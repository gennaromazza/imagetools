# Batch Print Layout — architettura

Percorso guidato a 5 passi: **Foto → Cosa stampi → Carta → Impagina → Esporta**.
Ogni passo si sblocca quando il precedente è completo (`App.tsx`, array `gates`).

## Principio di progetto

Tutto discende da quattro dati dell'utente e viene **derivato**, mai sincronizzato con effetti:

```
foto (+ copie)  ─┐
obiettivo        ├─►  carta consigliata ─► carta scelta ─► misura foto ─► griglia ─► pagine
carta + margini ─┤
DPI             ─┘
```

Cambiare un dato ricalcola il resto in un solo passaggio (`useMemo` in `hooks/useWorkbench.ts`).
Così il foglio e la misura della foto non possono più andare fuori sincrono.

## Moduli

| File | Ruolo | Testato |
|---|---|---|
| `src/print-engine.ts` | Geometria pura: preset, griglia, orientamento del foglio, misura per N foto, crop, paginazione. Usato anche da ID Photo. | `print-engine.test.ts` |
| `src/print-planner.ts` | Logica del percorso guidato: obiettivo (`PrintGoal`), carte disponibili, valutazione di ogni carta, carta consigliata, consiglio sull'orientamento. Nessuna dipendenza da React. | `print-planner.test.ts` |
| `src/render-export.ts` | Rendering su canvas ed export JPG/PNG/PDF/TIF/ZIP (scrittura atomica desktop). | `render-export.test.ts` |
| `src/hooks/useWorkbench.ts` | Stato e azioni: import (cartella desktop, browser, handoff Archivio Flow), ritagli, editor esterno, export. È l'unico punto che tiene lo stato. | via UI |
| `src/lib/assets.ts` | Import delle foto e gestione degli URL blob. | — |
| `src/lib/crop-math.ts` | Zoom, rotazione e chiave di geometria del ritaglio. | — |
| `src/components/steps/*` | Un componente per passo (solo presentazione). | — |
| `src/components/SheetPreview.tsx` | Anteprima del foglio (canvas + strato cliccabile). | — |
| `src/components/SheetThumb.tsx` | Miniatura vettoriale di una carta con le foto disposte. | — |

## Regole da non rompere

- **Ritagli**: salvati con la chiave di geometria (`cropGeometryKey`). Se cambia la misura/proporzione della foto, il ritaglio dell'utente non è più valido e si riparte dal taglio automatico; cambiare solo DPI o carta lo conserva.
- **Carta consigliata** (`recommendPaperId`): minimizza la carta consumata (fogli × area). Letter non viene mai consigliata se esistono alternative. Per «quante foto per pagina» il default è A4.
- **«N foto per pagina»**: `calculatePhotoSizeForCount` ammette celle vuote (5 foto → griglia 2×3) e verifica con il motore reale che ci stiano davvero; `paginateAssets(…, maxPerPage)` rispetta il numero scelto.
- **Orientamento**: `auto` sceglie quello che contiene più foto; `portrait`/`landscape` sono vincolanti.
- **Supporto originale** (`media: true` sui preset Hi-Print): compare come carta «uno per foglio», senza margini.
- Anteprima e export usano lo stesso renderer; l'anteprima ha DPI limitati (`getPreviewRenderDpi`), l'export no.

## Verifica

```powershell
npm --workspace @photo-tools/batch-print-layout run test
npx tsc --noEmit -p apps/batch-print-layout
```

La suite è raggiungibile dalla Dev Console come «Batch Print Layout — Caccia bug» (`npm run test:batch-print-layout-bug-hunt`).
