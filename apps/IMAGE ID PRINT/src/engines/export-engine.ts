import type { LayoutResult, ExportFormat, DocumentPreset, SheetPreset } from '../types'

/**
 * Renders the final print sheet onto a dedicated canvas and triggers download.
 *
 * The cropped source image is drawn ONCE per photo slot — no intermediate scaling.
 * JPG quality is set to 1.0 (maximum); PNG is lossless.
 * For PDF, jsPDF is loaded dynamically to avoid bundling it upfront.
 */
export async function exportSheet(
  croppedCanvas: HTMLCanvasElement,
  layout: LayoutResult,
  format: ExportFormat,
  docPreset: DocumentPreset,
  sheetPreset: SheetPreset,
  dpi: number,
): Promise<void> {
  const sheetW = Math.round(layout.sheetWidthPx)
  const sheetH = Math.round(layout.sheetHeightPx)
  const photoW = Math.round(layout.photoWidthPx)
  const photoH = Math.round(layout.photoHeightPx)

  // Dedicated high-res export canvas — never the preview canvas
  const canvas = document.createElement('canvas')
  canvas.width = sheetW
  canvas.height = sheetH
  const ctx = canvas.getContext('2d')!

  // White background (print-ready)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, sheetW, sheetH)

  // Draw each photo at its exact position.
  // If the layout chose a rotated orientation, rotate the image 90° CW so it
  // fills the (wider-than-tall) slot correctly — single scale per slot.
  for (const pos of layout.positions) {
    const px = Math.round(pos.x)
    const py = Math.round(pos.y)

    if (layout.photoRotated) {
      ctx.save()
      // Translate to the centre of the slot, rotate 90° CW, draw centred
      ctx.translate(px + photoW / 2, py + photoH / 2)
      ctx.rotate(Math.PI / 2)
      // After rotation the image's natural width maps to the slot height and vice-versa
      ctx.drawImage(croppedCanvas, -photoH / 2, -photoW / 2, photoH, photoW)
      ctx.restore()
    } else {
      ctx.drawImage(croppedCanvas, px, py, photoW, photoH)
    }
  }

  const filename = buildFilename(docPreset, sheetPreset, layout.total, dpi, format === 'pdf' ? 'jpg' : format)

  if (format === 'pdf') {
    await exportAsPdf(canvas, sheetPreset, layout.total, docPreset, dpi)
    return
  }

  const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png'
  const quality = format === 'jpg' ? 1.0 : undefined

  await new Promise<void>((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (blob) downloadBlob(blob, filename)
        resolve()
      },
      mimeType,
      quality,
    )
  })
}

function buildFilename(
  doc: DocumentPreset,
  sheet: SheetPreset,
  copies: number,
  dpi: number,
  ext: string,
): string {
  const docPart = `${doc.id}_${doc.widthMm}x${doc.heightMm}`
  const sheetPart = `${sheet.widthMm}x${sheet.heightMm}`
  return `${docPart}_${sheetPart}_${copies}copie_${dpi}dpi.${ext}`
}

async function exportAsPdf(
  canvas: HTMLCanvasElement,
  sheet: SheetPreset,
  copies: number,
  doc: DocumentPreset,
  dpi: number,
): Promise<void> {
  const { jsPDF } = await import('jspdf')

  const widthMm = sheet.widthMm
  const heightMm = sheet.heightMm
  const orientation = widthMm >= heightMm ? 'l' : 'p'

  const pdf = new jsPDF({
    orientation,
    unit: 'mm',
    format: [widthMm, heightMm],
    compress: false, // no lossy compression
  })

  // Embed the sheet image at exact physical dimensions — no automatic scaling
  const dataUrl = canvas.toDataURL('image/jpeg', 1.0)
  pdf.addImage(dataUrl, 'JPEG', 0, 0, widthMm, heightMm, undefined, 'NONE')

  const filename = buildFilename(doc, sheet, copies, dpi, 'pdf')
  pdf.save(filename)
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
