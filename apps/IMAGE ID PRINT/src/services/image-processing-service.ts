import type { DocumentPreset } from '../types'
import { getAiUnavailableMessage, getRembgEndpoint, hasDesktopBridge } from '../lib/desktop-runtime'
import { isRembgAvailable, removeBackgroundWithLocalService } from './background-removal-service'
import { expandCanvasWhite } from './canvas-expand-service'
import { tryGenerativeRefillEdges } from './generative-refill-service'
import { upscaleCanvas2x } from './upscale-service'

interface FaceBox {
  x: number
  y: number
  width: number
  height: number
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

export interface AiProcessingOptions {
  removeBackground: boolean
  applyWhiteBackground: boolean
  autoFitToDocument: boolean
  autoFitRatioThreshold: number
  expandWhiteCanvas: boolean
  backgroundRefine: number
  generativeRefillEdges: boolean
  upscale2x: boolean
  enhancePortrait: boolean
  toneWarmth: number
  skinSmoothing: number
  blemishReduction: number
  feminineSoftening: boolean
  faceSlimming: number
  noseRefinement: number
  edgeSoftness: number
  expandPaddingPx: number
  refillIntensity: number
}

export interface AiRefinePayload {
  editableCanvas: HTMLCanvasElement
  restoreCanvas: HTMLCanvasElement
  applyWhiteBackground: boolean
  edgeSoftness: number
}

export interface AiProcessingResult {
  canvas: HTMLCanvasElement
  warnings: string[]
  refinePayload: AiRefinePayload | null
}

export function defaultAiOptions(): AiProcessingOptions {
  return {
    removeBackground: true,
    applyWhiteBackground: true,
    autoFitToDocument: true,
    autoFitRatioThreshold: 0.16,
    expandWhiteCanvas: false,
    backgroundRefine: 0.35,
    generativeRefillEdges: false,
    upscale2x: false,
    enhancePortrait: false,
    toneWarmth: 0.2,
    skinSmoothing: 0.2,
    blemishReduction: 0.15,
    feminineSoftening: false,
    faceSlimming: 0.1,
    noseRefinement: 0.08,
    edgeSoftness: 0.5,
    expandPaddingPx: 40,
    refillIntensity: 0.25,
  }
}

export function inferAiOptionsForSource(
  source: HTMLImageElement | HTMLCanvasElement | null,
  preset: DocumentPreset,
  dpi: number,
): AiProcessingOptions {
  const inferred = defaultAiOptions()
  if (!source) return inferred

  const width = source instanceof HTMLCanvasElement ? source.width : source.naturalWidth
  const height = source instanceof HTMLCanvasElement ? source.height : source.naturalHeight

  const targetRatio = preset.widthMm / preset.heightMm
  const sourceRatio = width / height
  const ratioDiff = Math.abs(sourceRatio - targetRatio)

  inferred.autoFitToDocument = true
  inferred.autoFitRatioThreshold = ratioDiff > 0.35 ? 0.12 : 0.16
  inferred.expandWhiteCanvas = ratioDiff > 0.25
  inferred.backgroundRefine = 0.45
  inferred.expandPaddingPx = ratioDiff > 0.45 ? 70 : ratioDiff > 0.25 ? 50 : 40
  inferred.upscale2x = width < 900 || height < 900
  inferred.enhancePortrait = true
  inferred.edgeSoftness = dpi >= 600 ? 0.35 : 0.5
  inferred.generativeRefillEdges = false

  return inferred
}

export function suggestAiActions(
  source: HTMLImageElement | HTMLCanvasElement | null,
  preset: DocumentPreset,
  dpi: number,
): string[] {
  const suggestions: string[] = []
  suggestions.push('Rimuovi sfondo per uno sfondo bianco uniforme')

  if (!source) return suggestions

  const width = source instanceof HTMLCanvasElement ? source.width : source.naturalWidth
  const height = source instanceof HTMLCanvasElement ? source.height : source.naturalHeight

  if (width < 900 || height < 900) {
    suggestions.push('Immagine piccola: Upscale 2x migliora la nitidezza in stampa')
  } else if (width >= 900 && width < 1200) {
    suggestions.push(`Risoluzione sufficiente per ${dpi} DPI, Upscale 2x opzionale`)
  }

  const targetRatio = preset.widthMm / preset.heightMm
  const sourceRatio = width / height
  if (Math.abs(sourceRatio - targetRatio) > 0.35) {
    suggestions.push('Proporzioni diverse dal formato scelto: Espandi sfondo con bianco')
  }

  return suggestions
}

export async function processCanvasWithAi(
  sourceCanvas: HTMLCanvasElement,
  options: AiProcessingOptions,
  preset?: DocumentPreset,
): Promise<AiProcessingResult> {
  let subjectCanvas = cloneCanvas(sourceCanvas)
  let restoreCanvas = cloneCanvas(sourceCanvas)
  const warnings: string[] = []

  if (options.removeBackground) {
    const available = await isRembgAvailable()
    if (!available) {
      warnings.push(getAiUnavailableMessage(hasDesktopBridge()))
    } else {
      try {
        const originalW = subjectCanvas.width
        const originalH = subjectCanvas.height
        const scaled = resizeCanvasToMax(subjectCanvas, 1500)
        const blob = await canvasToBlob(scaled, 'image/jpeg', 0.9)
        const removedBlob = await removeBackgroundWithLocalService(blob, 20000, {
          backgroundRefine: options.backgroundRefine,
        })
        const removedImg = await blobToImage(removedBlob)
        subjectCanvas = scaleCanvas(imageToCanvas(removedImg), originalW, originalH)
      } catch (err) {
        warnings.push(
          `Rimozione sfondo fallita: ${err instanceof Error ? err.message : 'errore sconosciuto'}.`,
        )
      }
    }
  }

  const shouldAutoFit =
    !!preset
    && options.autoFitToDocument
    && getDocumentRatioDiff(subjectCanvas, preset) >= options.autoFitRatioThreshold

  if (options.expandWhiteCanvas || shouldAutoFit) {
    if (preset) {
      const detectedFace = await detectFaceWithSidecar(restoreCanvas)
      const fitted = fitSubjectAndRestoreForDocument(subjectCanvas, restoreCanvas, preset, options.expandPaddingPx, {
        face: detectedFace,
      })
      subjectCanvas = fitted.subjectCanvas
      restoreCanvas = fitted.restoreCanvas
    } else {
      subjectCanvas = expandCanvasTransparent(subjectCanvas, options.expandPaddingPx, options.expandPaddingPx)
      restoreCanvas = expandCanvasWhite(restoreCanvas, options.expandPaddingPx, options.expandPaddingPx)
    }
  }

  if (options.generativeRefillEdges) {
    try {
      subjectCanvas = await tryGenerativeRefillEdges(subjectCanvas, options.refillIntensity)
    } catch {
      warnings.push('Refill generativo non configurato: uso espansione bianca standard.')
    }
  }

  if (options.enhancePortrait) {
    const faceForEnhancement = await detectFaceWithSidecar(restoreCanvas)
    restoreCanvas = applyPortraitEnhancement(restoreCanvas, options, faceForEnhancement)
    subjectCanvas = applyPortraitEnhancement(subjectCanvas, options, faceForEnhancement)
    if (!faceForEnhancement && (options.faceSlimming > 0.02 || options.noseRefinement > 0.02)) {
      warnings.push('Rimodellamento viso/naso limitato: volto non rilevato con sicurezza.')
    }
  }

  if (options.upscale2x) {
    restoreCanvas = upscaleCanvas2x(restoreCanvas)
    subjectCanvas = upscaleCanvas2x(subjectCanvas)
  }

  return {
    canvas: composeAiOutputCanvas(subjectCanvas, options.applyWhiteBackground, options.edgeSoftness),
    warnings,
    refinePayload: {
      editableCanvas: cloneCanvas(subjectCanvas),
      restoreCanvas: cloneCanvas(restoreCanvas),
      applyWhiteBackground: options.applyWhiteBackground,
      edgeSoftness: options.edgeSoftness,
    },
  }
}

function cloneCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = source.width
  out.height = source.height
  out.getContext('2d')!.drawImage(source, 0, 0)
  return out
}

function imageToCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  canvas.getContext('2d')!.drawImage(img, 0, 0)
  return canvas
}

function applyUniformWhiteBackground(source: HTMLCanvasElement, edgeSoftness: number): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = source.width
  out.height = source.height
  const ctx = out.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, out.width, out.height)

  if (edgeSoftness > 0.01) {
    const feathered = document.createElement('canvas')
    feathered.width = source.width
    feathered.height = source.height
    const featherCtx = feathered.getContext('2d')!
    const blurRadius = Math.max(0.6, Math.min(6, edgeSoftness * 6))
    featherCtx.filter = `blur(${blurRadius.toFixed(2)}px)`
    featherCtx.drawImage(source, 0, 0)
    featherCtx.filter = 'none'
    ctx.drawImage(feathered, 0, 0)
  }

  ctx.drawImage(source, 0, 0)
  return out
}

export function composeAiOutputCanvas(
  subjectCanvas: HTMLCanvasElement,
  applyWhiteBackground: boolean,
  edgeSoftness: number,
): HTMLCanvasElement {
  return applyWhiteBackground
    ? applyUniformWhiteBackground(subjectCanvas, edgeSoftness)
    : cloneCanvas(subjectCanvas)
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality = 1.0): Promise<Blob> {
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

function resizeCanvasToMax(source: HTMLCanvasElement, maxSide: number): HTMLCanvasElement {
  const { width, height } = source
  if (width <= maxSide && height <= maxSide) return source
  const scale = maxSide / Math.max(width, height)
  return scaleCanvas(source, Math.round(width * scale), Math.round(height * scale))
}

function scaleCanvas(source: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, w, h)
  return out
}

function expandCanvasTransparent(
  source: HTMLCanvasElement,
  paddingX: number,
  paddingY: number,
): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = source.width + Math.max(0, Math.round(paddingX)) * 2
  out.height = source.height + Math.max(0, Math.round(paddingY)) * 2
  const ctx = out.getContext('2d')!
  ctx.clearRect(0, 0, out.width, out.height)
  ctx.drawImage(source, Math.max(0, Math.round(paddingX)), Math.max(0, Math.round(paddingY)))
  return out
}

function fitSubjectAndRestoreForDocument(
  subjectSource: HTMLCanvasElement,
  restoreSource: HTMLCanvasElement,
  preset: DocumentPreset,
  paddingPx: number,
  options?: {
    face?: FaceBox | null
  },
): {
  subjectCanvas: HTMLCanvasElement
  restoreCanvas: HTMLCanvasElement
} {
  const targetRatio = preset.widthMm / preset.heightMm
  const srcW = subjectSource.width
  const srcH = subjectSource.height

  let outW = srcW
  let outH = srcH
  const srcRatio = srcW / srcH
  if (srcRatio > targetRatio) {
    outH = Math.max(srcH, Math.ceil(srcW / targetRatio))
  } else {
    outW = Math.max(srcW, Math.ceil(srcH * targetRatio))
  }

  const needsExpansion = outW !== srcW || outH !== srcH
  if (needsExpansion && paddingPx > 0) {
    outW += paddingPx * 2
    outH += paddingPx * 2
  }

  const bounds = getOpaqueBounds(subjectSource)
  const face = options?.face
  const subjectCx = face ? face.x + face.width * 0.5 : (bounds ? (bounds.left + bounds.right) / 2 : srcW / 2)
  const subjectCy = face ? face.y + face.height * 0.43 : (bounds ? (bounds.top + bounds.bottom) / 2 : srcH / 2)
  const targetEyeY = outH * 0.38

  let offsetX = Math.round(outW / 2 - subjectCx)
  let offsetY = face
    ? Math.round(targetEyeY - subjectCy)
    : Math.round(outH / 2 - subjectCy)

  offsetX = clamp(offsetX, outW - srcW, 0)
  offsetY = clamp(offsetY, outH - srcH, 0)

  const subjectCanvas = document.createElement('canvas')
  subjectCanvas.width = outW
  subjectCanvas.height = outH
  subjectCanvas.getContext('2d')!.drawImage(subjectSource, offsetX, offsetY)

  const restoreCanvas = document.createElement('canvas')
  restoreCanvas.width = outW
  restoreCanvas.height = outH
  const restoreCtx = restoreCanvas.getContext('2d')!
  drawExtendedBackdrop(restoreCtx, restoreSource, outW, outH, offsetX, offsetY, srcW, srcH)
  restoreCtx.drawImage(restoreSource, offsetX, offsetY)

  return { subjectCanvas, restoreCanvas }
}

function drawExtendedBackdrop(
  ctx: CanvasRenderingContext2D,
  backdrop: HTMLCanvasElement,
  outW: number,
  outH: number,
  offsetX: number,
  offsetY: number,
  srcW: number,
  srcH: number,
): void {
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, outW, outH)

  ctx.drawImage(backdrop, offsetX, offsetY, srcW, srcH)

  if (offsetX > 0) {
    ctx.drawImage(backdrop, 0, 0, 1, srcH, 0, offsetY, offsetX, srcH)
  }
  const rightGap = outW - (offsetX + srcW)
  if (rightGap > 0) {
    ctx.drawImage(backdrop, srcW - 1, 0, 1, srcH, offsetX + srcW, offsetY, rightGap, srcH)
  }

  if (offsetY > 0) {
    ctx.drawImage(backdrop, 0, 0, srcW, 1, offsetX, 0, srcW, offsetY)
  }
  const bottomGap = outH - (offsetY + srcH)
  if (bottomGap > 0) {
    ctx.drawImage(backdrop, 0, srcH - 1, srcW, 1, offsetX, offsetY + srcH, srcW, bottomGap)
  }

  if (offsetX > 0 && offsetY > 0) {
    ctx.drawImage(backdrop, 0, 0, 1, 1, 0, 0, offsetX, offsetY)
  }
  if (rightGap > 0 && offsetY > 0) {
    ctx.drawImage(backdrop, srcW - 1, 0, 1, 1, offsetX + srcW, 0, rightGap, offsetY)
  }
  if (offsetX > 0 && bottomGap > 0) {
    ctx.drawImage(backdrop, 0, srcH - 1, 1, 1, 0, offsetY + srcH, offsetX, bottomGap)
  }
  if (rightGap > 0 && bottomGap > 0) {
    ctx.drawImage(backdrop, srcW - 1, srcH - 1, 1, 1, offsetX + srcW, offsetY + srcH, rightGap, bottomGap)
  }
}

async function detectFaceWithSidecar(source: HTMLCanvasElement): Promise<FaceBox | null> {
  try {
    const FACE_DETECT_ENDPOINT = getRembgEndpoint('/detect-face')
    const send = resizeCanvasToMax(source, 1800)
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
      x: payload.face.xNorm * source.width,
      y: payload.face.yNorm * source.height,
      width: payload.face.wNorm * source.width,
      height: payload.face.hNorm * source.height,
    }
  } catch {
    return null
  }
}

function applyPortraitEnhancement(
  source: HTMLCanvasElement,
  options: AiProcessingOptions,
  face: FaceBox | null,
): HTMLCanvasElement {
  let working = cloneCanvas(source)

  if (options.toneWarmth > 0.01) {
    working = applyWarmTone(working, options.toneWarmth)
  }

  const baseSmoothing = Math.max(options.skinSmoothing, options.blemishReduction)
  if (baseSmoothing > 0.01 || options.feminineSoftening) {
    const boost = options.feminineSoftening ? 0.12 : 0
    working = softenImage(working, Math.min(1, baseSmoothing + boost))
  }

  if (face) {
    if (options.faceSlimming > 0.01) {
      working = pinchHorizontal(
        working,
        face.x + face.width * 0.5,
        face.y + face.height * 0.58,
        face.width * 0.55,
        face.height * 0.75,
        Math.min(0.35, options.faceSlimming * 0.55),
      )
    }
    if (options.noseRefinement > 0.01) {
      working = pinchHorizontal(
        working,
        face.x + face.width * 0.5,
        face.y + face.height * 0.58,
        face.width * 0.19,
        face.height * 0.22,
        Math.min(0.28, options.noseRefinement * 0.7),
      )
    }
  }

  return working
}

function applyWarmTone(source: HTMLCanvasElement, amount: number): HTMLCanvasElement {
  const out = cloneCanvas(source)
  const ctx = out.getContext('2d')!
  const img = ctx.getImageData(0, 0, out.width, out.height)
  const d = img.data

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i]
    const g = d[i + 1]
    const b = d[i + 2]
    const lum = 0.299 * r + 0.587 * g + 0.114 * b

    const warmR = r + 26 * amount
    const warmG = g + 6 * amount
    const coolB = b - 16 * amount

    d[i] = clamp255(lum + (warmR - lum) * (1 + 0.15 * amount))
    d[i + 1] = clamp255(lum + (warmG - lum) * (1 + 0.06 * amount))
    d[i + 2] = clamp255(lum + (coolB - lum) * (1 + 0.08 * amount))
  }
  ctx.putImageData(img, 0, 0)
  return out
}

function softenImage(source: HTMLCanvasElement, amount: number): HTMLCanvasElement {
  const radius = 0.8 + amount * 2.6
  const blend = 0.08 + amount * 0.28

  const blurred = document.createElement('canvas')
  blurred.width = source.width
  blurred.height = source.height
  const bctx = blurred.getContext('2d')!
  bctx.filter = `blur(${radius.toFixed(2)}px)`
  bctx.drawImage(source, 0, 0)
  bctx.filter = 'none'

  const out = cloneCanvas(source)
  const octx = out.getContext('2d')!
  octx.save()
  octx.globalAlpha = blend
  octx.drawImage(blurred, 0, 0)
  octx.restore()
  return out
}

function pinchHorizontal(
  source: HTMLCanvasElement,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  strength: number,
): HTMLCanvasElement {
  const out = cloneCanvas(source)
  const ctx = out.getContext('2d')!
  const srcImg = ctx.getImageData(0, 0, out.width, out.height)
  const dstImg = ctx.getImageData(0, 0, out.width, out.height)
  const src = srcImg.data
  const dst = dstImg.data

  const x0 = Math.max(0, Math.floor(cx - rx - 2))
  const x1 = Math.min(out.width - 1, Math.ceil(cx + rx + 2))
  const y0 = Math.max(0, Math.floor(cy - ry - 2))
  const y1 = Math.min(out.height - 1, Math.ceil(cy + ry + 2))

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const nx = (x - cx) / rx
      const ny = (y - cy) / ry
      const r2 = nx * nx + ny * ny
      if (r2 >= 1) continue

      const local = 1 - r2
      const factor = Math.max(0.55, 1 - strength * local)
      const sampleX = cx + (x - cx) / factor
      const sampleY = y

      const [r, g, b, a] = sampleBilinear(src, out.width, out.height, sampleX, sampleY)
      const i = (y * out.width + x) * 4
      dst[i] = r
      dst[i + 1] = g
      dst[i + 2] = b
      dst[i + 3] = a
    }
  }

  ctx.putImageData(dstImg, 0, 0)
  return out
}

function sampleBilinear(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const x0 = clamp(Math.floor(x), 0, width - 1)
  const y0 = clamp(Math.floor(y), 0, height - 1)
  const x1 = clamp(x0 + 1, 0, width - 1)
  const y1 = clamp(y0 + 1, 0, height - 1)
  const tx = Math.max(0, Math.min(1, x - x0))
  const ty = Math.max(0, Math.min(1, y - y0))

  const c00 = getPixel(data, width, x0, y0)
  const c10 = getPixel(data, width, x1, y0)
  const c01 = getPixel(data, width, x0, y1)
  const c11 = getPixel(data, width, x1, y1)

  return [
    lerp(lerp(c00[0], c10[0], tx), lerp(c01[0], c11[0], tx), ty),
    lerp(lerp(c00[1], c10[1], tx), lerp(c01[1], c11[1], tx), ty),
    lerp(lerp(c00[2], c10[2], tx), lerp(c01[2], c11[2], tx), ty),
    lerp(lerp(c00[3], c10[3], tx), lerp(c01[3], c11[3], tx), ty),
  ]
}

function getPixel(data: Uint8ClampedArray, width: number, x: number, y: number): [number, number, number, number] {
  const i = (y * width + x) * 4
  return [data[i], data[i + 1], data[i + 2], data[i + 3]]
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)))
}

function getOpaqueBounds(
  canvas: HTMLCanvasElement,
): { left: number; top: number; right: number; bottom: number } | null {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const { width, height } = canvas
  const data = ctx.getImageData(0, 0, width, height).data

  let left = width
  let right = -1
  let top = height
  let bottom = -1
  const alphaThreshold = 8

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3]
      if (alpha > alphaThreshold) {
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
    }
  }

  if (right < left || bottom < top) return null
  return { left, top, right, bottom }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function getDocumentRatioDiff(source: HTMLCanvasElement, preset: DocumentPreset): number {
  const targetRatio = preset.widthMm / preset.heightMm
  const sourceRatio = source.width / source.height
  return Math.abs(sourceRatio - targetRatio)
}

function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Cannot decode image blob'))
    }
    img.src = url
  })
}
