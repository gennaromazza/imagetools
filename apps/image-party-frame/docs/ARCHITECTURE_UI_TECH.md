# Architecture, UI And Technologies

## Product Scope

PartyFrame is a local-first FileX desktop workflow for event-photo framing. It imports a source folder, applies one preset or custom template, lets the operator approve a consistent crop and exports a bounded batch with observable progress and recoverable failures.

## Runtime Topology

### FileX Desktop Shell

- Electron owns the application window, native folder/file access and component startup.
- A random PartyFrame session token is generated for each launch.
- The preload bridge exposes only the typed methods declared by `@photo-tools/desktop-contracts`.
- The renderer requests thumbnails and file metadata through the desktop bridge instead of loading every original into browser memory.
- The packaged main process starts the loopback image engine before the renderer is shown.

### React Renderer

- React 19 and React Router provide the page workflow.
- `ProjectContext.tsx` owns normalized, serializable project state while source `File` handles remain in project-scoped maps.
- `cropGeometry.ts` is the sole crop coordinate contract shared by workspace and comparison views.
- `templateGeometry.ts` consumes the same preset catalog used by the server, preventing preview/export geometry drift.
- `useApi.ts` owns network requests, cancellation and health state; `exportSession.ts` owns validated refresh recovery.
- Route guards reject incomplete projects while still allowing a detached export job to be monitored after refresh.

### Local Processing Engine

- `server/app.ts` defines the HTTP boundary, upload limits, authentication and routes.
- `server/jobs.ts` provides a bounded queue, cancellation, idempotency, progress snapshots and retention.
- `server/pipeline.ts` validates sources/templates/paths and performs EXIF-aware Sharp rendering.
- `server/templateCatalog.ts` is the shared source of truth for presets and frame artwork.
- The engine binds to `127.0.0.1`; sensitive routes require the desktop session token when configured.

## Core UI Flow

1. **Home** — create/import projects, reopen verified recents and manage the local template library.
2. **New project** — scan supported files with bounded concurrency, select/reorder a template and relink missing sources.
3. **Custom template** — edit vertical and horizontal drafts, validate geometry/assets and commit atomically on Save.
4. **Validation** — show explicit project, source and template checks before workspace entry.
5. **Workspace** — generate bounded thumbnails, edit crop locally during gestures, process previews and approve images.
6. **Comparison** — show the original against the real processed result or a geometrically equivalent local fallback.
7. **Export settings** — validate format, destination, naming and approved-only selection.
8. **Export progress** — show transfer, queue, rendering, writing and cleanup states; cancel, reconnect or retry failures.

## State And Persistence

- Every project has a stable ID; image identities and in-memory file handles are scoped to it.
- Crop is stored as normalized horizontal/vertical offsets plus zoom, with migration for legacy pixel offsets.
- Recent snapshots retain metadata and native paths. Reopen verifies the files before making the project editable.
- Custom-template metadata is stored in `localStorage`; validated background blobs are stored in IndexedDB.
- Portable JSON packages are versioned, size-bounded and schema-validated before committing state.
- Imported asset keys and preview URLs are never trusted; runtime values are regenerated locally.
- An active export intent and its last validated job snapshot are stored in `sessionStorage` so a page refresh does not create duplicate work.

## Rendering Contract

- EXIF orientation is applied before orientation selection and crop calculations.
- Workspace, comparison and server use the same cover-crop model.
- The workspace measures its preview host and contains the entire composition against both available width and height; resizing the UI never changes normalized crop data or export geometry.
- Image and adjustment panels become overlay controls below the desktop breakpoint so the composition remains the primary surface.
- Preset artwork is produced from the shared catalog; custom artwork is validated for both orientations.
- Output supports JPEG and PNG, uses sRGB and writes requested DPI metadata.
- Output files are first written as partial files and atomically renamed after success.
- Collision-safe naming preserves existing files unless overwrite is explicitly enabled.

## Performance And Backpressure

- Native imports keep lightweight placeholders and request thumbnails only when needed.
- Browser imports and preview generation use small worker pools rather than unbounded `Promise.all`.
- Crop gestures update a local draft and commit at gesture boundaries, avoiding whole-project renders for every pointer event.
- The server caps file count, per-file bytes, aggregate bytes, pixel dimensions, concurrent jobs and pending jobs.
- Job responses include real completed/total counts and the current phase instead of simulated progress.

## Failure And Recovery Model

- An application error boundary preserves persisted project data and offers a safe route back to Home.
- Health checks have timeout, cancellation and explicit checking/online/offline states.
- API errors carry stable codes and retryability; a full queue returns HTTP 429.
- Export cancellation is cooperative and cleans temporary uploads and partial outputs.
- Idempotency keys make reconnect and refresh safe.
- Per-file failures remain visible without hiding successful outputs.

## Technology Choices

- React 19, TypeScript, Vite and React Router
- Tailwind CSS, Radix primitives, Lucide icons and Sonner
- Electron and `@photo-tools/desktop-contracts`
- Node.js, Express, Multer and Sharp
- `localStorage`, `sessionStorage`, IndexedDB, object URLs and `ResizeObserver`

## Verification Boundaries

- State, crop, responsive workspace layout, source-import, export-session and portable-data regressions run through the PartyFrame bug-hunt script.
- Rendering, security and job behavior run through the server test suite.
- The FileX package-runtime check ensures the compiled server import closure is present in the desktop component output.
- These checks are registered in CI and in the FileX Dev Console.
