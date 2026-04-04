# FileX Suite Desktop - QA & UAT Checklists

## QA Tecnica (Pre-Release)

- Build x64 completata per:
  - suite launcher
  - auto-layout
  - photo-selector
  - archivio-flow
  - image-party-frame
  - image-id-print
- Manifest release generato e validato.
- Checksum installer verificabili.
- Install/uninstall smoke su VM pulita Windows 10 e 11.

## Test Update Matrix

- stable -> stable
- beta -> beta
- tool non installato -> install da launcher
- mismatch checksum -> blocco apply
- endpoint non disponibile -> fallback/errore user-friendly

## Fault Injection

- rete assente durante download
- download troncato/corrotto
- permessi insufficienti cartella utente
- installer chiuso manualmente

## UAT Studio Fotografico (Pilot)

- import evento SD completo (`archivio-flow`)
- selezione massiva RAW (`photo-selector`)
- export/preview (`auto-layout`)
- flusso frame/evento (`image-party-frame`)
- flusso documento (`image-id-print`, con e senza AI)

## Criterio di Done Release

- nessun blocker critico aperto
- crash rate pilot entro soglia
- checklist QA + UAT firmata
- asset release pubblicati su canale corretto
