# Image Party Frame

## Scopo

`image-party-frame-app` serve a costruire workflow rapidi di cornici fotografiche per eventi:
selezione template, regolazione crop immagine per immagine, anteprima, confronto ed export batch.

## Posizione Nel Monorepo

- app: `apps/image-party-frame`
- stack: React + TypeScript + Vite
- processing locale: Express + Sharp

## Flusso Principale

1. creazione o import di un progetto
2. scelta del template preset o custom
3. validazione del layout
4. regolazione crop nel workspace
5. confronto risultato
6. configurazione export
7. export batch finale

## Funzionalita' Chiave

- libreria template con riordino drag and drop
- salvataggio template custom con asset background
- rimozione preset dalla UI senza toccare le definizioni server-side
- progetti recenti locali
- import/export JSON di progetto e libreria template
- confronto immagine originale vs output incorniciato

## Persistenza

- `localStorage`: snapshot progetto recente, ordinamento template, metadati libreria
- `IndexedDB`: asset binari dei background template
- file JSON: trasferimento progetto e libreria su altri PC

## Note Architetturali

- il rendering finale dipende da un server locale raggiungibile
- i file immagine browser-side non sono intrinsecamente portabili senza re-import o relinking
- la direzione futura resta un packaging desktop Windows/macOS
