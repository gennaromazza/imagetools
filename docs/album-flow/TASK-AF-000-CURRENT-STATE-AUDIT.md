# TASK-AF-000 — Audit dello stato reale: FileX Album Flow

Data audit: 14 settembre 2026  
Scope: solo `D:\IMAGETOOL_REMOTE`; `mnt/`, `worktrees/` e il progetto Memorie Sospese sono esclusi.

## Esito

FileX possiede una base tecnica concreta per Album Flow e ora include uno scaffold eseguibile (`apps/album-flow`) registrato nel manifest desktop e nel Dev Console. Il riuso più solido resta il nucleo `@photo-tools/layout-engine` + `@photo-tools/core`; il contratto di handoff dedicato trasferisce già i metadati editoriali principali del Selector. Sono presenti export SVG, preflight iniziale, portabilità JSON e relink dei percorsi; restano renderer nativo/PDF, proofing completo e persistenza nativa.

## Fatti verificati

### Workspace e script

- Il repository è un monorepo npm workspaces (`apps/*`, `packages/*`), con root package `photo-tools`; `AGENTS.md` richiede l'uso di `npm`, non di pnpm. Il file `pnpm-workspace.yaml` è presente ma non definisce i workspace.
- Il checkout operativo è `main`, senza modifiche locali al momento dell'audit, con remoto `origin` configurato verso GitHub; esiste un solo worktree operativo.
- Le app rilevanti sono `apps/photo-selector-app` (React/Vite) e `apps/filex-desktop` (shell Electron). I package riutilizzabili rilevanti sono `@photo-tools/shared-types`, `@photo-tools/desktop-contracts`, `@photo-tools/layout-engine` e `@photo-tools/core`.
- Gli script reali per il Selector sono `dev:photo-selector-app`, `build:filex-desktop:photo-selector` e la famiglia `test:photo-selector-*`. La shell fornisce `build:photo-selector`, `dev:photo-selector-app` e distribuzioni Electron per Windows/macOS.
- È stato aggiunto lo workspace `apps/album-flow`, con script `dev`, `build` e `preview`; la shell espone `build:album-flow` e `dev:album-flow`.

### Image Photo Selector

- `ImageAsset` in `packages/shared-types/src/auto-layout.ts` già definisce identità (`id`, `sourceFileKey`, path), geometria/orientamento, preview, dimensioni, rating, pick/reject, colore, `customLabels` e rotazione.
- La selezione attiva è `activeAssetIds`; lo stato per asset contiene rating, `pickStatus`, `colorLabel`, `customLabels`, rotazione e timestamp separati per classificazione/selezione.
- Il progetto Selector (`DesktopPhotoSelectorProjectFile`, schema 1) salva `folderState.activeAssetIds` e `folderState.assetStates`; esistono anche persistenza per cartella, snapshot free-mode, cache di ordinamento `orderedIds` e backup Drive.
- Rating, pick/reject, colore ed etichette personalizzate sono letti e scritti in sidecar XMP. Le etichette personali usano il namespace `https://imagetool.local/ns/photosuite/1.0/`; il catalogo/toni/scorciatoie delle etichette è nelle preferenze desktop.
- L'ordine è persistibile nella cache di ordinamento (`DesktopSortCacheEntry.orderedIds`), ma non fa parte né del project file né dell'handoff attuale. Non è quindi un confine trasferibile garantito verso un nuovo tool.

### Handoff e confini Electron

- I tipi IPC condivisi sono centralizzati in `packages/desktop-contracts/src/index.ts`; preload espone API strettamente nominate tramite `contextBridge`.
- `DesktopPhotoToolHandoff` schema 1 include origine, destinazione, radice e file con percorso, nome, peso e mtime. Non include `assetId`, selezione, rating, pick/reject, colore, etichette, rotazione, ordine, gruppi o revisione del progetto.
- Il contratto ora ammette `album-flow` tramite un campo `albumFlow` dedicato, mantenendo il payload file-only per i consumer precedenti.
- Il manager di handoff usa payload firmati, TTL, limiti di cardinalità, controlli contro symlink e acknowledgement. È una base sicura da estendere, ma il suo schema va evoluto in modo esplicito, non aggirato.

### RAW, preview e cache

- In browser il Selector usa un pool di 2–6 Web Worker per estrarre JPEG incorporati nei RAW. Copre percorsi TIFF/IFD, RAF, BMFF/CR3 e due fallback di scansione JPEG; i fallimenti restituiscono `null` e non bloccano la UI.
- In Electron, le API thumbnail/preview sono esposte da preload e gestite nel main process; sono presenti servizi nativi, Sharp, ExifTool, cache RAM/disco e protocollo `filex-preview` per la quick preview.
- La cache disco ha entry `.thumb` e `.preview`, versione cache, budget configurabili, scelta/migrazione directory e pruning best-effort. La pipeline distingue thumbnail e preview.

### Layout engine e core

- `@photo-tools/layout-engine` esporta template predefiniti, selezione template, assegnazione asset-slot e generazione di pagine. I tipi condivisi modellano slot, template, `GeneratedPageLayout`, crop, lato pagina e `spreadId`.
- Il motore sceglie template considerando numero foto, orientamento, rapporto d'aspetto, perdita stimata di crop, lato/spread e riuso recente; l'assegnazione privilegia orientamento, rapporto, rating e priorità slot, poi applica scambi locali.
- `@photo-tools/core` crea `AutoLayoutResult` e fornisce operazioni manuali (spostare, inserire, svuotare, cambiare template, riordinare, creare/rimuovere pagina e aggiornare crop). Auto e manuale usano già gli stessi `GeneratedPageLayout` e `LayoutAssignment`.
- Album Flow include un renderer SVG di spread con dimensioni fisiche, bleed e safe area, oltre a preflight iniziale. Non esistono ancora rasterizzazione/PDF nativa, profili colore, printer marks o proofing completo.

### UI FileX, console, licenza, distribuzione e sito

- Il Selector ha token CSS reali in `styles.css`: shell scura `#1f2421/#232925`, pannelli `#2b312d`, testo `#f2ece5`, accento oro `#b89a63`, radii 26/18/12 px e font Segoe UI Variable Text/Segoe UI.
- Il catalogo ufficiale è `apps/filex-desktop/src/tool-manifest.ts`. Album Flow non compare né nel tipo `DesktopToolId`, né nel manifest, né nella Dev Console.
- La Dev Console deriva i tool dal manifest e richiede per ogni test uno script root, categoria e descrizione. Le categorie e i test del Selector esistono; Album Flow non ha ancora alcuna registrazione.
- La shell usa `electron-builder`, ASAR, allowlist dei file runtime, branding, NSIS per-user e `licenseRuntime` nel manifest. I tool della Suite usano in prevalenza `shared-runtime`; la policy di Album Flow è una decisione aperta.
- Le workflow presenti sono `ci.yml`, `windows-release.yml`, `website-suite-sync.yml` e `pages.yml`. Il sito contiene pagine per i tool esistenti, ma non una pagina Album Flow.

## Gap verificati

1. Workspace, manifest desktop, IPC, bridge preload, script e test iniziali sono ora presenti; restano da completare release entry e pagina marketing del sito.
2. Il contratto di handoff con metadati del Selector è presente e validato; resta da integrare con il salvataggio persistente nativo del progetto.
3. `AlbumProject` e capitoli sono presenti nel workspace, con export/import JSON, relink validato e salvataggio locale a due fasi; mancano persistenza nativa, versioning/migrazioni e relink interattivo.
4. Il workspace genera una prima bozza tramite il layout engine e un export SVG con bleed/safe area; renderer nativo/PDF, profili colore, printer marks e proofing completo restano da implementare.
5. Il raggruppamento del layout attuale è guidato dall'orientamento, non da cronologia, capitoli o gruppi narrativi.
6. Il motore non esegue analisi semantica, rilevamento volti/soggetti o punteggio narrativo; il crop iniziale è geometrico con un bias per ritratti, non content-aware.

## Verifiche eseguite

- Lettura delle istruzioni root, desktop e packages; manifest root, Selector, layout engine e shell.
- Inventario file/workspace, stato Git, branch, remoto e worktree.
- Ricerca e lettura mirata dei contratti `ImageAsset`, Selector project/store/XMP, handoff, preload/main, pipeline RAW/cache, layout engine/core, manifest, Dev Console, builder, workflow e sito.
- Nessun file di prodotto è stato modificato e non sono stati avviati build, packaging o test: l'audit è documentale/read-only e non cambia codice eseguibile.

## Collegamenti ai report AF-000

- [Mappa integrazione e handoff](AF-000-INTEGRATION-MAP.md)
- [Decisioni aperte e gate di avvio](AF-000-OPEN-DECISIONS.md)
