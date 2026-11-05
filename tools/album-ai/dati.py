"""Cartella dei dati di un matrimonio: provini, schede, simili, frasi, piano, anteprime, file per Album Flow.

Si sceglie con la variabile d'ambiente ALBUM_DATI: un nome (cartella dentro `lavori/`, per esempio
`ALBUM_DATI=nicola-carla-2026-06-05`) oppure un percorso assoluto. `lavori/` non va in Git: contiene foto e dati
dei clienti. Profilo di stile, libreria delle composizioni e ricette restano accanto agli script.
"""
import os
import sys
from pathlib import Path

QUI = Path(__file__).resolve().parent
LAVORI = QUI / "lavori"
_d = os.environ.get("ALBUM_DATI")
if not _d:
    sys.exit("Imposta ALBUM_DATI con il nome del lavoro (cartella in tools/album-ai/lavori/), es. ALBUM_DATI=nicola-carla-2026-06-05")
DATI = Path(_d) if Path(_d).is_absolute() else LAVORI / _d
DATI.mkdir(parents=True, exist_ok=True)
