export interface DocumentSpec {
  /** Required background */
  background: string
  /** Min head height crown-to-chin in mm (ICAO) */
  headHeightMinMm: number
  /** Max head height crown-to-chin in mm */
  headHeightMaxMm: number
  /** Max distance from image top to crown of head in mm */
  crownToTopMaxMm: number
  /** Eye-level description */
  eyeLevel: string
  /** Additional requirements */
  notes: string[]
  /** Official reference */
  reference: string
}

export type DocumentCategory = 'id_card' | 'passport' | 'visa' | 'residence_permit' | 'custom'
export type DocumentBackground = 'white' | 'light' | 'custom'

export interface DocumentPreset {
  id: string
  label: string
  countryCode: string
  countryName: string
  category: DocumentCategory
  name: string
  widthMm: number
  heightMm: number
  aspectRatio: number
  background: DocumentBackground
  notes?: string
  enabled: boolean
  /** Technical specs — defined for all non-custom presets */
  specs?: DocumentSpec
}

export interface SheetPreset {
  id: string
  label: string
  widthMm: number
  heightMm: number
}

export type DpiValue = 150 | 300 | 600

export type ExportFormat = 'jpg' | 'png' | 'pdf'

export interface LayoutResult {
  cols: number
  rows: number
  total: number
  photoWidthPx: number
  photoHeightPx: number
  sheetWidthPx: number
  sheetHeightPx: number
  marginPx: number
  spacingPx: number
  positions: Array<{ x: number; y: number }>
  /** true when the photo is placed rotated 90° to fit more copies */
  photoRotated: boolean
}
