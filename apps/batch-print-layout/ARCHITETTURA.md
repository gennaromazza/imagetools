# Print Flow (workspace batch-print-layout) — architettura

Ritaglio in serie per ordini di stampa. Un ordine ha uno o più **gruppi** (formato, riempimento, bordino, logo, foto); l'export crea una cartella per gruppo e un JPG per stampa.

| File | Ruolo | Testato |
|---|---|---|
| `src/order/model.ts` | Ordine, gruppi, foto, copie: funzioni pure | `order.test.ts` |
| `src/order/geometry.ts` | Orientamento, bordino, ritaglio, DPI effettivi | `order.test.ts` |
| `src/order/naming.ts` | Nomi di cartelle e file, mai in collisione | `order.test.ts` |
| `src/order/storage.ts` | Salvataggio e riapertura (localStorage, dati validati) | `order.test.ts` |
| `src/order/export.ts` | Export per gruppo, transazione atomica | `export.test.ts` |
| `src/order/render.ts` | Canvas di una stampa | prova a schermo |
| `src/order/quality.ts` | Punteggio di stampa e dati dell'originale | `quality.test.ts` |
| `src/order/resample.ts` | Riduzione di qualità prima dell'export | `order.test.ts` |
| `src/order/history.ts` | Cronologia dei lavori | `history.test.ts` |
| `src/ui/*` | Stato (`usePrintOrder`), importazione (`library`), componenti | prova a schermo |

## Regole da non rompere

- `src/print-engine.ts` e `src/render-export.ts` sono usati da **ID Photo**: Print Flow li riusa e non li adatta a sé.
- Anteprima (`ui/CropView.tsx`, CSS) ed export (`order/render.ts`, canvas) devono avere la stessa geometria.
- Il formato segue l'orientamento della foto come la si vede, rotazione compresa; i formati con cornice no.
- Cambiare formato, riempimento o bordino azzera i ritagli del gruppo.
- La sottocartella di un gruppo si crea solo con `ensureOutputSubfolder` (processo principale).
- Mai sovrascrivere file esistenti; gli originali non si toccano.

## Verifica

```powershell
npm run test:batch-print-layout-bug-hunt
```
