"""Gruppi di quasi doppioni, senza AI e senza riaprire gli originali.

Impronte dalle miniature già presenti nei provini (dHash 64 bit + colore medio), come il pacchetto photo-similarity
di Album Flow, più i legami scritti nelle schede («variante di 1354», «doppione di …», «gemella di …»).
Regole, come in photo-similarity ma con una finestra più larga perché qui si cercano anche pose ripetute:
- stesso capitolo del racconto, scattate entro FINESTRA secondi;
- impronte vicine (≤ VICINE bit) e colori simili, oppure raffica (≤ 3 s, stessa macchina e orientamento);
- nessuna catena: ogni coppia del gruppo resta entro LEGAME bit.
Scrive simili.json. Uso: python simili.py
"""
import json
import re
from datetime import datetime
from pathlib import Path
import sys

from PIL import Image

QUI = Path(__file__).resolve().parent
sys.path.insert(0, str(QUI))
from dati import DATI  # noqa: E402
FINESTRA = 180
VICINE = 14
LEGAME = 20
COLORE = 30
# Geometria dei provini (vedi crea_provini.py)
COLS, CELL, CAPTION_H, GAP, MARGIN, HEADER_H = 5, 480, 54, 16, 24, 44


def miniatura(provini, f):
    p = provini.setdefault(f["provino"], Image.open(DATI / "provini" / f"provino_{f['provino']:03d}.jpg").convert("RGB"))
    r, c = divmod(f["posizione"] - 1, COLS)
    x0, y0 = MARGIN + c * (CELL + GAP), MARGIN + HEADER_H + r * (CELL + CAPTION_H + GAP)
    w, h = f["larghezza"] or 3, f["altezza"] or 2
    s = CELL / max(w, h)
    tw, th = round(w * s), round(h * s)
    return p.crop((x0 + (CELL - tw) // 2, y0 + (CELL - th) // 2, x0 + (CELL - tw) // 2 + tw, y0 + (CELL - th) // 2 + th))


def impronta(img):
    g = img.convert("L").resize((9, 8), Image.LANCZOS)
    px = list(g.tobytes())
    bits = 0
    for y in range(8):
        for x in range(8):
            bits = (bits << 1) | (px[y * 9 + x] > px[y * 9 + x + 1])
    # Colore per zone (griglia 4×4): due persone diverse sullo stesso sfondo hanno la stessa media ma zone diverse.
    m = list(img.resize((4, 4), Image.LANCZOS).tobytes())
    return bits, m


def distanza(a, b):
    return bin(a ^ b).count("1")


def colore(a, b):
    """Distanza media di colore tra le 16 zone (0-441)."""
    return sum(sum((x - y) ** 2 for x, y in zip(a[k:k + 3], b[k:k + 3])) ** 0.5 for k in range(0, 48, 3)) / 16


def carica_impronte():
    """Impronte di tutte le foto (dHash + colore per zone), calcolate una volta e salvate in impronte.json."""
    path = DATI / "impronte.json"
    if path.exists():
        return {k: (v[0], v[1]) for k, v in json.loads(path.read_text(encoding="utf-8")).items()}
    foto = json.loads((DATI / "provini" / "foto.json").read_text(encoding="utf-8"))
    provini, out = {}, {}
    for f in foto:
        out[f["nome"]] = impronta(miniatura(provini, f))
    path.write_text(json.dumps({k: [v[0], v[1]] for k, v in out.items()}), encoding="utf-8")
    return out


def main():
    schede = json.loads((DATI / "schede.json").read_text(encoding="utf-8"))
    foto = {f["nome"]: f for f in json.loads((DATI / "provini" / "foto.json").read_text(encoding="utf-8"))}
    import motore_stile as m
    provini = {}
    dati = []
    for s in schede:
        h, col = impronta(miniatura(provini, foto[s["nome"]]))
        dati.append({"nome": s["nome"], "cap": m.capitolo_di(s), "t": datetime.strptime(s["orario"][:19], "%Y-%m-%d %H:%M:%S"),
                     "cam": s["seriale"], "o": s["orientamento"], "hash": h, "col": col, "note": s["note"]})
    per_radice = {Path(d["nome"]).stem[-4:]: d["nome"] for d in dati}
    indice = {d["nome"]: i for i, d in enumerate(dati)}

    # Legami dalle schede scritte dall'AI.
    legami_ai = set()
    for i, d in enumerate(dati):
        for ref in re.findall(r"(?:variante|doppione|gemella) di|simile a (?:\w+_)?([A-Z]*\d{4})", d["note"]):
            j = indice.get(per_radice.get(ref[-4:], ""))
            if j is not None and dati[j]["cap"] == d["cap"]:
                legami_ai.add((min(i, j), max(i, j)))

    archi = []
    for i in range(len(dati)):
        for j in range(i + 1, len(dati)):
            a, b = dati[i], dati[j]
            if a["cap"] != b["cap"] or a["cap"] is None:
                continue
            dt = abs((a["t"] - b["t"]).total_seconds())
            if (i, j) in legami_ai:
                archi.append((0, i, j, "schede"))
                continue
            if dt > FINESTRA:
                continue
            hd = distanza(a["hash"], b["hash"])
            dc = sum(sum((x - y) ** 2 for x, y in zip(a["col"][k:k + 3], b["col"][k:k + 3])) ** 0.5 for k in range(0, 48, 3)) / 16
            if dt <= 3 and a["cam"] == b["cam"] and a["o"] == b["o"] and hd <= 24:
                archi.append((hd, i, j, "raffica"))
            elif hd <= VICINE and dc <= COLORE and a["o"] == b["o"]:
                archi.append((hd, i, j, "quasi uguali"))
    archi.sort()
    gruppo = list(range(len(dati)))
    membri = {i: [i] for i in range(len(dati))}

    def radice(i):
        while gruppo[i] != i:
            gruppo[i] = gruppo[gruppo[i]]
            i = gruppo[i]
        return i

    for _, i, j, tipo in archi:
        ri, rj = radice(i), radice(j)
        if ri == rj:
            continue
        unione = membri[ri] + membri[rj]
        if tipo != "schede" and any(distanza(dati[x]["hash"], dati[y]["hash"]) > LEGAME for x in unione for y in unione if x < y
                                    and (x, y) not in legami_ai):
            continue
        if len(unione) > 8:
            continue
        gruppo[rj] = ri
        membri[ri] = sorted(unione, key=lambda k: dati[k]["t"])
        del membri[rj]
    gruppi = [[dati[k]["nome"] for k in v] for v in membri.values() if len(v) > 1]
    gruppi.sort(key=lambda g: indice[g[0]])
    (DATI / "simili.json").write_text(json.dumps({"finestraSecondi": FINESTRA, "vicineBit": VICINE, "gruppi": gruppi}, ensure_ascii=False, indent=1), encoding="utf-8")
    in_gruppo = sum(len(g) for g in gruppi)
    print(f"gruppi: {len(gruppi)}, foto in gruppi: {in_gruppo}, foto tolte tenendone una per gruppo: {in_gruppo - len(gruppi)}")
    print("legami dalle schede:", len(legami_ai))


if __name__ == "__main__":
    main()
