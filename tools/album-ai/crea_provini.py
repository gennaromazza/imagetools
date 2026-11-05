"""
Crea i provini per la prova di impaginazione AI di Album Flow.

Prende l'elenco dei nomi file copiato da Image Select Pro («Copia nomi»: un nome per riga;
vanno bene anche i percorsi completi di «Copia percorso»), cerca le foto nella cartella indicata
(anche nelle sottocartelle) e genera provini da 10 foto (5 x 2) con il nome del file sotto ogni foto.

Accanto ai provini scrive `foto.json`/`foto.csv` con, per ogni foto: numero, provino, nome, percorso,
orario di scatto, macchina (modello e seriale), misure e orientamento. Sono i dati EXIF che servono
all'analisi; gli originali si aprono solo in lettura e non vengono mai modificati.

Uso:
    python crea_provini.py --cartella "E:\\...\\selezione" --elenco nomi.txt
    python crea_provini.py --cartella "E:\\...\\selezione" --appunti      (legge l'elenco dagli appunti)

Richiede Pillow. Se trova exiftool (nel PATH o nei node_modules del repository) lo usa per
leggere orario con millisecondi e seriale della macchina; altrimenti usa gli EXIF letti da Pillow.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta
from dataclasses import dataclass, asdict
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp"}
RAW_EXT = {".cr2", ".cr3", ".nef", ".arw", ".raf", ".orf", ".rw2", ".dng", ".pef", ".srw"}

COLS, ROWS = 5, 2
CELL = 480          # lato del riquadro della miniatura, in pixel
CAPTION_H = 54      # spazio per il nome sotto la miniatura
GAP = 16
MARGIN = 24
HEADER_H = 44
BG = (255, 255, 255)
INK = (20, 20, 20)
MUTED = (110, 110, 110)


@dataclass
class Foto:
    numero: int
    provino: int
    posizione: int
    nome: str
    percorso: str
    orario: str | None
    orario_exif: str | None
    macchina: str | None
    seriale: str | None
    larghezza: int | None
    altezza: int | None
    orientamento: str | None


# ---------------------------------------------------------------------------
# Elenco dei nomi
# ---------------------------------------------------------------------------

def leggi_appunti() -> str:
    if sys.platform == "win32":
        out = subprocess.run(["powershell", "-NoProfile", "-Command", "Get-Clipboard -Raw"],
                             capture_output=True, text=True, encoding="utf-8")
        return out.stdout
    if sys.platform == "darwin":
        return subprocess.run(["pbpaste"], capture_output=True, text=True).stdout
    raise SystemExit("Lettura degli appunti non supportata su questo sistema: usa --elenco.")


def nomi_dall_elenco(testo: str) -> list[str]:
    """Un nome (o percorso) per riga, senza doppioni, nell'ordine dato."""
    visti: set[str] = set()
    nomi: list[str] = []
    for riga in testo.splitlines():
        riga = riga.strip().strip('"')
        if not riga:
            continue
        chiave = riga.lower()
        if chiave not in visti:
            visti.add(chiave)
            nomi.append(riga)
    return nomi


def indicizza_cartella(cartella: Path, escludi: set[str]) -> dict[str, list[Path]]:
    """Nome file (minuscolo) -> percorsi trovati, anche nelle sottocartelle (salvo quelle escluse)."""
    indice: dict[str, list[Path]] = {}
    for radice, dirs, files in os.walk(cartella):
        dirs[:] = [d for d in dirs if d.lower() not in escludi]
        for nome in files:
            if Path(nome).suffix.lower() in IMAGE_EXT | RAW_EXT:
                indice.setdefault(nome.lower(), []).append(Path(radice) / nome)
    return indice


def risolvi(nomi: list[str], cartella: Path, escludi: set[str]) -> tuple[list[Path], list[str], list[str]]:
    """
    Trasforma l'elenco in file da mettere nei provini. Se nell'elenco ci sono RAW e JPG della stessa foto
    (Image Select Pro copia anche il file gemello) si tiene una sola foto, preferendo il JPG.
    Restituisce (file, mancanti, avvisi).
    """
    indice = indicizza_cartella(cartella, escludi)
    trovati: list[Path] = []
    mancanti: list[str] = []
    avvisi: list[str] = []
    for voce in nomi:
        p = Path(voce)
        if p.is_absolute() and p.exists():
            trovati.append(p)
            continue
        candidati = indice.get(p.name.lower(), [])
        if not candidati:
            mancanti.append(voce)
            continue
        if len(candidati) > 1:
            avvisi.append(f"{p.name}: trovato in {len(candidati)} cartelle, uso {candidati[0]}")
        trovati.append(candidati[0])

    # Una foto per «radice» del nome: JPG prima del RAW.
    per_radice: dict[str, Path] = {}
    ordine: list[str] = []
    for f in trovati:
        radice = str(f.with_suffix("")).lower()
        if radice not in per_radice:
            per_radice[radice] = f
            ordine.append(radice)
        elif per_radice[radice].suffix.lower() in RAW_EXT and f.suffix.lower() in IMAGE_EXT:
            per_radice[radice] = f
    finali: list[Path] = []
    for radice in ordine:
        f = per_radice[radice]
        if f.suffix.lower() in RAW_EXT:
            # Cerca un JPG gemello non elencato.
            gemello = next((indice[k][0] for k in (f.stem.lower() + e for e in (".jpg", ".jpeg")) if k in indice), None)
            if gemello:
                f = gemello
        finali.append(f)
    return finali, mancanti, avvisi


# ---------------------------------------------------------------------------
# EXIF
# ---------------------------------------------------------------------------

def trova_exiftool(esplicito: str | None) -> str | None:
    if esplicito:
        return esplicito
    sul_path = shutil.which("exiftool")
    if sul_path:
        return sul_path
    for base in [Path(__file__).resolve(), *Path(__file__).resolve().parents]:
        for root in (base, Path("D:/IMAGETOOL_REMOTE")):
            exe = root / "node_modules" / "exiftool-vendored.exe" / "bin" / "exiftool.exe"
            if exe.exists():
                return str(exe)
    return None


def exif_con_exiftool(exe: str, files: list[Path]) -> dict[str, dict]:
    tag = ["-DateTimeOriginal", "-SubSecTimeOriginal", "-Model", "-SerialNumber", "-InternalSerialNumber",
           "-ImageWidth", "-ImageHeight", "-Orientation#"]
    with tempfile.NamedTemporaryFile("w", suffix=".args", delete=False, encoding="utf-8") as fh:
        fh.write("\n".join(str(f) for f in files))
        argfile = fh.name
    try:
        out = subprocess.run([exe, "-json", "-charset", "filename=utf8", *tag, "-@", argfile],
                             capture_output=True, text=True, encoding="utf-8")
        dati = json.loads(out.stdout or "[]")
    except (OSError, json.JSONDecodeError):
        return {}
    finally:
        os.unlink(argfile)
    return {str(Path(d["SourceFile"])).lower(): d for d in dati}


def exif_con_pillow(img: Image.Image) -> dict:
    ex = img.getexif()
    sub = ex.get_ifd(0x8769)  # Exif IFD
    return {
        "DateTimeOriginal": sub.get(0x9003) or ex.get(0x0132),
        "SubSecTimeOriginal": sub.get(0x9291),
        "Model": ex.get(0x0110),
        "SerialNumber": sub.get(0xA431),
    }


def formatta_orario(d: dict) -> str | None:
    dt = d.get("DateTimeOriginal")
    if not dt or not isinstance(dt, str):
        return None
    # "2026:06:05 11:42:07" -> "2026-06-05 11:42:07.123"
    data, _, ora = dt.partition(" ")
    s = f"{data.replace(':', '-')} {ora[:8]}"
    sub = d.get("SubSecTimeOriginal")
    if sub not in (None, ""):
        s += "." + str(sub).strip()[:3].ljust(3, "0")
    return s


def leggi_correzioni(voci: list[str]) -> dict[str, timedelta]:
    """«X-T3=-1d 00:12:30» -> {"x-t3": timedelta}. Il modello è quello EXIF (colonna «macchina»)."""
    correzioni: dict[str, timedelta] = {}
    for voce in voci:
        modello, _, valore = voce.partition("=")
        valore = valore.strip()
        segno = -1 if valore.startswith("-") else 1
        valore = valore.lstrip("+-").strip()
        giorni = 0
        if "d" in valore:
            g, _, valore = valore.partition("d")
            giorni = int(g)
        parti = [int(x) for x in valore.strip().split(":")] if valore.strip() else []
        parti += [0] * (3 - len(parti))
        delta = timedelta(days=giorni, hours=parti[0], minutes=parti[1], seconds=parti[2])
        correzioni[modello.strip().lower()] = segno * delta
    return correzioni


def delta_per(nome: str, modello: str, correzioni: dict[str, timedelta]) -> timedelta | None:
    """Prima gli intervalli di nomi («DSCF9001..DSCF9548»), poi il modello della macchina."""
    radice = Path(nome).stem.lower()
    for chiave, delta in correzioni.items():
        if ".." in chiave:
            da, _, a = chiave.partition("..")
            da, a = Path(da.strip()).stem, Path(a.strip()).stem
            if len(radice) == len(da) and da <= radice <= a:
                return delta
    return correzioni.get(modello.strip().lower())


def orario_corretto(dati: dict, nome: str, correzioni: dict[str, timedelta]) -> str | None:
    testo = formatta_orario(dati)
    if not testo:
        return None
    delta = delta_per(nome, str(dati.get("Model") or ""), correzioni)
    if not delta:
        return testo
    dt = datetime.strptime(testo[:19], "%Y-%m-%d %H:%M:%S") + delta
    return dt.strftime("%Y-%m-%d %H:%M:%S") + testo[19:]


# ---------------------------------------------------------------------------
# Provini
# ---------------------------------------------------------------------------

def carica_font(size: int) -> ImageFont.ImageFont:
    for nome in ("arialbd.ttf", "Arial Bold.ttf", "DejaVuSans-Bold.ttf", "Helvetica.ttc"):
        try:
            return ImageFont.truetype(nome, size)
        except OSError:
            continue
    return ImageFont.load_default()


ROTAZIONE = {3: Image.Transpose.ROTATE_180, 6: Image.Transpose.ROTATE_270, 8: Image.Transpose.ROTATE_90}


def anteprima_raw(exe: str | None, path: Path, orientamento: int) -> Image.Image | None:
    """Anteprima JPG incorporata nel RAW (CR2, RAF, …), raddrizzata con l'orientamento EXIF del RAW."""
    if not exe:
        return None
    for tag in ("-PreviewImage", "-JpgFromRaw", "-ThumbnailImage"):
        out = subprocess.run([exe, "-b", tag, str(path)], capture_output=True)
        if len(out.stdout) > 1000:
            img = Image.open(io.BytesIO(out.stdout))
            img.draft("RGB", (CELL * 2, CELL * 2))
            img = img.convert("RGB")
            if orientamento in ROTAZIONE:
                img = img.transpose(ROTAZIONE[orientamento])
            return img
    return None


def miniatura(path: Path, exe: str | None, orientamento: int) -> tuple[Image.Image | None, Image.Image | None]:
    """(miniatura già raddrizzata, immagine originale per gli EXIF; None per i RAW). Apre il file solo in lettura."""
    try:
        if path.suffix.lower() in RAW_EXT:
            thumb = anteprima_raw(exe, path, orientamento)
            if thumb is not None:
                thumb.thumbnail((CELL, CELL), Image.LANCZOS)
            return thumb, None
        img = Image.open(path)
        img.draft("RGB", (CELL * 2, CELL * 2))  # decodifica JPEG ridotta: molto più veloce
        thumb = ImageOps.exif_transpose(img).convert("RGB")
        thumb.thumbnail((CELL, CELL), Image.LANCZOS)
        return thumb, img
    except Exception:
        return None, None


def scrivi_testo_centrato(draw: ImageDraw.ImageDraw, cx: int, y: int, testo: str, font, fill, max_w: int) -> None:
    while draw.textlength(testo, font=font) > max_w and len(testo) > 4:
        testo = "…" + testo[2:]
    w = draw.textlength(testo, font=font)
    draw.text((cx - w / 2, y), testo, font=font, fill=fill)


def disegna_provino(numero: int, totale: int, voci: list[tuple[Foto, Image.Image | None]], titolo: str) -> Image.Image:
    w = MARGIN * 2 + COLS * CELL + (COLS - 1) * GAP
    h = MARGIN * 2 + HEADER_H + ROWS * (CELL + CAPTION_H) + (ROWS - 1) * GAP
    foglio = Image.new("RGB", (w, h), BG)
    draw = ImageDraw.Draw(foglio)
    f_nome = carica_font(30)
    f_head = carica_font(26)
    draw.text((MARGIN, MARGIN), f"{titolo} — provino {numero:03d} di {totale:03d}", font=f_head, fill=MUTED)
    for i, (foto, thumb) in enumerate(voci):
        r, c = divmod(i, COLS)
        x0 = MARGIN + c * (CELL + GAP)
        y0 = MARGIN + HEADER_H + r * (CELL + CAPTION_H + GAP)
        if thumb is not None:
            foglio.paste(thumb, (x0 + (CELL - thumb.width) // 2, y0 + (CELL - thumb.height) // 2))
        else:
            draw.rectangle([x0, y0, x0 + CELL, y0 + CELL], outline=MUTED, width=2)
            scrivi_testo_centrato(draw, x0 + CELL // 2, y0 + CELL // 2 - 15, "non leggibile", f_nome, MUTED, CELL - 20)
        # Nome del file ben leggibile sotto la miniatura (senza estensione non si perde nulla, ma la teniamo).
        scrivi_testo_centrato(draw, x0 + CELL // 2, y0 + CELL + 10, foto.nome, f_nome, INK, CELL - 8)
    return foglio


def main() -> int:
    ap = argparse.ArgumentParser(description="Provini da 10 foto con il nome sotto ogni foto, dall'elenco di Image Select Pro.")
    ap.add_argument("--cartella", required=True, help="cartella delle foto (si cerca anche nelle sottocartelle)")
    sorgente = ap.add_mutually_exclusive_group(required=True)
    sorgente.add_argument("--elenco", help="file di testo con un nome (o percorso) per riga")
    sorgente.add_argument("--appunti", action="store_true", help="legge l'elenco dagli appunti (dopo «Copia nomi»)")
    ap.add_argument("--uscita", required=True, help="cartella dei provini (di solito tools/album-ai/lavori/<lavoro>/provini)")
    ap.add_argument("--ordine", choices=["scatto", "elenco"], default="scatto",
                    help="«scatto» ordina per orario EXIF (predefinito); «elenco» tiene l'ordine dei nomi")
    ap.add_argument("--titolo", default="Album Flow — prova AI", help="testo in alto su ogni provino")
    ap.add_argument("--exiftool", help="percorso di exiftool, se non lo trova da solo")
    ap.add_argument("--escludi", action="append", default=[], metavar="SOTTOCARTELLA",
                    help="nome di una sottocartella da ignorare (copie, backup); si può ripetere")
    ap.add_argument("--correggi", action="append", default=[], metavar="MODELLO|DA..A=±[Nd ]HH:MM:SS",
                    help="sposta l'orario di una macchina (\"X-T3=-1d\") o di un intervallo di file "
                         "(\"DSCF9001..DSCF9548=-1d 00:00:00\") con l'orologio sbagliato; si può ripetere")
    ap.add_argument("--solo-verifica", action="store_true",
                    help="non crea i provini: dice quali nomi non trova e quali trova in più cartelle")
    args = ap.parse_args()

    cartella = Path(args.cartella)
    if not cartella.is_dir():
        raise SystemExit(f"Cartella non trovata: {cartella}")
    testo = leggi_appunti() if args.appunti else Path(args.elenco).read_text(encoding="utf-8-sig")
    nomi = nomi_dall_elenco(testo)
    if not nomi:
        raise SystemExit("L'elenco è vuoto.")

    files, mancanti, avvisi = risolvi(nomi, cartella, {e.lower() for e in args.escludi})
    print(f"Nomi nell'elenco: {len(nomi)}, foto trovate: {len(files)}, non trovate: {len(mancanti)}")
    if args.solo_verifica:
        for m in mancanti:
            print("  NON TROVATA:", m)
        for a in avvisi:
            print("  DOPPIONE:", a)
        return 0
    if not files:
        raise SystemExit("Nessuna foto trovata: controlla la cartella.")

    exe = trova_exiftool(args.exiftool)
    exif_ext = exif_con_exiftool(exe, files) if exe else {}
    print("EXIF letti con " + ("exiftool" if exif_ext else "Pillow"))

    # Prima passata: miniature + dati.
    righe: list[tuple[Path, dict, Image.Image | None, tuple[int, int] | None]] = []
    for i, f in enumerate(files, 1):
        dati = exif_ext.get(str(f).lower(), {})
        try:
            orient = int(dati.get("Orientation") or 1)
        except (TypeError, ValueError):
            orient = 1
        thumb, img = miniatura(f, exe, orient)
        if not dati and img is not None:
            dati = exif_con_pillow(img)
        size = None
        if img is not None:
            size = img.size
            if (img.getexif().get(0x0112) or 1) in (5, 6, 7, 8):
                size = (size[1], size[0])
            img.close()
        elif thumb is not None:
            # RAW: le proporzioni vere sono quelle dell'anteprima già raddrizzata; le misure dal RAW.
            rw, rh = dati.get("ImageWidth"), dati.get("ImageHeight")
            if isinstance(rw, int) and isinstance(rh, int):
                lungo, corto = max(rw, rh), min(rw, rh)
                size = (lungo, corto) if thumb.width >= thumb.height else (corto, lungo)
            else:
                size = thumb.size
        if f.suffix.lower() in RAW_EXT and thumb is None:
            avvisi.append(f"{f.name}: RAW senza anteprima leggibile" + ("" if exe else " (exiftool non trovato)"))
        righe.append((f, dati, thumb, size))
        if i % 50 == 0:
            print(f"  {i}/{len(files)}")

    correzioni = leggi_correzioni(args.correggi)
    for f, dati, _t, _s in righe:
        dati["_orario"] = orario_corretto(dati, f.name, correzioni)

    # Riepilogo per macchina: serve a scoprire gli orologi sfasati (stesso momento, orari diversi).
    per_macchina: dict[str, list[str]] = {}
    for f, dati, _t, _s in righe:
        chiave = f"{dati.get('Model') or '?'} ({dati.get('SerialNumber') or dati.get('InternalSerialNumber') or 's/n ?'})"
        if dati["_orario"]:
            per_macchina.setdefault(chiave, []).append(dati["_orario"])
    print("Orari per macchina" + (" (dopo le correzioni)" if correzioni else "") + ":")
    for chiave, orari in sorted(per_macchina.items(), key=lambda kv: min(kv[1])):
        print(f"  {chiave}: {len(orari)} foto, dalle {min(orari)[:16]} alle {max(orari)[:16]}")

    if args.ordine == "scatto":
        righe.sort(key=lambda r: (r[1]["_orario"] or "9999", r[0].name.lower()))

    uscita = Path(args.uscita)
    uscita.mkdir(parents=True, exist_ok=True)
    totale = (len(righe) + COLS * ROWS - 1) // (COLS * ROWS)
    schede: list[Foto] = []
    for p in range(totale):
        blocco = righe[p * COLS * ROWS:(p + 1) * COLS * ROWS]
        voci = []
        for j, (f, dati, thumb, size) in enumerate(blocco):
            w, h = size if size else (None, None)
            foto = Foto(
                numero=p * COLS * ROWS + j + 1, provino=p + 1, posizione=j + 1, nome=f.name, percorso=str(f),
                orario=dati["_orario"], orario_exif=formatta_orario(dati), macchina=(str(dati.get("Model")).strip() if dati.get("Model") else None),
                seriale=(str(dati.get("SerialNumber") or dati.get("InternalSerialNumber") or "").strip() or None),
                larghezza=w, altezza=h,
                orientamento=None if not size else ("orizzontale" if w > h else "verticale" if h > w else "quadrata"),
            )
            schede.append(foto)
            voci.append((foto, thumb))
        disegna_provino(p + 1, totale, voci, args.titolo).save(uscita / f"provino_{p + 1:03d}.jpg", quality=88)
        print(f"  provino {p + 1:03d}/{totale:03d}")

    (uscita / "foto.json").write_text(json.dumps([asdict(s) for s in schede], ensure_ascii=False, indent=2), encoding="utf-8")
    with open(uscita / "foto.csv", "w", newline="", encoding="utf-8-sig") as fh:
        wr = csv.DictWriter(fh, fieldnames=list(asdict(schede[0]).keys()), delimiter=";")
        wr.writeheader()
        wr.writerows(asdict(s) for s in schede)
    if mancanti or avvisi:
        (uscita / "avvisi.txt").write_text(
            "NON TROVATE:\n" + "\n".join(mancanti) + "\n\nAVVISI:\n" + "\n".join(avvisi) + "\n", encoding="utf-8")
        print(f"Vedi avvisi.txt ({len(mancanti)} non trovate, {len(avvisi)} avvisi)")
    print(f"Fatto: {totale} provini e {len(schede)} foto in {uscita}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
