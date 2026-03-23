export function expandCanvasWhite(
  source: HTMLCanvasElement,
  paddingX: number,
  paddingY: number,
): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = source.width + Math.max(0, Math.round(paddingX)) * 2
  out.height = source.height + Math.max(0, Math.round(paddingY)) * 2

  const ctx = out.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(
    source,
    Math.max(0, Math.round(paddingX)),
    Math.max(0, Math.round(paddingY)),
  )

  return out
}
