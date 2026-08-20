# StudioFlow — Modello dati

## Tabelle locali

- `schema_migrations`: versione applicata e timestamp.
- `archives`: root, gerarchia, ultima scansione completa e riconciliazione.
- `archive_entries`: percorso relativo, tipo, dimensione, mtime e fingerprint opzionali.
- `cards`: identità fisica osservabile, filesystem, capacità, first/last seen.
- `card_snapshots`: fotografia immutabile del contenuto di una scheda.
- `import_sessions`: stato, sorgente/destinazione, contatori reali, verifica ed errore.
- `import_files`: prova per file, percorso sorgente, metadati, fingerprint, destinazione e stato.
- `sync_outbox`: eventi locali da sincronizzare sul registro remoto.

## Identità

Gli ID di archivio derivano dal root normalizzato; una scheda usa seriale del volume quando disponibile insieme a capacità/filesystem. Lo snapshot usa il fingerprint deterministico del contenuto e non viene confuso con la scheda fisica, che può essere riutilizzata.

## Fonte di verità

Il filesystem resta fonte del contenuto fotografico. SQLite è la fonte del workflow e delle prove già verificate. Drive è una replica di metadati utile per ricerca e continuità, non una fonte sufficiente per autorizzare la formattazione locale.
