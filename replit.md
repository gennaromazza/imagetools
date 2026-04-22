# FileX Suite (photo-tools)

A professional modular ecosystem for photographic workflows, structured as an NPM workspaces monorepo.

## Architecture

### Monorepo Structure
- **apps/** - User-facing applications (React + Vite)
  - `auto-layout-app` - Automatic multi-photo pagination (primary dev app)
  - `image-party-frame` - Batch framing and live cropping for events
  - `IMAGE ID PRINT` - Document photo preparation with AI background removal
  - `archivio-flow` - SD card import and work archiving
  - `photo-selector-app` - Advanced photo selection and classification
  - `filex-desktop` - Shared Electron shell and Suite Launcher
  - `AlbumWiew` - Browsable photo albums with annotation support
- **packages/** - Shared libraries
  - `core` - Orchestration logic and manual editing state
  - `layout-engine` - Algorithm for template selection and slot assignment
  - `shared-types` - TypeScript definitions
  - `filesystem` - File system scanning and metadata utilities
  - `presets` & `ui-schema` - Shared configuration and UI metadata

### Tech Stack
- **Language**: TypeScript/JavaScript + Python (AI sidecar)
- **Frontend**: React 19 + Vite 6
- **Styling**: Tailwind CSS, Shadcn/ui, Material UI
- **Desktop (Windows)**: Electron + electron-builder
- **Image Processing**: Sharp, exiftool-vendored, ag-psd
- **AI**: Python rembg for background removal

## Development

### Running the App
The primary dev workflow runs the `auto-layout-app` on port 5000:
```
npm run dev:auto-layout
```

Other apps can be run with:
```
npm run dev:image-party-frame
npm run dev:photo-selector
npm run dev:archivio-flow
npm run dev:image-id-print
```

### Installing Dependencies
```
npm install
npm install @rollup/rollup-linux-x64-gnu --no-save  # Required for Linux/Replit
```

### Building
```
npm run build
```

## Deployment
Configured as a static site deployment. Builds the auto-layout-app and serves from `apps/auto-layout-app/dist`.

## Notes
- The `@rollup/rollup-linux-x64-gnu` native module must be installed separately for Linux environments (Replit). The package-lock.json was originally generated on Windows.
- Electron-related features (filex-desktop) are Windows-only and won't work in Replit.
- Python AI features (rembg background removal) require Python 3.12 with the rembg package.
