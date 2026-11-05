"""Legge un progetto dalla memoria di Album Flow (localStorage dell'app desktop) e lo salva come file progetto, per
confrontare l'impaginato finale di Gennaro con quello del motore. Sola lettura: lavora su una copia dei log LevelDB.

Uso: python leggi_album_app.py <lavoro> "<testo nel nome del progetto>"
     -> lavori/<lavoro>/finale-gennaro.filex-album.json
Senza il secondo argomento elenca i progetti presenti.
"""
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

QUI = Path(__file__).resolve().parent
LEVELDB = Path(os.environ.get("APPDATA", "")) / "FileX Album Flow" / "Local Storage" / "leveldb"
CHIAVE = b"filex.albumFlow.v2.projects"


def varint(b, i):
    r = s = 0
    while True:
        c = b[i]
        i += 1
        r |= (c & 0x7F) << s
        if c < 0x80:
            return r, i
        s += 7


def records(data):
    """Record del log LevelDB (blocchi da 32 KB, frammenti FULL/FIRST/MIDDLE/LAST)."""
    BLOCK, pos, frag = 32768, 0, b""
    while pos + 7 <= len(data):
        resto = BLOCK - pos % BLOCK
        if resto < 7:
            pos += resto
            continue
        ln = data[pos + 4] | (data[pos + 5] << 8)
        tipo = data[pos + 6]
        corpo = data[pos + 7:pos + 7 + ln]
        pos += 7 + ln
        if tipo == 1:
            yield corpo
        elif tipo == 2:
            frag = corpo
        elif tipo == 3:
            frag += corpo
        elif tipo == 4:
            yield frag + corpo
            frag = b""
        else:
            break


def progetti():
    ultimo = None
    with tempfile.TemporaryDirectory() as tmp:
        for f in sorted(LEVELDB.glob("*.log")):
            copia = Path(tmp) / f.name
            shutil.copy(f, copia)
            for rec in records(copia.read_bytes()):
                try:
                    i, n = 12, int.from_bytes(rec[8:12], "little")
                    for _ in range(n):
                        t = rec[i]
                        i += 1
                        kl, i = varint(rec, i)
                        k = rec[i:i + kl]
                        i += kl
                        if t == 1:
                            vl, i = varint(rec, i)
                            v = rec[i:i + vl]
                            i += vl
                            if k.endswith(CHIAVE):
                                ultimo = v
                except Exception:
                    continue
    if ultimo is None:
        sys.exit("Progetti non trovati nel log di Album Flow (apri e chiudi l'album nell'app, poi riprova).")
    testo = ultimo[1:].decode("utf-16-le") if ultimo[0] == 0 else ultimo[1:].decode("latin-1")
    return json.loads(testo)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    tutti = progetti()
    if len(sys.argv) < 3:
        for p in tutti:
            print(f"{p['updatedAt'][:16]}  {len(p['spreads']):3} doppie  {p['projectName']}")
        return
    cerca = sys.argv[2].lower()
    scelti = [p for p in tutti if cerca in p["projectName"].lower()]
    if len(scelti) != 1:
        sys.exit(f"Progetti che contengono «{sys.argv[2]}»: {[p['projectName'] for p in scelti]} (ne serve uno solo)")
    out = QUI / "lavori" / sys.argv[1] / "finale-gennaro.filex-album.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"format": "filex-album-project", "version": 2, "project": scelti[0]}, ensure_ascii=False),
                   encoding="utf-8")
    print(out)


if __name__ == "__main__":
    main()
