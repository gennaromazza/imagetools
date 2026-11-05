"""Una o più immagini riassuntive per album: tutte le doppie in piccolo con il numero, per studiarne lo stile con pochi token.

Uso: python panoramica_album.py <cartella con i JPG delle doppie> <nome uscita> [per_immagine]
Gli originali si aprono solo in lettura.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

CELL_W, COLS, GAP, LABEL = 470, 5, 14, 26


def main():
    cartella, nome = Path(sys.argv[1]), sys.argv[2]
    per_immagine = int(sys.argv[3]) if len(sys.argv) > 3 else 25
    out = cartella.parent / "panoramiche"
    out.mkdir(exist_ok=True)
    files = sorted(f for f in cartella.glob("*.jpg") if f.name.lower().startswith(("page-", nome.split("_")[0].lower())) or "spread" in f.name.lower())
    if not files:
        files = sorted(cartella.glob("*.jpg"))
    try:
        font = ImageFont.truetype("arialbd.ttf", 20)
    except OSError:
        font = ImageFont.load_default()
    for parte in range(0, len(files), per_immagine):
        blocco = files[parte:parte + per_immagine]
        thumbs = []
        for f in blocco:
            img = Image.open(f)
            img.draft("RGB", (CELL_W * 2, CELL_W))
            img = img.convert("RGB")
            img.thumbnail((CELL_W, CELL_W), Image.LANCZOS)
            thumbs.append((f, img))
        row_h = max(t.height for _, t in thumbs) + LABEL + GAP
        rows = (len(thumbs) + COLS - 1) // COLS
        foglio = Image.new("RGB", (COLS * (CELL_W + GAP) + GAP, rows * row_h + GAP), (40, 40, 40))
        d = ImageDraw.Draw(foglio)
        for i, (f, t) in enumerate(thumbs):
            r, c = divmod(i, COLS)
            x, y = GAP + c * (CELL_W + GAP), GAP + r * row_h
            d.text((x, y), f"{parte + i + 1}  {f.stem[-12:]}", font=font, fill=(230, 200, 120))
            foglio.paste(t, (x, y + LABEL))
            if t.width / t.height > 1.6:  # piega al centro delle doppie
                d.line([(x + t.width // 2, y + LABEL), (x + t.width // 2, y + LABEL + t.height)], fill=(255, 60, 60), width=1)
        dest = out / f"{nome}_{parte // per_immagine + 1}.jpg"
        foglio.save(dest, quality=82)
        print(dest.name, foglio.size, len(blocco))


if __name__ == "__main__":
    main()
