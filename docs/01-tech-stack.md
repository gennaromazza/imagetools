# FileX Suite — Tech Stack & Convenzioni

Questo documento descrive lo stack realmente presente nella suite **FileX** (ex ImageTools) a marzo 2026 e la roadmap di uniformazione tecnologica.

## 1. Stack attuale

- TypeScript
- Node.js con `npm` workspaces
- React 18/19 (da uniformare)
- Vite 6
- Express (backend locale per alcuni tool)
- Python (AI sidecar per Image ID Print)
- browser APIs (`localStorage`, `IndexedDB`, File System Access API quando disponibile)
- JSON per configurazioni, serializzazione progetto ed export `.imagetool`

## 2. Tool e package

### Tool principali
- `auto-layout-app`: impaginazione automatica multifoto (React + Vite)
- `image-party-frame`: batch framing, crop live, export eventi (React + Vite + Express)
- `IMAGE ID PRINT`: foto documento pronte per la stampa, AI/sidecar (React + Vite + Python)
- `archivio-flow`: import e archiviazione lavori da SD (React + Vite + Express)
- `photo-selector-app`: selezione e classificazione foto avanzata (React + Vite)

### Moduli condivisi
- `core`: orchestrazione e stato manuale
- `layout-engine`: motore di planning e layout
- `presets`: preset fogli e request di default
- `shared-types`: tipi condivisi
- `ui-schema`: metadati UI condivisi
- `filesystem`: base per storage Node/browser futuri

## 3. Struttura workspace attuale

```text
apps/
  auto-layout-app/
  image-party-frame/
  IMAGE ID PRINT/
  archivio-flow/
  photo-selector-app/

packages/
  core/
  filesystem/
  layout-engine/
  presets/
  shared-types/
  ui-schema/
```

## 4. Script disponibili

- `npm run dev`
- `npm run dev:auto-layout`
- `npm run dev:image-party-frame`
- `npm run dev:image-id-print`
- `npm run dev:archivio-flow`
- `npm run dev:photo-selector`
- `npm run build`
- `npm run typecheck`
- `npm run lint`

**Nota:** alcuni workspace usano React 18, altri React 19. Uniformare a React 19 per coerenza.

## 5. Build e quality gates

- `npm run build`: OK (alcuni warning chunk size)
- `npm run typecheck`: errori da risolvere in auto-layout-app

**Da implementare:**
- test automatici
- lint attivo in tutti i workspace
- formatter centralizzato

## 6. Modello tecnico

- Stato persistente: `localStorage` e `IndexedDB`
- Import immagini: `FileList`, URL blob, dataset demo
- Export: renderer canvas, download, File System Access API

## 7. Convenzioni tecniche

- package separati per responsabilità
- tipi condivisi in package dedicato
- componenti React in `PascalCase.tsx`
- file TS non-component in `kebab-case.ts`
- stato serializzabile per request e project export
- niente logica di layout nella UI
- niente dipendenze UI dentro `layout-engine`
- niente tipi duplicati tra app e package condivisi

## 8. Contratti principali

- `ImageAsset`, `SheetSpec`, `LayoutTemplate`, `LayoutAssignment`, `GeneratedPageLayout`, `AutoLayoutRequest`, `AutoLayoutResult`, `RenderJob`

## 9. Limitazioni tecniche attuali

- nessuna integrazione Photoshop / UXP
- export `tif` non realmente nativo nel browser
- nessuna persistenza preset utente dedicata
- nessuna suite di test per proteggere regressioni

## 10. Roadmap di uniformazione

1. Uniformare React a v19 in tutti i workspace
2. Allineare pattern UI e dipendenze principali
3. Attivare lint e formatter centralizzato
4. Introdurre test automatici per engine/core
5. Consolidare moduli condivisi
6. Packaging desktop e distribuzione facilitata
