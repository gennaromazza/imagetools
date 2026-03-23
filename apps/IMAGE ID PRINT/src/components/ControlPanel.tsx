import { useMemo, useRef, useState } from 'react'
import { ImagePlus, Download, Loader2, AlertTriangle, ChevronDown } from 'lucide-react'
import { cn } from '../lib/utils'
import type { AiProcessingOptions } from '../services/image-processing-service'
import type {
  DocumentPreset,
  SheetPreset,
  DpiValue,
  ExportFormat,
  LayoutResult,
  DocumentCategory,
} from '../types'
import { DOCUMENT_PRESETS } from '../presets/document-presets'
import { SHEET_PRESETS } from '../presets/sheet-presets'

interface ControlPanelProps {
  imageFile: File | null
  docPreset: DocumentPreset
  customDocSize: { widthMm: number; heightMm: number }
  sheetPreset: SheetPreset
  dpi: DpiValue
  exportFormat: ExportFormat
  layout: LayoutResult | null
  resolutionWarning: string | null
  croppedCanvas: HTMLCanvasElement | null
  aiOptions: AiProcessingOptions
  aiWarnings: string[]
  aiSuggestions: string[]
  isAiProcessing: boolean
  isExporting: boolean
  onImageReplace: (file: File, img: HTMLImageElement) => void
  onDocPresetChange: (preset: DocumentPreset) => void
  onCustomDocSizeChange: (size: { widthMm: number; heightMm: number }) => void
  onSheetPresetChange: (preset: SheetPreset) => void
  onDpiChange: (dpi: DpiValue) => void
  onExportFormatChange: (format: ExportFormat) => void
  onAiOptionsChange: (updater: (prev: AiProcessingOptions) => AiProcessingOptions) => void
  onApplyAi: () => void
  onResetAi: () => void
  onExport: () => void
}

const DPI_OPTIONS: { value: DpiValue; label: string; hint: string }[] = [
  { value: 150, label: '150 DPI', hint: 'Bassa qualità' },
  { value: 300, label: '300 DPI', hint: 'Standard stampa' },
  { value: 600, label: '600 DPI', hint: 'Alta qualità' },
]

const FORMAT_OPTIONS: { value: ExportFormat; label: string }[] = [
  { value: 'jpg', label: 'JPG' },
  { value: 'png', label: 'PNG' },
  { value: 'pdf', label: 'PDF' },
]

type CategoryFilter = 'all' | Exclude<DocumentCategory, 'custom'>

const CATEGORY_FILTERS: Array<{ value: CategoryFilter; label: string }> = [
  { value: 'all', label: 'Tutti' },
  { value: 'id_card', label: 'ID' },
  { value: 'passport', label: 'Passport' },
  { value: 'visa', label: 'Visa' },
  { value: 'residence_permit', label: 'Residence' },
]

const categoryOrder: Record<DocumentCategory, number> = {
  id_card: 0,
  passport: 1,
  visa: 2,
  residence_permit: 3,
  custom: 4,
}

export function ControlPanel({
  imageFile,
  docPreset,
  customDocSize,
  sheetPreset,
  dpi,
  exportFormat,
  layout,
  resolutionWarning,
  croppedCanvas,
  aiOptions,
  aiWarnings,
  aiSuggestions,
  isAiProcessing,
  isExporting,
  onImageReplace,
  onDocPresetChange,
  onCustomDocSizeChange,
  onSheetPresetChange,
  onDpiChange,
  onExportFormatChange,
  onAiOptionsChange,
  onApplyAi,
  onResetAi,
  onExport,
}: ControlPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      onImageReplace(file, img)
    }
    img.src = url
    e.target.value = ''
  }

  const isCustom = docPreset.id === 'custom'
  const canExport = !!croppedCanvas && !!layout && layout.total > 0 && !isExporting
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>('all')
  const [selectedCountry, setSelectedCountry] = useState<string>('ALL')
  const [query, setQuery] = useState('')
  const [showAiAdvanced, setShowAiAdvanced] = useState(false)

  const countries = useMemo(() => {
    const unique = Array.from(new Set(DOCUMENT_PRESETS.filter((p) => p.enabled).map((p) => p.countryCode)))
    unique.sort((a, b) => {
      if (a === 'IT') return -1
      if (b === 'IT') return 1
      const nameA = DOCUMENT_PRESETS.find((p) => p.countryCode === a)?.countryName ?? a
      const nameB = DOCUMENT_PRESETS.find((p) => p.countryCode === b)?.countryName ?? b
      return nameA.localeCompare(nameB, 'it', { sensitivity: 'base' })
    })
    return ['ALL', ...unique]
  }, [])

  const filteredPresets = useMemo(() => {
    const q = query.trim().toLowerCase()
    return DOCUMENT_PRESETS
      .filter((p) => p.enabled)
      .filter((p) => (selectedCategory === 'all' ? true : p.category === selectedCategory))
      .filter((p) => (selectedCountry === 'ALL' ? true : p.countryCode === selectedCountry))
      .filter((p) => {
        if (!q) return true
        return p.name.toLowerCase().includes(q) || p.countryName.toLowerCase().includes(q)
      })
      .sort((a, b) => {
        if (a.countryCode === 'IT' && b.countryCode !== 'IT') return -1
        if (b.countryCode === 'IT' && a.countryCode !== 'IT') return 1

        const countryCmp = a.countryName.localeCompare(b.countryName, 'it', { sensitivity: 'base' })
        if (countryCmp !== 0) return countryCmp

        const catCmp = categoryOrder[a.category] - categoryOrder[b.category]
        if (catCmp !== 0) return catCmp

        return a.name.localeCompare(b.name, 'it', { sensitivity: 'base' })
      })
  }, [query, selectedCategory, selectedCountry])

  const autoSuggestion = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    if (q.includes('usa') || q.includes('us') || q.includes('america')) {
      return DOCUMENT_PRESETS.find((p) => p.id === 'us_visa') ?? null
    }
    return null
  }, [query])

  const autoFitProfileLabel = useMemo(() => {
    const threshold = aiOptions.autoFitRatioThreshold
    if (threshold <= 0.14) return 'Aggressivo'
    if (threshold <= 0.26) return 'Bilanciato'
    return 'Conservativo'
  }, [aiOptions.autoFitRatioThreshold])

  return (
    <aside className="flex flex-col gap-4 min-h-full pr-2">
      {/* ── App identity ── */}
      <div className="shrink-0">
        <h1 className="text-base font-semibold text-[var(--app-text)] leading-tight">
          Image ID Print
        </h1>
        <p className="text-xs text-[var(--app-text-subtle)] mt-0.5">Foto per documenti</p>
      </div>

      <Divider />

      {/* ── Foto ── */}
      <CollapsibleSection label="Foto" defaultOpen>
        {imageFile ? (
          <div className="flex items-center justify-between gap-2">
            <p
              className="text-xs text-[var(--app-text-muted)] truncate flex-1"
              title={imageFile.name}
            >
              {imageFile.name}
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-[var(--app-surface-strong)] hover:bg-[var(--app-border)] text-[var(--app-text-muted)] hover:text-[var(--app-text)] transition-colors"
            >
              <ImagePlus size={13} />
              Cambia
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-[var(--app-border)] text-xs text-[var(--app-text-muted)] hover:border-[var(--brand-primary)] hover:text-[var(--app-text)] transition-colors"
          >
            <ImagePlus size={14} />
            Seleziona foto
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,image/jpeg,image/png"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Resolution warning */}
        {resolutionWarning && (
          <div className="flex items-start gap-2 rounded-lg bg-[var(--danger-soft)] border border-[var(--danger)] px-3 py-2 mt-1">
            <AlertTriangle size={14} className="text-[var(--danger)] mt-0.5 shrink-0" />
            <p className="text-xs text-[var(--danger)] leading-snug">{resolutionWarning}</p>
          </div>
        )}
      </CollapsibleSection>

      <Divider />

      <CollapsibleSection label="Miglioramento immagine" defaultOpen>
        <div className="flex flex-col gap-1.5">
          <ToggleRow
            label="Rimuovi sfondo"
            checked={aiOptions.removeBackground}
            onChange={(checked) => onAiOptionsChange((prev) => ({ ...prev, removeBackground: checked }))}
          />
          <ToggleRow
            label="Applica sfondo bianco"
            checked={aiOptions.applyWhiteBackground}
            onChange={(checked) => onAiOptionsChange((prev) => ({ ...prev, applyWhiteBackground: checked }))}
          />
          <ToggleRow
            label="Adattamento automatico al formato documento"
            checked={aiOptions.autoFitToDocument}
            onChange={(checked) => onAiOptionsChange((prev) => ({ ...prev, autoFitToDocument: checked }))}
          />
          <ToggleRow
            label="Espandi sfondo con bianco"
            checked={aiOptions.expandWhiteCanvas}
            onChange={(checked) => onAiOptionsChange((prev) => ({ ...prev, expandWhiteCanvas: checked }))}
          />
          <ToggleRow
            label="Refill generativo bordi (non disponibile)"
            checked={aiOptions.generativeRefillEdges}
            disabled
            onChange={(checked) => onAiOptionsChange((prev) => ({ ...prev, generativeRefillEdges: checked }))}
          />
          <ToggleRow
            label="Upscale 2x"
            checked={aiOptions.upscale2x}
            onChange={(checked) => onAiOptionsChange((prev) => ({ ...prev, upscale2x: checked }))}
          />
          <ToggleRow
            label="Miglioramento ritratto"
            checked={aiOptions.enhancePortrait}
            onChange={(checked) => onAiOptionsChange((prev) => ({ ...prev, enhancePortrait: checked }))}
          />
        </div>

        <button
          type="button"
          onClick={() => setShowAiAdvanced((v) => !v)}
          className="mt-1 text-[11px] px-2 py-1 rounded border border-[var(--app-border)] bg-[var(--app-field)] text-[var(--app-text-subtle)] hover:text-[var(--app-text)]"
        >
          {showAiAdvanced ? 'Nascondi controlli avanzati' : 'Mostra controlli avanzati'}
        </button>

        <div className="grid grid-cols-1 gap-2 mt-2">
          <NumberInput
            label="Padding espansione (px)"
            value={aiOptions.expandPaddingPx}
            min={0}
            max={500}
            onChange={(v) => onAiOptionsChange((prev) => ({ ...prev, expandPaddingPx: v }))}
          />

          <SliderInput
            label="Morbidezza bordo"
            value={aiOptions.edgeSoftness}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => onAiOptionsChange((prev) => ({ ...prev, edgeSoftness: v }))}
          />

          <SliderInput
            label="Soglia adattamento formato"
            value={aiOptions.autoFitRatioThreshold}
            min={0.05}
            max={0.45}
            step={0.01}
            badgeLabel={autoFitProfileLabel}
            onChange={(v) => onAiOptionsChange((prev) => ({ ...prev, autoFitRatioThreshold: v }))}
          />

          {showAiAdvanced && (
            <>
              <SliderInput
                label="Intensita refill"
                value={aiOptions.refillIntensity}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => onAiOptionsChange((prev) => ({ ...prev, refillIntensity: v }))}
              />

              <SliderInput
                label="Calore tonalita pelle"
                value={aiOptions.toneWarmth}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => onAiOptionsChange((prev) => ({ ...prev, toneWarmth: v }))}
              />

              <SliderInput
                label="Levigatura pelle"
                value={aiOptions.skinSmoothing}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => onAiOptionsChange((prev) => ({ ...prev, skinSmoothing: v }))}
              />

              <SliderInput
                label="Riduzione imperfezioni"
                value={aiOptions.blemishReduction}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => onAiOptionsChange((prev) => ({ ...prev, blemishReduction: v }))}
              />

              <ToggleRow
                label="Soft look viso"
                checked={aiOptions.feminineSoftening}
                onChange={(checked) => onAiOptionsChange((prev) => ({ ...prev, feminineSoftening: checked }))}
              />

              <SliderInput
                label="Rimodellamento viso"
                value={aiOptions.faceSlimming}
                min={0}
                max={0.35}
                step={0.01}
                onChange={(v) => onAiOptionsChange((prev) => ({ ...prev, faceSlimming: v }))}
              />

              <SliderInput
                label="Rimodellamento naso"
                value={aiOptions.noseRefinement}
                min={0}
                max={0.3}
                step={0.01}
                onChange={(v) => onAiOptionsChange((prev) => ({ ...prev, noseRefinement: v }))}
              />
            </>
          )}
        </div>

        <div className="flex gap-2 mt-2">
          <button
            onClick={onApplyAi}
            disabled={!croppedCanvas || isAiProcessing}
            className={cn(
              'flex-1 text-xs py-2 rounded-lg border transition-colors',
              !croppedCanvas || isAiProcessing
                ? 'bg-[var(--app-surface-strong)] text-[var(--app-text-subtle)] border-[var(--app-border)] cursor-not-allowed'
                : 'bg-[var(--brand-primary-soft)] text-[var(--brand-primary)] border-[var(--brand-primary)] hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)]',
            )}
          >
            {isAiProcessing ? 'Elaborazione AI...' : 'Applica AI'}
          </button>
          <button
            onClick={onResetAi}
            className="flex-1 text-xs py-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-field)] text-[var(--app-text-muted)] hover:text-[var(--app-text)]"
          >
            Reset modifiche AI
          </button>
        </div>

        {aiSuggestions.length > 0 && (
          <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-field)] p-2 mt-2">
            {aiSuggestions.map((s, i) => (
              <p key={i} className="text-[10px] text-[var(--app-text-subtle)]">• {s}</p>
            ))}
          </div>
        )}

        {aiWarnings.length > 0 && (
          <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-2 mt-2">
            {aiWarnings.map((w, i) => (
              <p key={i} className="text-[10px] text-[var(--danger)]">• {w}</p>
            ))}
          </div>
        )}
      </CollapsibleSection>

      <Divider />

      {/* ── Tipo documento ── */}
      <CollapsibleSection label="Tipo documento" defaultOpen>
        {/* Category filter */}
        <div className="flex gap-1.5">
          {CATEGORY_FILTERS.map((item) => (
            <button
              key={item.value}
              onClick={() => setSelectedCategory(item.value)}
              className={cn(
                'flex-1 py-1.5 rounded-lg text-[11px] font-medium border transition-colors',
                selectedCategory === item.value
                  ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-soft)] text-[var(--app-text)]'
                  : 'border-[var(--app-border)] bg-[var(--app-field)] text-[var(--app-text-muted)] hover:text-[var(--app-text)]',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Country filter */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-[var(--app-text-subtle)]">Paese</label>
          <select
            value={selectedCountry}
            onChange={(e) => setSelectedCountry(e.target.value)}
            className="w-full px-2 py-1.5 rounded-lg text-xs bg-[var(--app-field)] border border-[var(--app-border)] text-[var(--app-text)] focus:outline-none focus:border-[var(--brand-primary)]"
          >
            <option value="ALL">Tutti</option>
            {countries
              .filter((c) => c !== 'ALL')
              .map((countryCode) => {
                const countryName = DOCUMENT_PRESETS.find((p) => p.countryCode === countryCode)?.countryName ?? countryCode
                return (
                  <option key={countryCode} value={countryCode}>
                    {countryName}
                  </option>
                )
              })}
          </select>
        </div>

        {/* Search */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-[var(--app-text-subtle)]">Cerca paese o formato</label>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="es. usa, 35x45"
            className="w-full px-2 py-1.5 rounded-lg text-xs bg-[var(--app-field)] border border-[var(--app-border)] text-[var(--app-text)] placeholder:text-[var(--app-text-subtle)] focus:outline-none focus:border-[var(--brand-primary)]"
          />
          {autoSuggestion && (
            <button
              onClick={() => onDocPresetChange(autoSuggestion)}
              className="text-left text-[10px] px-2 py-1 rounded bg-[var(--brand-primary-soft)] text-[var(--brand-primary)] border border-[var(--brand-primary)]"
            >
              Suggerimento: {autoSuggestion.name}
            </button>
          )}
        </div>

        <div className="flex flex-col gap-2 max-h-52 overflow-y-auto">
          {filteredPresets.map((preset) => (
            <button
              key={preset.id}
              onClick={() => onDocPresetChange(preset)}
              className={cn(
                'w-full text-left px-3 py-2 rounded-lg text-xs border transition-colors',
                docPreset.id === preset.id
                  ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-soft)] text-[var(--app-text)]'
                  : 'border-[var(--app-border)] bg-[var(--app-field)] text-[var(--app-text-muted)] hover:border-[var(--app-border-strong)] hover:text-[var(--app-text)]',
              )}
            >
              <div className="font-medium">{preset.name}</div>
              <div className="text-[10px] text-[var(--app-text-subtle)]">
                {preset.countryName} · {preset.widthMm}x{preset.heightMm} mm
              </div>
            </button>
          ))}
          {filteredPresets.length === 0 && (
            <p className="text-[11px] text-[var(--app-text-subtle)] px-1">Nessun preset trovato con questi filtri.</p>
          )}
        </div>

        {/* Custom size inputs */}
        {isCustom && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <NumberInput
              label="Larghezza (mm)"
              value={customDocSize.widthMm}
              min={10}
              max={200}
              onChange={(v) => {
                const updated = { ...customDocSize, widthMm: v }
                onCustomDocSizeChange(updated)
                onDocPresetChange({ ...docPreset, widthMm: v, heightMm: updated.heightMm })
              }}
            />
            <NumberInput
              label="Altezza (mm)"
              value={customDocSize.heightMm}
              min={10}
              max={200}
              onChange={(v) => {
                const updated = { ...customDocSize, heightMm: v }
                onCustomDocSizeChange(updated)
                onDocPresetChange({ ...docPreset, widthMm: updated.widthMm, heightMm: v })
              }}
            />
          </div>
        )}
      </CollapsibleSection>

      <Divider />

      {/* ── Formato foglio ── */}
      <CollapsibleSection label="Formato foglio">
        <div className="flex flex-col gap-2">
          {SHEET_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => onSheetPresetChange(preset)}
              className={cn(
                'w-full text-left px-3 py-2 rounded-lg text-xs border transition-colors',
                sheetPreset.id === preset.id
                  ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-soft)] text-[var(--app-text)]'
                  : 'border-[var(--app-border)] bg-[var(--app-field)] text-[var(--app-text-muted)] hover:border-[var(--app-border-strong)] hover:text-[var(--app-text)]',
              )}
            >
              <span className="font-medium">{preset.label}</span>
              <span className="ml-2 text-[var(--app-text-subtle)]">
                {preset.widthMm}×{preset.heightMm} mm
              </span>
            </button>
          ))}
        </div>
      </CollapsibleSection>

      <Divider />

      {/* ── DPI ── */}
      <CollapsibleSection label="Qualità stampa">
        <div className="flex gap-1.5">
          {DPI_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onDpiChange(opt.value)}
              title={opt.hint}
              className={cn(
                'flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                dpi === opt.value
                  ? 'border-[var(--brand-accent)] bg-[var(--brand-primary-soft)] text-[var(--brand-accent)]'
                  : 'border-[var(--app-border)] bg-[var(--app-field)] text-[var(--app-text-muted)] hover:text-[var(--app-text)]',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </CollapsibleSection>

      <Divider />

      {/* ── Formato export ── */}
      <CollapsibleSection label="Formato file">
        <div className="flex gap-1.5">
          {FORMAT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onExportFormatChange(opt.value)}
              className={cn(
                'flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                exportFormat === opt.value
                  ? 'border-[var(--brand-accent)] bg-[var(--brand-primary-soft)] text-[var(--brand-accent)]'
                  : 'border-[var(--app-border)] bg-[var(--app-field)] text-[var(--app-text-muted)] hover:text-[var(--app-text)]',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </CollapsibleSection>

      {/* Spacer */}
      <div className="flex-1" />

      {/* ── Export button (sticky) ── */}
      <div className="sticky bottom-0 pt-2 pb-1 bg-[var(--app-surface)]">
        <button
          onClick={onExport}
          disabled={!canExport}
          className={cn(
            'w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all shrink-0',
            canExport
              ? 'bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-strong)] text-[var(--brand-primary-foreground)] shadow-md'
              : 'bg-[var(--app-surface-strong)] text-[var(--app-text-subtle)] cursor-not-allowed',
          )}
        >
          {isExporting ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Esportazione...
            </>
          ) : (
            <>
              <Download size={16} />
              Esporta {layout && layout.total > 0 ? `(${layout.total} copie)` : ''}
            </>
          )}
        </button>
      </div>
    </aside>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function CollapsibleSection({
  label,
  children,
  defaultOpen = false,
}: {
  label: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="flex flex-col gap-2 shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[var(--app-text-subtle)] hover:text-[var(--app-text)]"
      >
        <span>{label}</span>
        <ChevronDown
          size={14}
          className={cn('transition-transform', open ? 'rotate-180' : 'rotate-0')}
        />
      </button>
      {open && children}
    </div>
  )
}

function Divider() {
  return <div className="h-px bg-[var(--app-border)] shrink-0" />
}

function NumberInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] text-[var(--app-text-subtle)]">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10)
          if (!isNaN(v) && v >= min && v <= max) onChange(v)
        }}
        className="w-full px-2 py-1.5 rounded-lg text-xs bg-[var(--app-field)] border border-[var(--app-border)] text-[var(--app-text)] focus:outline-none focus:border-[var(--brand-primary)]"
      />
    </div>
  )
}

function ToggleRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className={cn(
      'flex items-center justify-between gap-2 text-xs',
      disabled ? 'text-[var(--app-text-subtle)]' : 'text-[var(--app-text-muted)]',
    )}>
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-[var(--brand-primary)] disabled:opacity-50"
      />
    </label>
  )
}

function SliderInput({
  label,
  value,
  min,
  max,
  step,
  badgeLabel,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  badgeLabel?: string
  onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] text-[var(--app-text-subtle)] flex items-center justify-between gap-2">
        <span>{label}: {value.toFixed(2)}</span>
        {badgeLabel && (
          <span className="px-1.5 py-0.5 rounded border border-[var(--brand-primary)] bg-[var(--brand-primary-soft)] text-[var(--brand-primary)] font-medium">
            {badgeLabel}
          </span>
        )}
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  )
}
