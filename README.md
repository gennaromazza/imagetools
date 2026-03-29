# FileX Suite

Repository principale della suite **FileX**: strumenti fotografici modulari per impaginazione, selezione, archivio e stampa documento.

## Struttura

- `apps/`: applicazioni finali della suite
- `packages/`: moduli condivisi
- `docs/`: documentazione di suite e dei singoli tool

## Tool principali

- `apps/auto-layout-app`: impaginazione automatica multifoto
- `apps/image-party-frame`: batch framing, crop live, export eventi
- `apps/IMAGE ID PRINT`: foto documento pronte per la stampa
- `apps/archivio-flow`: import e archiviazione lavori da SD
- `apps/photo-selector-app`: selezione e classificazione foto avanzata
- `apps/filex-desktop`: shell desktop Electron condivisa

## Stato desktop

La suite sta migrando da tool browser-first a software desktop installabile.

Stato rilevante a marzo 2026:

- esiste una shell Electron comune in `apps/filex-desktop`
- `Image ID Print` e' integrato nella shell come desktop app dedicata
- il packaging Windows per `Image ID Print` produce un installer `NSIS`
- il runtime AI di `Image ID Print` viene staged nelle risorse dell'app
- il build macOS e' configurato, ma gli artefatti finali devono essere generati da host o CI macOS
- ogni tool desktop scrive i propri artefatti in `apps/filex-desktop/release/<tool-id>`

## Comandi utili

- build frontend `Image ID Print`:
  - `npm --workspace @photo-tools/image-id-print run build`
- build shell desktop + app `Image ID Print`:
  - `npm --workspace @photo-tools/filex-desktop run build:image-id-print`
- installer Windows `Image ID Print`:
  - `npm --workspace @photo-tools/filex-desktop run dist:image-id-print:win`
- build macOS `Image ID Print` da host macOS:
  - `npm --workspace @photo-tools/filex-desktop run dist:image-id-print:mac`

## Branding

Per `Image ID Print`, il branding desktop visibile e':

- `Image ID Print`
- `by ImageStudio di Gennaro Mazzacane`

## Documentazione

- `docs/00-overview.md`
- `docs/01-tech-stack.md`
- `docs/02-ui-system.md`
- `docs/03-desktop-windows-migration.md`
- `docs/tools/image-id-print.md`
