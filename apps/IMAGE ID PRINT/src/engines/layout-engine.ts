import type { DocumentPreset, SheetPreset, LayoutResult } from '../types'
import { mmToPx } from '../lib/utils'

/** Margin on each side of the sheet (mm). 3 mm is standard for photo lab prints. */
const MARGIN_MM = 3
/** Gap between photos (mm). 1 mm — photos are cut apart after printing. */
const SPACING_MM = 1

/**
 * Try one specific combination of sheet orientation and photo rotation.
 * Returns the LayoutResult for that combination.
 */
function tryLayout(
  sheetW: number,
  sheetH: number,
  photoW: number,
  photoH: number,
  marginPx: number,
  spacingPx: number,
  photoRotated: boolean,
): LayoutResult {
  const usableW = sheetW - 2 * marginPx
  const usableH = sheetH - 2 * marginPx

  const cols = Math.max(0, Math.floor((usableW + spacingPx) / (photoW + spacingPx)))
  const rows = Math.max(0, Math.floor((usableH + spacingPx) / (photoH + spacingPx)))
  const total = cols * rows

  const positions: Array<{ x: number; y: number }> = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      positions.push({
        x: marginPx + c * (photoW + spacingPx),
        y: marginPx + r * (photoH + spacingPx),
      })
    }
  }

  return {
    cols,
    rows,
    total,
    photoWidthPx: photoW,
    photoHeightPx: photoH,
    sheetWidthPx: sheetW,
    sheetHeightPx: sheetH,
    marginPx,
    spacingPx,
    positions,
    photoRotated,
  }
}

/**
 * Pure function — no UI, no side effects.
 * Tries all 4 combinations of sheet orientation (portrait/landscape) ×
 * photo rotation (normal/rotated 90°) and returns the one that fits
 * the most copies.
 *
 * Formula: pixel = (mm / 25.4) * dpi
 */
export function calculateLayout(
  doc: DocumentPreset,
  sheet: SheetPreset,
  dpi: number = 300,
): LayoutResult {
  const photoW = mmToPx(doc.widthMm, dpi)
  const photoH = mmToPx(doc.heightMm, dpi)
  const sheetWp = mmToPx(sheet.widthMm, dpi)   // portrait
  const sheetHp = mmToPx(sheet.heightMm, dpi)  // portrait
  const marginPx = mmToPx(MARGIN_MM, dpi)
  const spacingPx = mmToPx(SPACING_MM, dpi)

  // 4 candidates:
  // 1. Sheet portrait  + photo normal
  // 2. Sheet portrait  + photo rotated 90°
  // 3. Sheet landscape + photo normal
  // 4. Sheet landscape + photo rotated 90°
  const candidates: LayoutResult[] = [
    tryLayout(sheetWp, sheetHp, photoW,  photoH,  marginPx, spacingPx, false),
    tryLayout(sheetWp, sheetHp, photoH,  photoW,  marginPx, spacingPx, true),
    tryLayout(sheetHp, sheetWp, photoW,  photoH,  marginPx, spacingPx, false),
    tryLayout(sheetHp, sheetWp, photoH,  photoW,  marginPx, spacingPx, true),
  ]

  // Pick the combination with the most copies (ties favour portrait, i.e. lower index)
  return candidates.reduce((best, cur) => (cur.total > best.total ? cur : best))
}
