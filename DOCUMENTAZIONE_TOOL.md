
# Documentazione Tool Principali

Breve spiegazione di cosa fa ogni tool/app della suite:

## Script Principali (root)
- **avvia-archivio-flow.bat**: Avvia l'applicazione Archivio Flow.
- **avvia-auto-layout.bat**: Avvia l'applicazione Auto Layout.
- **avvia-image-id-print.bat**: Avvia l'applicazione Image ID Print.
- **avvia-image-party-frame.bat**: Avvia l'applicazione Image Party Frame.
- **avvia-photo-selector.bat**: Avvia l'applicazione Photo Selector.
- **avvia-progetto.bat**: Avvia l'intero progetto o più servizi insieme.

## apps/

### archivio-flow
- Importa foto da SD.
- Organizza automaticamente i lavori fotografici in cartelle strutturate.
- Rinomina i file in modo coerente e senza collisioni.
- Genera un archivio leggero (JPG compressi, opzionale).
- Tiene un registro dei lavori creati, ricercabili per nome/data.
- Permette di consultare e riaprire lavori esistenti.
- UI e flusso coerenti con il resto della suite.

### auto-layout-app
- Strumento per impaginazione automatica di foto su fogli/pagine.
- Permette di selezionare immagini e template di layout.
- Calcola la disposizione ottimale delle foto su più pagine secondo preset o regole personalizzate.
- Consente l’editing manuale del layout e l’esportazione del risultato.
- Pensato per velocizzare la creazione di impaginati fotografici (album, provini, ecc.).

### filex-desktop
- Applicazione desktop (Electron) per la gestione avanzata di file e asset fotografici.

### IMAGE ID PRINT
- Permette di caricare una foto e ritagliarla con proporzioni vincolate (fototessera, passaporto).
- Consente la scelta del formato foglio.
- Genera automaticamente una pagina con più copie della foto.
- Esporta un file pronto per la stampa in alta qualità.
- Flusso guidato: upload, crop, scelta formato, anteprima, export.

### image-party-frame
- Crea progetti fotografici con template predefiniti o personalizzati.
- Permette di riordinare e nascondere template.
- Salva template e progetti in formato portatile (JSON).
- Offre editing live di crop/zoom e batch export tramite server locale.
- Pensato per eventi/feste, con UI desktop-style e strumenti di automazione layout.

### photo-selector-app
- Analizza e ottimizza il caricamento e la gestione di grandi quantità di foto.
- Si ispira a Photo Mechanic per velocità di anteprima e browsing.
- Ottimizza la pipeline di caricamento e caching delle anteprime.
- Pensato per selezionare rapidamente le migliori foto da grandi set.

## packages/
- **core/**: Funzionalità di base condivise tra le app.
- **desktop-contracts/**: Contratti e tipi condivisi per l'app desktop.
- **filesystem/**: Funzioni e servizi per la gestione del filesystem.
- **layout-engine/**: Motore per la gestione e il calcolo dei layout.
- **presets/**: Preset e configurazioni condivise.
- **shared-types/**: Tipi TypeScript condivisi tra i pacchetti.
- **ui-schema/**: Schemi e componenti per l'interfaccia utente.

## Altri file utili
- **README.md**: Documentazione generale del progetto.
- **MIGLIORAMENTI_ALTA_PRIORITA.md**: Lista miglioramenti prioritari.
- **MIGLIORAMENTI_COMPLETATI.md**: Lista miglioramenti completati.
- **UI_EXPERIENCE_AUDIT.md**: Audit e suggerimenti sull'esperienza utente.

## Note
Per dettagli specifici su ogni tool/app, consultare i rispettivi file `leggimi.md` o `README.md` presenti nelle cartelle delle app.