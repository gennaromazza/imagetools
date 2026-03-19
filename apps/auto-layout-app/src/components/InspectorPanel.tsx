import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { SHEET_PRESETS } from "@photo-tools/presets";
import type {
  GeneratedPageLayout,
  ImageAsset,
  LayoutAssignment,
  RulerUnit,
} from "@photo-tools/shared-types";
import { AssignmentInspector } from "./AssignmentInspector";

// ═══════════════════════════════════════════════════════════════════════════
// Utility helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatMeasurement(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function normalizeGuides(values: number[] | undefined, maxCm: number): number[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(
    new Set(
      values
        .filter((v) => Number.isFinite(v) && v > 0 && v < maxCm)
        .map((v) => Number(v.toFixed(3)))
    )
  ).sort((a, b) => a - b);
}

function cmToPixels(cm: number, dpi: number): number {
  return (cm / 2.54) * dpi;
}

function pixelsToCm(px: number, dpi: number): number {
  return (px / dpi) * 2.54;
}

function formatGuideValue(cm: number, page: GeneratedPageLayout, unit: RulerUnit): string {
  if (unit === "px") {
    return `${Math.round(cmToPixels(cm, page.sheetSpec.dpi))} px`;
  }
  return `${formatMeasurement(cm)} cm`;
}

function formatAspectRatioLabel(page: GeneratedPageLayout): string {
  return `${formatMeasurement(page.sheetSpec.widthCm)}:${formatMeasurement(page.sheetSpec.heightCm)}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// CommitOnBlurNumberField — shared inline input
// ═══════════════════════════════════════════════════════════════════════════

interface CommitOnBlurNumberFieldProps {
  label: string;
  value: number;
  min?: string;
  step?: string;
  className?: string;
  unit?: string;
  allowZero?: boolean;
  onCommit: (value: number) => void;
}

function CommitOnBlurNumberField({
  label,
  value,
  min = "1",
  step = "0.1",
  className,
  unit,
  allowZero = false,
  onCommit,
}: CommitOnBlurNumberFieldProps) {
  const [draftValue, setDraftValue] = useState(() => formatMeasurement(value));

  useEffect(() => {
    setDraftValue(formatMeasurement(value));
  }, [value]);

  const commitDraft = useCallback(() => {
    const parsed = Number(draftValue);
    if (!Number.isFinite(parsed) || parsed < 0 || (!allowZero && parsed === 0)) {
      setDraftValue(formatMeasurement(value));
      return;
    }
    if (parsed !== value) {
      onCommit(parsed);
      return;
    }
    setDraftValue(formatMeasurement(value));
  }, [allowZero, draftValue, onCommit, value]);

  return (
    <label className={className ? `field ${className}` : "field"}>
      <span>{label}</span>
      <div className={unit ? "field__input-with-unit" : undefined}>
        <input
          type="number"
          min={min}
          step={step}
          inputMode="decimal"
          value={draftValue}
          onChange={(event) => setDraftValue(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setDraftValue(formatMeasurement(value));
              event.preventDefault();
            }
          }}
        />
        {unit ? <span className="field__unit">{unit}</span> : null}
      </div>
    </label>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. InspectorHeader
// ═══════════════════════════════════════════════════════════════════════════

function InspectorHeader({ onCollapse }: { onCollapse: () => void }) {
  return (
    <div className="layout-studio__inspector-header">
      <span className="layout-studio__rail-eyebrow">Inspector</span>
      <button type="button" className="ghost-button" onClick={onCollapse}>
        Nascondi
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. InspectorSummary
// ═══════════════════════════════════════════════════════════════════════════

interface InspectorSummaryProps {
  pageNumber: number;
  assignmentsCount: number;
  slotsCount: number;
  dpi: number;
}

function InspectorSummary({ pageNumber, assignmentsCount, slotsCount, dpi }: InspectorSummaryProps) {
  return (
    <div className="inspector-section inspector-section--summary">
      <div className="inspector-metric">
        <small>Foglio</small>
        <strong>{pageNumber}</strong>
      </div>
      <div className="inspector-metric">
        <small>Foto</small>
        <strong>{assignmentsCount}</strong>
      </div>
      <div className="inspector-metric">
        <small>Slot</small>
        <strong>{slotsCount}</strong>
      </div>
      <div className="inspector-metric">
        <small>DPI</small>
        <strong>{dpi}</strong>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. InspectorSheetSection
// ═══════════════════════════════════════════════════════════════════════════

interface InspectorSheetSectionProps {
  activePage: GeneratedPageLayout;
  onPageSheetPresetChange: (pageId: string, presetId: string) => void;
  onPageSheetFieldChange: (
    pageId: string,
    field: "widthCm" | "heightCm" | "marginCm" | "gapCm" | "dpi" | "photoBorderWidthCm",
    value: number
  ) => void;
}

function InspectorSheetSection({
  activePage,
  onPageSheetPresetChange,
  onPageSheetFieldChange,
}: InspectorSheetSectionProps) {
  const aspectRatio = formatAspectRatioLabel(activePage);

  return (
    <div className="inspector-section">
      <span className="inspector-section__eyebrow">Formato foglio</span>

      <label className="field inspector-field">
        <span>Preset</span>
        <select
          value={activePage.sheetSpec.presetId}
          onChange={(event) => onPageSheetPresetChange(activePage.id, event.target.value)}
        >
          {SHEET_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.label}</option>
          ))}
        </select>
      </label>

      <div className="sheet-toolbar__presets inspector-sheet-settings__presets">
        {(["13x18", "15x20", "20x15", "20x30", "30x20", "a4"] as const).map((presetId) => {
          const preset = SHEET_PRESETS.find((item) => item.id === presetId);
          if (!preset) return null;
          const isActive = activePage.sheetSpec.presetId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              className={isActive ? "sheet-toolbar__chip sheet-toolbar__chip--active" : "sheet-toolbar__chip"}
              onClick={() => onPageSheetPresetChange(activePage.id, preset.id)}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      <div className="inline-grid inline-grid--2">
        <CommitOnBlurNumberField
          label="Larghezza"
          className="inspector-field"
          value={activePage.sheetSpec.widthCm}
          onCommit={(v) => onPageSheetFieldChange(activePage.id, "widthCm", v)}
        />
        <CommitOnBlurNumberField
          label="Altezza"
          className="inspector-field"
          value={activePage.sheetSpec.heightCm}
          onCommit={(v) => onPageSheetFieldChange(activePage.id, "heightCm", v)}
        />
      </div>

      <div className="inline-grid inline-grid--3">
        <CommitOnBlurNumberField
          label="Margine"
          className="inspector-field"
          min="0"
          step="0.1"
          unit="cm"
          allowZero
          value={activePage.sheetSpec.marginCm}
          onCommit={(v) => onPageSheetFieldChange(activePage.id, "marginCm", v)}
        />
        <CommitOnBlurNumberField
          label="Gap"
          className="inspector-field"
          min="0"
          step="0.1"
          unit="cm"
          allowZero
          value={activePage.sheetSpec.gapCm}
          onCommit={(v) => onPageSheetFieldChange(activePage.id, "gapCm", v)}
        />
        <CommitOnBlurNumberField
          label="DPI"
          className="inspector-field"
          min="72"
          step="50"
          value={activePage.sheetSpec.dpi}
          onCommit={(v) => onPageSheetFieldChange(activePage.id, "dpi", v)}
        />
      </div>

      <div className="inspector-section__quick-actions">
        <button
          type="button"
          className="ghost-button"
          title="Riduce gap di 0,1 cm"
          onClick={() => onPageSheetFieldChange(activePage.id, "gapCm", Math.max(0, Number((activePage.sheetSpec.gapCm - 0.1).toFixed(1))))}
        >
          Gap −
        </button>
        <button
          type="button"
          className="ghost-button"
          title="Aumenta gap di 0,1 cm"
          onClick={() => onPageSheetFieldChange(activePage.id, "gapCm", Number((activePage.sheetSpec.gapCm + 0.1).toFixed(1)))}
        >
          Gap +
        </button>
        <button
          type="button"
          className="ghost-button"
          title="Riduce margine di 0,1 cm"
          onClick={() => onPageSheetFieldChange(activePage.id, "marginCm", Math.max(0, Number((activePage.sheetSpec.marginCm - 0.1).toFixed(1))))}
        >
          Margine −
        </button>
        <button
          type="button"
          className="ghost-button"
          title="Aumenta margine di 0,1 cm"
          onClick={() => onPageSheetFieldChange(activePage.id, "marginCm", Number((activePage.sheetSpec.marginCm + 0.1).toFixed(1)))}
        >
          Margine +
        </button>
      </div>

      <div className="inspector-sheet-settings__ratio">
        Aspect ratio {aspectRatio} · margine {activePage.sheetSpec.marginCm.toFixed(1)} cm · gap{" "}
        {activePage.sheetSpec.gapCm.toFixed(1)} cm
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. InspectorGuidesSection
// ═══════════════════════════════════════════════════════════════════════════

interface InspectorGuidesSectionProps {
  activePage: GeneratedPageLayout;
  pageGuides: { verticalGuidesCm: number[]; horizontalGuidesCm: number[] };
  verticalGuideDraft: string;
  horizontalGuideDraft: string;
  setVerticalGuideDraft: (value: string) => void;
  setHorizontalGuideDraft: (value: string) => void;
  upsertGuide: (axis: "vertical" | "horizontal", displayValue: number) => void;
  removeGuide: (axis: "vertical" | "horizontal", guideCm: number) => void;
  onPageSheetStyleChange: (
    pageId: string,
    changes: { showRulers?: boolean; rulerUnit?: RulerUnit; verticalGuidesCm?: number[]; horizontalGuidesCm?: number[] },
    activity?: string
  ) => void;
}

function InspectorGuidesSection({
  activePage,
  pageGuides,
  verticalGuideDraft,
  horizontalGuideDraft,
  setVerticalGuideDraft,
  setHorizontalGuideDraft,
  upsertGuide,
  removeGuide,
  onPageSheetStyleChange,
}: InspectorGuidesSectionProps) {
  const rulerUnit = activePage.sheetSpec.rulerUnit ?? "cm";
  const stepSize = rulerUnit === "px" ? "10" : "0.1";

  return (
    <div className="inspector-section">
      <span className="inspector-section__eyebrow">Righelli e guide</span>

      <label className="check-row">
        <input
          type="checkbox"
          checked={activePage.sheetSpec.showRulers ?? false}
          onChange={(event) =>
            onPageSheetStyleChange(
              activePage.id,
              { showRulers: event.target.checked },
              `Righelli ${event.target.checked ? "attivati" : "nascosti"} sul foglio ${activePage.pageNumber}.`
            )
          }
        />
        <span>Mostra righelli sul foglio</span>
      </label>

      <label className="field inspector-field">
        <span>Unità righello</span>
        <select
          value={rulerUnit}
          onChange={(event) =>
            onPageSheetStyleChange(
              activePage.id,
              { rulerUnit: event.target.value as RulerUnit },
              `Unità righello aggiornata per il foglio ${activePage.pageNumber}.`
            )
          }
        >
          <option value="cm">Centimetri</option>
          <option value="px">Pixel</option>
        </select>
      </label>

      <div className="inspector-guides__add-row">
        <label className="field inspector-field">
          <span>Verticale</span>
          <div className="field__input-with-unit">
            <input type="number" min="0" step={stepSize} value={verticalGuideDraft} onChange={(e) => setVerticalGuideDraft(e.target.value)} />
            <span className="field__unit">{rulerUnit}</span>
          </div>
        </label>
        <button
          type="button"
          className="ghost-button inspector-guide-add"
          onClick={() => { const n = Number(verticalGuideDraft); if (Number.isFinite(n)) upsertGuide("vertical", n); }}
        >
          +
        </button>
        <label className="field inspector-field">
          <span>Orizzontale</span>
          <div className="field__input-with-unit">
            <input type="number" min="0" step={stepSize} value={horizontalGuideDraft} onChange={(e) => setHorizontalGuideDraft(e.target.value)} />
            <span className="field__unit">{rulerUnit}</span>
          </div>
        </label>
        <button
          type="button"
          className="ghost-button inspector-guide-add"
          onClick={() => { const n = Number(horizontalGuideDraft); if (Number.isFinite(n)) upsertGuide("horizontal", n); }}
        >
          +
        </button>
      </div>

      <div className="inspector-guide-lists">
        <div className="inspector-guide-list">
          <strong>Verticali</strong>
          <div className="inspector-guide-list__items">
            {pageGuides.verticalGuidesCm.length > 0
              ? pageGuides.verticalGuidesCm.map((guideCm) => (
                  <button
                    key={`v-${guideCm}`}
                    type="button"
                    className="inspector-guide-chip"
                    onClick={() => removeGuide("vertical", guideCm)}
                    title="Clicca per rimuovere"
                  >
                    {formatGuideValue(guideCm, activePage, rulerUnit)}
                  </button>
                ))
              : <span className="helper-inline">Nessuna</span>}
          </div>
        </div>
        <div className="inspector-guide-list">
          <strong>Orizzontali</strong>
          <div className="inspector-guide-list__items">
            {pageGuides.horizontalGuidesCm.length > 0
              ? pageGuides.horizontalGuidesCm.map((guideCm) => (
                  <button
                    key={`h-${guideCm}`}
                    type="button"
                    className="inspector-guide-chip"
                    onClick={() => removeGuide("horizontal", guideCm)}
                    title="Clicca per rimuovere"
                  >
                    {formatGuideValue(guideCm, activePage, rulerUnit)}
                  </button>
                ))
              : <span className="helper-inline">Nessuna</span>}
          </div>
        </div>
      </div>

      <details className="inspector-section__help-details">
        <summary>Uso rapido</summary>
        <span>Clicca sul righello in alto per creare una guida verticale e su quello a sinistra per una guida orizzontale.</span>
      </details>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. InspectorSlotSection
// ═══════════════════════════════════════════════════════════════════════════

interface InspectorSlotSectionProps {
  activePage: GeneratedPageLayout;
  selectedSlot?: GeneratedPageLayout["slotDefinitions"][number];
  selectedAssignment?: LayoutAssignment;
  selectedAsset?: ImageAsset;
  onUpdateSlotAssignment: (
    pageId: string,
    slotId: string,
    changes: Partial<
      Pick<
        LayoutAssignment,
        "fitMode" | "zoom" | "offsetX" | "offsetY" | "rotation" | "locked" | "cropLeft" | "cropTop" | "cropWidth" | "cropHeight"
      >
    >
  ) => void;
  onClearSlot: (pageId: string, slotId: string) => void;
  onOpenCropEditor: (pageId: string, slotId: string) => void;
}

function InspectorSlotSection({
  activePage,
  selectedSlot,
  selectedAssignment,
  selectedAsset,
  onUpdateSlotAssignment,
  onClearSlot,
  onOpenCropEditor,
}: InspectorSlotSectionProps) {
  return (
    <div className="inspector-section">
      <span className="inspector-section__eyebrow">Slot selezionato</span>
      <AssignmentInspector
        pageLabel={`Foglio ${activePage.pageNumber}`}
        slot={selectedSlot}
        assignment={selectedAssignment}
        asset={selectedAsset}
        onChange={(changes) => {
          if (!selectedSlot) return;
          onUpdateSlotAssignment(activePage.id, selectedSlot.id, changes);
        }}
        onClear={() => {
          if (!selectedSlot) return;
          onClearSlot(activePage.id, selectedSlot.id);
        }}
        onOpenCropEditor={() => {
          if (!selectedSlot) return;
          onOpenCropEditor(activePage.id, selectedSlot.id);
        }}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. InspectorPageActions
// ═══════════════════════════════════════════════════════════════════════════

interface InspectorPageActionsProps {
  activePageId: string;
  onRebalancePage: (pageId: string) => void;
  onRemovePage: (pageId: string) => void;
}

function InspectorPageActions({ activePageId, onRebalancePage, onRemovePage }: InspectorPageActionsProps) {
  return (
    <div className="inspector-section inspector-section--actions">
      <span className="inspector-section__eyebrow">Azioni foglio</span>
      <div className="inspector-actions">
        <button
          type="button"
          className="secondary-button"
          title="Ricalcola il layout del foglio corrente"
          onClick={() => onRebalancePage(activePageId)}
        >
          Riadatta questo foglio
        </button>
        <button
          type="button"
          className="ghost-button ghost-button--danger"
          onClick={() => onRemovePage(activePageId)}
        >
          Elimina foglio
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// InspectorPanel — orchestrator
// ═══════════════════════════════════════════════════════════════════════════

export interface InspectorPanelProps {
  activePage: GeneratedPageLayout;
  selectedSlot?: GeneratedPageLayout["slotDefinitions"][number];
  selectedAssignment?: LayoutAssignment;
  selectedAsset?: ImageAsset;
  isCollapsed: boolean;
  onCollapse: () => void;
  onPageSheetPresetChange: (pageId: string, presetId: string) => void;
  onPageSheetFieldChange: (
    pageId: string,
    field: "widthCm" | "heightCm" | "marginCm" | "gapCm" | "dpi" | "photoBorderWidthCm",
    value: number
  ) => void;
  onPageSheetStyleChange: (
    pageId: string,
    changes: {
      backgroundColor?: string;
      backgroundImageUrl?: string;
      photoBorderColor?: string;
      photoBorderWidthCm?: number;
      showRulers?: boolean;
      rulerUnit?: RulerUnit;
      verticalGuidesCm?: number[];
      horizontalGuidesCm?: number[];
    },
    activity?: string
  ) => void;
  onUpdateSlotAssignment: (
    pageId: string,
    slotId: string,
    changes: Partial<
      Pick<
        LayoutAssignment,
        "fitMode" | "zoom" | "offsetX" | "offsetY" | "rotation" | "locked" | "cropLeft" | "cropTop" | "cropWidth" | "cropHeight"
      >
    >
  ) => void;
  onClearSlot: (pageId: string, slotId: string) => void;
  onRebalancePage: (pageId: string) => void;
  onRemovePage: (pageId: string) => void;
  onOpenCropEditor: (pageId: string, slotId: string) => void;
}

export function InspectorPanel({
  activePage,
  selectedSlot,
  selectedAssignment,
  selectedAsset,
  isCollapsed,
  onCollapse,
  onPageSheetPresetChange,
  onPageSheetFieldChange,
  onPageSheetStyleChange,
  onUpdateSlotAssignment,
  onClearSlot,
  onRebalancePage,
  onRemovePage,
  onOpenCropEditor,
}: InspectorPanelProps) {
  const [verticalGuideDraft, setVerticalGuideDraft] = useState("0");
  const [horizontalGuideDraft, setHorizontalGuideDraft] = useState("0");

  const pageGuides = useMemo(
    () => ({
      verticalGuidesCm: normalizeGuides(activePage.sheetSpec.verticalGuidesCm, activePage.sheetSpec.widthCm),
      horizontalGuidesCm: normalizeGuides(activePage.sheetSpec.horizontalGuidesCm, activePage.sheetSpec.heightCm),
    }),
    [activePage]
  );

  useEffect(() => {
    setVerticalGuideDraft("0");
    setHorizontalGuideDraft("0");
  }, [activePage.id, activePage.sheetSpec.rulerUnit]);

  const upsertGuide = useCallback(
    (axis: "vertical" | "horizontal", displayValue: number) => {
      if (!Number.isFinite(displayValue) || displayValue < 0) return;
      const unit = activePage.sheetSpec.rulerUnit ?? "cm";
      const maxCm = axis === "vertical" ? activePage.sheetSpec.widthCm : activePage.sheetSpec.heightCm;
      const nextCm = unit === "px" ? pixelsToCm(displayValue, activePage.sheetSpec.dpi) : displayValue;
      const field = axis === "vertical" ? "verticalGuidesCm" : "horizontalGuidesCm";
      const nextGuides = normalizeGuides([...(pageGuides[field] ?? []), nextCm], maxCm);
      onPageSheetStyleChange(
        activePage.id,
        { [field]: nextGuides },
        `${axis === "vertical" ? "Guida verticale" : "Guida orizzontale"} aggiunta al foglio ${activePage.pageNumber}.`
      );
    },
    [activePage, onPageSheetStyleChange, pageGuides]
  );

  const removeGuide = useCallback(
    (axis: "vertical" | "horizontal", guideCm: number) => {
      const field = axis === "vertical" ? "verticalGuidesCm" : "horizontalGuidesCm";
      const nextGuides = (pageGuides[field] ?? []).filter((v) => v !== guideCm);
      onPageSheetStyleChange(
        activePage.id,
        { [field]: nextGuides },
        `${axis === "vertical" ? "Guida verticale" : "Guida orizzontale"} rimossa dal foglio ${activePage.pageNumber}.`
      );
    },
    [activePage, onPageSheetStyleChange, pageGuides]
  );

  return (
    <aside
      className={
        isCollapsed
          ? "layout-studio__inspector layout-studio__inspector--collapsed"
          : "layout-studio__inspector"
      }
    >
      <InspectorHeader onCollapse={onCollapse} />

      <InspectorSummary
        pageNumber={activePage.pageNumber}
        assignmentsCount={activePage.assignments.length}
        slotsCount={activePage.slotDefinitions.length}
        dpi={activePage.sheetSpec.dpi}
      />

      <InspectorSheetSection
        activePage={activePage}
        onPageSheetPresetChange={onPageSheetPresetChange}
        onPageSheetFieldChange={onPageSheetFieldChange}
      />

      <InspectorGuidesSection
        activePage={activePage}
        pageGuides={pageGuides}
        verticalGuideDraft={verticalGuideDraft}
        horizontalGuideDraft={horizontalGuideDraft}
        setVerticalGuideDraft={setVerticalGuideDraft}
        setHorizontalGuideDraft={setHorizontalGuideDraft}
        upsertGuide={upsertGuide}
        removeGuide={removeGuide}
        onPageSheetStyleChange={onPageSheetStyleChange}
      />

      <InspectorSlotSection
        activePage={activePage}
        selectedSlot={selectedSlot}
        selectedAssignment={selectedAssignment}
        selectedAsset={selectedAsset}
        onUpdateSlotAssignment={onUpdateSlotAssignment}
        onClearSlot={onClearSlot}
        onOpenCropEditor={onOpenCropEditor}
      />

      <InspectorPageActions
        activePageId={activePage.id}
        onRebalancePage={onRebalancePage}
        onRemovePage={onRemovePage}
      />
    </aside>
  );
}
