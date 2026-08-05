# Pipeline colore

## Separazione fondamentale

La pipeline deve conservare tre livelli distinti:

1. **Input transform**: interpreta correttamente RAW o JPEG e li porta nello spazio di lavoro.
2. **Base tecnica**: produce un punto di partenza leggibile senza cancellare l'intenzione della scena.
3. **Look creativo**: curva, cromia e palette che diventano il profilo riutilizzabile.

Mescolare questi livelli produrrebbe una LUT dipendente da una specifica fotocamera o esposizione. L'audit deve mostrare i tre risultati separatamente.

## Ingest

### RAW

Percorso proposto:

1. identificazione mediante signature e metadati, non soltanto estensione;
2. estrazione JPEG incorporato per browser e contatto rapido;
3. decode lineare tramite LibRaw per l'analisi;
4. black level, white level, bilanciamento e matrici camera registrati nell'audit;
5. demosaic appropriato al sensore, compreso Fuji X-Trans;
6. conversione in spazio di lavoro lineare a gamut ampio;
7. costruzione del proxy di preview con tone mapping versionato.

LibRaw dichiara di non essere un motore di rendering fotografico completo. Il suo output deve quindi essere considerato un proxy controllato, non una replica di Adobe Camera Raw. La preview incorporata nel RAF puo' includere una Film Simulation e non puo' essere usata come rappresentazione lineare del RAW.

### JPEG

Percorso proposto:

1. applicazione dell'orientamento EXIF;
2. verifica del profilo ICC incorporato;
3. conversione ICC nello spazio di lavoro mediante LittleCMS/libvips;
4. assunzione sRGB soltanto per file non taggati, con warning persistente;
5. rilevazione di clipping per canale, compressione forte e dimensioni insufficienti;
6. nessun tentativo di “ricostruire” informazioni inesistenti.

### Canonical image

Ogni decoder produce un contratto comune, non un bitmap anonimo:

```text
CanonicalImage
  pixels: float32 linear RGB
  workingSpaceId
  sourceKind: raw | jpeg | embedded-preview
  cameraMake / cameraModel
  sourceProfile / assumedProfile
  whiteBalance
  exposureMetadata
  clippingFlags
  provenance
```

Il core algoritmico non deve conoscere RAF, CR3, NEF o ARW: riceve solo `CanonicalImage` e diagnostica di ingest.

## Analisi delle reference

Per ogni immagine si calcolano descrittori robusti, con algoritmo e parametri versionati:

- percentili di luminanza invece di soli minimo/massimo;
- istogrammi RGB e luminanza;
- distribuzione cromatica in uno spazio percettivo;
- neutral axis e dominanti probabili;
- contrasto globale e locale;
- clipping per canale;
- palette dominante con peso limitato per aree estreme;
- indicatori di pelle e neutri, inizialmente conservativi;
- similarita' di scena e outlier tra reference.

Il tool non deduce il look da una sola media colore. In modalita' paired RAW/JPEG confronta regioni corrispondenti dopo allineamento, stima prima la curva tonale e poi il residuo cromatico.

## Base tecnica “flat”

La base suggerita usa percentili robusti e una curva monotona limitata. Non deve forzare il nero a 0 o il bianco al massimo.

Regole:

- preservare un margine configurato nelle ombre e nelle alte luci;
- ridurre mezzitoni eccessivi solo quando piu' segnali confermano sovraesposizione percettiva;
- distinguere clipping reale da assenza intenzionale di dati agli estremi;
- non neutralizzare tramonti, luci di scena o dominanti creative senza conferma;
- applicare limiti piu' conservativi quando vengono rilevati pelle, abito bianco o forti speculari;
- segnalare, non correggere, un JPEG gia' clippato.

La classificazione di high-key, low-key, silhouette, nebbia e scena notturna deve avere uno stato `incerto`. In caso di incertezza la base automatica non si applica e l'utente vede un confronto A/B.

## Costruzione del look

### MVP deterministico

1. normalizzazione tecnica delle reference solo nello spazio di analisi;
2. stima di una curva luminanza monotona e regolarizzata;
3. stima di trasformazioni cromatiche a bassa complessita';
4. fitting di una 3D LUT con penalita' di smoothness e distanza dall'identita';
5. protezioni per neutri, luminanza e regioni di pelle;
6. generazione delle intensita' tramite blending matematico con l'identita', non tramite tre fitting indipendenti;
7. validazione su gradienti sintetici e foto escluse dal fitting.

La griglia LUT iniziale e lo spazio di encoding non sono ancora approvati. Il prototipo deve confrontare almeno 33^3 e 65^3 per errore, dimensione e compatibilita' Adobe.

### Proposte “look fighi”

Le proposte derivano da archetipi parametrici originali e versionati. Ogni proposta e' una ricetta composta da attributi leggibili, per esempio:

```text
contrast: soft-shoulder
blackPoint: lifted-low
highlightHue: warm-subtle
shadowHue: cool-neutral
greenResponse: muted
skinPriority: high
```

Il confronto A/B aggiorna un vettore di preferenze del progetto. Non serve addestrare un modello personale globale nel primo rilascio; il sistema puo' usare ranking pairwise deterministico o bayesiano e mostrare quali attributi hanno guidato la proposta successiva.

## Anteprima

L'anteprima deve indicare sempre:

- renderer e versione;
- sorgente RAW decodificata oppure JPEG incorporato;
- stato `Base`, `Look` o `Base + Look`;
- intensita';
- eventuali warning di compatibilita'.

La visualizzazione usa color management fino al profilo monitor quando disponibile. Il confronto deve includere pixel peeping, clipping overlay, istogramma per canale e una vista sincronizzata di tutte le foto di prova.

## Esportazione Lightroom

Contratto logico:

```text
LookRecipe
  -> CreativeProfile XMP
       embedded look table / 3D LUT
       profile metadata and amount behavior
  -> Preset XMP: Look only
  -> Preset XMP: Soft / Standard / Strong
  -> Preset XMP opzionale: Standard + Auto Tone
  -> ZIP validator
```

Il preset `Auto Base` delega le regolazioni scene-dependent a Lightroom tramite le proprieta' XMP supportate. Una LUT statica non deve simulare un algoritmo per-immagine.

Prima del rilascio occorre una proof-of-conformance che stabilisca:

- schema XMP e encoding della look table accettati;
- comportamento della quantita' del profilo;
- struttura esatta dello ZIP;
- differenze Lightroom Classic, desktop e mobile;
- comportamento su RAW, JPEG e profili non disponibili;
- stabilita' dopo re-import ed export del preset da Lightroom.

## Indipendenza dal brand

Il pacchetto esportato usa un Creative Profile e non un Camera Matching Profile. Questo lo rende applicabile oltre Fuji, ma non elimina le differenze iniziali di sensore, illuminante e profilo Adobe.

La garanzia realistica e': **stessa intenzione creativa, entro la matrice di test dichiarata**. Non: **stessi valori RGB su ogni fotocamera**. Per avvicinare corpi diversi serve validazione su immagini rappresentative o, facoltativamente in futuro, una calibrazione camera-specifica separata dal look.

