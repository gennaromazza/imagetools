# Archivio Flow

Archivio Flow è il tool desktop FileX per importare schede SD, verificare le copie e mantenere un archivio fotografico consultabile. Il prodotto è Electron; il renderer React/Vite aperto nel browser è soltanto una superficie di debug.

## Stato della release

- Versione candidata: `0.1.26`.
- Runtime: Electron tramite `@photo-tools/filex-desktop`.
- Persistenza primaria: SQLite locale StudioFlow.
- Replica remota opzionale: manifest Google Drive, mai fotografie.
- Licenza: `shared-runtime` FileX All Access.

## Avvio e verifica

Eseguire dalla radice del monorepo:

```powershell
npm --workspace @photo-tools/filex-desktop run dev:archivio-flow
npm --workspace @photo-tools/archivio-flow run typecheck
npm --workspace @photo-tools/archivio-flow run build
npm --workspace @photo-tools/archivio-flow run build:server
npm --workspace @photo-tools/archivio-flow run test:archive
```

Lo script desktop compila shell e server, avvia il renderer sulla porta `4175` e apre Electron con preload e IPC reali.

## Comportamento dell'indice

L'indice archivio viene persistito in SQLite e riutilizzato all'avvio. Una semplice apertura o il caricamento della lista lavori non devono provocare una scansione completa. La scansione completa è prevista:

- al primo utilizzo di una nuova radice;
- quando cambia la radice archivio;
- tramite **Riconcilia archivio**, avviata esplicitamente dall'utente.

Il watcher del filesystem, una nuova importazione e la rinomina di una cartella aggiornano soltanto il sottoalbero del lavoro interessato. **Controlla nomi cartelle** legge la gerarchia dei lavori senza ricostruire l'indice di tutti i file. Se il watcher non è disponibile, il controllo periodico registra le nuove cartelle ma lascia la scansione completa all'azione manuale.

Il conteggio mostrato durante una scansione è in sola lettura. La rinomina delle cartelle richiede sempre una selezione e una conferma esplicita. Dopo la conferma il runtime accetta una sola operazione alla volta, mostra avanzamento e cartella corrente anche cambiando sezione e aggiorna il registro senza forzare una seconda scansione completa.

## Google Drive

Ogni cliente collega il proprio account dal pannello **Google Drive**. FileX usa il client OAuth ufficiale di tipo `Desktop app`, callback loopback dinamico, PKCE e scope `drive.file`. Client ID e Client Secret sono configurazioni di build; il refresh token dell'utente viene cifrato con Electron `safeStorage`.

La sincronizzazione carica soltanto il registro StudioFlow nella cartella FileX dell'account collegato. Importazione e verifica locale continuano a funzionare offline.

## Documentazione ufficiale

- `docs/STUDIOFLOW_ARCHITECTURE.md`
- `docs/STUDIOFLOW_DATA_MODEL.md`
- `docs/STUDIOFLOW_IMPORT_STATE_MACHINE.md`
- `docs/STUDIOFLOW_DRIVE_REGISTRY.md`
- `docs/STUDIOFLOW_IMPLEMENTATION_REPORT.md`
- `docs/archivio-flow-desktop-checklist.md`
- `docs/18-publish-build-contract.md`

La specifica storica del 19 agosto resta in `leggimi19082026.md` soltanto come traccia del requisito originario; non è fonte di verità per il comportamento attuale.
