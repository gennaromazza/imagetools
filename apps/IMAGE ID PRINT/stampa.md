# Feature: Pulsante stampa ottimizzato per DNP RX1

> **Stato:** da implementare  
> **Priorità:** alta  
> **Contesto:** aggiunta al `ControlPanel` accanto al pulsante "Esporta"

---

## Obiettivo

Permettere la stampa diretta del foglio composito su stampante DNP RX1 (dye-sublimation) senza passare dall'export file → apertura manuale → stampa. Il flusso deve essere un singolo click, con gestione automatica del formato media e del bleed fisico della stampante.

---

## Flusso logico

```
Clic "Stampa"
    │
    ├─ Guard checks
    │       croppedCanvas · layout.total > 0 · !isExporting · !isAiProcessing
    │       └─ [fallisce] → toast.warning, blocca
    │
    ├─ Media mapping
    │       sheetPreset → media DNP (10×15 / 15×20 / 15×23 cm)
    │       └─ [formato non standard] → toast.warning, lascia procedere
    │
    ├─ Genera canvas finale
    │       300 DPI · sRGB · toDataURL('image/jpeg', 0.97)
    │
    ├─ Crea iframe nascosto
    │       @page { size: W H; margin: 0 }
    │       img { width: 100%; height: 100%; object-fit: fill }
    │
    ├─ iframe.contentWindow.print()
    │       (il driver DNP gestisce color management)
    │
    └─ Cleanup + feedback
            rimuovi iframe dopo 2s · toast.success "Inviato alla stampante"
```

---

## Media supportati (DNP RX1)

| Formato | Dimensioni | Note |
|---|---|---|
| 10×15 cm | 100 × 150 mm | Più comune, passaporti/documenti |
| 15×20 cm | 150 × 200 mm | Formato ritratto A5 |
| 15×23 cm | 150 × 230 mm | Panorama allargato |

Tolleranza di matching: ±2 mm. Se il foglio selezionato non rientra nella tolleranza, avvisare con `toast.warning` ma **non bloccare** la stampa.

---

## Dettaglio bleed

Il DNP RX1 overscansa fisicamente ~1 mm per lato per garantire la stampa borderless. Il canvas deve essere generato con 1 mm di bleed aggiuntivo nelle dimensioni `@page`:

```
@page size = (sheetWidthMm + 2) × (sheetHeightMm + 2) mm
```

Il canvas stesso non viene modificato: la dimensione aggiuntiva è solo nel CSS dell'iframe. Il driver DNP clippa l'eccesso in stampa.

---

## Implementazione

### `services/print-service.ts` (nuovo file)

```ts
const DNP_MEDIA = [
  { widthMm: 100, heightMm: 150, label: '10×15 cm (4×6")' },
  { widthMm: 150, heightMm: 200, label: '15×20 cm (6×8")' },
  { widthMm: 150, heightMm: 230, label: '15×23 cm (6×9")' },
]

const BLEED_MM = 1

export function checkDnpCompatibility(widthMm: number, heightMm: number) {
  return DNP_MEDIA.find(
    (m) =>
      Math.abs(m.widthMm - widthMm) <= 2 &&
      Math.abs(m.heightMm - heightMm) <= 2,
  )
}

export async function printForDnpRx1(
  canvas: HTMLCanvasElement,
  sheetWidthMm: number,
  sheetHeightMm: number,
): Promise<void> {
  const dataUrl = canvas.toDataURL('image/jpeg', 0.97)

  const pw = sheetWidthMm + BLEED_MM * 2
  const ph = sheetHeightMm + BLEED_MM * 2

  const iframe = document.createElement('iframe')
  iframe.style.cssText =
    'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:0'
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument!
  doc.open()
  doc.write(`<!DOCTYPE html>
<html>
<head>
<style>
  @page {
    size: ${pw}mm ${ph}mm;
    margin: 0;
  }
  html, body {
    margin: 0;
    padding: 0;
    width: ${pw}mm;
    height: ${ph}mm;
    overflow: hidden;
  }
  img {
    display: block;
    width: ${pw}mm;
    height: ${ph}mm;
    object-fit: fill;
  }
</style>
</head>
<body><img src="${dataUrl}"/></body>
</html>`)
  doc.close()

  await new Promise<void>((resolve) => {
    const img = doc.querySelector('img')!
    const go = () => {
      iframe.contentWindow!.focus()
      iframe.contentWindow!.print()
      resolve()
    }
    if (img.complete) go()
    else img.onload = go
  })

  setTimeout(() => document.body.removeChild(iframe), 2000)
}
```

> **Nota su `object-fit: fill`:** scelta intenzionale. Il canvas è già stato calcolato alla risoluzione DPI esatta. Usare `cover` o `contain` introdurrebbe un'interpolazione browser che degrada la qualità dye-sub.

---

### Modifiche a `ControlPanel.tsx`

**1. Correggere il guard `canExport`** (bug esistente — `isAiProcessing` non era incluso):

```ts
// PRIMA (bug: si può esportare durante elaborazione AI)
const canExport = !!croppedCanvas && !!layout && layout.total > 0 && !isExporting

// DOPO
const canExport =
  !!croppedCanvas && !!layout && layout.total > 0 && !isExporting && !isAiProcessing
```

**2. Aggiungere handler e guard per la stampa:**

```ts
const canPrint =
  !!croppedCanvas && !!layout && layout.total > 0 &&
  !isExporting && !isAiProcessing

const handlePrint = async () => {
  if (!croppedCanvas || !layout) return

  const compatible = checkDnpCompatibility(
    sheetPreset.widthMm,
    sheetPreset.heightMm,
  )

  if (!compatible) {
    toast.warning('Formato foglio non standard per DNP RX1', {
      description:
        'Media supportati: 10×15, 15×20, 15×23 cm. ' +
        'Seleziona uno di questi per risultati ottimali.',
    })
  }

  try {
    await printForDnpRx1(croppedCanvas, sheetPreset.widthMm, sheetPreset.heightMm)
    toast.success('Inviato alla stampante')
  } catch {
    toast.error('Errore durante la stampa')
  }
}
```

**3. Pulsante nel JSX** (accanto al pulsante Esporta, nella stessa barra sticky):

```tsx
<button
  onClick={handlePrint}
  disabled={!canPrint}
  title="Stampa direttamente su DNP RX1"
  className={cn(
    'w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all',
    canPrint
      ? 'bg-[var(--app-surface-strong)] hover:bg-[var(--app-border)] text-[var(--app-text)] border border-[var(--app-border)]'
      : 'bg-[var(--app-surface-strong)] text-[var(--app-text-subtle)] cursor-not-allowed',
  )}
>
  <Printer size={16} />
  Stampa (DNP RX1)
</button>
```

---

## Impostazioni richieste nel driver DNP RX1

Queste impostazioni devono essere configurate dall'utente nel dialog di stampa del sistema operativo. Valutare se aggiungere un tooltip informativo al pulsante.

| Impostazione | Valore corretto |
|---|---|
| Margini | Nessuno (0) |
| Scala pagina | 100% — non adattare |
| Profilo colore | sRGB |
| Qualità | Fine (non Standard) |

> Il driver DNP gestisce internamente la linearizzazione del ribbon e la curva dye-sub. Non è necessaria nessuna conversione colore lato canvas.

---

## Note tecniche aggiuntive

- **Nessuna dipendenza esterna:** l'implementazione usa solo `HTMLCanvasElement.toDataURL` e `window.print()` via iframe. Zero librerie aggiuntive.
- **Compatibilità browser:** Chrome e Edge gestiscono correttamente `@page size` in mm negli iframe. Firefox può ignorare le dimensioni `@page` — comportamento atteso, non un bug dell'app.
- **Pressione P non shortcut:** non aggiungere `Ctrl+P` come shortcut al pulsante. Il browser userebbe il suo dialog nativo che ignora l'iframe dedicato.
- **Pulizia iframe:** il `setTimeout` di 2 secondi è intenzionale per non interrompere lo spooler di stampa prima che il job sia inviato al driver.