# Image ID Print

## Sintesi

`Image ID Print` e' il tool della suite FileX dedicato a fototessere, passaporti e foto documento pronte per stampa ed export.

Dal punto di vista prodotto non e' piu soltanto una web app locale: e' integrato nella shell desktop `Electron` della suite e puo essere distribuito come software installabile.

Branding visibile:

- `Image ID Print`
- `by ImageStudio di Gennaro Mazzacane`

## Funzioni principali

- upload JPG/PNG
- crop guidato per formati documento
- layout automatico copie su foglio
- export JPG, PNG e PDF
- stampa foglio
- AI locale per:
  - rimozione sfondo
  - sfondo bianco
  - auto-fit al formato
  - espansione canvas
  - miglioramento ritratto
  - refine manuale dello scontorno

## Architettura

### Frontend

- React + Vite + TypeScript
- UI in `apps/IMAGE ID PRINT/src`

### Desktop shell

- Electron condiviso in `apps/filex-desktop`
- manifest tool in `apps/filex-desktop/src/tool-manifest.ts`
- preload bridge in `apps/filex-desktop/src/preload.ts`
- lifecycle AI desktop in `apps/filex-desktop/src/image-id-print-ai-service.ts`

### Runtime AI

- sidecar Python basato su `rembg`
- server Flask locale `rembg_server.py`
- modello `u2net.onnx`
- staging runtime desktop con `apps/filex-desktop/scripts/stage-image-id-print-runtime.mjs`

## Packaging

### Windows

Comando:

```bash
npm --workspace @photo-tools/filex-desktop run dist:image-id-print:win
```

Output atteso:

- `apps/filex-desktop/release/image-id-print/Image-ID-Print-<version>-x64-setup.exe`
- `apps/filex-desktop/release/image-id-print/win-unpacked`

Nota:

- ogni tool desktop ora usa una sottocartella dedicata sotto `apps/filex-desktop/release/<tool-id>`
- questo evita che i build di `Image ID Print`, `Selezione Foto` e altri tool si sovrascrivano tra loro

Il pacchetto include:

- renderer build
- shell Electron
- branding
- runtime AI staged in `resources/image-id-print-runtime`

### macOS

Comando host-arch:

```bash
npm --workspace @photo-tools/filex-desktop run dist:image-id-print:mac
```

Comandi espliciti:

```bash
npm --workspace @photo-tools/filex-desktop run dist:image-id-print:mac:x64
npm --workspace @photo-tools/filex-desktop run dist:image-id-print:mac:arm64
```

Output atteso:

- `apps/filex-desktop/release/image-id-print/Image-ID-Print-<version>-x64.dmg`
- `apps/filex-desktop/release/image-id-print/Image-ID-Print-<version>-x64.zip`
- `apps/filex-desktop/release/image-id-print/Image-ID-Print-<version>-arm64.dmg`
- `apps/filex-desktop/release/image-id-print/Image-ID-Print-<version>-arm64.zip`

Nota:

- la build macOS e' arch-specific, non piu `universal`, per mantenere coerente anche il sidecar AI locale
- gli artefatti finali vanno generati da host o CI macOS
- notarization e code signing non sono ancora inclusi
- e' presente il workflow GitHub Actions `.github/workflows/image-id-print-macos.yml` per generare sia `x64` sia `arm64`

## Flussi supportati

### Utente finale desktop

- installa l'app
- apre `Image ID Print`
- il motore AI viene avviato dalla shell desktop
- usa crop, AI, export e stampa senza setup Python manuale

### Sviluppo

- il frontend puo ancora girare in modo browser-first
- i launcher `.bat` del sidecar restano disponibili per debug locale

## Stato implementativo

Implementato:

- integrazione desktop first-class
- runtime AI gestito dal main process
- UI con stato AI desktop
- branding applicato in app e installer Windows
- installer Windows generato con successo

Non incluso in questa milestone:

- code signing Windows
- notarization macOS
- build macOS verificato da macchina Windows
