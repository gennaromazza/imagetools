# Architettura e persistenza

## Struttura proposta

```text
apps/backup-guard                 renderer React/Vite e host Electron
packages/backup-guard-domain      regole pure e costruzione del piano
packages/backup-guard-filesystem  scansione, staging, copia e verifica
packages/backup-guard-history     baseline, journal, cronologia e query
packages/backup-guard-lightroom   riconoscimento pacchetti e lock
packages/desktop-contracts        contratti Suite e Archivio Flow
```

Il dominio non dipende da Electron. Tutte le mutazioni filesystem avvengono nel processo desktop tramite API tipizzate; il renderer non riceve primitive arbitrarie di scrittura.

## Modello dati minimo

### `archive_pairs`

- `id`, `display_name`
- identita' master e clone
- radici normalizzate
- policy di retention e soglie
- baseline corrente
- date ultimo controllo e ultima verifica profonda

### `entries`

- coppia e percorso relativo normalizzato
- tipo, dimensione, timestamp e attributi
- SHA-256 e data ultimo hash
- identita' file disponibile
- presenza master/clone alla baseline
- classificazione Lightroom opzionale

### `sessions`

- ID, coppia, tipo, inizio/fine, stato
- conteggi e byte per operazione
- baseline iniziale/finale
- conferma utente e versione motore

### `operations`

- sessione, percorso, tipo e direzione
- stato, tentativi, checksum e messaggio errore
- percorso staging o cestino

### `events`

Registro append-only per eventi utente e motore. Gli eventi sensibili includono cancellazione, recupero, override e cambio associazione volume.

## Database

SQLite locale con WAL, foreign key, migrazioni versionate e transazioni corte. Database e journal risiedono nello storage utente FileX, non dentro l'archivio fotografico. Il clone contiene solo il marcatore di identita', staging e cestino protetto.

## Pipeline

1. `preflight`: valida volumi e radici.
2. `scan`: enumera senza seguire link esterni.
3. `classify`: confronta master, clone e baseline.
4. `plan`: produce operazioni immutabili e relativo digest.
5. `approve`: acquisisce la conferma prevista dalla policy.
6. `execute`: applica il piano con journal.
7. `verify`: controlla risultato e invarianti.
8. `commit`: pubblica baseline e cronologia.

Il digest del piano impedisce che cambiamenti avvenuti dopo la schermata di conferma vengano eseguiti silenziosamente: in tal caso il piano scade e viene ricalcolato.

## Concorrenza e prestazioni

Code separate per enumerazione, lettura e scrittura; concorrenza adattiva per volume, limitazione I/O e pausa automatica quando il sistema e' sotto pressione. File grandi vengono elaborati in streaming. Percorsi Windows lunghi, Unicode, RAW, JPEG, video e sidecar sono trattati come file opachi.

