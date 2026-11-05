"""Prepara la scrittura delle schede di un lavoro (ALBUM_DATI).

1. In <DATI>/schede_parti/ scrive un file ogni 3 provini con una riga per foto, nel formato a 9 campi
       nome|momento|tipo|espressione|forza|piena|ruolo|soggetto|note
   da completare guardando i provini (i campi «?» vanno sostituiti). Se si passa --da <schede.json> di un altro
   lavoro con le stesse foto, copia quello che c'è già.
2. In <DATI>/vista/ unisce 3 provini in un'immagine larga 1800 px: è quella da guardare (meno token).
   I file esistenti in schede_parti/ non vengono sovrascritti.
Uso: ALBUM_DATI=<lavoro> python prepara_schede.py [--da schede.json] [--per-file 3]
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dati import DATI  # noqa: E402

MOM = {"preparazione sposa": "PSA", "preparazione sposo": "PSO", "cerimonia": "CER", "uscita": "USC",
       "ritratti di coppia": "COP", "ricevimento": "RIC", "dettagli": "DET", "altro": "ALT"}
TIPO = {"dettaglio": "D", "ritratto": "R", "mezzo busto": "MB", "figura intera": "FI", "gruppo": "G", "ambiente": "A"}
GUIDA = [
    ("firme", r"firm"), ("bouquet-suocera", r"suocer|consegna del bouquet"), ("torta", r"torta"),
    ("uscita-chiesa", r"\blanci|\briso\b|petal|coriandol"), ("rinfresco", r"rinfresc|buffet|aperitiv"),
    ("chiesa-intera", r"chiesa intera|dal fondo|panoram|grandangol"), ("ingresso", r"ingresso|entra|accompagn"),
    ("con-parenti", r"genitor|\bmadre\b|\bpadre\b|\bmamma\b|\bpap[aà]\b|testimon|nonn|fratell|sorell|suocer"),
    ("gruppo-posa", r"in posa|foto di gruppo|in camera"), ("vestizione", r"vest|abito|cravatt|gemell|scarp|trucc|acconc|velo"),
    ("ballo", r"\bball"), ("brindisi", r"brindis"),
]


def ruolo(s):
    t = (s["espressione"] + " " + s["note"]).lower()
    if s["tipo"] == "dettaglio":
        return "dettaglio-chiesa" if s["momento"] == "cerimonia" else "dettaglio"
    for r, p in GUIDA:
        if re.search(p, t):
            return r
    return {"ritratti di coppia": "coppia", "cerimonia": "rito", "ricevimento": "festa"}.get(s["momento"], "spontanea")


def main():
    import argparse
    from PIL import Image
    ap = argparse.ArgumentParser()
    ap.add_argument("--da")
    ap.add_argument("--per-file", type=int, default=3)
    args = ap.parse_args()
    vecchie = {Path(s["nome"]).stem.upper(): s for s in json.loads(Path(args.da).read_text(encoding="utf-8"))} if args.da else {}
    per_file = args.per_file
    foto = json.loads((DATI / "provini" / "foto.json").read_text(encoding="utf-8"))
    out = DATI / "schede_parti"
    out.mkdir(exist_ok=True)
    ultimo = max(f["provino"] for f in foto)
    for a in range(1, ultimo + 1, per_file):
        b = min(ultimo, a + per_file - 1)
        righe = ["# nome|momento|tipo|espressione|forza|piena|ruolo|soggetto(sx/c/dx)|note"]
        for f in sorted((f for f in foto if a <= f["provino"] <= b), key=lambda f: f["numero"]):
            s = vecchie.get(Path(f["nome"]).stem.upper())
            if not s:
                righe.append(f"{f['nome']}|?|?|?|3|n|?|c|")
                continue
            note = re.sub(r"\b(doppione di \S+|variante)\b;?", "", s["note"]).strip(" ;")
            righe.append("|".join([f["nome"], MOM[s["momento"]], TIPO[s["tipo"]], s["espressione"], str(s["forza"]),
                                   "s" if s["paginaPiena"] else "n", ruolo(s), "c", note]))
        (out / f"p{a:03d}-{b:03d}.txt").write_text("\n".join(righe) + "\n", encoding="utf-8")
    print("bozze in", out)


if __name__ == "__main__":
    main()
