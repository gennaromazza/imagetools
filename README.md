# FileX Suite (ex ImageTools)

Repository principale della suite **FileX** (ex ImageTools): strumenti professionali per workflow fotografici, progettati per lavorare insieme come un ecosistema modulare.

## Struttura

- `apps/`: applicazioni finali della suite
- `packages/`: moduli condivisi
- `docs/`: documentazione di suite e dei singoli tool

## Tool Principali (Marzo 2026)

- `apps/auto-layout-app` — Impaginazione automatica multifoto
- `apps/image-party-frame` — Batch framing, crop live, export eventi
- `apps/IMAGE ID PRINT` — Foto documento pronte per la stampa (AI/sidecar)
- `apps/archivio-flow` — Import, archiviazione e organizzazione lavori da SD
- `apps/photo-selector-app` — Selezione e classificazione foto avanzata

## Launcher Windows

- `avvia-progetto.bat`: schermata di scelta tool (da estendere per includere tutti i tool FileX)
- `avvia-auto-layout.bat`: avvia direttamente Auto Layout
- `avvia-image-party-frame.bat`: avvia direttamente Image Party Frame
- `avvia-image-id-print.bat`: avvia Image ID Print (con AI sidecar)
- `avvia-archivio-flow.bat`: avvia Archivio Flow
- `avvia-photo-selector.bat`: avvia Photo Selector

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
- `docs/tools/`: documenti specifici dei singoli tool
