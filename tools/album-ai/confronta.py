"""Confronta l'impaginato finale di Gennaro (finale-gennaro.filex-album.json, da leggi_album_app.py) con il piano del
motore dello stesso lavoro: doppie, foto e foto per doppia per capitolo, fogli interi, foto aggiunte e tolte,
accostamenti uguali e, doppia per doppia, le due versioni affiancate. Serve a ricavare le regole da riportare nel
profilo (stile-gennaro.json) e nelle ricette.

Uso: ALBUM_DATI=<lavoro> python confronta.py
"""
import collections
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dati import DATI  # noqa: E402
import motore_stile as m  # noqa: E402


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    schede = {s["nome"]: s for s in json.loads((DATI / "schede.json").read_text(encoding="utf-8"))}
    cer = [s["orario"][11:16] for s in schede.values() if s["momento"] == "cerimonia" and s["orario"][11:13] >= "06"]
    if cer:
        m.INIZIO_CHIESA = min(cer)
    g = json.loads((DATI / "finale-gennaro.filex-album.json").read_text(encoding="utf-8"))["project"]
    nomi = {a["id"]: a["fileName"] for a in g["assets"]}
    lui = [([nomi[i["assetId"]] for a in sp["areas"] for i in a["items"]], sp["split"], sp["areas"]) for sp in g["spreads"]]
    piano = json.loads((DATI / "piano-album-stile.json").read_text(encoding="utf-8"))
    io = [([i["fileName"] for a in sp["areas"] for i in a["items"]], sp["split"], sp["areas"]) for sp in piano["spreads"]]

    def capitoli(versione):
        d = collections.defaultdict(lambda: [0, 0, 0])
        for foto, split, _ in versione[1:]:
            if not foto:
                continue
            c = collections.Counter(m.capitolo_di(schede[n]) for n in foto if n in schede).most_common(1)[0][0]
            d[c][0] += 1
            d[c][1] += len(foto)
            d[c][2] += split == "full"
        return d

    for titolo, v in (("GENNARO", lui), ("MOTORE", io)):
        print(titolo, f"{len(v)} doppie, {sum(len(f) for f, _, _ in v)} foto")
        for c, (n, f, full) in capitoli(v).items():
            print(f"  {c:11} doppie {n:2}  foto {f:3}  media {f / n:.1f}  fogli interi {full}")
    a = {x for f, _, _ in lui for x in f}
    b = {x for f, _, _ in io for x in f}

    def coppie(v):
        out = set()
        for f, _, _ in v:
            f = sorted(f)
            out |= {(x, y) for i, x in enumerate(f) for y in f[i + 1:]}
        return out
    print(f"\nfoto in comune {len(a & b)}, solo sue {len(a - b)}, solo del motore {len(b - a)}; "
          f"accostamenti uguali {len(coppie(lui) & coppie(io))} su {len(coppie(lui))}")
    riga = lambda s: f"{s['orario'][11:16]} {s['nome']} {s.get('ruolo', '')} {s['forza']}★ {s['espressione'][:45]}"
    print("\naggiunte da lui:")
    for n in sorted(a - b, key=lambda n: schede[n]["orario"]):
        print("  " + riga(schede[n]))
    print("tolte da lui:")
    for n in sorted(b - a, key=lambda n: schede[n]["orario"]):
        print("  " + riga(schede[n]))
    fmt = lambda v: [" || ".join(",".join(Path(nomi.get(i.get("assetId"), i.get("fileName", "?"))).stem[-4:] if "assetId" in i
                                          else Path(i["fileName"]).stem[-4:] for i in ar["items"]) for ar in areas)
                     + ("  [intero]" if split == "full" else "") for _, split, areas in v]
    L, R = fmt(lui), fmt(io)
    print("\ndoppia per doppia (Gennaro | motore):")
    for k in range(max(len(L), len(R))):
        print(f"{k + 1:2} {L[k] if k < len(L) else '':62} | {R[k] if k < len(R) else ''}")


if __name__ == "__main__":
    main()
