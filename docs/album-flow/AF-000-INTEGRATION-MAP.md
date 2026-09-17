# AF-000 — Mappa di integrazione Album Flow

## Percorso target verificato

`Archivio Flow` → `Image Select Pro` → `Album Flow`

Il percorso esiste tramite il sistema desktop di photo handoff e il manifest Album dedicato; il payload Album conserva i metadati editoriali necessari senza sostituire il contratto file-only esistente.

| Area | Riutilizzo verificato | Adattamento necessario |
|---|---|---|
| Identità foto | `ImageAsset.id`, `path`, `sourceFileKey`, geometria, orientamento, dimensioni | Definire identità stabile e policy per file spostati/non disponibili. |
| Stato editoriale | rating, pick/reject, colore, `customLabels`, rotazione; XMP + stato progetto | Nel manifest Album usare valori e definizioni etichetta, non solo path. |
| Selezione | `activeAssetIds` | Inserire esplicitamente stato selezionato e selezione ordinata. |
| Ordine | `DesktopSortCacheEntry.orderedIds` | Portarlo nel contratto/versione progetto; oggi è cache separata. |
| Capitoli | Nessun tipo Album | Definire derivazione label→chapter e comportamento per foto multi-etichetta. |
| Auto layout | template, scoring, crop, pagine/spread | Aggiungere segmentazione narrativa e policy album. |
| Editor manuale | operazioni core su `AutoLayoutResult` | Incapsularle in un `AlbumProject` persistente, con undo/persistenza UI. |
| Preview/RAW | worker RAW, IPC native preview, cache | Il tool deve consumare API desktop esistenti, non leggere RAW nel renderer. |
| Export e proof | solo `RenderJob` descrittivo | Implementare renderer, preflight e output atomico. |

## Confini proposti, non ancora implementati

1. Un nuovo `AlbumFlowHandoffManifestV1`, aggiuntivo e non sostitutivo del handoff file-only esistente.
2. Un `AlbumProject` come proprietario di asset importati, capitoli, spread, assegnazioni, impostazioni e revisioni.
3. `@photo-tools/layout-engine` resta puro e senza Electron/DOM; renderer e persistenza appartengono ad app/servizi Album Flow.
4. Gli IPC Album Flow devono essere aggiunti prima a `@photo-tools/desktop-contracts`, quindi implementati in main/preload, mai inventati nel renderer.

## Contratto minimo da decidere

Il payload deve contenere almeno:

- versione schema e revisione/provenienza del Selector;
- radice sorgente e asset con `assetId`, path relativo/assoluto, `sourceFileKey`, geometria e ordinamento esplicito;
- `selected`, rating, pick/reject, colore, `customLabels`, rotazione e relativi timestamp;
- catalogo/definizioni delle etichette e gruppi/capitoli derivati;
- integrità per ogni file e regole di scadenza/acknowledgement.

Questa è una proposta architetturale basata sui tipi esistenti, non un contratto approvato.
