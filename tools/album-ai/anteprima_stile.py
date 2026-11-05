"""Anteprima di un piano con stili per area (al vivo «fill», pausa «fit» con margine, pagina di testo).

Uso: python anteprima_stile.py [piano.json] [cartella_uscita]
Riusa la cache delle foto di anteprima_album.py. Le celle seguono i rapporti salvati nel layout, come Album Flow;
in «fill» ogni foto copre la sua cella (rifilata al centro), in «fit» il blocco mantiene le proporzioni delle foto.
"""
import html
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
import anteprima_album as base  # noqa: E402
from crea_provini import RAW_EXT, exif_con_exiftool, trova_exiftool  # noqa: E402

QUI = Path(__file__).resolve().parent
sys.path.insert(0, str(QUI))
from dati import DATI  # noqa: E402
PX_CM = 30


def celle(node, rect, gap, out):
    x, y, w, h = rect
    if node["kind"] == "leaf":
        out[node["itemId"]] = rect
        return
    r = node["ratio"]
    if node["dir"] == "row":
        w1 = (w - gap) * r
        celle(node["first"], (x, y, w1, h), gap, out)
        celle(node["second"], (x + w1 + gap, y, w - gap - w1, h), gap, out)
    else:
        h1 = (h - gap) * r
        celle(node["first"], (x, y, w, h1), gap, out)
        celle(node["second"], (x, y + h1 + gap, w, h - gap - h1), gap, out)


CARATTERI = {"bodoni-moda": ("bod_r.ttf", "georgia.ttf"), "jost": ("segoeui.ttf", "arial.ttf"),
             "cormorant": ("georgiai.ttf", "georgia.ttf")}


def carattere(nome, punti, corsivo=False):
    """Font di sistema simile a quello del progetto (anteprima, non tipografia definitiva)."""
    px = max(8, round(punti * 0.0353 * PX_CM))
    for f in CARATTERI.get(nome, ("georgia.ttf",)) + (("georgiai.ttf",) if corsivo else ()):
        try:
            return ImageFont.truetype(f, px)
        except OSError:
            continue
    return ImageFont.load_default()


def copri(img, w, h, zoom=1.0, cx=0.5, cy=0.5):
    """Riempie la cella; zoom > 1 stringe il ritaglio attorno al punto (cx, cy), come gli item di Album Flow."""
    s = max(w / img.width, h / img.height) * max(1.0, zoom)
    big = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)
    l = min(max(0, cx * big.width - w / 2), big.width - w)
    t = min(max(0, cy * big.height - h / 2), big.height - h)
    return big.crop((round(l), round(t), round(l) + round(w), round(t) + round(h)))


def main():
    piano_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DATI / "piano-album-stile.json"
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else DATI / "anteprime-stile"
    out.mkdir(exist_ok=True)
    base.CACHE.mkdir(parents=True, exist_ok=True)
    piano = json.loads(piano_path.read_text(encoding="utf-8"))
    sheet = piano["progetto"]["sheet"]
    PW, H = round(sheet["widthCm"] * PX_CM), round(sheet["heightCm"] * PX_CM)
    W = 2 * PW
    exe = trova_exiftool(None)
    assets = {a["id"]: a for a in piano["assets"]}
    nuove = [a for a in assets.values() if Path(a["fileName"]).suffix.lower() in RAW_EXT
             and not (base.CACHE / (Path(a["fileName"]).stem + ".jpg")).exists()]
    if nuove:
        dati = exif_con_exiftool(exe, [Path(a["absolutePath"]) for a in nuove])
        for a in nuove:
            a["_orient"] = int(dati.get(a["absolutePath"].lower(), {}).get("Orientation") or 1)
    try:
        f_titolo = ImageFont.truetype("georgia.ttf", 60)
    except OSError:
        f_titolo = ImageFont.load_default()

    sezioni = []
    for sp in piano["spreads"]:
        foglio = Image.new("RGB", (W, H), "white")
        draw = ImageDraw.Draw(foglio)
        rects = [(0, 0, W, H)] if sp["split"] == "full" else [(0, 0, PW, H), (PW, 0, PW, H)]
        for area, (ax, ay, aw, ah) in zip(sp["areas"], rects):
            st = area["style"]
            draw.rectangle([ax, ay, ax + aw, ay + ah], fill=st.get("background", "#ffffff"))
            if not area["items"]:
                if area.get("apertura"):
                    # Segnaposto del logo: lo inserisce Gennaro.
                    cx, cy, r = ax + aw / 2, ay + ah * 0.3, 52
                    draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(205, 191, 159), width=2)
                    f = carattere("jost", 15)
                    bb = draw.textbbox((0, 0), "LOGO", font=f)
                    draw.text((cx - bb[2] / 2, cy - bb[3] / 2), "LOGO", font=f, fill=(205, 191, 159))
                continue
            imgs = {it["id"]: base.carica(assets[it["assetId"]], exe) for it in area["items"]}
            pad, gap = st["paddingCm"] * PX_CM, st["gapCm"] * PX_CM
            inner = (ax + pad, ay + pad, aw - 2 * pad, ah - 2 * pad)
            if st["mode"] == "fit":
                aspects = {k: v.width / v.height for k, v in imgs.items()}
                asp = base.aspect(area["layout"], aspects)
                bw, bh = inner[2], inner[2] / asp
                if bh > inner[3]:
                    bh, bw = inner[3], inner[3] * asp
                c = {}
                base.disponi(area["layout"], (inner[0] + (inner[2] - bw) / 2, inner[1] + (inner[3] - bh) / 2, bw, bh), aspects, gap, c)
            else:
                c = {}
                celle(area["layout"], inner, gap, c)
            per_id = {it["id"]: it for it in area["items"]}
            for iid, (x, y, w, h) in c.items():
                it = per_id[iid]
                tassello = copri(imgs[iid], w, h, it.get("zoom", 1), it.get("cx", 0.5), it.get("cy", 0.5))
                if st.get("mono"):
                    tassello = tassello.convert("L").convert("RGB")
                foglio.paste(tassello, (round(x), round(y)))
        for o in sp.get("overlays", []):
            testo = o["text"].upper() if o.get("uppercase") else o["text"]
            if o.get("trackingEm", 0) >= 0.2:
                testo = " ".join(testo)
            f = carattere(o["font"], o["sizePt"], o.get("italic"))
            bb = draw.textbbox((0, 0), testo, font=f)
            x0, larg = o["x"] * W, o["w"] * W
            draw.text((x0 + (larg - bb[2]) / 2, o["y"] * H - bb[3] / 2), testo, font=f, fill=o["color"])
        draw.line([(PW, 0), (PW, H)], fill=(200, 200, 200), width=1)
        nome = f"doppia_{sp['numero']:02d}.jpg"
        foglio.save(out / nome, quality=85)
        sezioni.append(f'<section id="d{sp["numero"]}"><h2><span>{sp["numero"]}</span> {html.escape(sp["momento"])}</h2>'
                       f'<img src="{nome}" loading="lazy" alt="Doppia {sp["numero"]}"><p class="perche">{html.escape(sp["motivazione"])}</p></section>')
        print(f"  doppia {sp['numero']:02d}")
    ctrl = piano.get("controlli", {})
    esito = ", ".join(f"{k}: {v}" for k, v in ctrl.get("esito", {}).items())
    viol = "; ".join(ctrl.get("violazioni", [])) or "nessuna"
    indice = " ".join(f'<a href="#d{s["numero"]}">{s["numero"]}</a>' for s in piano["spreads"])
    pagina = f"""<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>{html.escape(piano['progetto']['projectName'])}</title>
<style>body{{margin:0;background:#1f2421;color:#e9e4da;font-family:-apple-system,Segoe UI,Roboto,sans-serif}}
header{{position:sticky;top:0;background:#2b312d;padding:12px 24px;z-index:2;border-bottom:1px solid #3a413c}}
header h1{{margin:0 0 4px;font-size:18px;color:#b89a63}} header p{{margin:0 0 6px;font-size:12px;color:#9c9588}}
nav a{{color:#cfc7b8;margin-right:8px;font-size:13px;text-decoration:none}}
main{{max-width:1600px;margin:0 auto;padding:24px}} section{{margin:0 0 44px}} h2{{font-size:16px;margin:0 0 10px}} h2 span{{color:#b89a63;margin-right:6px}}
img{{width:100%;display:block;box-shadow:0 6px 30px rgba(0,0,0,.45)}} .perche{{margin:10px 0 0;font-size:14px}}</style></head>
<body><header><h1>{html.escape(piano['progetto']['projectName'])}</h1><p>Profilo: {html.escape(piano.get('profilo', ''))} — {html.escape(esito)} — violazioni: {html.escape(viol)}</p>
<nav>{indice}</nav></header><main>{''.join(sezioni)}</main></body></html>"""
    (out / "album.html").write_text(pagina, encoding="utf-8")
    print("Fatto:", out / "album.html")


if __name__ == "__main__":
    main()
