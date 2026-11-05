"""Trasforma il piano del motore (piano-album-stile.json) in un progetto Album Flow (.filex-album.json, formato 2)
da aprire con «Apri progetto». Tutte le foto delle schede entrano nella libreria (anche quelle non impaginate),
divise nei capitoli; le doppie sono quelle del piano. Le note del motore (motivazioni, ruoli) non entrano nel file.

Uso: ALBUM_DATI=<lavoro> python esporta_filex.py [nome progetto]
"""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dati import DATI  # noqa: E402
import motore_stile  # noqa: E402

COLORI = {"casa-sposo": "#c9a27e", "casa-sposa": "#d79bb0", "chiesa": "#9bbf7a", "esterni": "#5fb3a1", "ristorante": "#6fa8d6"}
TITOLI = {"casa-sposo": "Casa sposo", "casa-sposa": "Casa sposa", "chiesa": "Chiesa", "esterni": "Esterne", "ristorante": "Ristorante"}


def aid(nome):
    return "as-" + re.sub(r"[^A-Za-z0-9_.-]", "-", Path(nome).stem)


def main():
    piano = json.loads((DATI / "piano-album-stile.json").read_text(encoding="utf-8"))
    schede = json.loads((DATI / "schede.json").read_text(encoding="utf-8"))
    foto = {f["nome"]: f for f in json.loads((DATI / "provini" / "foto.json").read_text(encoding="utf-8"))}
    frasi = DATI / "frasi.json"
    nomi = json.loads(frasi.read_text(encoding="utf-8")).get("apertura", {}).get("nomi", "") if frasi.exists() else ""
    nome_progetto = sys.argv[1] if len(sys.argv) > 1 else f"{nomi or DATI.name} (impaginazione AI)"
    adesso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    cer = [s["orario"][11:16] for s in schede if s["momento"] == "cerimonia" and s["orario"][11:13] >= "06"]
    if cer:
        motore_stile.INIZIO_CHIESA = min(cer)

    assets, capitoli = [], {}
    for i, s in enumerate(sorted(schede, key=lambda s: s["orario"])):
        f = foto[s["nome"]]
        w, h = f["larghezza"], f["altezza"]
        ms = int(datetime.strptime(s["orario"][:19], "%Y-%m-%d %H:%M:%S").timestamp() * 1000)
        assets.append({"id": aid(s["nome"]), "fileName": s["nome"], "path": s["nome"], "absolutePath": f["percorso"],
                       "width": w, "height": h, "aspectRatio": round(w / h, 4),
                       "orientation": "horizontal" if w > h else "vertical" if h > w else "square",
                       "captureTimeMs": ms, "rating": max(0, min(5, s["forza"])), "manualOrder": i, "importedAt": adesso})
        c = motore_stile.capitolo_di(s)
        if c:
            capitoli.setdefault(c, []).append(aid(s["nome"]))

    def stile(st):
        return {"gapCm": st.get("gapCm", 0.1), "paddingCm": st.get("paddingCm", 0), "borderCm": 0, "borderColor": "#ffffff",
                "background": st.get("background", "#ffffff"), "mode": st.get("mode", "fill"), "align": "center",
                "mono": bool(st.get("mono", False))}

    spreads = []
    for sp in piano["spreads"]:
        n = sp["numero"]
        aree = []
        for j, a in enumerate(sp["areas"]):
            aree.append({"id": f"area-{n:02d}-{j}", "style": stile(a["style"]), "layout": a["layout"],
                         "items": [{"id": it["id"], "assetId": aid(it["fileName"]), "zoom": max(1, it.get("zoom", 1)),
                                    "cx": it.get("cx", 0.5), "cy": it.get("cy", 0.5)} for it in a["items"]],
                         "seed": 0})
        spread = {"id": f"spread-{n:02d}", "split": sp["split"], "linked": False, "areas": aree}
        if sp.get("overlays"):
            spread["overlays"] = [{k: v for k, v in o.items() if k != "styleName"} | {"styleName": o.get("styleName", "")}
                                  for o in sp["overlays"]]
        spreads.append(spread)

    sheet = piano["progetto"]["sheet"]
    progetto = {
        "schemaVersion": 2, "projectId": "album-ai-" + re.sub(r"[^a-z0-9]", "", nome_progetto.lower())[:24],
        "projectName": nome_progetto, "sourceFolderPath": str(Path(assets[0]["absolutePath"]).parent),
        "createdAt": adesso, "updatedAt": adesso, "stage": "pending",
        "assets": assets, "labels": [],
        "chapters": [{"id": f"chap-{c}", "title": TITOLI[c], "color": COLORI[c], "assetIds": ids} for c, ids in capitoli.items()],
        "spreads": spreads, "favoriteLayouts": [],
        "settings": {"sheet": {"presetId": f"fmt-{sheet['widthCm']}x{sheet['heightCm']}",
                               "label": f"Orizzontale {sheet['widthCm']} × {sheet['heightCm']} cm",
                               "widthCm": sheet["widthCm"], "heightCm": sheet["heightCm"], "dpi": 300, "marginCm": 1,
                               "gapCm": 0.1, "bleedCm": 0.3, "backgroundColor": "#ffffff"},
                     "sortKey": "capture-time",
                     "defaultStyle": {"gapCm": 0.1, "paddingCm": 0, "borderCm": 0, "borderColor": "#ffffff",
                                      "background": "#ffffff", "mode": "fill", "align": "center", "mono": False}},
    }
    apertura = piano["spreads"][0]["areas"][1]["items"]
    if apertura:
        progetto["coverAssetId"] = aid(apertura[0]["fileName"])
    out = DATI / (re.sub(r"[^A-Za-z0-9]+", "-", nome_progetto).strip("-") + ".filex-album.json")
    out.write_text(json.dumps({"format": "filex-album-project", "version": 2, "project": progetto}, ensure_ascii=False, indent=2),
                   encoding="utf-8")
    print(out)


if __name__ == "__main__":
    main()
