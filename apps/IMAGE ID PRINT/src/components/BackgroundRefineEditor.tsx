import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { Hand, RotateCcw, Save, Search, Slash, Sparkles, SplitSquareHorizontal, Undo2, Redo2, X, ZoomIn, ZoomOut } from 'lucide-react'
import { cn } from '../lib/utils'
import { cloneCanvas, drawCheckerboard, paintRefineLine, type RefineMode } from '../services/refine-mask-service'

interface BackgroundRefineEditorProps {
  editableCanvas: HTMLCanvasElement
  restoreCanvas: HTMLCanvasElement
  applyWhiteBackground: boolean
  onCancel: () => void
  onSave: (canvas: HTMLCanvasElement) => void
}

export function BackgroundRefineEditor({
  editableCanvas,
  restoreCanvas,
  applyWhiteBackground,
  onCancel,
  onSave,
}: BackgroundRefineEditorProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const displayCanvasRef = useRef<HTMLCanvasElement>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const guideCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const restoreCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const workingCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const undoStackRef = useRef<HTMLCanvasElement[]>([])
  const redoStackRef = useRef<HTMLCanvasElement[]>([])
  const isPaintingRef = useRef(false)
  const isPanningRef = useRef(false)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  const hoverPointRef = useRef<{ x: number; y: number } | null>(null)
  const panStartRef = useRef<{ x: number; y: number } | null>(null)
  const panOriginRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const rafRenderRef = useRef<number | null>(null)
  const [interactionMode, setInteractionMode] = useState<'paint' | 'pan'>('paint')
  const [brushMode, setBrushMode] = useState<RefineMode>('remove')
  const [brushSize, setBrushSize] = useState(36)
  const [brushHardness, setBrushHardness] = useState(0.72)
  const [compareMode, setCompareMode] = useState(true)
  const [compareSplit, setCompareSplit] = useState(50)
  const [historyTick, setHistoryTick] = useState(0)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    guideCanvasRef.current = cloneCanvas(editableCanvas)
    restoreCanvasRef.current = cloneCanvas(restoreCanvas)
    workingCanvasRef.current = cloneCanvas(editableCanvas)
    undoStackRef.current = []
    redoStackRef.current = []
    isPaintingRef.current = false
    isPanningRef.current = false
    lastPointRef.current = null
    hoverPointRef.current = null
    panStartRef.current = null
    panOriginRef.current = { x: 0, y: 0 }
    setInteractionMode('paint')
    setBrushMode('remove')
    setBrushSize(36)
    setBrushHardness(0.72)
    setCompareMode(true)
    setCompareSplit(50)
    setZoomLevel(1)
    setPanOffset({ x: 0, y: 0 })
    setHistoryTick((v) => v + 1)
  }, [editableCanvas, restoreCanvas])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const updateViewportSize = () => {
      setViewportSize({
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      })
    }

    updateViewportSize()
    const observer = new ResizeObserver(updateViewportSize)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  const fitScale = Math.max(
    0.08,
    Math.min(
      viewportSize.width > 0 ? (viewportSize.width - 24) / editableCanvas.width : 1,
      viewportSize.height > 0 ? (viewportSize.height - 24) / editableCanvas.height : 1,
    ),
  )

  const displayScale = fitScale * zoomLevel

  const clampPanOffset = useCallback((nextOffset: { x: number; y: number }, nextZoom = zoomLevel) => {
    if (viewportSize.width <= 0 || viewportSize.height <= 0) {
      return nextOffset
    }

    const scaledWidth = editableCanvas.width * fitScale * nextZoom
    const scaledHeight = editableCanvas.height * fitScale * nextZoom
    const maxX = Math.max(0, (scaledWidth - viewportSize.width) / 2 + 24)
    const maxY = Math.max(0, (scaledHeight - viewportSize.height) / 2 + 24)

    return {
      x: Math.min(maxX, Math.max(-maxX, nextOffset.x)),
      y: Math.min(maxY, Math.max(-maxY, nextOffset.y)),
    }
  }, [editableCanvas.height, editableCanvas.width, fitScale, viewportSize.height, viewportSize.width, zoomLevel])

  useEffect(() => {
    setPanOffset((prev) => clampPanOffset(prev))
  }, [clampPanOffset, displayScale])

  const clearOverlay = useCallback(() => {
    const overlay = overlayCanvasRef.current
    if (!overlay) return
    const overlayCtx = overlay.getContext('2d')
    if (!overlayCtx) return
    overlayCtx.clearRect(0, 0, overlay.width, overlay.height)
  }, [])

  const drawBrushPreview = useCallback((x: number, y: number) => {
    const overlay = overlayCanvasRef.current
    if (!overlay) return
    const ctx = overlay.getContext('2d')
    if (!ctx) return

    clearOverlay()

    const fillColor = brushMode === 'remove'
      ? 'rgba(225, 74, 74, 0.18)'
      : 'rgba(70, 124, 255, 0.18)'
    const strokeColor = brushMode === 'remove'
      ? 'rgba(225, 74, 74, 0.95)'
      : 'rgba(70, 124, 255, 0.95)'

    ctx.save()
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = fillColor
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }, [brushMode, brushSize, clearOverlay])

  const drawRefinedPreview = useCallback((ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    const working = workingCanvasRef.current
    if (!working) return

    if (!applyWhiteBackground) {
      drawCheckerboard(ctx, canvas.width, canvas.height)
    } else {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    ctx.drawImage(working, 0, 0)
  }, [applyWhiteBackground])

  const renderNow = useCallback(() => {
    const canvas = displayCanvasRef.current
    const overlay = overlayCanvasRef.current
    const working = workingCanvasRef.current
    const restore = restoreCanvasRef.current
    if (!canvas || !working || !restore) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (canvas.width !== working.width || canvas.height !== working.height) {
      canvas.width = working.width
      canvas.height = working.height
    }

    const showCompare = compareMode && !isPaintingRef.current
    if (showCompare) {
      const splitX = Math.round(canvas.width * (compareSplit / 100))
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, splitX, canvas.height)
      ctx.clip()
      ctx.drawImage(restore, 0, 0)
      ctx.restore()

      ctx.save()
      ctx.beginPath()
      ctx.rect(splitX, 0, canvas.width - splitX, canvas.height)
      ctx.clip()
      drawRefinedPreview(ctx, canvas)
      ctx.restore()

      ctx.strokeStyle = 'rgba(255,255,255,0.92)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(splitX + 0.5, 0)
      ctx.lineTo(splitX + 0.5, canvas.height)
      ctx.stroke()

      ctx.fillStyle = 'rgba(28,28,28,0.66)'
      ctx.fillRect(10, 10, 92, 20)
      ctx.fillRect(canvas.width - 102, 10, 92, 20)
      ctx.fillStyle = '#ffffff'
      ctx.font = '11px system-ui, -apple-system, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('Originale', 56, 20)
      ctx.fillText('Rifinito', canvas.width - 56, 20)
    } else {
      drawRefinedPreview(ctx, canvas)
    }

    if (overlay) {
      if (overlay.width !== canvas.width || overlay.height !== canvas.height) {
        overlay.width = canvas.width
        overlay.height = canvas.height
      }
    }
    clearOverlay()
    if (interactionMode === 'paint' && hoverPointRef.current) {
      drawBrushPreview(hoverPointRef.current.x, hoverPointRef.current.y)
    }
  }, [clearOverlay, compareMode, compareSplit, drawBrushPreview, drawRefinedPreview, interactionMode])

  const scheduleRender = useCallback(() => {
    if (rafRenderRef.current !== null) return
    rafRenderRef.current = window.requestAnimationFrame(() => {
      rafRenderRef.current = null
      renderNow()
    })
  }, [renderNow])

  useEffect(() => {
    scheduleRender()
  }, [brushMode, brushSize, brushHardness, compareMode, compareSplit, historyTick, scheduleRender])

  useEffect(() => {
    return () => {
      if (rafRenderRef.current !== null) {
        window.cancelAnimationFrame(rafRenderRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (interactionMode === 'pan') {
      hoverPointRef.current = null
      clearOverlay()
    } else {
      scheduleRender()
    }
  }, [clearOverlay, interactionMode, scheduleRender])

  const getPointFromEvent = (e: PointerEvent<HTMLCanvasElement>) => {
    const canvas = displayCanvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }

  const pushUndoSnapshot = useCallback(() => {
    const working = workingCanvasRef.current
    if (!working) return
    undoStackRef.current.push(cloneCanvas(working))
    if (undoStackRef.current.length > 20) {
      undoStackRef.current.shift()
    }
    redoStackRef.current = []
    setHistoryTick((v) => v + 1)
  }, [])

  const paintAt = useCallback((x: number, y: number, pressure = 1) => {
    const working = workingCanvasRef.current
    const guide = guideCanvasRef.current
    const restore = restoreCanvasRef.current
    if (!working || !guide || !restore) return

    hoverPointRef.current = { x, y }
    paintRefineLine(
      working,
      guide,
      restore,
      lastPointRef.current ?? { x, y },
      { x, y },
      brushSize,
      brushMode,
      brushHardness,
      pressure,
    )
    lastPointRef.current = { x, y }
    scheduleRender()
    drawBrushPreview(x, y)
  }, [brushHardness, brushMode, brushSize, drawBrushPreview, scheduleRender])

  const updateZoomLevel = useCallback((nextZoom: number) => {
    const clampedZoom = Math.min(8, Math.max(1, nextZoom))
    setZoomLevel(clampedZoom)
    setPanOffset((prev) => clampPanOffset(prev, clampedZoom))
  }, [clampPanOffset])

  const restoreWorkingCanvas = useCallback((canvas: HTMLCanvasElement) => {
    workingCanvasRef.current = cloneCanvas(canvas)
    setHistoryTick((v) => v + 1)
  }, [])

  const handleUndo = useCallback(() => {
    const current = workingCanvasRef.current
    const next = undoStackRef.current.pop()
    if (!current || !next) return
    redoStackRef.current.push(cloneCanvas(current))
    restoreWorkingCanvas(next)
  }, [restoreWorkingCanvas])

  const handleRedo = useCallback(() => {
    const current = workingCanvasRef.current
    const next = redoStackRef.current.pop()
    if (!current || !next) return
    undoStackRef.current.push(cloneCanvas(current))
    restoreWorkingCanvas(next)
  }, [restoreWorkingCanvas])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (!meta) return
      const target = e.target
      if (
        target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }

      if (e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) {
          handleRedo()
        } else {
          handleUndo()
        }
      }

      if (e.key.toLowerCase() === 'y') {
        e.preventDefault()
        handleRedo()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleRedo, handleUndo])

  const handlePointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (interactionMode === 'pan') {
      isPanningRef.current = true
      panStartRef.current = { x: e.clientX, y: e.clientY }
      panOriginRef.current = panOffset
      hoverPointRef.current = null
      clearOverlay()
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }

    const point = getPointFromEvent(e)
    if (!point) return

    pushUndoSnapshot()
    isPaintingRef.current = true
    hoverPointRef.current = point
    lastPointRef.current = point
    e.currentTarget.setPointerCapture(e.pointerId)
    const pressure = e.pressure > 0 ? e.pressure : 1
    paintAt(point.x, point.y, 0.45 + pressure * 0.55)
  }

  const handlePointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (isPanningRef.current && panStartRef.current) {
      const dx = e.clientX - panStartRef.current.x
      const dy = e.clientY - panStartRef.current.y
      setPanOffset(clampPanOffset({
        x: panOriginRef.current.x + dx,
        y: panOriginRef.current.y + dy,
      }))
      return
    }

    const point = getPointFromEvent(e)
    if (!point) return
    hoverPointRef.current = point

    if (!isPaintingRef.current) {
      if (interactionMode === 'paint') {
        drawBrushPreview(point.x, point.y)
      }
      return
    }

    const pressure = e.pressure > 0 ? e.pressure : 1
    paintAt(point.x, point.y, 0.45 + pressure * 0.55)
  }

  const stopPainting = (e?: PointerEvent<HTMLCanvasElement>) => {
    if (isPanningRef.current) {
      isPanningRef.current = false
      panStartRef.current = null
      if (e) {
        try {
          e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {
          // Pointer capture may already be released.
        }
      }
      return
    }

    isPaintingRef.current = false
    lastPointRef.current = null
    if (e) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // Pointer capture may already be released.
      }
    }
    scheduleRender()
  }

  const handlePointerCancel = (e: PointerEvent<HTMLCanvasElement>) => {
    hoverPointRef.current = null
    clearOverlay()
    stopPainting(e)
  }

  const handlePointerLeave = () => {
    hoverPointRef.current = null
    clearOverlay()
    if (isPaintingRef.current) {
      isPaintingRef.current = false
      lastPointRef.current = null
      scheduleRender()
    }
  }

  const handleReset = () => {
    workingCanvasRef.current = cloneCanvas(editableCanvas)
    undoStackRef.current = []
    redoStackRef.current = []
    isPaintingRef.current = false
    isPanningRef.current = false
    lastPointRef.current = null
    hoverPointRef.current = null
    panStartRef.current = null
    panOriginRef.current = { x: 0, y: 0 }
    setInteractionMode('paint')
    setZoomLevel(1)
    setPanOffset({ x: 0, y: 0 })
    clearOverlay()
    setHistoryTick((v) => v + 1)
  }

  const handleSave = () => {
    const working = workingCanvasRef.current
    if (!working) return
    onSave(cloneCanvas(working))
  }

  const canUndo = undoStackRef.current.length > 0
  const canRedo = redoStackRef.current.length > 0
  const canvasCursorClass = interactionMode === 'pan'
    ? (isPanningRef.current ? 'cursor-grabbing' : 'cursor-grab')
    : (brushMode === 'remove' ? 'cursor-crosshair' : 'cursor-cell')

  return (
    <div className="flex flex-col h-full gap-3 min-h-0">
      <div className="flex items-center justify-between gap-3 shrink-0">
        <div>
          <h3 className="text-sm font-semibold text-[var(--app-text)]">Refina scontorno</h3>
          <p className="text-xs text-[var(--app-text-subtle)]">
            Il recupero soggetto ora usa la crop originale per ricostruire meglio capelli e contorni chiari.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button
            onClick={handleUndo}
            disabled={!canUndo}
            className={cn(
              'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors',
              canUndo
                ? 'border-[var(--app-border)] bg-[var(--app-field)] text-[var(--app-text-muted)] hover:text-[var(--app-text)]'
                : 'border-[var(--app-border)] bg-[var(--app-field)] text-[var(--app-text-subtle)] cursor-not-allowed opacity-60',
            )}
          >
            <Undo2 size={13} />
            Undo
          </button>
          <button
            onClick={handleRedo}
            disabled={!canRedo}
            className={cn(
              'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors',
              canRedo
                ? 'border-[var(--app-border)] bg-[var(--app-field)] text-[var(--app-text-muted)] hover:text-[var(--app-text)]'
                : 'border-[var(--app-border)] bg-[var(--app-field)] text-[var(--app-text-subtle)] cursor-not-allowed opacity-60',
            )}
          >
            <Redo2 size={13} />
            Redo
          </button>
          <button
            onClick={() => setCompareMode((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors',
              compareMode
                ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-soft)] text-[var(--brand-primary)]'
                : 'border-[var(--app-border)] bg-[var(--app-field)] text-[var(--app-text-muted)] hover:text-[var(--app-text)]',
            )}
          >
            <SplitSquareHorizontal size={13} />
            Confronto
          </button>
          <button
            onClick={() => setInteractionMode((mode) => (mode === 'pan' ? 'paint' : 'pan'))}
            className={cn(
              'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors',
              interactionMode === 'pan'
                ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-soft)] text-[var(--brand-primary)]'
                : 'border-[var(--app-border)] bg-[var(--app-field)] text-[var(--app-text-muted)] hover:text-[var(--app-text)]',
            )}
          >
            <Hand size={13} />
            Sposta
          </button>
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-[var(--app-border)] bg-[var(--app-field)] text-[var(--app-text-muted)] hover:text-[var(--app-text)]"
          >
            <RotateCcw size={13} />
            Reset
          </button>
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-[var(--app-border)] bg-[var(--app-field)] text-[var(--app-text-muted)] hover:text-[var(--app-text)]"
          >
            <X size={13} />
            Chiudi
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-[var(--brand-primary)] bg-[var(--brand-primary-soft)] text-[var(--brand-primary)] hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)]"
          >
            <Save size={13} />
            Applica
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_270px] min-h-0 flex-1">
        <div
          ref={viewportRef}
          className="min-h-0 relative rounded-xl overflow-hidden bg-[var(--app-field)] p-3"
          onWheel={(e) => {
            e.preventDefault()
            const direction = e.deltaY < 0 ? 1.1 : 0.9
            updateZoomLevel(zoomLevel * direction)
          }}
        >
          <div
            className="absolute left-1/2 top-1/2"
            style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px)` }}
          >
            <div
              className="relative"
              style={{
                width: editableCanvas.width,
                height: editableCanvas.height,
                transform: `translate(-50%, -50%) scale(${displayScale})`,
                transformOrigin: 'center center',
              }}
            >
              <canvas
                ref={displayCanvasRef}
                className={cn(
                  'block rounded-lg shadow-sm',
                  canvasCursorClass,
                )}
                style={{ display: 'block' }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={stopPainting}
                onPointerCancel={handlePointerCancel}
                onPointerLeave={handlePointerLeave}
              />
              <canvas
                ref={overlayCanvasRef}
                className="absolute inset-0 pointer-events-none"
                style={{ display: 'block' }}
              />
            </div>
          </div>
          <div className="absolute bottom-3 left-3 rounded-lg border border-[var(--app-border)] bg-[rgba(22,24,28,0.78)] px-2.5 py-1.5 text-[11px] text-white/88 shadow-sm backdrop-blur-sm">
            Rotella per zoom · Sposta per trascinare dentro l&apos;immagine
          </div>
        </div>

        <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-3 flex flex-col gap-3 shrink-0">
          <div className="flex items-center gap-1 rounded-lg bg-[var(--app-field)] p-1">
            <button
              onClick={() => setBrushMode('remove')}
              className={cn(
                'flex-1 text-xs rounded-md py-2 transition-colors',
                brushMode === 'remove'
                  ? 'bg-[var(--brand-primary-soft)] text-[var(--brand-primary)]'
                  : 'text-[var(--app-text-muted)] hover:text-[var(--app-text)]',
              )}
            >
              <Slash size={13} className="inline-block mr-1" />
              Elimina sfondo
            </button>
            <button
              onClick={() => setBrushMode('keep')}
              className={cn(
                'flex-1 text-xs rounded-md py-2 transition-colors',
                brushMode === 'keep'
                  ? 'bg-[var(--brand-primary-soft)] text-[var(--brand-primary)]'
                  : 'text-[var(--app-text-muted)] hover:text-[var(--app-text)]',
              )}
            >
              <Sparkles size={13} className="inline-block mr-1" />
              Tieni soggetto
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[10px] text-[var(--app-text-subtle)] flex items-center justify-between">
              <span>Zoom editor</span>
              <span className="font-medium text-[var(--app-text-muted)]">{Math.round(zoomLevel * 100)}%</span>
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateZoomLevel(zoomLevel / 1.15)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--app-border)] bg-[var(--app-field)] text-[var(--app-text-muted)] hover:text-[var(--app-text)]"
                aria-label="Riduci zoom"
              >
                <ZoomOut size={14} />
              </button>
              <input
                type="range"
                min={1}
                max={8}
                step={0.05}
                value={zoomLevel}
                onChange={(e) => updateZoomLevel(Number(e.target.value))}
                className="w-full"
              />
              <button
                onClick={() => updateZoomLevel(zoomLevel * 1.15)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--app-border)] bg-[var(--app-field)] text-[var(--app-text-muted)] hover:text-[var(--app-text)]"
                aria-label="Aumenta zoom"
              >
                <ZoomIn size={14} />
              </button>
            </div>
            <button
              onClick={() => {
                setZoomLevel(1)
                setPanOffset({ x: 0, y: 0 })
              }}
              className="inline-flex items-center gap-1.5 self-start text-[11px] px-2 py-1 rounded-md border border-[var(--app-border)] bg-[var(--app-field)] text-[var(--app-text-muted)] hover:text-[var(--app-text)]"
            >
              <Search size={12} />
              Adatta alla vista
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[10px] text-[var(--app-text-subtle)] flex items-center justify-between">
              <span>Dimensione pennello</span>
              <span className="font-medium text-[var(--app-text-muted)]">{brushSize}px</span>
            </label>
            <input
              type="range"
              min={8}
              max={120}
              step={1}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="w-full"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[10px] text-[var(--app-text-subtle)] flex items-center justify-between">
              <span>Durezza bordo</span>
              <span className="font-medium text-[var(--app-text-muted)]">{Math.round(brushHardness * 100)}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={brushHardness}
              onChange={(e) => setBrushHardness(Number(e.target.value))}
              className="w-full"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[10px] text-[var(--app-text-subtle)] flex items-center justify-between">
              <span>Split preview</span>
              <span className="font-medium text-[var(--app-text-muted)]">{compareSplit}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={compareSplit}
              onChange={(e) => setCompareSplit(Number(e.target.value))}
              disabled={!compareMode}
              className="w-full"
            />
          </div>

          <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-field)] p-2 text-[11px] text-[var(--app-text-subtle)] space-y-1">
            <p>Tieni soggetto recupera dettaglio dalla crop originale, non dal bianco gia applicato.</p>
            <p>Confronto attivo mostra la foto originale a sinistra e il risultato doc a destra.</p>
            <p>Undo e Redo ti permettono di spingere di piu il refine senza paura.</p>
            <p>Con Sposta e Zoom puoi entrare nei dettagli senza perdere il punto di lavoro.</p>
          </div>

          <div className="mt-auto text-[11px] text-[var(--app-text-subtle)]">
            Il risultato resta non distruttivo finche non premi Applica.
          </div>
        </div>
      </div>
    </div>
  )
}
