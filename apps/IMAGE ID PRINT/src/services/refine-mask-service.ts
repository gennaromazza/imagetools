export type RefineMode = 'keep' | 'remove'

export interface RefinePoint {
  x: number
  y: number
}

export function cloneCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = source.width
  out.height = source.height
  out.getContext('2d')!.drawImage(source, 0, 0)
  return out
}

export function paintRefineLine(
  workingCanvas: HTMLCanvasElement,
  guideCanvas: HTMLCanvasElement,
  restoreCanvas: HTMLCanvasElement,
  from: RefinePoint,
  to: RefinePoint,
  brushRadius: number,
  mode: RefineMode,
  hardness = 0.72,
  strength = 1,
): void {
  const ctx = workingCanvas.getContext('2d')
  const guideCtx = guideCanvas.getContext('2d')
  const restoreCtx = restoreCanvas.getContext('2d')
  if (!ctx || !guideCtx || !restoreCtx) return

  const working = ctx.getImageData(0, 0, workingCanvas.width, workingCanvas.height)
  const guide = guideCtx.getImageData(0, 0, guideCanvas.width, guideCanvas.height)
  const restore = restoreCtx.getImageData(0, 0, restoreCanvas.width, restoreCanvas.height)
  const workingData = working.data
  const guideData = guide.data
  const restoreData = restore.data

  const dx = to.x - from.x
  const dy = to.y - from.y
  const distance = Math.max(1, Math.hypot(dx, dy))
  const step = Math.max(1.5, brushRadius * 0.28)
  const steps = Math.max(1, Math.ceil(distance / step))

  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = from.x + dx * t
    const y = from.y + dy * t
    paintRefineStamp(
      workingData,
      guideData,
      restoreData,
      workingCanvas.width,
      workingCanvas.height,
      x,
      y,
      brushRadius,
      mode,
      hardness,
      strength,
    )
  }

  ctx.putImageData(working, 0, 0)
}

export function paintRefineStamp(
  workingData: Uint8ClampedArray,
  guideData: Uint8ClampedArray,
  restoreData: Uint8ClampedArray,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  brushRadius: number,
  mode: RefineMode,
  hardness = 0.72,
  strength = 1,
): void {
  const radius = Math.max(1, brushRadius)
  const minX = Math.max(0, Math.floor(centerX - radius))
  const maxX = Math.min(width - 1, Math.ceil(centerX + radius))
  const minY = Math.max(0, Math.floor(centerY - radius))
  const maxY = Math.min(height - 1, Math.ceil(centerY + radius))
  const amount = Math.max(0.01, Math.min(1, strength))
  const invRadius = 1 / radius
  const hard = Math.max(0, Math.min(1, hardness))
  const edgeExponent = 0.9 + (1 - hard) * 2.8
  const centerBias = 0.55 + hard * 0.45

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - centerX
      const dy = y - centerY
      const dist = Math.hypot(dx, dy)
      if (dist > radius) continue

      const falloff = Math.max(0, 1 - dist * invRadius)
      const edgeSoftness = Math.pow(falloff, edgeExponent)
      const blend = edgeSoftness * amount * centerBias
      const idx = (y * width + x) * 4
      const currentAlpha = workingData[idx + 3] / 255

      if (mode === 'remove') {
        const alphaBias = 0.45 + currentAlpha * 0.55
        const nextAlpha = workingData[idx + 3] * (1 - blend * alphaBias)
        workingData[idx + 3] = clampByte(nextAlpha)
      } else {
        const guideAlpha = guideData[idx + 3] / 255
        const nearbyAlpha = sampleNearbyAlpha(workingData, width, height, x, y, 2)
        const nearbyGuide = sampleNearbyAlpha(guideData, width, height, x, y, 2)
        const edgeStrength = estimateEdgeStrength(restoreData, width, height, x, y)
        const subjectTone = estimateSubjectTone(restoreData, idx)
        const localSubjectHint = Math.max(
          guideAlpha * 0.95,
          nearbyGuide * 0.9,
          nearbyAlpha * 0.88,
        )
        const visualDetailHint = Math.max(
          edgeStrength * 0.72,
          subjectTone * 0.4,
        )

        // Keep mode should behave like a real manual restore tool.
        // We still bias toward likely subject pixels, but the brush must
        // visibly bring back the original crop even when the initial AI
        // matte removed too much.
        const restoreIntent = Math.max(
          localSubjectHint,
          visualDetailHint,
          0.62,
        )
        const alphaTarget = Math.max(
          currentAlpha,
          Math.min(1, 0.7 + restoreIntent * 0.3),
        )
        const alphaBlend = blend * (0.82 + (1 - currentAlpha) * 0.4)
        const rgbBlend = blend * (0.78 + restoreIntent * 0.22)

        workingData[idx] = lerpByte(workingData[idx], restoreData[idx], rgbBlend)
        workingData[idx + 1] = lerpByte(workingData[idx + 1], restoreData[idx + 1], rgbBlend)
        workingData[idx + 2] = lerpByte(workingData[idx + 2], restoreData[idx + 2], rgbBlend)
        workingData[idx + 3] = lerpByte(workingData[idx + 3], alphaTarget * 255, alphaBlend)
      }

      if (workingData[idx + 3] < 4) {
        workingData[idx + 3] = 0
      }
    }
  }
}

export function drawCheckerboard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cellSize = 18,
): void {
  ctx.clearRect(0, 0, width, height)

  for (let y = 0; y < height; y += cellSize) {
    for (let x = 0; x < width; x += cellSize) {
      const isDark = ((x / cellSize) + (y / cellSize)) % 2 === 0
      ctx.fillStyle = isDark ? '#ece6de' : '#f8f5ef'
      ctx.fillRect(x, y, cellSize, cellSize)
    }
  }
}

function sampleNearbyAlpha(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
): number {
  let best = 0
  for (let yy = Math.max(0, y - radius); yy <= Math.min(height - 1, y + radius); yy++) {
    for (let xx = Math.max(0, x - radius); xx <= Math.min(width - 1, x + radius); xx++) {
      const idx = (yy * width + xx) * 4 + 3
      best = Math.max(best, data[idx] / 255)
    }
  }
  return best
}

function estimateEdgeStrength(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const left = getLuma(data, width, height, x - 1, y)
  const right = getLuma(data, width, height, x + 1, y)
  const top = getLuma(data, width, height, x, y - 1)
  const bottom = getLuma(data, width, height, x, y + 1)
  const gradient = Math.abs(right - left) + Math.abs(bottom - top)
  return Math.max(0, Math.min(1, gradient / 180))
}

function estimateSubjectTone(data: Uint8ClampedArray, idx: number): number {
  const r = data[idx]
  const g = data[idx + 1]
  const b = data[idx + 2]
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return Math.max(0, 1 - Math.pow(luma, 1.8))
}

function getLuma(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const clampedX = Math.max(0, Math.min(width - 1, x))
  const clampedY = Math.max(0, Math.min(height - 1, y))
  const idx = (clampedY * width + clampedX) * 4
  return 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
}

function lerpByte(a: number, b: number, t: number): number {
  return clampByte(a + (b - a) * Math.max(0, Math.min(1, t)))
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)))
}
