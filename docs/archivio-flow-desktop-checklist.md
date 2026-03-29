# Archivio Flow Desktop Checklist

## Stato implementazione

- [x] Renderer `archivio-flow` senza `fetch("/api/...")`
- [x] Bridge preload + IPC aggiunto per Archivio Flow
- [x] Runtime desktop usa storage utente nativo via `ARCHIVIO_FLOW_DATA_DIR`
- [x] Migrazione dati legacy `apps/archivio-flow/server/data` verso storage utente
- [x] Import SD via shell desktop con progresso
- [x] Supporto copia file foto, RAW, video, sidecar e contenuti SD generici
- [x] Apertura cartella finale via shell desktop
- [x] Gestione autore come cartella sotto `FOTO_SD\<Autore>`
- [x] Generazione `BASSA_QUALITA` via IPC
- [x] Archivio lavori, link contratto e delete via IPC
- [x] Build desktop Archivio Flow x64 riuscita
- [x] Build desktop Archivio Flow ia32 riuscita
- [ ] Build Mac artefatto finale

## Artefatti generati

- [x] `apps/filex-desktop/release/archivio-flow/Archivio-Flow-0.1.0-x64-setup.exe`
- [x] `apps/filex-desktop/release/archivio-flow/Archivio-Flow-0.1.0-ia32-setup.exe`

## Verifiche tecniche

- [x] `npm --workspace @photo-tools/archivio-flow run typecheck`
- [x] `npm --workspace @photo-tools/archivio-flow run build`
- [x] `npm --workspace @photo-tools/archivio-flow run build:server`
- [x] `npm --workspace @photo-tools/filex-desktop run build:shell`
- [x] `npm --workspace @photo-tools/filex-desktop run build:archivio-flow`
- [x] `npm --workspace @photo-tools/filex-desktop run dist:archivio-flow:win64`
- [x] `npm --workspace @photo-tools/filex-desktop run dist:archivio-flow:win32`
- [ ] `npm --workspace @photo-tools/filex-desktop run dist:archivio-flow:mac`

## Nota Mac

- Il comando Mac fallisce su questo ambiente Windows con errore `Build for macOS is supported only on macOS`.
- La pipeline e lo script `dist:archivio-flow:mac` sono presenti, ma l'artefatto finale va generato su una macchina macOS.
