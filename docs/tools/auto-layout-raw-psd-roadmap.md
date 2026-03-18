# Auto Layout RAW + PSD Roadmap

Piano di programmazione per introdurre in `Auto Layout`:

- selezione veloce di file RAW con approccio simile a Photo Mechanic
- uso dei RAW in review e impaginazione tramite preview embedded
- export avanzato in `PSD`
- futura evoluzione verso `PSD` con Smart Object collegati ai file RAW

Questo documento e' il riferimento tecnico da riusare nelle prossime sessioni di sviluppo.

## Obiettivo Prodotto

Portare `Auto Layout` da tool di impaginazione JPG/PNG a software desktop professionale capace di:

- leggere cataloghi misti `JPG + RAW`
- selezionare le foto con grande velocita'
- assegnare rating, pick/reject e colori anche ai RAW
- impaginare usando preview embedded dei RAW
- esportare sia in formati raster sia in `PSD`
- aprire la strada a un workflow professionale Photoshop-centric

## Stato Attuale

Ad oggi il progetto:

- importa realmente solo `.jpg`, `.jpeg`, `.png`
- usa il browser per generare preview e thumbnail
- impagina usando `sourceUrl` o `previewUrl`
- esporta in `JPG` e `PNG`
- non ha supporto reale ai RAW
- non ha export `PSD`

Punti del codice gia' rilevanti:

- import browser: [browser-image-assets.ts](/d:/IMAGETOOL_REMOTE/apps/auto-layout-app/src/browser-image-assets.ts)
- rendering fogli: [sheet-renderer.ts](/d:/IMAGETOOL_REMOTE/apps/auto-layout-app/src/sheet-renderer.ts)
- tipi condivisi: [auto-layout.ts](/d:/IMAGETOOL_REMOTE/packages/shared-types/src/auto-layout.ts)

## Visione Tecnica

### Principio Base

Il software non deve tentare di decodificare i RAW completi nel frontend web-like attuale.

La strategia consigliata e':

1. leggere preview embedded e metadati dai RAW
2. usare quelle preview per selezione e impaginazione
3. separare l'export in due linee:
   - raster standard
   - export `PSD` avanzato

### Perche' questa scelta

Vantaggi:

- velocita' molto piu' alta in selezione
- UX vicina a Photo Mechanic
- meno consumo memoria
- impaginazione piu' fluida su progetti grandi
- supporto RAW realistico senza introdurre subito un decoder RAW completo

Limiti:

- la preview embedded non e' equivalente al RAW sviluppato al 100%
- l'export raster ad alta qualita' puo' richiedere una pipeline dedicata
- il vero `PSD con Smart Object RAW` e' una fase avanzata

## Obiettivi di Release

### Release 1: RAW Review Foundation

Obiettivo:

- far entrare i RAW nel catalogo e nella selezione
- usare preview embedded per review e classificazione

Scope:

- supporto estensioni RAW principali
- estrazione preview embedded
- estrazione orientamento e metadati base
- supporto classificazione completa nel selector
- compatibilita' con filtri e ribbon esistenti

Output atteso:

- il fotografo puo' selezionare e classificare RAW quasi come farebbe in Photo Mechanic

### Release 2: RAW Layout Foundation

Obiettivo:

- usare i RAW anche dentro lo studio di impaginazione

Scope:

- ribbon con RAW
- anteprima slot con preview embedded
- drag and drop RAW
- replace modal RAW-aware
- salvataggio progetto con riferimenti RAW + preview cache

Output atteso:

- il fotografo puo' impaginare usando i RAW senza doverli convertire prima

### Release 3: PSD Raster Export

Obiettivo:

- esportare un file `PSD` multilivello con layout gia' costruito

Scope:

- un livello per foto/slot
- coordinate, scala e rotazione trasferite
- gruppi per foglio
- fondo pagina e canvas corretti
- naming coerente dei livelli

Output atteso:

- il fotografo apre in Photoshop un PSD strutturato e rifinibile

### Release 4: PSD Smart Object Research

Obiettivo:

- validare la fattibilita' di `PSD` con Smart Object collegati ai RAW

Scope:

- studio formato PSD/PSB
- verifica librerie esistenti
- test compatibilita' Photoshop
- verifica linked vs embedded smart objects

Output atteso:

- decisione tecnica su implementazione o scarto

## Architettura Consigliata

### 1. Pipeline RAW Desktop-Native

Per ottenere prestazioni serie, la parte RAW dovrebbe vivere in un layer desktop, non nel browser puro.

Approccio consigliato:

- shell desktop futura `Electron` o `Tauri`
- modulo nativo o helper backend per:
  - lettura preview embedded
  - lettura EXIF/XMP
  - eventuale export avanzato

Responsabilita':

- frontend:
  - UI selector
  - classificazione
  - preview e layout
- backend/native bridge:
  - parsing RAW
  - cache preview
  - estrazione metadati
  - eventuale export `PSD`

### 2. Cache Preview

Serve una cache persistente per non rigenerare continuamente le preview dei RAW.

Contenuto minimo cache:

- `sourceFileKey`
- `rawType`
- `previewPath` o blob cache key
- `thumbnailPath` o blob cache key
- `width`
- `height`
- `orientation`
- `lastModified`

Strategia:

- all'import si genera preview una sola volta
- alle aperture successive si ricarica da cache
- rigenerazione solo se il file cambia

### 3. Estensione del Modello Dati

Il modello `ImageAsset` dovra' evolvere.

Campi da introdurre:

```ts
type AssetSourceKind = "bitmap" | "raw";

interface RawSourceInfo {
  extension: string;
  hasEmbeddedPreview: boolean;
  embeddedPreviewWidth?: number;
  embeddedPreviewHeight?: number;
  sidecarXmpPath?: string;
}

interface ImageAsset {
  id: string;
  sourceFileKey: string;
  fileName: string;
  path: string;
  sourceKind?: AssetSourceKind;
  rawInfo?: RawSourceInfo;
  width: number;
  height: number;
  orientation: "horizontal" | "vertical" | "square";
  aspectRatio: number;
  sourceUrl?: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  rating?: number;
  pickStatus?: "picked" | "rejected" | "unmarked";
  colorLabel?: "red" | "yellow" | "green" | "blue" | "purple" | null;
}
```

## Supporto RAW: Formati Target

Prima lista consigliata:

- `.CR2`
- `.CR3`
- `.NEF`
- `.ARW`
- `.RAF`
- `.DNG`

Seconda fase eventuale:

- `.ORF`
- `.RW2`
- `.PEF`

## Piano di Implementazione

## Fase A: Discovery Tecnica

Obiettivi:

- scegliere il motore di lettura RAW
- verificare se conviene modulo nativo, CLI helper o libreria JS/WASM

Task:

1. confrontare librerie o tool per estrazione preview embedded
2. misurare tempo medio su cartella da 500 RAW
3. verificare lettura metadati minimi:
   - dimensioni
   - orientamento
   - data
   - maker/model
4. valutare cache preview su disco
5. definire API interna tra frontend e layer desktop

Deliverable:

- documento decisionale tecnico
- benchmark base
- scelta stack

## Fase B: Import RAW nel Selector

Obiettivi:

- rendere il selector capace di lavorare con RAW senza perdere fluidita'

Task:

1. estendere file supportati in input
2. introdurre pipeline import differenziata:
   - bitmap standard
   - raw con preview embedded
3. generare thumbnail e preview da embedded JPEG
4. persistere cache preview
5. aggiornare progress modal:
   - file supportati
   - file ignorati
   - anteprime RAW estratte

Deliverable:

- cartella con RAW caricabile
- preview visibili nel selector
- rating e colori persistenti

## Fase C: Studio Layout RAW-Aware

Obiettivi:

- usare RAW anche nella pagina di impaginazione

Task:

1. adattare ribbon foto
2. adattare preview slot
3. adattare replace modal
4. adattare export plan interno a lavorare con asset `raw`
5. mostrare badge tipo file:
   - `RAW`
   - `JPG`
   - `PNG`

Deliverable:

- slot e ribbon funzionanti con asset RAW

## Fase D: Export Raster Compatibile

Obiettivi:

- definire comportamento chiaro per export raster quando le sorgenti sono RAW

Strategia consigliata:

- usare preview embedded o preview cache ad alta qualita'
- mostrare avviso qualità se la preview non supera una soglia minima

Task:

1. definire minima risoluzione accettabile per slot
2. verificare qualita' preview embedded per foglio finale
3. introdurre warning:
   - "La preview RAW potrebbe non bastare per export finale ad alta qualita'"
4. opzionale:
   - consentire sostituzione con derivato TIFF/JPG sviluppato

Deliverable:

- export raster prevedibile e spiegato all'utente

## Fase E: Export PSD Raster

Obiettivi:

- generare PSD multilivello subito utile

Task:

1. definire modello layer:
   - gruppo per foglio
   - livello per slot
   - nome livello = file sorgente
2. convertire trasformazioni layout in coordinate PSD
3. aggiungere maschere slot
4. gestire sfondo pagina
5. salvare metadata base export

Deliverable:

- file PSD apribile in Photoshop
- struttura livelli leggibile

## Fase F: Smart Object RAW Research

Obiettivi:

- capire se l'export PSD puo' usare RAW come Smart Object veri

Questioni da validare:

- quanto e' documentato il formato necessario
- se esistono librerie affidabili
- se Photoshop apre davvero il file come previsto
- se i link ai RAW restano stabili tra Windows e macOS

Esiti possibili:

- implementare linked smart objects
- implementare embedded smart objects
- rinunciare e restare su PSD raster professionale

## UX e Comunicazione

Il supporto RAW deve essere chiaro all'utente.

Messaggi da introdurre:

- `RAW importato tramite anteprima embedded`
- `Preview veloce pronta`
- `Qualita export basata sulla preview RAW`
- `Per massima qualita usa PSD o un derivato sviluppato`

Punti UI dove mostrarli:

- progress modal import
- selector
- studio ribbon
- pannello export

## Rischi Principali

### Rischio 1: Qualita' export insufficiente

Mitigazione:

- warning espliciti
- PSD come via premium
- futura pipeline high-quality

### Rischio 2: Performance scarse con decoder RAW sbagliato

Mitigazione:

- evitare decode completo nel frontend
- usare preview embedded
- benchmark prima dell'implementazione definitiva

### Rischio 3: PSD Smart Object troppo complesso

Mitigazione:

- dividere in due release:
  - PSD raster
  - smart object research

### Rischio 4: Cache preview corrotta o incoerente

Mitigazione:

- chiave stabile file + dimensione + lastModified
- invalidazione automatica se il file cambia

## Priorita' Consigliata

Ordine suggerito:

1. RAW import + preview embedded
2. selector RAW veloce
3. studio layout RAW-aware
4. export raster con warning qualità
5. PSD raster multilivello
6. ricerca Smart Object RAW

## Decisioni Gia' Raccomandate

Decisioni da considerare approvate salvo cambio strategia:

- niente decode RAW completo nel frontend web attuale
- review e layout basati su preview embedded
- supporto RAW come feature desktop-oriented
- PSD come export avanzato prioritario rispetto al decode RAW finale interno
- Smart Object RAW trattati come fase di ricerca, non come primo rilascio

## Prossimi Passi Operativi

Quando riprenderemo questa feature, il primo sprint consigliato e':

1. creare documento benchmark motore RAW
2. scegliere stack tecnico per preview embedded
3. estendere `ImageAsset` con `sourceKind` e `rawInfo`
4. prototipare import di una cartella RAW reale
5. misurare tempi selector su 100, 300 e 1000 file

## Nota Finale

Questa feature ha valore altissimo, ma va costruita con disciplina:

- velocita' di review prima di tutto
- chiarezza qualità export
- PSD professionale come ponte verso Photoshop
- Smart Object RAW solo dopo validazione seria
