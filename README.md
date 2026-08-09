# FileX Suite (ex ImageTools)

Repository principale della suite **FileX** (ex ImageTools): strumenti professionali per workflow fotografici, progettati per lavorare insieme come un ecosistema modulare.

## Struttura

- `apps/`: applicazioni finali della suite
- `packages/`: moduli condivisi
- `docs/`: documentazione di suite e dei singoli tool

## Tool principali

- `apps/image-party-frame` — Batch framing, crop live, export eventi
- `apps/archivio-flow` — Import, archiviazione e organizzazione lavori da SD
- `apps/photo-selector-app` — Image Select Pro: selezione e classificazione foto avanzata
- `apps/cache-sweep` — FileX Adobe Cleaner: utility esclusivamente Adobe per pulire cache supportate e rimuovere vecchie versioni affiancate a quella corrente su Windows

## Launcher Windows

FileX Suite gestisce ogni tool separatamente. La Suite usa un feed di aggiornamento dedicato; ogni tool mostra `Installa`, `Apri` oppure `Aggiorna` in base al catalogo remoto dei tool. Una release tool non costruisce o aggiorna la Suite.

Per aggiornare:

1. aggiornare FileX Suite quando richiesto;
2. riaprire la Suite e premere il refresh;
3. premere `Aggiorna` nella scheda del tool interessato.

Download ufficiale Suite: [installer stabile](https://github.com/gennaromazza/imagetools/releases/download/suite-channel-stable/FileX-Suite-stable-x64-setup.exe). Le release dei singoli componenti sono disponibili nell'[archivio release](https://github.com/gennaromazza/imagetools/releases).

- `avvia-progetto.bat`: schermata di scelta tool (da estendere per includere tutti i tool FileX)
- `avvia-image-party-frame.bat`: avvia direttamente Image Party Frame
- `avvia-archivio-flow.bat`: avvia Archivio Flow
- `avvia-photo-selector.bat`: avvia Image Select Pro

## Visione Suite FileX

L’obiettivo è una suite integrata, con:
- UI e UX coerenti
- tecnologie allineate (React, Vite, TypeScript, Node)
- launcher e documentazione unificati
- moduli condivisi per storage, preset, tipi, orchestrazione

## Roadmap Unificazione

1. Allineamento documentazione e naming (FileX branding)
2. Aggiornamento launcher principale per includere tutti i tool
3. Uniformazione stack tecnologico (React 18/19, dipendenze, pattern UI)
4. Refactor moduli condivisi e servizi
5. Packaging desktop e distribuzione facilitata

## Documentazione

- `docs/00-overview.md`, `docs/01-tech-stack.md`, `docs/02-ui-system.md`: documenti di suite
- `docs/03-desktop-windows-migration.md`: piano di migrazione desktop Windows condiviso per tutta la suite
- `docs/GIT_WORKFLOW.md`: policy Git operativa (branch, sync, conflitti, recovery)
- `docs/18-publish-build-contract.md`: contratto completo per build, pubblicazione, sito e updater
- `docs/10-product-vision-suite-desktop.md` .. `docs/17-roadmap-v2.md`: documentazione enterprise per programma EXE Suite
- `docs/tools/`: documenti specifici dei singoli tool
