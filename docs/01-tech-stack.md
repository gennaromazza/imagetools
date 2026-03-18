# Photo Tools for Photographers

## 01. Tech Stack & Technical Conventions

Questo documento descrive lo stack realmente presente nel repository al 16 marzo 2026 e chiarisce
quali parti sono gia' implementate e quali sono ancora pianificate.

Nota:

- questo file descrive la suite `Photo Tools / ImageTools`
- i dettagli specifici dei singoli prodotti stanno in `docs/tools/`

## 1. Stack attuale confermato

Tecnologie oggi in uso nel monorepo:

- TypeScript
- Node.js con `npm` workspaces
- React 19
- Vite 6
- browser APIs (`localStorage`, `IndexedDB`, File System Access API quando disponibile)
- JSON per configurazioni, serializzazione progetto ed export `.imagetool`

## 2. Stato dei package

### `apps/auto-layout-app`

Primo tool operativo della suite.

Responsabilita':

- dashboard progetti
- setup del job di impaginazione
- editor visuale dei fogli
- export dal browser
- import/export progetto

### `apps/image-party-frame`

Secondo tool operativo della suite, focalizzato su framing, crop live e export batch.

Responsabilita':

- creazione progetto da cartella immagini
- gestione template preset e custom
- workspace di crop con anteprima
- confronto immagine e export batch tramite server locale
- import/export JSON di progetto e libreria template

### `packages/core`

Responsabilita':

- creazione del piano iniziale
- modifica manuale delle assegnazioni
- gestione template per pagina
- ricalcolo dello stato risultante

API principali oggi esposte:

- `createAutoLayoutPlan`
- `buildAutoLayoutResult`
- `moveImageBetweenSlots`
- `placeImageInSlot`
- `addImageToPage`
- `changePageTemplate`
- `createPage`
- `removePage`
- `updatePageSheetSpec`
- `updateSlotAssignment`
- `rebalancePagesForAssignedImages`

### `packages/layout-engine`

Responsabilita':

- scelta template
- generazione layout iniziale
- assegnazione immagini agli slot

Vincolo confermato:

- nessuna dipendenza dalla UI
- nessuna dipendenza da Photoshop

### `packages/presets`

Responsabilita':

- preset dei fogli
- request di default per `auto-layout`

### `packages/shared-types`

Responsabilita':

- tipi condivisi per asset, fogli, template, assignment, output e result

### `packages/ui-schema`

Responsabilita':

- metadati UI condivisi per navigazione e sezioni standard del tool

### `packages/filesystem`

Package presente ma non ancora centrale nel flusso browser attuale.
Resta utile come base per integrazioni future lato Node o desktop.

## 3. Struttura workspace attuale

```text
apps/
  auto-layout-app/
  image-party-frame/

packages/
  core/
  filesystem/
  layout-engine/
  presets/
  shared-types/
  ui-schema/
```

Rispetto alla visione iniziale non sono ancora presenti:

- `apps/photoshop-plugin`
- `apps/cli`
- `packages/logging`
- `legacy/extendscript`

## 4. Script disponibili

Script root verificati:

- `npm run dev`
- `npm run dev:auto-layout`
- `npm run dev:image-party-frame`
- `npm run dev:all:image-party-frame`
- `npm run build`
- `npm run typecheck`
- `npm run lint`

Nota importante:

- lo script root `lint` esiste, ma al momento i workspace non espongono task `lint`
- non esiste ancora uno script `test`

## 5. Build e quality gates

Stato verificato il 16 marzo 2026:

- `npm run build`: OK
- `npm run typecheck`: OK

Stato non ancora presente:

- test automatici
- lint attivo nei workspace
- formatter centralizzato dichiarato nei package script

## 6. Modello tecnico dell'app browser

L'app attuale e' browser-first, quindi usa questi livelli:

### Stato persistente progetto

- `localStorage` per l'elenco dei progetti e i metadata principali
- `IndexedDB` per salvare blob immagine e ripristinare preview dopo reload

### Import immagini

- `FileList` e URL blob generati nel browser
- dataset demo incluso per onboarding e test manuale rapido

### Export

- renderer canvas lato browser
- download file generati
- scrittura diretta in cartella solo quando il browser espone File System Access API

## 7. Convenzioni tecniche attive

Convenzioni gia' rispettate nel repo:

- package separati per responsabilita'
- tipi condivisi in package dedicato
- componenti React in `PascalCase.tsx`
- file TS non-component in `kebab-case.ts`
- stato serializzabile per request e project export

Convenzioni da mantenere:

- niente logica di layout nella UI
- niente dipendenze UI dentro `layout-engine`
- niente tipi duplicati tra app e package condivisi

## 8. Contratti principali

Tipi importanti oggi realmente in uso:

- `ImageAsset`
- `SheetSpec`
- `LayoutTemplate`
- `LayoutAssignment`
- `GeneratedPageLayout`
- `AutoLayoutRequest`
- `AutoLayoutResult`
- `RenderJob`

## 9. Limitazioni tecniche attuali

Limiti concreti dello stack oggi:

- nessuna integrazione Photoshop / UXP
- export `tif` non realmente nativo nel browser
- nessuna persistenza preset utente dedicata
- nessuna suite di test per proteggere regressioni del planner/editor

## 10. Direzione successiva consigliata

I prossimi passi tecnici piu' coerenti con il codice attuale sono:

1. introdurre test per `layout-engine` e `core`
2. attivare lint nei workspace
3. estrarre meglio i servizi di storage ed export browser
4. preparare un renderer desktop o Photoshop per formati di output piu' ricchi
5. valutare una seconda app solo quando il primo tool e' stabilizzato
