"""Unisce le schede scritte a blocchi (schede_parti/*.txt) con i dati EXIF di provini/foto.json in schede.json.

Controlla che ogni foto dei provini abbia una scheda e che ogni nome letto sotto le miniature esista davvero.
"""
import json
import sys
from pathlib import Path

QUI = Path(__file__).resolve().parent
sys.path.insert(0, str(QUI))
from dati import DATI  # noqa: E402
MOMENTI = {
    "PSA": "preparazione sposa", "PSO": "preparazione sposo", "CER": "cerimonia", "USC": "uscita",
    "COP": "ritratti di coppia", "RIC": "ricevimento", "DET": "dettagli", "ALT": "altro",
}
# Ruolo della foto nel racconto: le ricette (ricette.py) lo leggono al posto delle parole chiave.
RUOLI = {
    "dettaglio", "vestizione", "ritratto", "con-parenti", "parenti", "gruppo-posa", "spontanea", "invitati",
    "bouquet-suocera", "ingresso", "rito", "dettaglio-chiesa", "chiesa-intera", "firme", "gruppi-altare",
    "uscita-chiesa", "rinfresco", "coppia", "ricevimento", "ballo", "torta", "brindisi", "festa",
}
TIPI = {"D": "dettaglio", "R": "ritratto", "MB": "mezzo busto", "FI": "figura intera", "G": "gruppo", "A": "ambiente"}


def main() -> int:
    foto = json.loads((DATI / "provini" / "foto.json").read_text(encoding="utf-8"))
    per_nome = {f["nome"]: f for f in foto}
    schede, errori, visti = [], [], set()
    for parte in sorted((DATI / "schede_parti").glob("*.txt")):
        for n, riga in enumerate(parte.read_text(encoding="utf-8").splitlines(), 1):
            if not riga.strip() or riga.startswith("#"):
                continue
            campi = riga.split("|")
            if len(campi) not in (7, 9):
                errori.append(f"{parte.name}:{n} campi={len(campi)}")
                continue
            campi = [c.strip() for c in campi]
            if "?" in campi[:8]:
                errori.append(f"{parte.name}:{n} scheda da completare: {campi[0]}")
                continue
            if len(campi) == 7:
                nome, mom, tipo, emo, forza, piena, note = campi
                ruolo, soggetto = None, "c"
            else:
                nome, mom, tipo, emo, forza, piena, ruolo, soggetto, note = campi
                if ruolo not in RUOLI:
                    errori.append(f"{parte.name}:{n} ruolo sconosciuto: {ruolo}")
                if soggetto not in ("sx", "c", "dx"):
                    errori.append(f"{parte.name}:{n} soggetto non valido: {soggetto}")
            if nome not in per_nome:
                errori.append(f"{parte.name}:{n} nome non presente nei provini: {nome}")
                continue
            if nome in visti:
                errori.append(f"{parte.name}:{n} scheda doppia: {nome}")
            visti.add(nome)
            f = per_nome[nome]
            orient = f["orientamento"]
            corretto = None
            if "ROT:o" in note:
                corretto = "orizzontale"
            elif "ROT:v" in note:
                corretto = "verticale"
            if corretto and corretto != orient:
                orient_vera = corretto
            else:
                orient_vera = orient
            schede.append({
                "numero": f["numero"], "provino": f["provino"], "posizione": f["posizione"],
                "nome": nome, "percorso": f["percorso"],
                "orario": f["orario"], "orarioExif": f.get("orario_exif"),
                "macchina": f["macchina"], "seriale": f["seriale"],
                "momento": MOMENTI[mom], "tipo": TIPI[tipo],
                "orientamento": orient_vera,
                "orientamentoExif": orient,
                "orientamentoDaCorreggere": orient_vera != orient or "CAPOVOLTA" in note,
                "espressione": emo, "forza": int(forza), "paginaPiena": piena == "s",
                "note": note.replace("ROT:o", "").replace("ROT:v", "").strip(" ;"),
                **({"ruolo": ruolo, "soggetto": soggetto} if ruolo else {}),
                "biancoNero": "BN" in note.split(";")[0].split(","),
            })
    # «DOPO:NOME» nelle note: la foto va subito dopo quell'altra (orologio sbagliato o scatto fuori ordine).
    per_s = {s["nome"]: s for s in schede}
    for s in schede:
        for tok in s["note"].replace(";", " ").split():
            if tok.startswith("DOPO:") and tok[5:] in per_s:
                from datetime import datetime, timedelta
                rif = per_s[tok[5:]]["orario"]
                s["orario"] = (datetime.strptime(rif[:19], "%Y-%m-%d %H:%M:%S") + timedelta(seconds=1)).strftime("%Y-%m-%d %H:%M:%S")
                s["note"] = s["note"].replace(tok, "").strip(" ;")
    mancanti = [f["nome"] for f in foto if f["nome"] not in visti]
    schede.sort(key=lambda s: s["numero"])
    (DATI / "schede.json").write_text(json.dumps(schede, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"schede: {len(schede)} / foto: {len(foto)}; senza scheda: {len(mancanti)}; errori: {len(errori)}")
    for e in errori + [f"senza scheda: {m}" for m in mancanti]:
        print(" ", e)
    return 1 if errori or mancanti else 0


if __name__ == "__main__":
    sys.exit(main())
