"""Dalle schede scritte al file per Album Flow, in un colpo: unisce le schede, cerca le foto simili, impagina col
motore di stile, crea le anteprime da sfogliare e il progetto .filex-album.json, poi lo verifica col controllo di
Album Flow. Ogni passo si ferma al primo errore.

Uso: python impagina.py <lavoro> [nome progetto]
     (<lavoro> = cartella in tools/album-ai/lavori/, con provini/ e schede_parti/ già pronti)
"""
import os
import subprocess
import sys
from pathlib import Path

QUI = Path(__file__).resolve().parent
RADICE = QUI.parents[1]


def passo(nome, cmd, env, cwd=QUI):
    print(f"\n== {nome}")
    r = subprocess.run(cmd, cwd=cwd, env=env)
    if r.returncode:
        sys.exit(f"Fermato: «{nome}» non riuscito (codice {r.returncode}).")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    env = {**os.environ, "ALBUM_DATI": sys.argv[1], "PYTHONIOENCODING": "utf-8"}
    dati = Path(sys.argv[1]) if Path(sys.argv[1]).is_absolute() else QUI / "lavori" / sys.argv[1]
    py = sys.executable
    passo("schede", [py, "unisci_schede.py"], env)
    passo("foto simili", [py, "simili.py"], env)
    passo("impaginazione", [py, "motore_stile.py"], env)
    passo("anteprime", [py, "anteprima_stile.py"], env)
    passo("panoramiche", [py, "panoramica_album.py", str(dati / "anteprime-stile"), dati.name, "27"], env)
    passo("file Album Flow", [py, "esporta_filex.py", *sys.argv[2:3]], env)
    progetto = max(dati.glob("*.filex-album.json"), key=lambda p: p.stat().st_mtime)
    tsx = next((p for p in [RADICE / "node_modules/.bin/tsx.cmd", RADICE / "node_modules/.bin/tsx",
                            RADICE.parents[2] / "node_modules/.bin/tsx.cmd"] if p.exists()), None)
    if tsx:
        passo("verifica con Album Flow", [str(tsx), str(QUI / "verifica_filex.ts"), str(progetto)], env, cwd=RADICE)
    else:
        print("\n(verifica saltata: tsx non trovato; eseguire npm ci nella radice)")
    print(f"\nFatto.\n  Anteprima: {dati / 'anteprime-stile' / 'album.html'}\n  Album Flow (Home → «Apri progetto…»): {progetto}")


if __name__ == "__main__":
    main()
