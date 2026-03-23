import { useRef, useEffect } from 'react'
import type { DocumentPreset } from '../types'

const REMBG_BASE_URL = (
  (import.meta as unknown as { env?: { VITE_REMBG_ENDPOINT?: string } }).env?.VITE_REMBG_ENDPOINT
  ?? 'http://localhost:7010/remove-background'
).replace(/\/remove-background$/, '')

const FACE_DETECT_ENDPOINT = `${REMBG_BASE_URL}/detect-face`

export interface UseCropEngineReturn {
  canvasRef: React.RefObject<HTMLCanvasElement>
  getCroppedCanvas: () => HTMLCanvasElement | null
  resetCrop: () => void
  autoAlignToGuide: () => Promise<boolean>
}

interface FaceBox {
  x: number
  y: number
  width: number
  height: number
}

interface FaceDetectionLike {
  boundingBox: { x: number; y: number; width: number; height: number }
}

interface FaceDetectorCtorLike {
  new (options?: { maxDetectedFaces?: number; fastMode?: boolean }): {
    detect: (image: ImageBitmapSource) => Promise<FaceDetectionLike[]>
  }
}

interface SidecarDetectFaceResponse {
  ok: boolean
  face: null | {
    xNorm: number
    yNorm: number
    wNorm: number
    hNorm: number
  }
}

/**
 * Draws a head + shoulders silhouette guide inside the crop frame.
 * Purely visual — NEVER rendered into the exported image.
 *
 * Proportions follow ICAO Doc 9303 and Italian Ministero dell'Interno:
 *   Crown:     ~6% from top   (≈ 2.7 mm for 45 mm — spec: max 5 mm from top)
 *   Eye level: ~38% from top  (ICAO 56–69% from bottom = 31–44% from top)
 *   Chin:      ~79% from top  (head height ≈ 73% = 32.9 mm — spec: 31–36 mm)
 *   Shoulders: emerge from ~86%
 */
function drawSilhouette(
  ctx: CanvasRenderingContext2D,
  cX: number,
  cY: number,
  cW: number,
  cH: number,
): void {
  const crownFrac   = 0.06
  const eyeFrac     = 0.38
  const chinFrac    = 0.79
  const neckBotFrac = 0.86

  const crownY   = cY + cH * crownFrac
  const eyeY     = cY + cH * eyeFrac
  const chinY    = cY + cH * chinFrac
  const neckBotY = cY + cH * neckBotFrac
  const botY     = cY + cH
  const cx       = cX + cW / 2

  // Head ellipse geometry
  const headRY = (chinY - crownY) / 2
  const headCY = crownY + headRY
  const headRX = headRY * 0.78   // anatomical face width/height ratio
  const neckHW = headRX * 0.34   // neck half-width

  ctx.save()

  // ── Head oval ──────────────────────────────────────────────────────────────
  ctx.beginPath()
  ctx.ellipse(cx, headCY, headRX, headRY, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,255,255,0.07)'
  ctx.fill()
  ctx.setLineDash([5, 4])
  ctx.strokeStyle = 'rgba(255,255,255,0.65)'
  ctx.lineWidth = 1.8
  ctx.stroke()

  // ── Neck vertical lines ────────────────────────────────────────────────────
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(cx - neckHW, chinY + 2)
  ctx.lineTo(cx - neckHW, neckBotY)
  ctx.moveTo(cx + neckHW, chinY + 2)
  ctx.lineTo(cx + neckHW, neckBotY)
  ctx.strokeStyle = 'rgba(255,255,255,0.38)'
  ctx.lineWidth = 1.2
  ctx.stroke()

  // ── Shoulder curves ────────────────────────────────────────────────────────
  ctx.setLineDash([5, 4])
  // Left
  ctx.beginPath()
  ctx.moveTo(cx - neckHW * 1.15, neckBotY)
  ctx.bezierCurveTo(
    cx - cW * 0.22, neckBotY + cH * 0.025,
    cx - cW * 0.44, neckBotY + cH * 0.075,
    cX, botY,
  )
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'
  ctx.lineWidth = 1.8
  ctx.stroke()
  // Right
  ctx.beginPath()
  ctx.moveTo(cx + neckHW * 1.15, neckBotY)
  ctx.bezierCurveTo(
    cx + cW * 0.22, neckBotY + cH * 0.025,
    cx + cW * 0.44, neckBotY + cH * 0.075,
    cX + cW, botY,
  )
  ctx.stroke()

  // ── Eye-level guide (gold accent) ─────────────────────────────────────────
  ctx.setLineDash([7, 4])
  ctx.beginPath()
  ctx.moveTo(cX + 2, eyeY)
  ctx.lineTo(cX + cW - 2, eyeY)
  ctx.strokeStyle = 'rgba(184,154,99,0.72)'
  ctx.lineWidth = 1.2
  ctx.stroke()
  // Label
  ctx.setLineDash([])
  const fontSize = Math.max(9, Math.round(cW * 0.055))
  ctx.font = `${fontSize}px system-ui, -apple-system, sans-serif`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillStyle = 'rgba(184,154,99,0.82)'
  ctx.fillText('occhi ↑', cX + cW - 4, eyeY - 2)

  // ── Crown guard band (green tint = safe zone) ─────────────────────────────
  ctx.fillStyle = 'rgba(102,117,107,0.22)'
  ctx.fillRect(cX, cY, cW, cH * crownFrac)
  ctx.font = `${Math.max(8, Math.round(cW * 0.046))}px system-ui, -apple-system, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillStyle = 'rgba(180,210,180,0.60)'
  ctx.fillText('zona corona', cx, cY + cH * crownFrac - 1)

  ctx.restore()
}

/**
 * Canvas-based crop engine.
 * The crop frame is fixed (centered, correct aspect ratio).
 * The user drags / scrolls to pan/zoom the image underneath.
 * All state is held in refs to avoid stale closures in event handlers.
 */
export function useCropEngine(
  image: HTMLImageElement | null,
  docPreset: DocumentPreset,
  onCropUpdate?: (canvas: HTMLCanvasElement) => void,
  showSilhouette = true,
): UseCropEngineReturn {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Mutable state held in refs (so event handlers never go stale)
  const cropStateRef = useRef({ imgX: 0, imgY: 0, scale: 1 })
  const dragRef = useRef({ active: false, lastX: 0, lastY: 0 })
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showSilhouetteRef = useRef(showSilhouette)
  const detectedFaceRef = useRef<FaceBox | null>(null)
  const detectedForImageRef = useRef<HTMLImageElement | null>(null)
  showSilhouetteRef.current = showSilhouette

  // Always-current refs
  const imageRef = useRef(image)
  const docPresetRef = useRef(docPreset)
  const onCropUpdateRef = useRef(onCropUpdate)
  imageRef.current = image
  docPresetRef.current = docPreset
  onCropUpdateRef.current = onCropUpdate

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /** Returns the crop rect (pixels) centred in the canvas. */
  const getCropRect = (canvas: HTMLCanvasElement) => {
    const doc = docPresetRef.current
    const ar = doc.widthMm / doc.heightMm
    const canvasAr = canvas.width / canvas.height
    const pad = 40
    let cropW: number
    let cropH: number
    if (ar > canvasAr) {
      cropW = canvas.width - pad * 2
      cropH = cropW / ar
    } else {
      cropH = canvas.height - pad * 2
      cropW = cropH * ar
    }
    return {
      cropX: Math.round((canvas.width - cropW) / 2),
      cropY: Math.round((canvas.height - cropH) / 2),
      cropW,
      cropH,
    }
  }

  /** Clamp image position so the crop area is always fully covered. */
  const clamp = (canvas: HTMLCanvasElement) => {
    const img = imageRef.current
    if (!img) return
    const { scale, imgX, imgY } = cropStateRef.current
    const { cropX, cropY, cropW, cropH } = getCropRect(canvas)
    const imgW = img.naturalWidth * scale
    const imgH = img.naturalHeight * scale
    cropStateRef.current.imgX = Math.min(cropX, Math.max(cropX + cropW - imgW, imgX))
    cropStateRef.current.imgY = Math.min(cropY, Math.max(cropY + cropH - imgH, imgY))
  }

  /** Render the canvas: image + dark vignette + crop frame + guides. */
  const draw = () => {
    const canvas = canvasRef.current
    const img = imageRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')!
    const { imgX, imgY, scale } = cropStateRef.current
    const { cropX, cropY, cropW, cropH } = getCropRect(canvas)

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Image
    ctx.drawImage(img, imgX, imgY, img.naturalWidth * scale, img.naturalHeight * scale)

    // Dark overlay outside crop (even-odd rule)
    ctx.save()
    ctx.fillStyle = 'rgba(0,0,0,0.58)'
    ctx.beginPath()
    ctx.rect(0, 0, canvas.width, canvas.height)
    ctx.rect(cropX, cropY, cropW, cropH)
    ctx.fill('evenodd')

    // Crop frame
    ctx.strokeStyle = 'rgba(242,236,229,0.9)'
    ctx.lineWidth = 2
    ctx.strokeRect(cropX, cropY, cropW, cropH)

    // Corner marks
    // ── Silhouette guide (clipped to crop area, only for spec presets) ──────
    if (showSilhouetteRef.current && docPresetRef.current.category !== 'custom') {
      ctx.save()
      ctx.beginPath()
      ctx.rect(cropX, cropY, cropW, cropH)
      ctx.clip()
      drawSilhouette(ctx, cropX, cropY, cropW, cropH)
      ctx.restore()
    }

    // ── Crop frame ─────────────────────────────────────────────────────────
    ctx.strokeStyle = 'rgba(242,236,229,0.9)'
    ctx.lineWidth = 2
    ctx.strokeRect(cropX, cropY, cropW, cropH)

    // ── Corner marks ───────────────────────────────────────────────────────
    const cs = 14
    ctx.strokeStyle = 'rgba(242,236,229,1)'
    ctx.lineWidth = 2.5
    const corners = [
      [cropX, cropY, cs, 0, 0, cs],
      [cropX + cropW, cropY, -cs, 0, 0, cs],
      [cropX, cropY + cropH, cs, 0, 0, -cs],
      [cropX + cropW, cropY + cropH, -cs, 0, 0, -cs],
    ] as const
    for (const [x, y, dx1, dy1, dx2, dy2] of corners) {
      ctx.beginPath()
      ctx.moveTo(x + dx1, y + dy1)
      ctx.lineTo(x, y)
      ctx.lineTo(x + dx2, y + dy2)
      ctx.stroke()
    }

    // ── Rule-of-thirds grid (improved + intersection dots) ─────────────────
    ctx.strokeStyle = 'rgba(242,236,229,0.28)'
    ctx.lineWidth = 0.8
    for (let i = 1; i <= 2; i++) {
      const xLine = cropX + (cropW * i) / 3
      const yLine = cropY + (cropH * i) / 3
      ctx.beginPath()
      ctx.moveTo(xLine, cropY)
      ctx.lineTo(xLine, cropY + cropH)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(cropX, yLine)
      ctx.lineTo(cropX + cropW, yLine)
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(242,236,229,0.50)'
    for (let i = 1; i <= 2; i++) {
      for (let j = 1; j <= 2; j++) {
        ctx.beginPath()
        ctx.arc(cropX + (cropW * i) / 3, cropY + (cropH * j) / 3, 2.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // ── Centre crosshair ───────────────────────────────────────────────────
    const cx = cropX + cropW / 2
    const cy = cropY + cropH / 2
    ctx.strokeStyle = 'rgba(242,236,229,0.45)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx - 10, cy)
    ctx.lineTo(cx + 10, cy)
    ctx.moveTo(cx, cy - 10)
    ctx.lineTo(cx, cy + 10)
    ctx.stroke()

    ctx.restore()
  }

  const getCachedOrDetectFace = async (): Promise<FaceBox | null> => {
    const img = imageRef.current
    if (!img) return null

    if (detectedForImageRef.current === img && detectedFaceRef.current) {
      return detectedFaceRef.current
    }

    // Primary path for packaged app: local sidecar (browser-independent).
    const sidecarFace = await detectFaceWithSidecar(img)
    if (sidecarFace) {
      detectedFaceRef.current = sidecarFace
      detectedForImageRef.current = img
      return sidecarFace
    }

    // Optional fallback for browsers where sidecar may be unavailable.
    const Detector = (window as unknown as { FaceDetector?: FaceDetectorCtorLike }).FaceDetector
    if (!Detector) return null

    try {
      const bitmap = await createImageBitmap(img)
      const detector = new Detector({ maxDetectedFaces: 1, fastMode: true })
      const faces = await detector.detect(bitmap)
      bitmap.close()
      const face = faces[0]
      if (!face?.boundingBox) return null

      const box = {
        x: face.boundingBox.x,
        y: face.boundingBox.y,
        width: face.boundingBox.width,
        height: face.boundingBox.height,
      }
      detectedFaceRef.current = box
      detectedForImageRef.current = img
      return box
    } catch {
      return null
    }
  }

  const detectFaceWithSidecar = async (img: HTMLImageElement): Promise<FaceBox | null> => {
    try {
      const send = resizeImageForDetection(img, 1800)
      const blob = await canvasToBlob(send, 'image/jpeg', 0.9)
      const formData = new FormData()
      formData.append('image', blob, 'face-detect.jpg')

      const res = await fetch(FACE_DETECT_ENDPOINT, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) return null

      const payload = (await res.json()) as SidecarDetectFaceResponse
      if (!payload.ok || !payload.face) return null

      return {
        x: payload.face.xNorm * img.naturalWidth,
        y: payload.face.yNorm * img.naturalHeight,
        width: payload.face.wNorm * img.naturalWidth,
        height: payload.face.hNorm * img.naturalHeight,
      }
    } catch {
      return null
    }
  }

  const autoAlignToGuide = async (): Promise<boolean> => {
    const canvas = canvasRef.current
    const img = imageRef.current
    if (!canvas || !img) return false

    const face = await getCachedOrDetectFace()
    if (!face) return false

    const { cropX, cropY, cropW, cropH } = getCropRect(canvas)
    const targetEyeY = cropY + cropH * 0.38
    const targetFaceX = cropX + cropW * 0.5

    // Empirical eye location inside face box: ~43% from top.
    const eyeYInImage = face.y + face.height * 0.43
    const faceXInImage = face.x + face.width * 0.5

    const state = cropStateRef.current
    const currentEyeY = state.imgY + eyeYInImage * state.scale
    const currentFaceX = state.imgX + faceXInImage * state.scale

    state.imgY += targetEyeY - currentEyeY
    state.imgX += targetFaceX - currentFaceX

    clamp(canvas)
    draw()
    notifyCrop()
    return true
  }

  /** Notify parent with the current crop content. */
  const notifyCrop = () => {
    const cropped = getCroppedCanvasInternal()
    if (cropped) onCropUpdateRef.current?.(cropped)
  }

  /** Extract the crop area to an off-screen canvas at native image resolution. */
  const getCroppedCanvasInternal = (): HTMLCanvasElement | null => {
    const canvas = canvasRef.current
    const img = imageRef.current
    if (!canvas || !img) return null
    const { imgX, imgY, scale } = cropStateRef.current
    const { cropX, cropY, cropW, cropH } = getCropRect(canvas)

    // Map crop rect (canvas coords) → image coords
    const srcX = (cropX - imgX) / scale
    const srcY = (cropY - imgY) / scale
    const srcW = cropW / scale
    const srcH = cropH / scale

    const out = document.createElement('canvas')
    out.width = Math.round(srcW)
    out.height = Math.round(srcH)
    out.getContext('2d')!.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, out.width, out.height)
    return out
  }

  // ─── Initial setup when image or preset changes ──────────────────────────────

  const doReset = () => {
    const canvas = canvasRef.current
    const img = imageRef.current
    if (!canvas || !img) return

    const { cropX, cropY, cropW, cropH } = getCropRect(canvas)
    const ar = docPresetRef.current.widthMm / docPresetRef.current.heightMm
    const imgAr = img.naturalWidth / img.naturalHeight

    // Fit so the image fills the crop area
    const scale = imgAr > ar ? cropH / img.naturalHeight : cropW / img.naturalWidth
    const scaledW = img.naturalWidth * scale
    const scaledH = img.naturalHeight * scale

    cropStateRef.current = {
      scale,
      imgX: cropX + (cropW - scaledW) / 2,
      imgY: cropY + (cropH - scaledH) / 2,
    }
    detectedFaceRef.current = null
    detectedForImageRef.current = null
    draw()
    requestAnimationFrame(notifyCrop)
  }

  useEffect(() => {
    if (image) doReset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, docPreset.id, docPreset.widthMm, docPreset.heightMm])

  // Redraw when silhouette is toggled (draw uses refs only — no stale closure)
  useEffect(() => {
    if (image && canvasRef.current) draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSilhouette])

  // ─── Event handlers (attached once — use refs for mutable state) ─────────────

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const onMouseDown = (e: MouseEvent) => {
      dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY }
      canvas.style.cursor = 'grabbing'
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current.active || !imageRef.current) return
      const dx = e.clientX - dragRef.current.lastX
      const dy = e.clientY - dragRef.current.lastY
      cropStateRef.current.imgX += dx
      cropStateRef.current.imgY += dy
      dragRef.current.lastX = e.clientX
      dragRef.current.lastY = e.clientY
      clamp(canvas)
      draw()
    }

    const onMouseUp = () => {
      if (dragRef.current.active && imageRef.current) notifyCrop()
      dragRef.current.active = false
      canvas.style.cursor = 'grab'
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const img = imageRef.current
      if (!img) return
      const { scale, imgX, imgY } = cropStateRef.current
      const { cropX, cropY, cropW, cropH } = getCropRect(canvas)
      const minScale = Math.max(cropW / img.naturalWidth, cropH / img.naturalHeight)
      const factor = e.deltaY < 0 ? 1.08 : 0.93
      const newScale = Math.max(minScale, scale * factor)
      // Zoom towards crop centre
      const cx = cropX + cropW / 2
      const cy = cropY + cropH / 2
      cropStateRef.current.imgX = cx - (cx - imgX) * (newScale / scale)
      cropStateRef.current.imgY = cy - (cy - imgY) * (newScale / scale)
      cropStateRef.current.scale = newScale
      clamp(canvas)
      draw()
      // Debounced notify after wheel settles
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current)
      wheelTimerRef.current = setTimeout(notifyCrop, 250)
    }

    canvas.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, []) // empty — all mutable state is via refs

  return {
    canvasRef: canvasRef as React.RefObject<HTMLCanvasElement>,
    getCroppedCanvas: getCroppedCanvasInternal,
    resetCrop: doReset,
    autoAlignToGuide,
  }
}

function resizeImageForDetection(img: HTMLImageElement, maxSide: number): HTMLCanvasElement {
  const srcW = img.naturalWidth
  const srcH = img.naturalHeight
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH))
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))

  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  return out
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality = 1): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Cannot convert canvas to blob'))
        return
      }
      resolve(blob)
    }, mimeType, quality)
  })
}
