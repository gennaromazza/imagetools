"""Libreria delle composizioni reali dai progetti Album Flow dell'utente (solo lettura).

Per ogni area con 2-12 foto salva la struttura dell'albero (righe/colonne), i rapporti e l'orientamento della foto
in ogni cella, nell'ordine di lettura. Le aree con la stessa struttura e gli stessi orientamenti diventano un solo
modello, con i rapporti medi e il numero di volte in cui è stato usato.

Uso: python estrai_modelli.py <progetto1.json> [<progetto2.json> ...]   → stile/modelli.json
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

QUI = Path(__file__).resolve().parent


def firma(n, ori):
    """Struttura con gli orientamenti nelle foglie, es. R(v,C(o,o))."""
    if n["kind"] == "leaf":
        return ori[n["itemId"]]
    return ("R(" if n["dir"] == "row" else "C(") + firma(n["first"], ori) + "," + firma(n["second"], ori) + ")"


def rapporti(n):
    return [] if n["kind"] == "leaf" else [n["ratio"]] + rapporti(n["first"]) + rapporti(n["second"])


def main():
    gruppi = defaultdict(lambda: {"usi": 0, "rapporti": [], "album": set(), "esempio": None})
    for path in sys.argv[1:]:
        dati = json.loads(Path(path).read_text(encoding="utf-8"))
        p = dati.get("project", dati)
        asset = {a["id"]: a for a in p["assets"]}
        for sp in p["spreads"]:
            target = "full" if sp["split"] == "full" else "page"
            for area in sp["areas"]:
                if not area.get("layout") or area.get("free") or not 2 <= len(area["items"]) <= 12:
                    continue
                ori = {}
                for it in area["items"]:
                    a = asset[it["assetId"]]
                    ori[it["id"]] = "v" if a.get("orientation") == "vertical" or (a.get("height") or 0) > (a.get("width") or 0) else "o"
                f = firma(area["layout"], ori)
                g = gruppi[(target, f)]
                g["usi"] += 1
                g["rapporti"].append(rapporti(area["layout"]))
                g["album"].add(p["projectName"])
    modelli = []
    for (target, f), g in sorted(gruppi.items(), key=lambda kv: -kv[1]["usi"]):
        medi = [round(sum(r[i] for r in g["rapporti"]) / len(g["rapporti"]), 4) for i in range(len(g["rapporti"][0]))]
        modelli.append({"id": f"m{len(modelli) + 1:03d}", "target": target, "firma": f, "foto": f.count("o") + f.count("v"),
                        "usi": g["usi"], "album": len(g["album"]), "rapporti": medi})
    (QUI / "stile").mkdir(exist_ok=True)
    (QUI / "stile" / "modelli.json").write_text(json.dumps(modelli, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"modelli: {len(modelli)} (aree: {sum(m['usi'] for m in modelli)})")
    for m in modelli[:25]:
        print(f"  {m['id']} {m['target']:4} {m['foto']:2} foto  usi {m['usi']:2}  album {m['album']}  {m['firma']}")


if __name__ == "__main__":
    main()
