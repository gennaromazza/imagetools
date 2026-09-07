# Image Party Frame

PartyFrame is the FileX tool for creating framed photo projects, checking layouts, adjusting crops and exporting large image batches through the local desktop engine.

## Main Capabilities

- Imports supported images from a folder without keeping every original in browser memory
- Reopens recent desktop projects when their source files are still available, with a relink flow when they are not
- Supports preset templates and validated custom vertical/horizontal templates
- Keeps crop and zoom consistent between workspace preview, comparison and final export
- Fits the full vertical or horizontal composition inside the available workspace and exposes compact responsive side panels
- Processes previews with EXIF orientation and exports JPEG or PNG in sRGB with the requested DPI metadata
- Runs export as an observable job with upload, queue, processing and completion states
- Reports per-file success or failure, supports cancellation and safely resumes an active job after a page refresh
- Uses atomic output writes and collision-safe filenames so an interrupted export does not leave apparently complete files
- Imports and exports versioned project and template-library packages with validation and bounded payloads

## Logo e testo nei template personalizzati

- “Arrotondamento angoli (px)” regola il raggio dell’area foto per ogni variante: 0 mantiene gli angoli squadrati. Il raggio comprende il bordo ed è conservato nella libreria, nei pacchetti e nell’export; il centro della foto resta visibile.

- Ogni variante verticale/orizzontale contiene fino a 3 loghi e 5 testi indipendenti.
- I loghi si caricano da file (massimo 10 MB), si spostano e ridimensionano dal canvas o tramite coordinate e dimensioni. Le proporzioni dell’immagine sono preservate dentro il riquadro.
- I testi supportano fino a 200 caratteri, più righe, dimensioni da 12 a 600 px, colore, grassetto, corsivo, allineamento, ombra e opacità.
- Dopo “Aggiungi” puoi scrivere subito sul canvas. Il doppio clic riapre la scrittura; Escape o un clic fuori la terminano. La maniglia di spostamento resta disponibile anche per un riquadro a larghezza piena; quella nell’angolo ridimensiona testo e riquadro insieme.
- Gli otto font photobooth sono inclusi tramite Fontsource e funzionano offline; anteprima ed export usano lo stesso rendering PNG. L’opacità viene applicata una sola volta e il testo viene ritagliato sul bordo del canvas.
- La libreria conserva anche i file dei loghi in IndexedDB; i pacchetti portabili includono gli asset. Un logo mancante blocca l’esportazione invece di sparire dal risultato.
- Il pulsante “Modifica” nella libreria riapre il template completo. “Salva nella Libreria” aggiorna lo stesso modello; “Duplica” permette di conservarne una copia separata.
- `npm run test:image-party-frame-overlays` verifica geometria, controlli reali in Electron, font offline, varianti, rendering e persistenza. È disponibile nella categoria Image Party Frame della Dev Console.

## Stack

- Frontend: React 19, TypeScript, Vite and React Router
- UI: Tailwind CSS, Radix UI, shadcn-style components and Lucide icons
- State: React Context, browser storage and IndexedDB for custom-template assets
- Backend: Node.js, Express, Multer and Sharp
- Desktop integration: Electron through the FileX shell and `@photo-tools/desktop-contracts`

## Development

Run commands from the monorepo root:

```bash
npm --workspace @photo-tools/image-party-frame-app run dev:all
```

- Frontend: `http://127.0.0.1:4170`
- Local API: `http://127.0.0.1:3001`

To run PartyFrame in its real FileX desktop shell:

```bash
npm run dev:image-party-frame
```

## Build And Verification

```bash
npm --workspace @photo-tools/image-party-frame-app run typecheck
npm run test:image-party-frame-bug-hunt
npm run test:image-party-frame-server
npm run test:image-party-frame-overlays
npm run test:image-party-frame-package-runtime
npm --workspace @photo-tools/filex-desktop run build:image-party-frame
```

The desktop build compiles the renderer and server and then copies the server runtime into the component output. The package-runtime test verifies that the compiled main-process import closure is included in that output.

## Runtime Notes

- In the Electron app, source files are referenced by verified native paths. The renderer receives only lightweight file descriptors and thumbnails until processing is requested.
- Native-path processing and sensitive local actions require the per-launch desktop session token. The API binds to loopback only.
- Recent projects are local convenience snapshots. A portable project package carries project state and custom-template assets, but does not duplicate the source photographs.
- Custom-template metadata is stored locally; background binaries are kept in IndexedDB and unreferenced assets are cleaned up.
- Preset templates remain defined by the shared server catalog even when hidden from the project interface.

## Documentation

- [Architecture, UI and technologies](./docs/ARCHITECTURE_UI_TECH.md)
- [Development and operations](./docs/DEVELOPMENT.md)

## Third-Party Note

The project includes UI patterns and components derived from the Radix/shadcn ecosystem. Legacy Figma/Unsplash attribution notes were condensed into this repository-level summary during documentation cleanup.
