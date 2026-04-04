# FileX Suite Desktop - Visione Prodotto

## Obiettivo

FileX Suite Desktop e' la piattaforma Windows per studi fotografici che unifica i tool operativi in una distribuzione `.exe` professionale:

- installer singoli per ogni tool
- installer Suite con launcher centrale
- aggiornamenti automatici per tool
- gestione modulare di componenti opzionali (es. AI sidecar Image ID Print)

## Personas

- Titolare studio: vuole stabilita', installazione semplice e tempi rapidi.
- Operatore selezione: usa quotidianamente `photo-selector-app` su volumi RAW alti.
- Operatore archivio: usa `archivio-flow` per import/copertura eventi.
- Retoucher: usa `image-party-frame` e `IMAGE ID PRINT` con integrazioni esterne.

## Success Metrics v1

- Tasso installazione completata >= 95% su Windows 10/11 x64.
- Tasso update completato >= 90% su canale stable.
- Crash rate anonimo < 1% sessioni.
- Tempo medio setup nuovo PC studio < 20 minuti.

## Scope v1

- Windows 10/11 x64.
- Release channels: `stable` (default) + `beta` (opt-in).
- Distribuzione via GitHub Releases.
- Code signing attivo in pipeline release.
- Nessun licensing in v1.

## Non-Goals v1

- Porting macOS con parita' completa.
- Telemetria usage avanzata.
- Licensing/account management.
