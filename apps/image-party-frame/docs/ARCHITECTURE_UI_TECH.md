# Architecture, UI And Technologies

## Product Scope

Image Party Frame is a local-first photo framing workflow with a browser frontend and a local processing server. The app is optimized for event-photo style batch work: choose a template, validate the layout, adjust crop image by image, then export final framed outputs.

## Application Architecture

### Frontend

- React application under [`src/app`](../src/app)
- Routing handled with React Router in [`src/app/routes.ts`](../src/app/routes.ts)
- Global project state handled by [`src/app/contexts/ProjectContext.tsx`](../src/app/contexts/ProjectContext.tsx)
- API integration handled by [`src/app/hooks/useApi.ts`](../src/app/hooks/useApi.ts)

### Backend

- Local Express API in [`server/index.ts`](../server/index.ts)
- `multer` handles uploads
- `sharp` handles crop, resize, compositing and output generation
- Preset templates are exposed by `GET /api/templates`

### Local Persistence

- `localStorage` stores:
  - recent project snapshots
  - template library ordering and hidden preset preferences
  - saved custom template metadata
- `IndexedDB` stores custom template background assets
- portable JSON packages provide machine-transferable project and template-library snapshots

## Core UI Flows

### 1. Home

- Opens new projects
- Shows recent project snapshots
- Shows saved template library
- Imports project packages and template-library packages
- Exports the saved template library as a portable package

### 2. New Project

- Reads preset templates from the backend
- Merges preset templates and saved custom templates into one ordered library
- Supports drag-and-drop reordering of templates
- Supports hiding preset templates from the project UI
- Supports loading saved custom templates into the project

### 3. Custom Template Builder

- Defines vertical and horizontal variants
- Supports background upload with optimization
- Supports border settings and photo area editing
- Saves to project or to library

### 4. Template Validation

- Previews the selected layout before editing begins

### 5. Workspace

- Live crop and zoom per image
- Single-image processing through the backend
- Approval workflow
- Comparison page entry point
- Project package export entry point

### 6. Image Comparison

- Compares original source preview with framed result or live framed preview

### 7. Export

- Export settings page configures format, quality, naming and destination
- Export progress page runs batch export and reports success/failure summary

## State Model

The project context stores:

- project identity and paths
- selected template id
- optional active custom template
- image list and crop state
- export settings

Session-only browser `File` objects are kept outside serializable state in in-memory maps. This is why a restored recent project can recover metadata and UI state, but not always the original file binaries after a browser restart.

Portable project packages embed the serializable project snapshot plus custom-template background assets. They are intended as the migration path toward true desktop-style save/import behavior across Windows and macOS.

## Template System

### Preset Templates

- Defined server-side for processing
- Exposed to the frontend via `/api/templates`
- Can be hidden from the project UI without being deleted from server definitions

### Custom Templates

- Built inside the app
- Store geometry for vertical and horizontal variants
- Can include background assets per orientation
- Persist through metadata in `localStorage` and binaries in `IndexedDB`

### Template Ordering

- The project template library keeps a user-defined preferred order
- Ordering is persisted locally and reused in the creation/edit flow

### Portable Packages

- Project packages capture normalized project state for transfer or backup
- Template-library packages capture saved custom templates and embedded background assets
- The current package format is JSON-based so it stays inspectable and easy to migrate later into desktop-native save flows

## Technology Choices

## Frontend

- React 18
- TypeScript
- Vite
- React Router
- Tailwind CSS
- Radix UI primitives
- Lucide icons
- Sonner for toast notifications

## Backend

- Node.js
- Express
- Multer
- Sharp
- dotenv

## Browser APIs

- `localStorage`
- `IndexedDB`
- `File` and `FormData`
- `ResizeObserver`
- object URLs via `URL.createObjectURL`

## Reusable Patterns For Similar Software

The current codebase already contains patterns that are reusable in other desktop-like media tools:

- local-first project state with React Context
- hybrid persistence using `localStorage` + `IndexedDB`
- portable JSON package import/export for user data transfer
- backend-backed image processing through multipart uploads
- session file-object maps for browser-based editing tools
- merged libraries combining presets and user-generated templates
- drag-and-drop ordering of reusable assets/templates

## Current Constraints

- Source image binaries are session-bound in the browser
- Preset template rendering metadata still exists server-side and is not user-editable
- Recent-project persistence is machine-local convenience, not the long-term cross-device storage model
- The app is local-environment oriented and assumes a reachable local API server
