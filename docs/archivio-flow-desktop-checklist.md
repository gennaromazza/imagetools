# Archivio Flow — checklist release 0.1.26

## Ambito

Questa release aggiorna Archivio Flow `0.1.26` e richiede separatamente FileX Suite `0.1.39` per distribuire il runtime OAuth condiviso aggiornato. I due componenti mantengono versioni, tag e feed indipendenti.

## Implementazione completata

- [x] Renderer Archivio Flow integrato con preload e IPC Electron.
- [x] Storage utente nativo tramite `ARCHIVIO_FLOW_DATA_DIR`.
- [x] Database SQLite StudioFlow con migrazioni, WAL, recovery e backup.
- [x] Importazione SD persistente, riprendibile e verificata.
- [x] Safe to Format fail-closed basato su prove locali.
- [x] Mapping categorie guidato e anteprima della destinazione.
- [x] Registrazione delle cartelle esterne e correzione nomi con conferma.
- [x] Indice SQLite riutilizzato all'avvio senza full rescan della lista lavori.
- [x] Aggiornamento incrementale dell'indice limitato al lavoro importato, rinominato o modificato dal watcher.
- [x] Stato dell'analisi nomi conservato durante il cambio sezione.
- [x] Rinomina cartelle serializzata, con avanzamento interrogabile e blocco dei doppi avvii.
- [x] Pannello Google Drive con account utente e soli manifest StudioFlow.
- [x] Client OAuth Google di tipo Desktop app, PKCE, `drive.file` e token cifrato.
- [x] Versione UI letta da `apps/archivio-flow/package.json`.

## Verifiche locali completate

- [x] `npm --workspace @photo-tools/archivio-flow run typecheck`.
- [x] `npm --workspace @photo-tools/archivio-flow run build`.
- [x] `npm --workspace @photo-tools/archivio-flow run build:server`.
- [x] `npm --workspace @photo-tools/archivio-flow run test:archive`: 9 test superati.
- [x] `npm --workspace @photo-tools/filex-desktop run build:shell`.
- [x] `npm --workspace @photo-tools/filex-desktop run build:archivio-flow`.
- [x] `npm run test:filex-independent-releases`.
- [x] `npm run test:filex-license-coverage`.
- [x] Server compilato copiato nella build Electron.
- [x] Secret CI `IMAGE_SELECT_GOOGLE_CLIENT_ID` e `IMAGE_SELECT_GOOGLE_CLIENT_SECRET` presenti.

## Gate prima della pubblicazione stabile

- [ ] Generare l'installer Windows x64 di Archivio Flow `0.1.26`.
- [ ] Installare l'artefatto e verificare avvio con licenza attiva e blocco senza entitlement.
- [ ] Verificare disinstallazione e reinstallazione anche offline e senza licenza valida.
- [ ] Collegare un account Google nuovo nell'installer, riavviare e verificare la persistenza cifrata.
- [ ] Sincronizzare un manifest, verificare che Drive non contenga fotografie o percorsi assoluti.
- [ ] Verificare coda offline, riconnessione dopo revoca e scollegamento account.
- [ ] Verificare riavvio con indice persistito senza nuova scansione completa.
- [ ] Pubblicare `archivio-flow-v0.1.26` e verificare la voce remota in `stable.json`.
- [ ] Generare e collaudare separatamente FileX Suite `0.1.39` con tag `suite-v0.1.39`.

## macOS

- [ ] Generare e collaudare DMG/ZIP su una macchina macOS.

La build macOS non viene dichiarata verificata da Windows.
