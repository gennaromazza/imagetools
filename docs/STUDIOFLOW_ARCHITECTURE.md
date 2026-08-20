# StudioFlow — Architettura target

## Confini

1. React presenta stato e invia comandi, senza accesso diretto al filesystem.
2. Electron/Express adattano IPC e HTTP agli stessi servizi applicativi.
3. Il motore locale esegue discovery, importazione, verifica, indicizzazione e recovery.
4. `StudioFlowStore` è la fonte persistente locale per sessioni, prove, schede, indice e outbox.
5. Google Drive è un consumer asincrono dell’outbox e non partecipa alla decisione locale di completamento.

## Flusso

`SD discovery → snapshot → import session → import_files → copia .part → verifica → commit session → outbox`.

Una sessione è completata soltanto quando ogni file pianificato è `VERIFIED`, `DUPLICATE_ACCEPTED` o esplicitamente `SKIPPED`. Errori e arresti rimangono recuperabili. La sicurezza di formattazione rilegge il supporto corrente e riconferma sul filesystem le prove persistite.

## Avvio e archivio

La UI usa subito l’indice SQLite valido e non avvia una full rescan alla semplice apertura. Il watcher rileva le modifiche dell'archivio e programma la riconciliazione con debounce. Se il watcher non è disponibile, una scansione di ripiego viene pianificata ogni sei ore. Una full rescan iniziale o manuale costruisce un nuovo insieme e lo sostituisce in transazione solo a successo avvenuto.

## Affidabilità

- SQLite WAL, foreign key e transazioni.
- Migrazioni numerate e integrity check.
- Sessioni attive al crash marcate `INTERRUPTED` all’avvio.
- Copie su file temporaneo nello stesso volume e rename finale.
- Safe-to-format fail-closed: errori, destinazioni mancanti o file sconosciuti impediscono `SAFE`.
- Drive offline non modifica mai una sessione locale verificata.
