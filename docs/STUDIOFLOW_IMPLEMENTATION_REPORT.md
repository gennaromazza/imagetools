# StudioFlow / Archivio Flow — rapporto di implementazione

## Architecture

Archivio Flow è ora local-first. La UI continua a usare il backend locale esistente e i contratti Electron condivisi; il backend coordina importazione, verifica, indice e persistenza. SQLite è la fonte primaria per lavori, impostazioni, indice, schede, sessioni, file importati e coda di sincronizzazione.

## Reuse

- shell Electron e preload di `filex-desktop`;
- contratti IPC di `@photo-tools/desktop-contracts`;
- autenticazione e client Google Drive già presenti nella Suite;
- flusso di importazione, rinomina e generazione JPEG già esistente in Archivio Flow;
- stack React, Vite, TypeScript e `sharp` già adottato dal tool.

## Database

Il database `studioflow.db` usa WAL, foreign key, transazioni e migrazioni versionate. Lo schema corrente è la versione 3 e contiene:

- `archives`, `archive_entries`;
- `cards`, `card_snapshots`;
- `import_sessions`, `import_files`, `session_payloads`;
- `sync_outbox`;
- `jobs`, `app_settings`, `app_meta`.

Impostazioni e lavori JSON preesistenti vengono importati una sola volta. Il database viene controllato all'apertura; in caso di corruzione viene conservata una copia diagnostica e ricreato il contenitore. È previsto un backup giornaliero con conservazione degli ultimi tre backup.

## Import

Ogni operazione genera una sessione persistente e registra lo stato di ogni file. Gli stati principali sono `CREATED`, `ANALYZING`, `READY`, `IMPORTING`, `VERIFYING` e `COMPLETED`; errori e arresti producono `FAILED`, `CANCELLED` o `INTERRUPTED`.

La copia usa un file temporaneo `.part`, verifica dimensione e fingerprint prima della rinomina atomica e marca `COMPLETED` soltanto quando tutti i file pianificati sono verificati, duplicati accettati o esplicitamente saltati. Il payload originale è persistito per consentire la ripresa senza ricopiare file già verificati.

## Archive indexing

All'avvio viene letto immediatamente l'ultimo indice SQLite. Se esiste una scansione completa valida, il caricamento della lista lavori non attraversa nuovamente l'archivio. La scansione completa avviene al primo utilizzo, quando cambia la radice, tramite comando manuale o come ripiego ogni sei ore soltanto se il watcher non è disponibile. La UI mostra stato, conteggi, ultimo aggiornamento ed eventuale errore.

## SD detection

L'identità fisica usa segnali come seriale volume, filesystem e capacità, senza usare la lettera dell'unità come identità. Ogni contenuto significativo genera un nuovo `CardSnapshot`; la stessa scheda formattata o riutilizzata produce quindi un fingerprint contenuto differente.

## Duplicate detection

Il nome del file non è considerato identità. La pipeline combina percorso relativo, dimensione, mtime e fingerprint veloce calcolato su testa, centro e coda. SHA-256 completo viene calcolato nei casi critici di verifica o ambiguità. Il Bloom Filter è usato solo come acceleratore e mai come prova.

## Verification e Safe To Format

Un file è verificato soltanto quando la destinazione configurata esiste, resta dentro l'archivio previsto e corrisponde per dimensione e SHA-256 al file corrente della SD. `SAFE` richiede una prova deterministica per ogni file rilevante. Un solo file senza prova, modificato o con destinazione mancante impedisce `SAFE` e produce `PARTIAL`, `UNSAFE` o `UNKNOWN` in modalità fail-closed.

## Google Drive

Drive riceve esclusivamente manifest e riepiloghi versionati con percorsi relativi: nessuna fotografia e nessun percorso assoluto locale. L'importazione termina correttamente anche offline. Gli eventi non sincronizzati restano nella outbox SQLite e vengono ritentati con backoff esponenziale usando il client Drive già autenticato dalla Suite. L'autorizzazione usa un client Google `Desktop app`, Authorization Code con PKCE, callback loopback dinamico e lo scope limitato `drive.file`; Client ID e Client Secret sono iniettati in build, ogni cliente collega il proprio account e il token cifrato è condiviso tra i tool FileX dello stesso profilo del computer.

## Recovery

All'apertura, sessioni lasciate in `IMPORTING` o `VERIFYING` diventano `INTERRUPTED` e sono esposte nella UI con l'azione **Riprendi**. Le prove già verificate restano persistenti. La ricostruzione dell'indice non elimina lo storico delle importazioni.

## Tests

La suite copre:

- migrazioni, persistenza, recovery e database corrotto;
- risoluzione destinazione e protezione dal path traversal;
- fingerprint/Bloom Filter senza falsi negativi per elementi inseriti;
- importazione, rinomina, collision avoidance, JPEG leggero e riuso di file verificati;
- Safe To Format fail-closed per file extra, modificati e destinazioni mancanti;
- indice SQLite con dataset simulati da 1.000, 5.000 e 20.000 file.
- riapertura della lista lavori senza ricostruzione dell'indice SQLite persistito.

I casi hardware/OS non riproducibili deterministicamente nei test automatici — rimozione fisica della SD durante la copia, disco pieno reale e scadenza OAuth reale — sono gestiti dai medesimi percorsi di errore persistenti ma richiedono anche collaudo manuale Windows prima della release.

## File principali

- `apps/archivio-flow/server/studioflow-store.ts`: database, migrazioni, recovery, outbox;
- `apps/archivio-flow/server/index.ts`: indice, SD, importazione, verifica e servizi;
- `apps/archivio-flow/server/destination-resolver.ts`: mapping e destinazioni sicure;
- `apps/archivio-flow/server/bloom-filter.ts`: acceleratore di lookup;
- `apps/archivio-flow/src/components/NuovoLavoroPanel.tsx`: stato StudioFlow, mapping, recovery e Safe To Format;
- `packages/desktop-contracts/src/index.ts`: contratto IPC condiviso;
- `apps/filex-desktop/src/main.ts`, `preload.ts`, `google-drive-service.ts`: bridge Electron e replica Drive.

## Limiti noti

- il watcher filesystem è un acceleratore: su filesystem che non lo supportano resta attiva la riconciliazione periodica/manuale;
- il riconoscimento fisico dipende dai metadati che Windows espone per il lettore e la scheda;
- i guasti hardware e OAuth reali devono essere inclusi nella matrice di collaudo manuale della release.
