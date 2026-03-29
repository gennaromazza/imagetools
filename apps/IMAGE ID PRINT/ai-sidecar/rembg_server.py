from io import BytesIO
import os
import numpy as np
import cv2
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from PIL import Image
from rembg import remove

app = Flask(__name__)
CORS(app)

MAX_UPLOAD_MB = 50
MAX_PIXELS = 12000 * 12000


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def parse_background_refine(form_value: str | None) -> float:
    if not form_value:
        return 0.35
    try:
        return clamp01(float(form_value))
    except Exception:
        return 0.35


def refine_background_edges(output_png_bytes: bytes, refine_strength: float) -> bytes:
    if refine_strength <= 0.001:
        return output_png_bytes

    with Image.open(BytesIO(output_png_bytes)) as out_img:
        rgba = np.array(out_img.convert("RGBA"), dtype=np.uint8)

    rgb = rgba[:, :, :3].astype(np.float32)
    alpha = rgba[:, :, 3].astype(np.float32) / 255.0

    # Tighten low-opacity fringe to cut residual background noise.
    edge_tighten = np.clip((0.55 - alpha) / 0.55, 0.0, 1.0) * refine_strength
    alpha_refined = np.clip(alpha - edge_tighten * 0.35, 0.0, 1.0)

    # Decontaminate color spill near semi-transparent hair borders.
    fringe_weight = np.clip((0.75 - alpha_refined) / 0.75, 0.0, 1.0) * refine_strength
    rgb = rgb + (255.0 - rgb) * (fringe_weight[..., None] * 0.55)

    rgba[:, :, :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    rgba[:, :, 3] = np.clip(alpha_refined * 255.0, 0, 255).astype(np.uint8)

    out_io = BytesIO()
    Image.fromarray(rgba, mode="RGBA").save(out_io, format="PNG")
    return out_io.getvalue()


@app.get("/health")
def health():
    return jsonify({"ok": True, "service": "rembg-sidecar"})


@app.post("/remove-background")
def remove_background():
    if "image" not in request.files:
        return jsonify({"error": "Missing image file field: image"}), 400

    file = request.files["image"]
    image_bytes = file.read()

    if not image_bytes:
        return jsonify({"error": "Empty image payload"}), 400

    if len(image_bytes) > MAX_UPLOAD_MB * 1024 * 1024:
        return jsonify({"error": f"Image too large (> {MAX_UPLOAD_MB}MB)"}), 413

    try:
        with Image.open(BytesIO(image_bytes)) as img:
            if img.width * img.height > MAX_PIXELS:
                return jsonify({"error": "Image resolution too large"}), 413
    except Exception:
        return jsonify({"error": "Invalid image format"}), 400

    try:
        refine_strength = parse_background_refine(request.form.get("backgroundRefine"))

        alpha_matting = refine_strength >= 0.2
        fg_threshold = int(235 + refine_strength * 20)
        bg_threshold = int(max(5, 30 - refine_strength * 20))
        erode_size = int(3 + refine_strength * 12)

        output = remove(
            image_bytes,
            alpha_matting=alpha_matting,
            alpha_matting_foreground_threshold=min(255, fg_threshold),
            alpha_matting_background_threshold=max(1, bg_threshold),
            alpha_matting_erode_structure_size=max(1, erode_size),
        )
        output = refine_background_edges(output, refine_strength)
        out_io = BytesIO(output)
        out_io.seek(0)
        return send_file(out_io, mimetype="image/png")
    except Exception as exc:
        return jsonify({"error": f"Background removal failed: {str(exc)}"}), 500


@app.post("/detect-face")
def detect_face():
    if "image" not in request.files:
        return jsonify({"error": "Missing image file field: image"}), 400

    file = request.files["image"]
    image_bytes = file.read()

    if not image_bytes:
        return jsonify({"error": "Empty image payload"}), 400

    if len(image_bytes) > MAX_UPLOAD_MB * 1024 * 1024:
        return jsonify({"error": f"Image too large (> {MAX_UPLOAD_MB}MB)"}), 413

    try:
        with Image.open(BytesIO(image_bytes)) as img:
            if img.width * img.height > MAX_PIXELS:
                return jsonify({"error": "Image resolution too large"}), 413
            rgb = img.convert("RGB")
            width, height = rgb.size
            np_img = np.array(rgb)
    except Exception:
        return jsonify({"error": "Invalid image format"}), 400

    try:
        gray = cv2.cvtColor(np_img, cv2.COLOR_RGB2GRAY)
        cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )
        faces = cascade.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(60, 60),
        )

        if len(faces) == 0:
            return jsonify({"ok": False, "face": None}), 404

        x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
        return jsonify(
            {
                "ok": True,
                "image": {"width": int(width), "height": int(height)},
                "face": {
                    "x": int(x),
                    "y": int(y),
                    "width": int(w),
                    "height": int(h),
                    "xNorm": float(x / width),
                    "yNorm": float(y / height),
                    "wNorm": float(w / width),
                    "hNorm": float(h / height),
                },
            }
        )
    except Exception as exc:
        return jsonify({"error": f"Face detection failed: {str(exc)}"}), 500


if __name__ == "__main__":
    # Keep host/port aligned with frontend default endpoint.
    port = int(os.environ.get("IMAGE_ID_PRINT_AI_PORT", "7010"))
    app.run(host="127.0.0.1", port=port, debug=False)
