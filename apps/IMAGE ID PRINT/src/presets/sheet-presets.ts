import type { SheetPreset } from '../types'

export const SHEET_PRESETS: SheetPreset[] = [
  { id: '10x15', label: '10×15 cm', widthMm: 100, heightMm: 150 },
  { id: '13x18', label: '13×18 cm', widthMm: 130, heightMm: 180 },
  { id: 'a4', label: 'A4 (21×29.7 cm)', widthMm: 210, heightMm: 297 },
]

export const DEFAULT_SHEET_PRESET = SHEET_PRESETS[0]
