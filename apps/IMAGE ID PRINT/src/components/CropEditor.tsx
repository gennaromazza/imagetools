import { useState } from 'react'
import { RotateCcw, User, ScanFace } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '../lib/utils'
import type { DocumentPreset } from '../types'
import { useCropEngine } from '../hooks/useCropEngine'

interface CropEditorProps {
  image: HTMLImageElement
  docPreset: DocumentPreset
  onCropUpdate: (canvas: HTMLCanvasElement) => void
}

export function CropEditor({ image, docPreset, onCropUpdate }: CropEditorProps) {
  const [showSilhouette, setShowSilhouette] = useState(true)
  const [isAutoAligning, setIsAutoAligning] = useState(false)
  const { canvasRef, getCroppedCanvas, resetCrop, autoAlignToGuide } = useCropEngine(image, docPreset, onCropUpdate, showSilhouette)

  const handleReset = () => {
    resetCrop()
    const cropped = getCroppedCanvas()
    if (cropped) onCropUpdate(cropped)
  }

  const hasSpecs = docPreset.category !== 'custom'

  const handleAutoAlign = async () => {
    setIsAutoAligning(true)
    try {
      const ok = await autoAlignToGuide()
      if (ok) {
        toast.success('Occhi allineati alla guida')
      } else {
        toast.warning('Allineamento automatico non disponibile', {
          description: 'Browser senza Face Detection o volto non rilevato. Regola manualmente il crop.',
        })
      }
    } finally {
      setIsAutoAligning(false)
    }
  }

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-1 shrink-0">
        <span className="text-sm font-medium text-[var(--app-text)]">
          Ritaglio — {docPreset.widthMm}×{docPreset.heightMm} mm
        </span>
        <div className="flex items-center gap-1">
          {/* Silhouette toggle — only for presets with specs */}
          {hasSpecs && (
            <button
              onClick={() => setShowSilhouette((v) => !v)}
              title={showSilhouette ? 'Nascondi guida sagoma' : 'Mostra guida sagoma'}
              className={cn(
                'flex items-center gap-1.5 text-xs py-1 px-2 rounded transition-colors',
                showSilhouette
                  ? 'bg-[var(--brand-primary-soft)] text-[var(--brand-primary)] border border-[var(--brand-primary)]'
                  : 'text-[var(--app-text-subtle)] hover:text-[var(--app-text)] hover:bg-[var(--app-surface-strong)]',
              )}
            >
              <User size={13} />
              Guida
            </button>
          )}
          {hasSpecs && (
            <button
              onClick={handleAutoAlign}
              disabled={isAutoAligning}
              title="Allinea automaticamente gli occhi alla guida"
              className={cn(
                'flex items-center gap-1.5 text-xs py-1 px-2 rounded transition-colors border',
                isAutoAligning
                  ? 'border-[var(--app-border)] bg-[var(--app-surface-strong)] text-[var(--app-text-subtle)] cursor-not-allowed'
                  : 'border-[var(--app-border)] bg-[var(--app-field)] text-[var(--app-text-muted)] hover:text-[var(--app-text)] hover:bg-[var(--app-surface-strong)]',
              )}
            >
              <ScanFace size={13} />
              {isAutoAligning ? 'Analisi...' : 'Allinea occhi'}
            </button>
          )}
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-xs text-[var(--app-text-subtle)] hover:text-[var(--app-text)] transition-colors py-1 px-2 rounded hover:bg-[var(--app-surface-strong)]"
          >
            <RotateCcw size={13} />
            Reset
          </button>
        </div>
      </div>

      {/* Canvas area */}
      <div className="flex-1 flex items-center justify-center rounded-xl overflow-hidden bg-[var(--app-field)] min-h-0">
        <canvas
          ref={canvasRef}
          width={520}
          height={480}
          className="cursor-grab active:cursor-grabbing"
          style={{ maxWidth: '100%', maxHeight: '100%', display: 'block' }}
        />
      </div>

      {/* Hint */}
      <p className="text-xs text-center text-[var(--app-text-subtle)] shrink-0">
        Trascina per riposizionare · Rotella del mouse per lo zoom · Allinea occhi per centratura rapida
      </p>
    </div>
  )
}
