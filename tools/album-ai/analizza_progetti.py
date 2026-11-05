"""Statistiche di stile da progetti Album Flow (.filex-album*.json), senza guardare immagini.

Uso: python analizza_progetti.py <progetto1.json> [<progetto2.json> ...]
Scrive stile/progetti.json con le misure per album e complessive. Legge i file solo in lettura.
"""
import json
import statistics as st
import sys
from collections import Counter
from pathlib import Path

QUI = Path(__file__).resolve().parent


def forma(n):
    return "o" if n["kind"] == "leaf" else ("R(" if n["dir"] == "row" else "C(") + forma(n["first"]) + "," + forma(n["second"]) + ")"


def analizza(path):
    dati = json.loads(Path(path).read_text(encoding="utf-8"))
    p = dati.get("project", dati)
    A = {a["id"]: a for a in p["assets"]}
    sp = p["spreads"]
    ori = lambda a: "v" if (a.get("height") or 0) > (a.get("width") or 0) else "o"
    aree = [a for s in sp for a in s["areas"]]
    usate = [it["assetId"] for a in aree for it in a["items"]]
    per_doppia = [sum(len(a["items"]) for a in s["areas"]) for s in sp]
    sole = [s for s in sp if per_doppia[sp.index(s)] == 1]
    full = [s for s in sp if s["split"] == "full"]
    # Coppie di pagine con una foto sola ciascuna
    uno_uno = sum(1 for s in sp if s["split"] == "half" and all(len(a["items"]) == 1 for a in s["areas"]))
    pagina_vuota = sum(1 for s in sp for a in s["areas"] if not a["items"])
    padding = Counter(round(a["style"]["paddingCm"], 1) for a in aree if a["items"])
    gap = Counter(round(a["style"]["gapCm"], 2) for a in aree if a["items"])
    mode = Counter(a["style"]["mode"] for a in aree if a["items"])
    mono = sum(1 for a in aree if a["items"] and a["style"].get("mono"))
    bordi = sum(1 for a in aree if a["items"] and a["style"].get("borderCm", 0) > 0)
    sfondi = Counter(a["style"].get("background", "#ffffff") for a in aree if a["items"] and a["style"].get("paddingCm", 0) > 0)
    # Orientamenti nelle aree da una foto
    singole = Counter(ori(A[a["items"][0]["assetId"]]) for a in aree if len(a["items"]) == 1)
    # Stelle: usate vs non usate
    stelle = lambda ids: Counter(A[i].get("rating") or 0 for i in ids)
    non_usate = [i for i in A if i not in set(usate)]
    tag = Counter(t for a in A.values() for t in (a.get("albumTags") or []))
    forme = Counter(forma(a["layout"]) for a in aree if a.get("layout") and len(a["items"]) in (2, 3, 4))
    ritmo = "".join("F" if s["split"] == "full" else ("1" if per_doppia[i] <= 2 else ("M" if per_doppia[i] <= 5 else "G")) for i, s in enumerate(sp))
    return {
        "album": p["projectName"],
        "formato": f'{p["settings"]["sheet"]["widthCm"]}x{p["settings"]["sheet"]["heightCm"]}',
        "doppie": len(sp),
        "fotoUsate": len(usate),
        "fotoInLibreria": len(A),
        "percentualeUsata": round(100 * len(usate) / max(1, len(A))),
        "fotoPerDoppia": {"media": round(st.mean(per_doppia), 1), "mediana": st.median(per_doppia), "max": max(per_doppia)},
        "split": dict(Counter(s["split"] for s in sp)),
        "fogliInteriConUnaFoto": sum(1 for s in full if sum(len(a["items"]) for a in s["areas"]) == 1),
        "fotoNeiFogliInteri": sorted(sum(len(a["items"]) for a in s["areas"]) for s in full),
        "doppieUnaFotoPerPagina": uno_uno,
        "pagineVuote(testo/nero)": pagina_vuota,
        "fotoPerArea": dict(sorted(Counter(len(a["items"]) for a in aree).items())),
        "areeDaUnaFoto(orientamento)": dict(singole),
        "mode": dict(mode), "paddingCm": dict(padding.most_common(5)), "gapCm": dict(gap.most_common(5)),
        "sfondiConMargine": dict(sfondi.most_common(4)),
        "areeBN": mono, "areeConBordo": bordi,
        "dispFree": sum(1 for a in aree if a.get("free")),
        "testiEGrafiche": sum(len(s.get("overlays") or []) for s in sp),
        "doppieConTesto": [i + 1 for i, s in enumerate(sp) if s.get("overlays")],
        "stelleUsate": dict(sorted(stelle(usate).items())), "stelleNonUsate": dict(sorted(stelle(non_usate).items())),
        "tagAlbum": dict(tag),
        "capitoli": [c["title"] for c in p["chapters"]],
        "formePiuUsate(2-4 foto)": dict(forme.most_common(6)),
        "ritmo(F=foglio intero,1=1-2 foto,M=3-5,G=6+)": ritmo,
    }


def main():
    risultati = [analizza(f) for f in sys.argv[1:]]
    (QUI / "stile").mkdir(exist_ok=True)
    (QUI / "stile" / "progetti.json").write_text(json.dumps(risultati, ensure_ascii=False, indent=2), encoding="utf-8")
    for r in risultati:
        print(f"\n=== {r['album']} ===")
        for k, v in r.items():
            if k != "album":
                print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
