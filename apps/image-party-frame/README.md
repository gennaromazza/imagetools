# Image Party Frame

Part of the ImageTools suite.

Desktop-style web application for building framed photo projects, validating templates, adjusting crop live, and exporting final images in batch.

## What It Does

- Creates photo projects from a selected image folder
- Supports preset templates from the backend and custom templates built inside the app
- Lets the user reorder templates with drag and drop and hide preset templates from the project UI
- Stores custom templates locally with IndexedDB-backed background assets
- Exports and imports portable JSON packages for project state and template libraries
- Provides live crop/zoom editing in the workspace
- Processes single images and batch exports through a local Express + Sharp server
- Restores recent project snapshots inside the app context

## Stack

- Frontend: React 18, TypeScript, Vite, React Router
- UI: Tailwind CSS, Radix UI, shadcn-style components, Lucide icons
- State: React Context + browser localStorage/IndexedDB + portable JSON packages
- Drag and drop: native HTML drag and drop in the project template library
- Backend: Node.js, Express, Multer, Sharp

## Main Flows

1. Create or reopen a project
2. Choose a preset or custom template
3. Validate the selected layout
4. Adjust image crop and approve images in the workspace
5. Compare original vs framed output
6. Configure export and run batch processing
7. Export or import project/template packages for transfer to another machine

## Run Locally

```bash
npm install
npm run dev:all
```

App:
- Frontend: `http://localhost:5173` or the next free Vite port
- Backend API: `http://localhost:3001`

## Build

```bash
npm run build
```

## Documentation

- [Architecture, UI and technologies](./docs/ARCHITECTURE_UI_TECH.md)
- [Development and operations](./docs/DEVELOPMENT.md)

## Notes

- Recent projects are local convenience entries. They restore project state on the current machine, but they are not the recommended cross-device transfer format.
- Portable project packages and template-library packages are the current bridge toward Windows/macOS desktop-style portability.
- Recent projects restore project state, but original source files are still session-bound browser `File` objects unless re-linked or re-imported on the target machine.
- Custom template background binaries are stored locally in IndexedDB.
- Preset templates remain defined server-side for rendering compatibility, even if hidden from the UI.

## Third-Party Note

The project includes UI patterns and components derived from the Radix/shadcn ecosystem. Legacy Figma/Unsplash attribution notes were condensed into this repository-level summary because the old generated markdown files were removed during documentation cleanup.
