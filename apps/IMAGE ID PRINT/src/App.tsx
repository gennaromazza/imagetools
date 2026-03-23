import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { Toaster, toast } from 'sonner'
import type { DocumentPreset, SheetPreset, DpiValue, ExportFormat, LayoutResult } from './types'
import { DEFAULT_DOCUMENT_PRESET } from './presets/document-presets'
import { DEFAULT_SHEET_PRESET } from './presets/sheet-presets'
import { calculateLayout } from './engines/layout-engine'
import { exportSheet } from './engines/export-engine'
import { mmToPx } from './lib/utils'
import {
  defaultAiOptions,
  inferAiOptionsForSource,
  processCanvasWithAi,
  suggestAiActions,
  type AiProcessingOptions,
} from './services/image-processing-service'
import { ControlPanel } from './components/ControlPanel'
import { CropEditor } from './components/CropEditor'
import { PreviewSheet } from './components/PreviewSheet'
import { UploadZone } from './components/UploadZone'

export default function App() {
  const MIN_LEFT_PANEL_W = 280
  const MAX_LEFT_PANEL_W = 460
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null)
  const [docPreset, setDocPreset] = useState<DocumentPreset>(DEFAULT_DOCUMENT_PRESET)
  const [customDocSize, setCustomDocSize] = useState({ widthMm: 35, heightMm: 45 })
  const [sheetPreset, setSheetPreset] = useState<SheetPreset>(DEFAULT_SHEET_PRESET)
  const [dpi, setDpi] = useState<DpiValue>(300)
  const [exportFormat, setExportFormat] = useState<ExportFormat>('jpg')
  const [croppedCanvas, setCroppedCanvas] = useState<HTMLCanvasElement | null>(null)
  const [aiCanvas, setAiCanvas] = useState<HTMLCanvasElement | null>(null)
  const [aiOptions, setAiOptions] = useState<AiProcessingOptions>(defaultAiOptions)
  const [isAiProcessing, setIsAiProcessing] = useState(false)
  const [aiWarnings, setAiWarnings] = useState<string[]>([])
  const [isExporting, setIsExporting] = useState(false)
  const [leftPanelWidth, setLeftPanelWidth] = useState<number>(() => {
    const raw = window.localStorage.getItem('image-id-print:left-panel-width')
    const parsed = raw ? Number(raw) : 312
    if (!Number.isFinite(parsed)) return 312
    return Math.min(MAX_LEFT_PANEL_W, Math.max(MIN_LEFT_PANEL_W, parsed))
  })
  const [centerPreviewMode, setCenterPreviewMode] = useState<'original' | 'compare' | 'ai'>('original')
  const [compareSplit, setCompareSplit] = useState(0.5)
  const [autoAiPending, setAutoAiPending] = useState(false)
  const aiPreviewCanvasRef = useRef<HTMLCanvasElement>(null)
  const isResizingLeftRef = useRef(false)

  useEffect(() => {
    window.localStorage.setItem('image-id-print:left-panel-width', String(leftPanelWidth))
  }, [leftPanelWidth])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isResizingLeftRef.current) return
      const next = Math.min(MAX_LEFT_PANEL_W, Math.max(MIN_LEFT_PANEL_W, e.clientX))
      setLeftPanelWidth(next)
    }

    const onMouseUp = () => {
      if (!isResizingLeftRef.current) return
      isResizingLeftRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [MAX_LEFT_PANEL_W, MIN_LEFT_PANEL_W])

  const startResizeLeftPanel = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    isResizingLeftRef.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    if (!aiCanvas || !aiPreviewCanvasRef.current) return
    const target = aiPreviewCanvasRef.current
    const ctx = target.getContext('2d')
    if (!ctx) return

    target.width = aiCanvas.width
    target.height = aiCanvas.height
    ctx.clearRect(0, 0, target.width, target.height)

    if (centerPreviewMode === 'compare' && croppedCanvas) {
      const splitX = Math.round(target.width * compareSplit)

      // Left side: original crop
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, splitX, target.height)
      ctx.clip()
      ctx.drawImage(croppedCanvas, 0, 0, target.width, target.height)
      ctx.restore()

      // Right side: AI result
      ctx.save()
      ctx.beginPath()
      ctx.rect(splitX, 0, target.width - splitX, target.height)
      ctx.clip()
      ctx.drawImage(aiCanvas, 0, 0, target.width, target.height)
      ctx.restore()

      // Divider line
      ctx.strokeStyle = 'rgba(242,236,229,0.9)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(splitX + 0.5, 0)
      ctx.lineTo(splitX + 0.5, target.height)
      ctx.stroke()
    } else {
      ctx.drawImage(aiCanvas, 0, 0)
    }
  }, [aiCanvas, croppedCanvas, centerPreviewMode, compareSplit])

  // ─── Derived state ──────────────────────────────────────────────────────────

  const layout = useMemo<LayoutResult | null>(() => {
    return calculateLayout(docPreset, sheetPreset, dpi)
  }, [docPreset, sheetPreset, dpi])

  const resolutionWarning = useMemo<string | null>(() => {
    if (!imageElement) return null
    const reqW = mmToPx(docPreset.widthMm, dpi)
    const reqH = mmToPx(docPreset.heightMm, dpi)
    if (imageElement.naturalWidth < reqW || imageElement.naturalHeight < reqH) {
      return `Risoluzione insufficiente per stampa ottimale a ${dpi} DPI. Risultato potrebbe apparire sfocato.`
    }
    return null
  }, [imageElement, docPreset, dpi])

  const aiSuggestions = useMemo(() => {
    return suggestAiActions(croppedCanvas ?? imageElement, docPreset, dpi)
  }, [croppedCanvas, imageElement, docPreset, dpi])

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleImageLoaded = useCallback((file: File, img: HTMLImageElement) => {
    setImageFile(file)
    setImageElement(img)
    setCroppedCanvas(null)
    setAiCanvas(null)
    setAiWarnings([])
    setCenterPreviewMode('original')
    setAiOptions(inferAiOptionsForSource(img, docPreset, dpi))
    setAutoAiPending(true)
  }, [docPreset, dpi])

  const handleCropUpdate = useCallback((canvas: HTMLCanvasElement) => {
    setCroppedCanvas(canvas)
    setAiCanvas(null)
    setCenterPreviewMode('original')
  }, [])

  const handleDocPresetChange = useCallback((preset: DocumentPreset) => {
    const hadAiResult = !!aiCanvas
    setDocPreset(preset)
    // AI output is bound to the previous crop/preset. Invalidate it so
    // the user immediately sees the new document framing.
    setAiCanvas(null)
    setAiWarnings([])
    setCenterPreviewMode('original')
    if (hadAiResult) {
      toast.message('Formato documento aggiornato', {
        description: 'Risultato AI precedente azzerato. Riapplica AI sul nuovo formato.',
      })
    }
  }, [aiCanvas])

  const runAiPipeline = useCallback(async (mode: 'manual' | 'auto'): Promise<boolean> => {
    if (!croppedCanvas) {
      if (mode === 'manual') toast.warning('Serve prima un ritaglio valido')
      return false
    }

    const anyEnabled = Object.entries(aiOptions).some(
      ([, v]) => typeof v === 'boolean' && v === true,
    )
    if (!anyEnabled) {
      if (mode === 'manual') {
        toast.warning('Nessuna opzione AI attiva', { description: 'Attiva almeno un\u2019opzione prima di applicare.' })
      }
      return false
    }

    setIsAiProcessing(true)
    try {
      const result = await processCanvasWithAi(croppedCanvas, aiOptions, docPreset)
      setAiCanvas(result.canvas)
      setAiWarnings(result.warnings)
      setCenterPreviewMode('compare')

      if (result.warnings.length > 0) {
        toast.warning('AI applicata con fallback', {
          description: result.warnings[0],
        })
      } else if (mode === 'manual') {
        toast.success('Elaborazione AI completata')
      }
      return true
    } catch (err) {
      console.error(err)
      if (mode === 'manual') {
        toast.error('Errore durante elaborazione AI')
      }
      return false
    } finally {
      setIsAiProcessing(false)
    }
  }, [croppedCanvas, aiOptions, docPreset])

  const handleApplyAi = useCallback(async () => {
    await runAiPipeline('manual')
  }, [runAiPipeline])

  useEffect(() => {
    if (!autoAiPending || !croppedCanvas || isAiProcessing) return
    let cancelled = false

    // Consume the one-shot flag immediately to avoid re-trigger loops
    // when crop updates happen while the async AI run is still in flight.
    setAutoAiPending(false)

    ;(async () => {
      const ok = await runAiPipeline('auto')
      if (!cancelled && ok) {
        toast.message('Anteprima AI pronta', {
          description: 'Analisi iniziale completata automaticamente.',
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [autoAiPending, croppedCanvas, isAiProcessing, runAiPipeline])

  const handleResetAi = useCallback(() => {
    setAiCanvas(null)
    setAiWarnings([])
    setCenterPreviewMode('original')
  }, [])

  const handleExport = useCallback(async () => {
    const sourceForExport = aiCanvas ?? croppedCanvas
    if (!sourceForExport || !layout || layout.total === 0) return
    setIsExporting(true)
    try {
      await exportSheet(sourceForExport, layout, exportFormat, docPreset, sheetPreset, dpi)
      toast.success(`Esportazione completata — ${layout.total} copie`, {
        description: `${docPreset.widthMm}×${docPreset.heightMm} mm · ${sheetPreset.label} · ${dpi} DPI`,
      })
    } catch (err) {
      console.error(err)
      toast.error('Errore durante l\'esportazione')
    } finally {
      setIsExporting(false)
    }
  }, [aiCanvas, croppedCanvas, layout, exportFormat, docPreset, sheetPreset, dpi])

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col"
      style={{ height: '100dvh', background: 'var(--app-bg)' }}
    >
      {/* Top bar */}
      <header
        className="flex items-center gap-3 px-5 shrink-0 border-b"
        style={{
          height: '52px',
          background: 'var(--app-topbar)',
          borderColor: 'var(--app-border)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
          style={{ background: 'var(--brand-primary)' }}>
          <span className="text-[10px] font-bold text-[var(--brand-primary-foreground)]">ID</span>
        </div>
        <span className="text-sm font-semibold text-[var(--app-text)]">Image ID Print</span>
        <span
          className="text-xs text-[var(--app-text-subtle)] hidden sm:inline"
          style={{ borderLeft: '1px solid var(--app-border)', paddingLeft: '12px', marginLeft: '4px' }}
        >
          Foto per documenti pronte per la stampa
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Resolution info */}
        {imageElement && (
          <span className="text-xs text-[var(--app-text-subtle)]">
            {imageElement.naturalWidth} × {imageElement.naturalHeight} px
          </span>
        )}
      </header>

      {/* Main 3-column workspace */}
      <main className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left — control panel */}
        <div
          className="shrink-0 overflow-y-auto flex flex-col p-4"
          style={{
            width: `${leftPanelWidth}px`,
            background: 'var(--app-surface)',
            borderRight: '1px solid var(--app-border)',
            scrollbarGutter: 'stable both-edges',
          }}
        >
          <ControlPanel
            imageFile={imageFile}
            docPreset={docPreset}
            customDocSize={customDocSize}
            sheetPreset={sheetPreset}
            dpi={dpi}
            exportFormat={exportFormat}
            layout={layout}
            resolutionWarning={resolutionWarning}
            croppedCanvas={croppedCanvas}
            aiOptions={aiOptions}
            aiWarnings={aiWarnings}
            aiSuggestions={aiSuggestions}
            isAiProcessing={isAiProcessing}
            isExporting={isExporting}
            onImageReplace={handleImageLoaded}
            onDocPresetChange={handleDocPresetChange}
            onCustomDocSizeChange={setCustomDocSize}
            onSheetPresetChange={setSheetPreset}
            onDpiChange={setDpi}
            onExportFormatChange={setExportFormat}
            onAiOptionsChange={setAiOptions}
            onApplyAi={handleApplyAi}
            onResetAi={handleResetAi}
            onExport={handleExport}
          />
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={startResizeLeftPanel}
          onDoubleClick={() => setLeftPanelWidth(312)}
          className="shrink-0 w-1 cursor-col-resize hover:bg-[var(--brand-primary)]/30 active:bg-[var(--brand-primary)]/50 transition-colors"
          style={{ background: 'var(--app-border)' }}
          title="Trascina per regolare la larghezza (doppio click per reset)"
        />

        {/* Centre — crop editor / upload zone */}
        <div
          className="flex-1 flex flex-col p-5 min-w-0"
          style={{ background: 'var(--app-bg)' }}
        >
          {imageElement ? (
            <div className="flex flex-col h-full min-h-0">
              {aiCanvas && (
                <div className="flex items-center justify-end gap-2 pb-2 shrink-0">
                  <button
                    onClick={() => setCenterPreviewMode('original')}
                    className={[
                      'text-xs py-1.5 px-2.5 rounded border transition-colors',
                      centerPreviewMode === 'original'
                        ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-soft)] text-[var(--brand-primary)]'
                        : 'border-[var(--app-border)] bg-[var(--app-field)] text-[var(--app-text-muted)] hover:text-[var(--app-text)]',
                    ].join(' ')}
                  >
                    Originale
                  </button>
                  <button
                    onClick={() => setCenterPreviewMode('compare')}
                    className={[
                      'text-xs py-1.5 px-2.5 rounded border transition-colors',
                      centerPreviewMode === 'compare'
                        ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-soft)] text-[var(--brand-primary)]'
                        : 'border-[var(--app-border)] bg-[var(--app-field)] text-[var(--app-text-muted)] hover:text-[var(--app-text)]',
                    ].join(' ')}
                  >
                    Confronto
                  </button>
                  <button
                    onClick={() => setCenterPreviewMode('ai')}
                    className={[
                      'text-xs py-1.5 px-2.5 rounded border transition-colors',
                      centerPreviewMode === 'ai'
                        ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-soft)] text-[var(--brand-primary)]'
                        : 'border-[var(--app-border)] bg-[var(--app-field)] text-[var(--app-text-muted)] hover:text-[var(--app-text)]',
                    ].join(' ')}
                  >
                    AI
                  </button>
                </div>
              )}

              <div className="flex-1 min-h-0">
                {aiCanvas && centerPreviewMode === 'ai' ? (
                  <div className="flex flex-col h-full gap-3">
                    <div className="flex-1 flex items-center justify-center rounded-xl overflow-hidden bg-[var(--app-field)] min-h-0 p-3">
                      <canvas
                        ref={aiPreviewCanvasRef}
                        style={{ maxWidth: '100%', maxHeight: '100%', display: 'block' }}
                      />
                    </div>
                    <p className="text-xs text-center text-[var(--app-text-subtle)] shrink-0">
                      Visualizzi il risultato AI corrente.
                    </p>
                  </div>
                ) : aiCanvas && centerPreviewMode === 'compare' ? (
                  <div className="flex flex-col h-full gap-3">
                    <div className="flex-1 flex items-center justify-center rounded-xl overflow-hidden bg-[var(--app-field)] min-h-0 p-3">
                      <canvas
                        ref={aiPreviewCanvasRef}
                        style={{ maxWidth: '100%', maxHeight: '100%', display: 'block' }}
                      />
                    </div>
                    <div className="px-1">
                      <label className="flex items-center justify-between text-[10px] text-[var(--app-text-subtle)] pb-1">
                        <span>Originale</span>
                        <span>AI</span>
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(compareSplit * 100)}
                        onChange={(e) => setCompareSplit(Number(e.target.value) / 100)}
                        className="w-full"
                      />
                    </div>
                    <p className="text-xs text-center text-[var(--app-text-subtle)] shrink-0">
                      Confronto live: sposta lo slider per vedere prima/dopo.
                    </p>
                  </div>
                ) : (
                  <CropEditor
                    image={imageElement}
                    docPreset={docPreset}
                    onCropUpdate={handleCropUpdate}
                  />
                )}
              </div>
            </div>
          ) : (
            <UploadZone
              onImageLoaded={handleImageLoaded}
              className="flex-1"
            />
          )}
        </div>

        {/* Right — preview & export */}
        <div
          className="shrink-0 flex flex-col p-4 overflow-y-auto"
          style={{
            width: '296px',
            background: 'var(--app-surface)',
            borderLeft: '1px solid var(--app-border)',
          }}
        >
          {/* Section heading */}
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--app-text-subtle)] mb-3 shrink-0">
            Anteprima foglio
          </p>

          <PreviewSheet layout={layout} croppedCanvas={aiCanvas ?? croppedCanvas} />
        </div>
      </main>

      <Toaster
        position="bottom-right"
        richColors
        closeButton
        toastOptions={{
          style: {
            background: 'var(--app-surface)',
            border: '1px solid var(--app-border)',
            color: 'var(--app-text)',
          },
        }}
      />
    </div>
  )
}
