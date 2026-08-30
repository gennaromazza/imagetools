# Development And Operations

## Prerequisites

- Node.js 20 or newer
- npm, run from the monorepo root
- Windows for the native folder picker; image processing and automated tests are otherwise platform-neutral

## Development Commands

Run the renderer and local engine together:

```bash
npm --workspace @photo-tools/image-party-frame-app run dev:all
```

Or run the real FileX desktop integration:

```bash
npm run dev:image-party-frame
```

Default development endpoints:

- Renderer: `http://127.0.0.1:4170`
- Local API: `http://127.0.0.1:3001`

Both services bind to loopback. Development uses the same token value in renderer and server; the packaged desktop app generates a random token for each launch and passes it through the preload contract.

## Build And Automated Checks

```bash
npm --workspace @photo-tools/image-party-frame-app run typecheck
npm run test:image-party-frame-bug-hunt
npm run test:image-party-frame-server
npm run test:image-party-frame-package-runtime
npm --workspace @photo-tools/filex-desktop run build:image-party-frame
```

The focused bug-hunt tests cover project isolation and migration, normalized crop geometry, route validation, native source import and portable-data validation. Server tests cover rendering, EXIF orientation, input and path limits, authentication, cancellation, idempotency, collisions and partial-file cleanup. The package-runtime check guards the compiled Electron import closure.

All three PartyFrame tests are also exposed in the FileX Dev Console under the PartyFrame category.

## Main Source Areas

- App shell and error boundary: [`src/app/App.tsx`](../src/app/App.tsx)
- Route protection: [`src/app/components/ProjectRouteGuard.tsx`](../src/app/components/ProjectRouteGuard.tsx)
- Project state: [`src/app/contexts/ProjectContext.tsx`](../src/app/contexts/ProjectContext.tsx)
- API client and export-session recovery: [`src/app/hooks/useApi.ts`](../src/app/hooks/useApi.ts)
- Crop contract: [`src/app/lib/cropGeometry.ts`](../src/app/lib/cropGeometry.ts)
- Source import: [`src/app/lib/sourceImport.ts`](../src/app/lib/sourceImport.ts)
- Template persistence: [`src/app/lib/savedTemplates.ts`](../src/app/lib/savedTemplates.ts)
- Portable packages: [`src/app/lib/portablePackages.ts`](../src/app/lib/portablePackages.ts)
- HTTP application and security boundary: [`server/app.ts`](../server/app.ts)
- Export job manager: [`server/jobs.ts`](../server/jobs.ts)
- Rendering and validation pipeline: [`server/pipeline.ts`](../server/pipeline.ts)
- Shared preset catalog: [`server/templateCatalog.ts`](../server/templateCatalog.ts)

## Project And Source Lifecycle

- Each project owns an isolated image list and stable image identifiers.
- Desktop imports validate supported source files and keep lightweight placeholders instead of loading all originals into memory.
- Recent-project snapshots retain native paths. Reopen verifies that those paths still identify the expected files; otherwise the user is sent through relinking.
- Crop is stored as normalized offsets plus zoom. Preview, comparison and server rendering use the same geometry contract.
- A portable project package restores project and custom-template state, but intentionally does not copy the source photographs.

## Custom Templates And Portable Data

- Template metadata lives in local storage and background binaries in IndexedDB.
- Builder changes are drafts until Save, so cancelling cannot mutate an existing template.
- Imported project/template packages are schema-checked, size-limited and migrated only from supported versions before any state is committed.
- Removing a saved template also attempts to remove unreferenced background assets.

## Export Job Lifecycle

1. The renderer validates project, template, sources and destination.
2. It creates an export job with an idempotency key and reports real upload progress.
3. The local engine queues bounded work and exposes job snapshots through polling.
4. Each output is rendered to a partial file and atomically renamed only after success.
5. The UI shows queued, processing, cancelling, completed and failed states with per-file results.
6. The active job identifier is stored for refresh recovery; cancellation remains available while the job exists.

Output uses sRGB, embeds a compatible profile and writes the requested DPI. Adobe RGB is deliberately rejected because the pipeline does not perform a real color-space conversion.

## API Summary

Public endpoints:

- `GET /api/health`
- `GET /api/templates`

Desktop-session endpoints (require `X-PartyFrame-Token` when a token is configured):

- `POST /api/process-image`
- `POST /api/export-jobs`
- `GET /api/export-jobs/:id`
- `DELETE /api/export-jobs/:id`
- `POST /api/export-jobs/:id/cancel`
- `POST /api/open-folder`
- `POST /api/pick-folder`

`POST /api/batch-export` is retained as a compatibility endpoint; new UI work should use the export-job API. Native `absolutePath` input is accepted only in an authenticated desktop session.

## Manual Acceptance Pass

1. Import a mixed folder and confirm unsupported files are skipped without freezing the UI.
2. Create a project, switch template and adjust several vertical and horizontal crops.
3. Confirm workspace, before/after comparison and final output show the same framing.
4. Save, reopen and edit a custom template; cancel once and confirm the saved version is unchanged.
5. Start an export, refresh during processing and confirm progress resumes.
6. Cancel another export and confirm partial outputs are not presented as complete files.
7. Export twice to the same destination and confirm existing files are not overwritten.
8. Reopen a recent project; then move one source and verify the relink flow.
9. Export/import project and template packages and verify malformed or oversized packages are rejected without changing current state.
10. Stop the local engine and confirm the interface reports it as unavailable instead of appearing idle.

## Maintenance Rules

- Keep preset metadata and server rendering definitions in the shared template catalog.
- Keep crop changes synchronized through `cropGeometry.ts`; do not add page-specific crop math.
- Add every new local test to a root `test:*` script and to the PartyFrame section of the FileX Dev Console.
- If the server main-process import graph changes, update the Electron builder whitelist and package-runtime test in the same change.
