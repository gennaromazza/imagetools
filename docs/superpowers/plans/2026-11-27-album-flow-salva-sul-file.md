# Album Flow «Salva sul file» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** collegare un album Album Flow a un file `.filex-album.json` su disco. Il pulsante «Salva sul file» lo scrive,
l'uscita dall'album chiede se salvare e l'apertura avvisa se un altro PC l'ha cambiato.

**Architecture:**
- Logica pura in `model/fileLink.ts`: collegamenti per PC in `localStorage`, impronta del contenuto, stato e decisioni.
- Accesso al disco in `desktop/projectFile.ts`, solo con le API desktop esistenti (`getPathForFile`, `readFile`,
  `statFiles`, `writeFilesReplacing`).
- `App.tsx` possiede collegamenti, finestre di domanda e salvataggio alla chiusura. `Workspace.tsx` mostra solo
  pulsante, stato e `Ctrl/⌘+S`.

**Tech Stack:** React 19 + Vite, TypeScript, `tsx --test` (node:test), contratti `@photo-tools/desktop-contracts`.

**Spec:** `docs/superpowers/specs/2026-11-27-album-flow-salva-sul-file-design.md`

## Global Constraints

- Nessun nuovo canale IPC, nessuna modifica a `packages/desktop-contracts` né a `apps/filex-desktop`.
- Nessuna modifica allo schema v2: i collegamenti stanno solo in `localStorage`, chiave `filex.albumFlow.fileLinks`.
- Il contenuto scritto è identico a quello di `exportProjectFile`: `serializeAlbumProject(project, media)` con i media
  di `collectEmbeddedMedia(mediaIdsOfProject(project))`.
- Lo stato si basa su un'impronta del contenuto, mai su `updatedAt`.
- Testi italiani brevi, esattamente:
  - pulsante: «Salva sul file»;
  - stati: «Salvato sul file», «Modifiche non salvate sul file», «Il file è stato cambiato da un altro PC», «File non
    raggiungibile».
- Domanda all'uscita: titolo «Salvare sul file prima di chiudere?», pulsanti Salva / Non salvare / Annulla.
- Chiusura del programma: nessuna domanda; si scrive solo se il file non è cambiato da un altro PC, dentro i 20 s della
  shell, insieme al backup su Drive (budget totale `CLOSE_BACKUP_BUDGET_MS` = 15 000 ms).
- Senza `window.filexDesktop` il pulsante non compare e il resto si comporta come oggi.
- Scorciatoia `Ctrl/⌘+S` separata dal tasto `S` da solo (`toggleSizes`), anche dentro i campi di testo.
- Popover e finestre con `Modal` di `components/ui.tsx`. Solo token di `styles.css`. Niente spinto fuori vista a
  1100×740.

## Review Focus

1. **Aprire e non toccare niente.** Un album appena caricato dal file deve risultare «Salvato sul file», anche dopo la
   normalizzazione di `parseAlbumProject` e gli `onChange` del Workspace all'avvio. Test in Task 1:
   `fingerprint stabile dopo serialize → parse`.
2. **Rete staccata o unità E: non collegata.** `statFiles` non restituisce il file o lancia un errore: lo stato diventa
   «File non raggiungibile», il salvataggio mostra un messaggio e niente si perde. Test in Task 2:
   `statProjectFile su file mancante restituisce null`.
3. **Salvataggio mentre l'altro PC ha già scritto.** Non si sovrascrive mai senza chiedere. Test in Task 1:
   `decideSave con stamp cambiato chiede conferma`.
4. **Chiusura del programma con il file cambiato altrove o non raggiungibile.** Non si scrive niente. Test in Task 1:
   `closeSaveTargets esclude i file cambiati e i non raggiungibili`.
5. **Cartella con percorso UNC o lettera di unità** (`\\DESKTOP-BT148BT\E\Album\x.filex-album.json`, `E:\Album\x.json`,
   `/Volumes/E/x.json`). La divisione cartella/nome deve funzionare in tutti i casi. Test in Task 2:
   `splitFilePath su Windows, UNC e macOS`.

---

### Task 1: Modulo puro del collegamento

**Files:**
- Create: `apps/album-flow/src/model/fileLink.ts`
- Test: `apps/album-flow/src/model/fileLink.test.ts`
- Modify: `package.json` (radice): script `test:album-flow-filelink` =
  `tsx --test apps/album-flow/src/model/fileLink.test.ts apps/album-flow/src/desktop/projectFile.test.ts`, aggiunto a
  `test:album-flow-all` dopo `test:album-flow-drive`.
- Modify: `apps/filex-dev-console/server/index.ts`: descrizione di `test:album-flow-filelink`, accanto a
  `test:album-flow-history`: «Verifica il collegamento di un album al file su disco: stato salvato/non salvato,
  cambiamenti fatti da un altro PC, file non raggiungibile, domande all'apertura e salvataggio alla chiusura senza
  sovrascrivere il lavoro dell'altro PC.»

**Interfaces:**
- Produces:
  - `type KeyValueStorage`: riusare quello esportato da `desktop/autoBackup.ts`, non duplicarlo.
  - `interface FileLink { path: string; stamp: string; savedHash: string }`
  - `const FILE_LINKS_KEY = "filex.albumFlow.fileLinks"`
  - `loadFileLinks(storage?): Record<string, FileLink>`: i valori non validi si ignorano e non lancia mai.
  - `setFileLink(projectId: string, link: FileLink, storage?): void` e `removeFileLink(projectId: string, storage?): void`
  - `albumFingerprint(project: AlbumProjectV2): string`: FNV-1a 32 bit in esadecimale, più la lunghezza, calcolata su
    `serializeAlbumProject(project)` senza media.
  - `stampOf(stat: { size: number; lastModified: number }): string` → `"size:lastModified"`, lo stesso formato di
    `desktop/api.ts`.
  - `type FileStatus = "saved" | "unsaved" | "changed-elsewhere" | "conflict" | "unreachable"`
    - `conflict` = cambiato altrove e anche qui.
  - `fileStatus(link: FileLink, currentStamp: string | null, fingerprint: string): FileStatus`
    - `currentStamp` null vuol dire non raggiungibile.
  - `type SaveDecision = "write" | "ask-overwrite" | "unreachable"`
  - `decideSave(link: FileLink | undefined, currentStamp: string | null): SaveDecision`
    - senza collegamento non si arriva qui: l'interfaccia chiede la cartella;
    - con `currentStamp` diverso da `link.stamp` → `ask-overwrite`.
  - `type OpenDecision = "load" | "keep" | "ask-load" | "ask-load-losing"`
  - `decideOpen(local: { fingerprint: string } | null, link: FileLink | undefined, fileStamp: string): OpenDecision`
    - album nuovo → `load`;
    - file invariato rispetto a `link.stamp` → `keep`;
    - file cambiato e nessuna modifica locale (`local.fingerprint === link.savedHash`) → `ask-load`;
    - file cambiato con modifiche locali → `ask-load-losing`;
    - album presente ma mai collegato → `ask-load-losing` se diverso dal file, altrimenti `load`.
  - `closeSaveTargets(projects, links, stamps: Record<string, string | null>): AlbumProjectV2[]`: gli album collegati in
    stato `unsaved`, esclusi `changed-elsewhere`, `conflict` e `unreachable`.

- [ ] **Step 1: Scrivi i test che falliscono** in `fileLink.test.ts`. Usa `makeProject` da `model/fixtures` e la
  `memoryStorage` come in `desktop/autoBackup.test.ts`. Test:
  - `collegamenti: si salvano, si rileggono, i valori rovinati si ignorano`: un `setItem` che lancia non fa lanciare;
    `{"a":{"path":1}}` è ignorato.
  - `fingerprint stabile dopo serialize → parse`: `albumFingerprint(parseAlbumProject(serializeAlbumProject(p)))` ===
    `albumFingerprint(parseAlbumProject(serializeAlbumProject(parseAlbumProject(serializeAlbumProject(p)))))`, e cambia
    dopo `rename`/`touch` di un campo.
  - `fileStatus`:
    - stesso stamp e stessa impronta → `saved`;
    - impronta diversa → `unsaved`;
    - stamp diverso e impronta uguale → `changed-elsewhere`;
    - tutti e due diversi → `conflict`;
    - `null` → `unreachable`.
  - `decideSave con stamp cambiato chiede conferma`: uguale → `write`, diverso → `ask-overwrite`, `null` → `unreachable`.
  - `decideOpen`: i cinque casi elencati in Interfaces.
  - `closeSaveTargets esclude i file cambiati e i non raggiungibili`: tre album (`unsaved`, `changed-elsewhere`,
    `unreachable`), solo il primo esce; un album non collegato non esce mai.
- [ ] **Step 2: Esegui** `npx tsx --test apps/album-flow/src/model/fileLink.test.ts`. Risultato atteso: FAIL, modulo
  mancante.
- [ ] **Step 3: Implementa** `model/fileLink.ts` con le firme qui sopra. Nessun DOM: `localStorage` solo tramite la
  `defaultStorage` come in `autoBackup.ts`.
- [ ] **Step 4: Esegui di nuovo.** Risultato atteso: PASS.
- [ ] **Step 5: Aggiungi** script e descrizione nella Dev Console. Esegui
  `npm --workspace @photo-tools/filex-dev-console run typecheck` e `npm run test:album-flow-system`. Risultato atteso:
  tutti e due OK. Il test di sistema fallisce se lo script non è raggiungibile o manca la descrizione.

### Task 2: Lettura e scrittura del file su disco

**Files:**
- Create: `apps/album-flow/src/desktop/projectFile.ts`
- Test: `apps/album-flow/src/desktop/projectFile.test.ts`, già incluso nello script del Task 1.

**Interfaces:**
- Consumes: `stampOf` e `albumFingerprint` (Task 1); `getDesktop` (`desktop/api.ts`); `serializeAlbumProject`,
  `parseAlbumProject` e `readEmbeddedMedia` (`model/portability.ts`); `collectEmbeddedMedia` e `restoreEmbeddedMedia`
  (`model/mediaStore.ts`); `mediaIdsOfProject` (`model/design.ts`).
- Produces:
  - `splitFilePath(path: string): { directory: string; fileName: string }`: separatore `\` o `/`, quello che c'è per
    ultimo.
  - `canLinkFiles(): boolean`: vero se esistono `getPathForFile`, `readFile`, `statFiles` e `writeFilesReplacing`.
  - `pathOfPickedFile(file: File): string | null`: `getPathForFile`; una stringa vuota o un errore danno `null`.
  - `statProjectFile(path: string): Promise<string | null>`: lo stamp, oppure `null` se non c'è o se c'è un errore.
  - `readProjectFile(path: string): Promise<{ project: AlbumProjectV2; raw: string; stamp: string }>`: lancia con il
    messaggio di `parseAlbumProject`, oppure con «File non raggiungibile: controlla la rete e l'unità E:».
  - `writeProjectFile(project: AlbumProjectV2, path: string): Promise<string>`: scrive con `writeFilesReplacing` e
    restituisce il nuovo stamp letto con `statFiles` dopo la scrittura.

- [ ] **Step 1: Scrivi i test che falliscono.** Imposta `globalThis.window = { filexDesktop: fake }` con un `fake` in
  memoria (mappa percorso → byte + `lastModified` crescente). Test:
  - `splitFilePath su Windows, UNC e macOS`:
    - `E:\Album\Sposi.filex-album.json` → `E:\Album` + `Sposi.filex-album.json`;
    - `\\DESKTOP-BT148BT\E\Album\x.filex-album.json` → `\\DESKTOP-BT148BT\E\Album` + `x.filex-album.json`;
    - `/Volumes/E/x.filex-album.json` → `/Volumes/E` + `x.filex-album.json`.
  - `statProjectFile su file mancante restituisce null`, e anche quando `statFiles` lancia.
  - `scrittura e rilettura`: `writeProjectFile` e poi `readProjectFile` danno lo stesso `albumFingerprint`; lo stamp
    restituito è uguale a quello di `statProjectFile`.
  - `canLinkFiles falso senza app desktop`.
- [ ] **Step 2: Esegui** `npm run test:album-flow-filelink`. Risultato atteso: FAIL.
- [ ] **Step 3: Implementa** `desktop/projectFile.ts`. `writeProjectFile` riusa la stessa composizione di
  `exportProjectFile` (`render/export.ts`). Estrai lì una funzione `projectFileBytes(project): Promise<Uint8Array>` e
  fai usare quella a tutti e due, senza duplicare.
- [ ] **Step 4: Esegui di nuovo.** Risultato atteso: PASS.

### Task 3: Collegamento in App (apertura, esportazione, chiusura del programma)

**Files:**
- Modify: `apps/album-flow/src/App.tsx`
- Create: `apps/album-flow/src/components/FileSyncDialog.tsx`: una `Modal` con titolo, testo e 2 o 3 pulsanti, guidata
  da una prop `kind: "exit" | "overwrite" | "load" | "load-losing"`.

**Interfaces:**
- Consumes: Task 1 e Task 2.
- Produces, per il Task 4: le prop nuove di `Workspace`
  - `fileStatus?: FileStatus | "unlinked"`: `undefined` se `canLinkFiles()` è falso;
  - `onSaveToFile?: () => void`.

- [ ] **Step 1: Stato in App.** `links` da `loadFileLinks()`; `stamps: Record<projectId, string | null>` aggiornato da
  `statProjectFile` quando un album si apre, dopo ogni salvataggio o caricamento e prima di uscire. `fileStatus` per
  l'album attivo: `albumFingerprint` calcolata con un ritardo di 600 ms dopo l'ultimo `onChange`, mai a ogni gesto.
- [ ] **Step 2: «Apri progetto…».**
  - Con `canLinkFiles()`: `pathOfPickedFile` → `readProjectFile`.
  - `decideOpen` con l'album locale dello stesso `projectId`:
    - `load`: come oggi (`restoreEmbeddedMedia` + `upsert(…, true)`), più `setFileLink` con stamp e impronta del
      progetto caricato;
    - `ask-*`: apre `FileSyncDialog` («load» o «load-losing»); «Tieni questa» collega comunque il file con lo stamp
      attuale e lascia `savedHash` invariato, così lo stato resta «Modifiche non salvate sul file».
  - Senza desktop: il comportamento di oggi.
- [ ] **Step 3: Apertura dalla Home** (`onOpen`). Se l'album è collegato: `statProjectFile`, poi `decideOpen`. Con
  `ask-*` mostra la stessa finestra prima di aprire il Workspace. «Carica» legge il file e fa `upsert(…, true)`.
- [ ] **Step 4: Salvataggio** (`saveToFile(projectId)`).
  - Senza collegamento: `chooseDesktopWriter()` per la cartella, nome `${safeFileName(name)}.filex-album.json`. Se il
    file esiste già (`existingNamesIn`), chiede di sostituirlo come fa oggi `ExportDialog`.
  - Con collegamento: `decideSave`:
    - `write` → `writeProjectFile`;
    - `ask-overwrite` → finestra «overwrite» con Sovrascrivi / Carica la sua versione / Annulla;
    - `unreachable` → banner «File non raggiungibile: l'album resta salvato su questo PC.».
  - Dopo ogni scrittura: `setFileLink` con il nuovo stamp e l'impronta.
  - Anche `exportProject` della Home e `saveProject` di `ExportDialog` collegano il file scritto. `ExportDialog` riceve
    una callback `onProjectSaved?(path: string)`.
- [ ] **Step 5: Uscita dall'album.** `onExit` del Workspace: se lo stato è `unsaved` o `conflict`, finestra «exit».
  - Salva → `saveToFile`, che può a sua volta chiedere «overwrite»; poi torna alla Home;
  - Non salvare → Home;
  - Annulla → resta nell'album.
- [ ] **Step 6: Chiusura del programma.** Ristruttura l'effetto `onPrepareClose`: ora esce subito se `!driveAvailable()`,
  e invece deve registrarsi anche senza Drive.
  - Prima: `statProjectFile` per gli album collegati, poi `closeSaveTargets`, poi `writeProjectFile` per ognuno.
  - Poi: `backupOnClose` come oggi.
  - Tutto dentro `CLOSE_BACKUP_BUDGET_MS`, con lo stesso schema a `Promise.race` di `backupOnClose`.
  - Il `beforeunload` chiede di aspettare anche quando ci sono `closeSaveTargets`.
  - Non lancia mai e chiama sempre `completeClosePreparation`.
- [ ] **Step 7: Verifica** `npx tsc --noEmit -p apps/album-flow/tsconfig.json`. Risultato atteso: nessun errore.

### Task 4: Pulsante, stato e scorciatoia nel Workspace

**Files:**
- Modify: `apps/album-flow/src/components/Workspace.tsx` (barra in alto, vicino a «Album»; gestione dei tasti vicino
  a `toggleSizes`)
- Modify: `apps/album-flow/src/styles.css`: classe `topbar__filestate` con i token esistenti; `--warn` per
  `unsaved`, `changed-elsewhere` e `conflict`, `--danger` per `unreachable`.

**Interfaces:**
- Consumes: le prop `fileStatus` e `onSaveToFile` del Task 3.

- [ ] **Step 1:** con `fileStatus !== undefined`, un `IconButton` o un pulsante «Salva sul file» con etichetta
  «Salva sul file (Ctrl/⌘+S)», e la scritta di stato dai testi di Global Constraints. Con `unlinked`: solo il pulsante.
- [ ] **Step 2:** `Ctrl/⌘+S` chiama `onSaveToFile` con `preventDefault`, anche con il fuoco in un campo di testo. `S`
  senza modificatori continua a chiamare `toggleSizes`.
- [ ] **Step 3:** etichetta «Nuovo» sul pulsante con `useNewFeature("salva-file")`, come `useNewFeature("drive")` nel
  Workspace.
- [ ] **Step 4:** `npx tsc --noEmit -p apps/album-flow/tsconfig.json`, poi `npm run test:album-flow-all`. Risultato
  atteso: tutto OK.

### Task 5: Verifica finale

- [ ] **Step 1:** esegui, dalla radice, e ottieni tutto OK:
  - `npx tsc --noEmit -p apps/album-flow/tsconfig.json`
  - `npm run test:album-flow-all`
  - `npm --workspace @photo-tools/filex-dev-console run typecheck`
  - `npm --workspace @photo-tools/album-flow run build`
- [ ] **Step 2: Prova visiva** con il dev server Vite e un `window.filexDesktop` finto in memoria, iniettato solo per la
  prova:
  - stato dopo l'apertura: «Salvato sul file»;
  - una modifica: «Modifiche non salvate sul file»;
  - `Ctrl+S`: torna «Salvato sul file»;
  - file cambiato «da un altro PC»: avviso;
  - uscita con modifiche: domanda.
  - A 1100×740 il pulsante non spinge fuori nessuna azione. Screenshot come prova.
- [ ] **Step 3: Cancello di revisione:** `security-review`, `simplify` e `code-review` sul diff, secondo parere
  DeepSeek sui punti rischiosi (chiusura e sovrascrittura).
- [ ] **Step 4:** commit soltanto su richiesta dell'utente, con soli i file di questo lavoro. `whatsNew.ts`, changelog e
  pagina del sito si fanno alla release, quando l'utente la chiede.
