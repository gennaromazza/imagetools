import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { GeneratedPageLayout, RulerUnit } from "@photo-tools/shared-types";
import {
  InspectorGuidesSection,
  InspectorPageActions,
  InspectorSheetSection,
} from "./InspectorPanel";

type PageSettingsSectionKey = "sheet" | "guides" | "actions";

interface PageSettingsPanelProps {
  activePage: GeneratedPageLayout;
  isOpen: boolean;
  onClose: () => void;
  onPageSheetPresetChange: (pageId: string, presetId: string) => void;
  onPageSheetFieldChange: (
    pageId: string,
    field: "widthCm" | "heightCm" | "marginCm" | "gapCm" | "dpi" | "photoBorderWidthCm" | "bleedCm",
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
  onRebalancePage: (pageId: string) => void;
  onRemovePage: (pageId: string) => void;
}

interface PageSettingsAccordionProps {
  title: string;
  description: string;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}

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
        .filter((entry) => Number.isFinite(entry) && entry > 0 && entry < maxCm)
        .map((entry) => Number(entry.toFixed(3)))
    )
  ).sort((left, right) => left - right);
}

function pixelsToCm(px: number, dpi: number): number {
  return (px / dpi) * 2.54;
}

function PageSettingsAccordion({
  title,
  description,
  isOpen,
  onToggle,
  children,
}: PageSettingsAccordionProps) {
  return (
    <section className={isOpen ? "inspector-accordion inspector-accordion--open" : "inspector-accordion"}>
      <button
        type="button"
        className="inspector-accordion__trigger"
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <span className="inspector-accordion__title-group">
          <strong>{title}</strong>
          <span>{description}</span>
        </span>
        <span className="inspector-accordion__icon" aria-hidden="true">
          {isOpen ? "−" : "+"}
        </span>
      </button>
      {isOpen ? <div className="inspector-accordion__body">{children}</div> : null}
    </section>
  );
}

export function PageSettingsPanel({
  activePage,
  isOpen,
  onClose,
  onPageSheetPresetChange,
  onPageSheetFieldChange,
  onPageSheetStyleChange,
  onRebalancePage,
  onRemovePage,
}: PageSettingsPanelProps) {
  const [expandedSection, setExpandedSection] = useState<PageSettingsSectionKey>("sheet");
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
    setExpandedSection("sheet");
    setVerticalGuideDraft("0");
    setHorizontalGuideDraft("0");
  }, [activePage.id, activePage.sheetSpec.rulerUnit]);

  const totalGuides = pageGuides.verticalGuidesCm.length + pageGuides.horizontalGuidesCm.length;
  const rulerUnit = activePage.sheetSpec.rulerUnit ?? "cm";

  const upsertGuide = useCallback(
    (axis: "vertical" | "horizontal", displayValue: number) => {
      if (!Number.isFinite(displayValue) || displayValue < 0) {
        return;
      }

      const maxCm = axis === "vertical" ? activePage.sheetSpec.widthCm : activePage.sheetSpec.heightCm;
      const nextCm = rulerUnit === "px" ? pixelsToCm(displayValue, activePage.sheetSpec.dpi) : displayValue;
      const field = axis === "vertical" ? "verticalGuidesCm" : "horizontalGuidesCm";
      const nextGuides = normalizeGuides([...(pageGuides[field] ?? []), nextCm], maxCm);

      onPageSheetStyleChange(
        activePage.id,
        { [field]: nextGuides },
        `${axis === "vertical" ? "Guida verticale" : "Guida orizzontale"} aggiunta al foglio ${activePage.pageNumber}.`
      );
    },
    [activePage, onPageSheetStyleChange, pageGuides, rulerUnit]
  );

  const removeGuide = useCallback(
    (axis: "vertical" | "horizontal", guideCm: number) => {
      const field = axis === "vertical" ? "verticalGuidesCm" : "horizontalGuidesCm";
      const nextGuides = (pageGuides[field] ?? []).filter((value) => value !== guideCm);

      onPageSheetStyleChange(
        activePage.id,
        { [field]: nextGuides },
        `${axis === "vertical" ? "Guida verticale" : "Guida orizzontale"} rimossa dal foglio ${activePage.pageNumber}.`
      );
    },
    [activePage, onPageSheetStyleChange, pageGuides]
  );

  const toggleSection = useCallback((section: PageSettingsSectionKey) => {
    setExpandedSection((current) => (current === section ? current : section));
  }, []);

  if (!isOpen) {
    return null;
  }

  return (
    <section className="page-settings-panel">
      <div className="page-settings-panel__header">
        <div className="page-settings-panel__identity">
          <span className="layout-studio__rail-eyebrow">Impostazioni foglio</span>
          <strong>{`Foglio ${activePage.pageNumber}`}</strong>
          <span className="page-settings-panel__meta">
            {activePage.templateLabel} · {formatMeasurement(activePage.sheetSpec.widthCm)}×{formatMeasurement(activePage.sheetSpec.heightCm)} cm
          </span>
        </div>

        <button type="button" className="ghost-button" onClick={onClose}>
          Nascondi
        </button>
      </div>

      <div className="page-settings-panel__sections">
        <PageSettingsAccordion
          title="Formato"
          description={`${activePage.sheetSpec.label} · gap ${activePage.sheetSpec.gapCm.toFixed(1)} cm`}
          isOpen={expandedSection === "sheet"}
          onToggle={() => toggleSection("sheet")}
        >
          <InspectorSheetSection
            activePage={activePage}
            onPageSheetPresetChange={onPageSheetPresetChange}
            onPageSheetFieldChange={onPageSheetFieldChange}
          />
        </PageSettingsAccordion>

        <PageSettingsAccordion
          title="Guide e righelli"
          description={totalGuides > 0 ? `${totalGuides} guide attive` : "Nessuna guida"}
          isOpen={expandedSection === "guides"}
          onToggle={() => toggleSection("guides")}
        >
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
        </PageSettingsAccordion>

        <PageSettingsAccordion
          title="Azioni"
          description="Riadatta o rimuovi il foglio corrente"
          isOpen={expandedSection === "actions"}
          onToggle={() => toggleSection("actions")}
        >
          <InspectorPageActions
            activePageId={activePage.id}
            onRebalancePage={onRebalancePage}
            onRemovePage={onRemovePage}
          />
        </PageSettingsAccordion>
      </div>
    </section>
  );
}
