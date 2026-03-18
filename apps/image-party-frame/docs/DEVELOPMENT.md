# Development And Operations

## Prerequisites

- Node.js 18+
- npm
- Windows-friendly local environment recommended because folder picking and local workflow were built with Windows in mind

## Install

```bash
npm install
```

## Run In Development

```bash
npm run dev:all
```

Or run separately:

```bash
npm run dev
npm run dev:server
```

## Default Endpoints

- Frontend: `http://localhost:5173` or next available Vite port
- Backend: `http://localhost:3001`

## Build

```bash
npm run build
```

## Main Source Areas

- Frontend entry: [`src/app/App.tsx`](../src/app/App.tsx)
- Routes: [`src/app/routes.ts`](../src/app/routes.ts)
- Project state: [`src/app/contexts/ProjectContext.tsx`](../src/app/contexts/ProjectContext.tsx)
- API hooks: [`src/app/hooks/useApi.ts`](../src/app/hooks/useApi.ts)
- Template persistence: [`src/app/lib/savedTemplates.ts`](../src/app/lib/savedTemplates.ts)
- Portable import/export: [`src/app/lib/portablePackages.ts`](../src/app/lib/portablePackages.ts)
- Template library ordering: [`src/app/lib/templateLibrary.ts`](../src/app/lib/templateLibrary.ts)
- Backend API: [`server/index.ts`](../server/index.ts)

## Important Runtime Behavior

### Recent Projects

- Recent projects store a project snapshot in `localStorage`
- Reopening a project restores project metadata and UI state
- Original source files may still be unavailable after a browser restart because browser `File` objects are not durable across sessions
- Treat recent projects as local convenience only, not as the cross-machine storage format

### Portable Project And Template Packages

- Project packages are exported from the workspace and imported from the home screen
- Template-library packages are imported/exported from the template library section on the home screen
- Package files are JSON so they can be versioned, migrated, and eventually mapped to a desktop-native save flow
- On another PC, package import restores project/template metadata and embedded custom-template assets; source image folders may still need relinking if the files are not bundled

### Custom Templates

- Template metadata lives in `localStorage`
- Background binaries live in `IndexedDB`
- Deleting a saved template also attempts cleanup of unreferenced background assets

### Export

- Single-image processing and batch export both use the local API server
- Batch export is driven from the export progress page and reports per-file failures

## API Summary

### `GET /api/health`

- Used by the server status badge

### `GET /api/templates`

- Returns preset template metadata for the project selection flow

### `POST /api/process-image`

- Accepts one source image plus crop/template parameters
- Returns the processed output path for preview use

### `POST /api/batch-export`

- Accepts a batch of source images and export settings
- Returns `success`, `failed`, `totalTime`, `outputDir`

### `POST /api/open-folder`

- Opens the export folder on the local machine

### `POST /api/pick-folder`

- Opens a Windows folder picker for export destination selection

## Recommended Manual Checks

1. Create a new project from an image folder
2. Reorder templates and verify the order persists
3. Hide a preset template and verify it disappears from the project UI
4. Build and save a custom template with both orientations
5. Reload the saved custom template into a project
6. Adjust crop in workspace and process at least one image
7. Open the comparison page from the workspace
8. Run a batch export
9. Export a portable project package and import it back
10. Export the template library package and import it on a clean browser profile
11. Return home and reopen the recent project snapshot

## Known Non-Issues / Expected Behavior

- If a recent project is restored after a browser restart, previews can be unavailable until images are re-imported
- Hidden preset templates are only hidden from the UI, not deleted from backend definitions
- Portable packages improve transferability, but the app still runs inside a browser shell and is not yet packaged as a desktop binary

## Maintenance Notes

- If template-related behavior changes, update:
  - `savedTemplates.ts`
  - `templateLibrary.ts`
  - `NewProject.tsx`
  - `CustomTemplateBuilder.tsx`
- If export behavior changes, update:
  - `useApi.ts`
  - `ExportSettings.tsx`
  - `ExportProgress.tsx`
  - `server/index.ts`
