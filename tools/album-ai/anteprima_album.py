"""Anteprima visiva di piano-album.json: una immagine per doppia pagina con le foto vere, più album.html da sfogliare.

Geometria come Album Flow: foglio 30×30 cm per pagina (doppia 60×30), aree full/half/third/two-thirds, margine
dell'area 0,6 cm, spazio tra le foto 0,2 cm, modalità «foto intera» (le divisioni si adattano alle proporzioni delle foto,
come naturalRatios, e il blocco si centra nell'area). Gli originali si aprono solo in lettura.
"""
import html
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from crea_provini import RAW_EXT, anteprima_raw, trova_exiftool  # noqa: E402

QUI = Path(__file__).resolve().parent
sys.path.insert(0, str(QUI))
from dati import DATI  # noqa: E402
OUT = DATI / "anteprime"
CACHE = OUT / "cache"
PX_CM = 40
PAGE_CM = 30
PADDING_CM = 0.6
GAP_CM = 0.2


def carica(asset, exe):
    """Anteprima 1200 px della foto, raddrizzata, in cache."""
    dest = CACHE / (Path(asset["fileName"]).stem + ".jpg")
    if dest.exists():
        return Image.open(dest).convert("RGB")
    path = Path(asset["absolutePath"])
    if path.suffix.lower() in RAW_EXT:
        orient = asset.get("_orient", 1)
        img = anteprima_raw(exe, path, orient)
    else:
        from PIL import ImageOps
        img = Image.open(path)
        img.draft("RGB", (1600, 1600))
        img = ImageOps.exif_transpose(img).convert("RGB")
    img.thumbnail((1200, 1200), Image.LANCZOS)
    img.save(dest, quality=85)
    return img


def aspect(node, aspects):
    if node["kind"] == "leaf":
        return aspects[node["itemId"]]
    a, b = aspect(node["first"], aspects), aspect(node["second"], aspects)
    return a + b if node["dir"] == "row" else 1 / (1 / a + 1 / b)


def disponi(node, rect, aspects, gap, out):
    """Divide il rettangolo come naturalRatios: ogni ramo prende lo spazio adatto alle sue foto."""
    x, y, w, h = rect
    if node["kind"] == "leaf":
        out[node["itemId"]] = rect
        return
    a, b = aspect(node["first"], aspects), aspect(node["second"], aspects)
    if node["dir"] == "row":
        r = a / (a + b)
        w1 = (w - gap) * r
        disponi(node["first"], (x, y, w1, h), aspects, gap, out)
        disponi(node["second"], (x + w1 + gap, y, w - gap - w1, h), aspects, gap, out)
    else:
        r = (1 / a) / (1 / a + 1 / b)
        h1 = (h - gap) * r
        disponi(node["first"], (x, y, w, h1), aspects, gap, out)
        disponi(node["second"], (x, y + h1 + gap, w, h - gap - h1), aspects, gap, out)


def aree(split):
    W, H = 2 * PAGE_CM * PX_CM, PAGE_CM * PX_CM
    if split == "full":
        return [(0, 0, W, H)]
    sx = {"half": 0.5, "third": 1 / 3, "two-thirds": 2 / 3}[split]
    return [(0, 0, W * sx, H), (W * sx, 0, W * (1 - sx), H)]


def main():
    piano = json.loads((QUI / "piano-album.json").read_text(encoding="utf-8"))
    schede = {s["nome"]: s for s in json.loads((DATI / "schede.json").read_text(encoding="utf-8"))}
    CACHE.mkdir(parents=True, exist_ok=True)
    exe = trova_exiftool(None)
    assets = {a["id"]: a for a in piano["assets"]}
    # Orientamento EXIF dei RAW (serve a raddrizzare l'anteprima incorporata).
    raw = [a for a in assets.values() if Path(a["fileName"]).suffix.lower() in RAW_EXT
           and not (CACHE / (Path(a["fileName"]).stem + ".jpg")).exists()]
    if raw:
        from crea_provini import exif_con_exiftool
        dati = exif_con_exiftool(exe, [Path(a["absolutePath"]) for a in raw])
        for a in raw:
            a["_orient"] = int(dati.get(a["absolutePath"].lower(), {}).get("Orientation") or 1)

    pad, gap = PADDING_CM * PX_CM, GAP_CM * PX_CM
    W, H = 2 * PAGE_CM * PX_CM, PAGE_CM * PX_CM
    schede_html = []
    for sp in piano["spreads"]:
        foglio = Image.new("RGB", (W, H), "white")
        draw = ImageDraw.Draw(foglio)
        for area, (ax, ay, aw, ah) in zip(sp["areas"], aree(sp["split"])):
            imgs = {it["id"]: carica(assets[it["assetId"]], exe) for it in area["items"]}
            aspects = {k: v.width / v.height for k, v in imgs.items()}
            stile = area.get("style", {})
            if stile.get("mode") == "fill" and len(area["items"]) == 1:
                # «Riempi»: la foto copre tutta l'area, rifilata al centro.
                img = next(iter(imgs.values()))
                s = max(aw / img.width, ah / img.height)
                big = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
                l, t = (big.width - aw) / 2, (big.height - ah) / 2
                foglio.paste(big.crop((round(l), round(t), round(l + aw), round(t + ah))), (round(ax), round(ay)))
                continue
            inner = (ax + pad, ay + pad, aw - 2 * pad, ah - 2 * pad)
            # Blocco intero «foto intera»: proporzione del layout, centrato nell'area utile.
            asp = aspect(area["layout"], aspects)
            bw, bh = inner[2], inner[2] / asp
            if bh > inner[3]:
                bh, bw = inner[3], inner[3] * asp
            celle = {}
            disponi(area["layout"], (inner[0] + (inner[2] - bw) / 2, inner[1] + (inner[3] - bh) / 2, bw, bh), aspects, gap, celle)
            for item_id, (x, y, w, h) in celle.items():
                img = imgs[item_id]
                # Dentro la cella la foto è intera (eventuale scarto di pochi px per il gap).
                s = min(w / img.width, h / img.height)
                tw, th = max(1, round(img.width * s)), max(1, round(img.height * s))
                foglio.paste(img.resize((tw, th), Image.LANCZOS), (round(x + (w - tw) / 2), round(y + (h - th) / 2)))
        draw.line([(W / 2, 0), (W / 2, H)], fill=(220, 220, 220), width=2)  # piega
        nome = f"doppia_{sp['numero']:02d}.jpg"
        foglio.save(OUT / nome, quality=86)
        foto = [it["fileName"] for a in sp["areas"] for it in a["items"]]
        dettagli = ", ".join(f"{n} ({schede[n]['forza']}★)" for n in foto)
        schede_html.append(
            f'<section id="d{sp["numero"]}"><h2><span>{sp["numero"]}</span> {html.escape(sp["momento"])}</h2>'
            f'<img src="{nome}" loading="lazy" alt="Doppia {sp["numero"]}">'
            f'<p class="perche">{html.escape(sp["motivazione"])}</p>'
            f'<p class="foto">{html.escape(" | ".join(a["templateName"] for a in sp["areas"]))} — {html.escape(dettagli)}</p></section>')
        print(f"  doppia {sp['numero']:02d}")

    indice = " ".join(f'<a href="#d{sp["numero"]}">{sp["numero"]}</a>' for sp in piano["spreads"])
    pagina = f"""<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>Anteprima album</title>
<style>
body{{margin:0;background:#1f2421;color:#e9e4da;font-family:-apple-system,Segoe UI,Roboto,sans-serif}}
header{{position:sticky;top:0;background:#2b312d;padding:12px 24px;z-index:2;border-bottom:1px solid #3a413c}}
header h1{{margin:0 0 6px;font-size:18px;color:#b89a63}} nav a{{color:#cfc7b8;margin-right:8px;font-size:13px;text-decoration:none}}
main{{max-width:1500px;margin:0 auto;padding:24px}} section{{margin:0 0 48px}}
h2{{font-size:16px;font-weight:600;margin:0 0 10px}} h2 span{{color:#b89a63;margin-right:6px}}
img{{width:100%;display:block;box-shadow:0 6px 30px rgba(0,0,0,.45);border-radius:2px}}
.perche{{margin:10px 0 4px;font-size:15px}} .foto{{margin:0;font-size:12px;color:#9c9588}}
</style></head><body><header><h1>Anteprima — {len(piano['spreads'])} doppie pagine, {piano['album']['numeroFoto']} foto (piano AI)</h1>
<nav>{indice}</nav></header><main>{''.join(schede_html)}</main></body></html>"""
    (OUT / "album.html").write_text(pagina, encoding="utf-8")
    print(f"Fatto: {OUT / 'album.html'}")


if __name__ == "__main__":
    main()
