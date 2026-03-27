import { useRef, useEffect } from 'react'
import type { LayoutResult } from '../types'

interface PreviewSheetProps {
  layout: LayoutResult | null
  croppedCanvas: HTMLCanvasElement | null
}

const PREVIEW_MAX_W = 240
const PREVIEW_MAX_H = 340

export function PreviewSheet({ layout, croppedCanvas }: PreviewSheetProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const dpr = Math.max(1, window.devicePixelRatio || 1)

    if (!layout) {
      // Empty placeholder
      canvas.width = Math.round(PREVIEW_MAX_W * dpr)
      canvas.height = Math.round(PREVIEW_MAX_H * dpr)
      canvas.style.width = `${PREVIEW_MAX_W}px`
      canvas.style.height = `${PREVIEW_MAX_H}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#f5f5f0'
      ctx.fillRect(0, 0, PREVIEW_MAX_W, PREVIEW_MAX_H)
      ctx.fillStyle = '#c9c1b7'
      ctx.font = '13px system-ui'
      ctx.textAlign = 'center'
      ctx.fillText('Anteprima foglio', PREVIEW_MAX_W / 2, PREVIEW_MAX_H / 2)
      return
    }

    // Scale to fit preview panel
    const scale = Math.min(
      PREVIEW_MAX_W / layout.sheetWidthPx,
      PREVIEW_MAX_H / layout.sheetHeightPx,
    )
    const pw = Math.floor(layout.sheetWidthPx * scale)
    const ph = Math.floor(layout.sheetHeightPx * scale)

    canvas.width = Math.round(pw * dpr)
    canvas.height = Math.round(ph * dpr)
    canvas.style.width = `${pw}px`
    canvas.style.height = `${ph}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // White sheet background
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, pw, ph)

    const photoW = layout.photoWidthPx * scale
    const photoH = layout.photoHeightPx * scale

    for (const pos of layout.positions) {
      const px = pos.x * scale
      const py = pos.y * scale

      if (croppedCanvas) {
        if (layout.photoRotated) {
          ctx.save()
          ctx.translate(px + photoH / 2, py + photoW / 2)
          ctx.rotate(Math.PI / 2)
          ctx.drawImage(croppedCanvas, -photoH / 2, -photoW / 2, photoH, photoW)
          ctx.restore()
        } else {
          ctx.drawImage(croppedCanvas, px, py, photoW, photoH)
        }
      } else {
        // Placeholder photo slot
        ctx.fillStyle = '#d8e1d4'
        ctx.fillRect(px, py, photoW, photoH)
        ctx.strokeStyle = '#a0a89a'
        ctx.lineWidth = 0.5
        ctx.strokeRect(px, py, photoW, photoH)
        // Silhouette icon placeholder lines
        ctx.strokeStyle = '#b0b8aa'
        ctx.lineWidth = 0.8
        const cx = px + photoW / 2
        const cy = py + photoH / 2
        ctx.beginPath()
        ctx.arc(cx, cy - photoH * 0.12, photoW * 0.14, 0, Math.PI * 2)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(cx, cy + photoH * 0.18, photoW * 0.22, 0, Math.PI)
        ctx.stroke()
      }
    }

    // Sheet border
    ctx.strokeStyle = '#888'
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, 0.5, pw - 1, ph - 1)
  }, [layout, croppedCanvas])

  const copies = layout?.total ?? 0

  return (
    <div className="flex flex-col items-center gap-3 h-full">
      {/* Canvas preview */}
      <div className="flex-1 flex items-center justify-center w-full min-h-0">
        <div className="rounded-lg overflow-hidden shadow-lg" style={{ lineHeight: 0 }}>
          <canvas ref={canvasRef} style={{ display: 'block' }} />
        </div>
      </div>

      {/* Info */}
      {layout && (
        <div className="w-full rounded-lg bg-[var(--app-field)] p-3 space-y-1 shrink-0">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--app-text-subtle)]">Copie per foglio</span>
            <span className="font-semibold text-[var(--brand-accent)]">{copies}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--app-text-subtle)]">Griglia</span>
            <span className="text-[var(--app-text-muted)]">
              {layout.cols} × {layout.rows}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--app-text-subtle)]">Orientamento</span>
            <span className="text-[var(--app-text-muted)]">
              {layout.sheetWidthPx >= layout.sheetHeightPx ? 'Orizzontale' : 'Verticale'}
              {layout.photoRotated && ' · foto ruotata'}
            </span>
          </div>
          {copies === 0 && (
            <p className="text-xs text-[var(--danger)] pt-1">
              ⚠ Nessuna copia possibile — prova un foglio più grande o una foto più piccola.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
