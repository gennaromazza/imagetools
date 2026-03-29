# Image ID Print

Tool per preparare foto documento pronte per la stampa multipla su foglio, con crop guidato, export e pipeline AI locale.

## Obiettivo

`Image ID Print` consente di:

1. caricare una foto
2. ritagliarla nel formato documento corretto
3. applicare correzioni AI conservative
4. generare un foglio con piu copie
5. esportare o stampare il risultato

## Stato attuale

L'app esiste in due modalita':

- modalita web/dev: frontend Vite con endpoint AI locale configurabile
- modalita desktop: app Electron distribuita tramite `apps/filex-desktop`

La modalita desktop e' quella di riferimento per il prodotto finale.

## Desktop packaging

Da marzo 2026 `Image ID Print` e' integrato come prodotto desktop dedicato:

- shell Electron condivisa
- branding visibile `by ImageStudio di Gennaro Mazzacane`
- runtime AI locale gestito dal processo main
- staging del sidecar Python dentro `resources/image-id-print-runtime`
- installer Windows `NSIS`
- target macOS `DMG` e `ZIP` configurati per build su host macOS

## Runtime AI

Il backend AI usa `rembg` e un sidecar Python locale.

Nel flusso desktop finale:

- l'utente non deve avviare `.bat`
- l'utente non deve creare `.venv`
- Electron prova ad avviare automaticamente il motore AI
- il frontend legge lo stato del motore tramite bridge desktop

Nel flusso di sviluppo restano disponibili:

- `avvia-rembg-sidecar.bat`
- `reset-rembg-sidecar.bat`

Questi launcher sono strumenti di supporto sviluppo/debug, non parte del flusso utente finale.

## Comandi principali

- sviluppo frontend:
  - `npm --workspace @photo-tools/image-id-print run dev`
- build frontend:
  - `npm --workspace @photo-tools/image-id-print run build`
- build desktop completo:
  - `npm --workspace @photo-tools/filex-desktop run build:image-id-print`
- installer Windows:
  - `npm --workspace @photo-tools/filex-desktop run dist:image-id-print:win`
- pacchetti macOS da host macOS:
  - `npm --workspace @photo-tools/filex-desktop run dist:image-id-print:mac`

## Output build

Windows:

- installer: `apps/filex-desktop/release/Image-ID-Print-<version>-x64-setup.exe`
- app unpacked: `apps/filex-desktop/release/win-unpacked`

## Note operative

- il runtime staged copia anche il modello `u2net.onnx` se presente nella cache utente
- il build macOS non va considerato verificato da Windows
- code signing e notarization non fanno parte di questa milestone
