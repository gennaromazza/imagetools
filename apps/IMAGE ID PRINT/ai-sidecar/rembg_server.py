from io import BytesIO
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
        output = remove(image_bytes)
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
    app.run(host="127.0.0.1", port=7010, debug=False)
