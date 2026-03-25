# FileX Suite - Piano Di Migrazione Desktop Windows

Documento di riferimento unico per il passaggio della suite **FileX** da insieme di tool browser-first a prodotto desktop Windows installabile come `.exe`.

Questo file e' valido per tutta la suite:

- `auto-layout-app`
- `photo-selector-app`
- `image-party-frame`
- `archivio-flow`
- `IMAGE ID PRINT`

Obiettivo: definire una strategia comune, eseguibile e incrementale che migliori prestazioni, integrazione file-system, packaging e distribuzione senza riscrivere le UI esistenti.

## 1. Obiettivo Prodotto

Portare FileX a una suite desktop professionale per Windows capace di:

- installarsi come applicazione `.exe`
- avviare i tool da una shell unica
- accedere al file system locale senza dipendere dal browser
- gestire cache, preview, sidecar e percorsi assoluti in modo nativo
- preparare il terreno per prestazioni vicino a Photo Mechanic / Bridge nei flussi di review RAW

## 2. Stato Attuale

Oggi la suite e' composta soprattutto da app React + Vite eseguite in browser locale:

- alcune funzioni dipendono da `showDirectoryPicker`, `input webkitdirectory`, `IndexedDB` e `blob:`
- il packaging desktop non e' ancora presente come shell reale
- i launcher Windows `.bat` avviano ambienti di sviluppo, non un prodotto installabile
- le operazioni piu' sensibili a I/O e RAW soffrono i limiti del browser

Impatto pratico:

- `photo-selector-app` e' ancora troppo lento su cartelle RAW grandi rispetto a Photo Mechanic e Bridge
- `auto-layout-app` e i tool di export restano vincolati a pipeline browser-side per file, preview e rendering
- l'integrazione con sidecar, percorsi assoluti, app esterne e cache disco non e' ancora centralizzata

## 3. Decisione Architetturale

### Scelta confermata

La direzione consigliata per FileX e':

1. mantenere le UI React/Vite esistenti
2. introdurre una shell desktop comune basata su `Electron`
3. spostare file-system, RAW preview, sidecar e servizi I/O intensivi in un layer desktop locale
4. esporre questi servizi alle app via `preload + IPC`

### Perche' Electron

`Electron` e' la scelta migliore per questo repository perche':

- la suite e' gia' tutta TypeScript / Node
- l'integrazione con processi locali, path Windows e helper nativi e' piu' rapida
- il packaging `.exe` e gli installer Windows sono maturi
- il costo principale oggi non e' la shell UI, ma il collo di bottiglia browser sui RAW e sul file system

### Cosa non basta fare

Non basta:

- mettere un wrapper `.exe` attorno alle app attuali
- continuare a far leggere i RAW al browser tramite `arrayBuffer()`
- basarsi solo su `File System Access API`

Questo ridurrebbe poco il gap con software professionali desktop.

## 4. Architettura Target Di Suite

```text
FileX Desktop Shell (Electron)
  |
  +-- React/Vite tool UI
  |     +-- auto-layout-app
  |     +-- photo-selector-app
  |     +-- image-party-frame
  |     +-- archivio-flow
  |     +-- IMAGE ID PRINT
  |
  +-- Desktop preload / IPC bridge
  |     +-- runtime info
  |     +-- native folder open
  |     +-- cache and settings
  |     +-- sidecar read/write
  |     +-- external app launch
  |
  +-- Local desktop services
        +-- folder indexing
        +-- RAW embedded preview extraction
        +-- EXIF/XMP
        +-- persistent thumbnail cache
        +-- export / automation helpers
```

## 5. Principi Di Migrazione

- riusare le UI esistenti, evitando riscritture massive
- introdurre contratti condivisi tra shell e tool
- migrare prima i flussi con massimo impatto reale sul lavoro del fotografo
- mantenere ogni tool funzionante anche durante la transizione
- separare chiaramente:
  - UI
  - logica dominio
  - bridge desktop
  - servizi nativi/locali

## 6. Milestone Di Suite

## Milestone 1 - Desktop Foundation

Obiettivo:

- creare una shell desktop comune
- introdurre manifest tool, preload e IPC base
- preparare packaging Windows

Deliverable:

- workspace `filex-desktop`
- contratto condiviso per IPC/runtime
- shell Electron avviabile
- primo packaging Windows `NSIS`

## Milestone 2 - Native Folder And Runtime Bridge

Obiettivo:

- smettere di dipendere dal browser per l'apertura cartelle
- centralizzare path assoluti, permessi e file operations

Deliverable:

- `openFolder`
- `reopenRecentFolder`
- `copy/move/save` file via bridge desktop
- cartelle recenti persistenti lato desktop

## Milestone 3 - RAW Performance Layer

Obiettivo:

- avvicinare `photo-selector-app` e i flussi RAW di suite a Photo Mechanic / Bridge

Deliverable:

- indice cartella desktop-side
- estrazione preview embedded fuori dal browser
- cache thumbnail persistente su disco
- pipeline visible-first realmente desktop-native

## Milestone 4 - Tool Adoption

Obiettivo:

- portare progressivamente tutti i tool a usare la shell comune

Ordine consigliato:

1. `photo-selector-app`
2. `auto-layout-app`
3. `archivio-flow`
4. `image-party-frame`
5. `IMAGE ID PRINT`

## Milestone 5 - Packaging And Distribution

Obiettivo:

- consegnare una suite installabile e distribuibile per Windows

Deliverable:

- installer `.exe`
- naming e branding unificati
- cartella dati utente condivisa
- strategia update e versioning

## 7. Priorita' Per Applicazione

## `photo-selector-app`

Priorita' massima.

Perche':

- e' il tool dove il gap con Photo Mechanic si percepisce subito
- e' il caso d'uso piu' sensibile a I/O, RAW, cache e sidecar
- il beneficio per il fotografo e' immediato e misurabile

Primi target:

- folder open nativo
- indice cartella lazy
- cache thumbnail su disco
- preview RAW tramite servizio desktop
- sidecar XMP nativi

## `auto-layout-app`

Seconda priorita'.

Primi target:

- import immagini via bridge desktop
- asset con path assoluti stabili
- preview RAW-aware
- export piu' robusto lato desktop

## `archivio-flow`

Terza priorita'.

Primi target:

- file operations locali piu' affidabili
- copy/move/rename con feedback nativo
- migliore gestione di throughput e conflitti

## `image-party-frame`

Quarta priorita'.

Primi target:

- consolidare backend locale
- preparare packaging Windows pulito
- coordinare UI, server e file outputs dentro la shell

## `IMAGE ID PRINT`

Quinta priorita'.

Primi target:

- orchestrazione shell + AI sidecar
- configurazione percorsi tool esterni
- packaging guidato del sidecar Python

## 8. Contratti Desktop Condivisi

Ogni tool deve convergere su questi contratti minimi:

- `getRuntimeInfo`
- `openFolder`
- `reopenRecentFolder`
- `readSidecar`
- `writeSidecar`
- `copyAssets`
- `moveAssets`
- `saveAssetAs`
- `openExternalPath`
- `getThumbnail`
- `getPreview`

Nota:

il bridge va introdotto per gradi. Non serve implementare tutto subito, ma il contratto deve essere pensato come fondazione comune di suite.

## 9. Packaging Windows

Scelta iniziale:

- `Electron Builder`
- target `NSIS`
- artefatto `.exe`

Linee guida:

- una shell desktop comune
- ogni tool come renderer caricato dalla shell
- packaging progressivo:
  - prima `photo-selector-app`
  - poi gli altri tool

## 10. Standard Operativi

- tutte le nuove funzioni desktop vanno documentate nei docs di suite
- le UI non devono parlare direttamente con API native non mediate dal preload
- i contratti IPC devono restare tipizzati
- niente logica business complessa dentro `main.ts`
- i servizi I/O intensivi devono restare fuori dal renderer

## 11. Rischi Principali

### Rischio 1 - Shell senza vero guadagno prestazionale

Mitigazione:

- non fermarsi al packaging
- spostare davvero RAW, sidecar e cache nel layer desktop

### Rischio 2 - Divergenza tra tool

Mitigazione:

- usare manifest comune
- usare contratti condivisi
- adottare la shell per tutti i tool con la stessa base

### Rischio 3 - Packaging complesso di tool con sidecar/server

Mitigazione:

- migrazione per milestone
- iniziare dal tool piu' semplice da valorizzare: `photo-selector-app`

### Rischio 4 - Regressioni durante la transizione

Mitigazione:

- non rompere il funzionamento browser esistente finche' il bridge desktop non copre i flussi principali

## 12. Piano Operativo Immediato

Questa e' la sequenza raccomandata da eseguire ora:

1. creare il documento di suite desktop Windows
2. creare il workspace `filex-desktop`
3. creare il package condiviso dei contratti desktop
4. introdurre preload + IPC runtime base
5. collegare il primo renderer reale: `photo-selector-app`
6. preparare build e packaging Windows iniziale
7. iniziare il bridge nativo del flusso cartella/RAW/XMP per `photo-selector-app`

## 13. Definizione Di Done Del Primo Sprint

Il primo sprint puo' considerarsi riuscito quando:

- esiste una shell desktop comune
- `photo-selector-app` si apre dentro la shell
- il runtime desktop e' rilevabile nel renderer
- esiste un comando di build Windows iniziale
- la documentazione di suite e' aggiornata

## 14. Prossimo Step Dopo Questo Documento

Dopo questo documento, il lavoro deve partire dalla fondazione tecnica e non da ulteriori ottimizzazioni browser isolate.

Priorita' assoluta:

- shell desktop condivisa
- bridge runtime
- integrazione iniziale `photo-selector-app`
- poi bridge nativo folder/RAW/XMP
