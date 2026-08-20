# StudioFlow / Archivio Flow — Audit architetturale

Data audit: 20 agosto 2026. Ambito verificato: `apps/archivio-flow`, integrazione Electron in `apps/filex-desktop`, contratti desktop e servizio Google Drive già presente nella Suite.

## Architettura corrente

Archivio Flow è un renderer React/Vite caricato dalla Suite Electron. Le operazioni native passano dal preload e dagli handler IPC di `filex-desktop`; in sviluppo è disponibile anche un server Express. Il backend storico è concentrato in `server/index.ts` e gestisce rilevamento supporti, scansione, importazione, manifest, archivio e generazione JPEG.

## Flusso di importazione corrente

Il renderer raccoglie sorgente, lavoro, autore, destinazione, filtri e opzioni. Il backend valida i percorsi, crea la struttura del lavoro, scansiona in streaming, assegna nomi senza collisioni, copia tramite file temporaneo, verifica dimensione/contenuto, aggiorna il manifest e opzionalmente genera JPEG. Lo stato operativo in memoria alimenta il progresso UI.

## Persistenza trovata

Prima di questo intervento lavori, impostazioni e cache erano JSON; il tentativo precedente aggiungeva `import-sessions.json` sovrascrivendo la cronologia. Nel monorepo è disponibile `node:sqlite`, già usato dalla Suite. La nuova fondazione usa `studioflow.sqlite`, WAL, foreign key, migrazioni e recovery del file corrotto. I JSON storici restano temporaneamente compatibili per impostazioni/lavori e saranno migrati senza interrompere gli utenti.

## Indicizzazione archivio

La versione precedente riscopriva l’albero dal filesystem e manteneva solo cache in memoria/JSON per i conteggi. Non esistevano indice persistente, riconciliazione completa o watcher affidabile. Lo schema SQLite introduce `archives` e `archive_entries`; la scansione resta read-only e deve aggiornare l’indice soltanto dopo una ricognizione riuscita.

## Supporti rimovibili

Su Windows il rilevamento usa WMI/PowerShell per le unità rimovibili; su macOS la Suite enumera `/Volumes`. I dati precedenti non erano sufficienti per identificare una scheda riutilizzata. Il nuovo modello separa identità fisica (`cards`) e contenuto osservato (`card_snapshots`).

## Google Drive

Archivio Flow non aveva integrazione Drive. La Suite dispone già di `apps/filex-desktop/src/google-drive-service.ts`: autenticazione e client vanno riutilizzati via boundary Electron. Drive rimane opzionale e contiene esclusivamente registro/manifest, mai fotografie. Gli eventi locali entrano prima in `sync_outbox`.

## Problemi rilevati e decisioni

- Il `typecheck` del workspace controllava solo il renderer: la verifica autorevole del server è `build:server`.
- Il prototipo safe-to-format usava conteggi di sessione e poteva produrre falsi positivi: rimosso come criterio.
- Le sessioni venivano sovrascritte e non avevano record per file: sostituite da tabelle relazionali.
- Stati e timestamp erano dichiarativi, non legati alle operazioni reali: ora vengono aggiornati durante analisi, copia, verifica, errore e annullamento.
- La UI non poteva interrogare la sicurezza della SD: introdotto contratto IPC/HTTP dedicato.
- Il server monolitico resta debito tecnico. La persistenza è stata estratta per ridurre il rischio senza una mega-riscrittura.

## Riutilizzo

Si conservano copia atomica, collision handling, manifest di importazione, scansione streaming, progressi, struttura cartelle e servizio Drive della Suite. Non vengono duplicati IPC o tipi nel renderer: il contratto pubblico vive in `packages/desktop-contracts`.
