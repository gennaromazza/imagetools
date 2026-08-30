import type { CustomTemplate } from "../contexts/ProjectContext";
import type { Template } from "../hooks/useApi";
import type { SavedTemplateRecord } from "./savedTemplates";

export type TemplateLibraryItem = {
  id: string;
  value: string;
  kind: "preset" | "custom" | "custom-draft";
  label: string;
  meta: string;
  presetId?: string;
  record?: SavedTemplateRecord;
  locked?: boolean;
};

type TemplateComparisonOptions = {
  includePreviewUrls?: boolean;
};

const ORDER_STORAGE_KEY = "desktop-frame-composer.template-library-order";
const HIDDEN_PRESET_STORAGE_KEY = "desktop-frame-composer.hidden-preset-templates";

function loadStoredStringArray(storageKey: string): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch (error) {
    console.warn(`Failed to load template library preference ${storageKey}`, error);
    return [];
  }
}

function saveStoredStringArray(storageKey: string, values: string[]): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(values));
}

export function loadHiddenPresetTemplateIds(): string[] {
  return loadStoredStringArray(HIDDEN_PRESET_STORAGE_KEY);
}

export function hidePresetTemplate(templateId: string): void {
  const current = new Set(loadHiddenPresetTemplateIds());
  current.add(templateId);
  saveStoredStringArray(HIDDEN_PRESET_STORAGE_KEY, Array.from(current));
}

export function restoreHiddenPresetTemplates(): void {
  saveStoredStringArray(HIDDEN_PRESET_STORAGE_KEY, []);
}

export function saveTemplateLibraryOrder(ids: string[]): void {
  saveStoredStringArray(ORDER_STORAGE_KEY, ids);
}

function formatPresetMeta(template: Template): string {
  const widthCm = ((template.width / template.dpi) * 2.54).toFixed(1);
  const heightCm = ((template.height / template.dpi) * 2.54).toFixed(1);
  return `${widthCm}x${heightCm} cm • ${template.dpi} DPI`;
}

export function areCustomTemplatesEquivalent(
  left: CustomTemplate | null | undefined,
  right: CustomTemplate | null | undefined,
  options: TemplateComparisonOptions = {}
): boolean {
  if (!left || !right || left.id !== "custom" || right.id !== "custom" || left.name !== right.name) {
    return false;
  }

  const comparableFields = [
    "widthCm",
    "heightCm",
    "dpi",
    "widthPx",
    "heightPx",
    "photoAreaX",
    "photoAreaY",
    "photoAreaWidth",
    "photoAreaHeight",
    "lockAspectRatio",
    "photoAspectRatio",
    "backgroundFileName",
    "borderSizePx",
    "borderColor",
  ] as const;

  return (["vertical", "horizontal"] as const).every((orientation) => {
    const leftVariant = left.variants[orientation];
    const rightVariant = right.variants[orientation];
    if (!leftVariant || !rightVariant) {
      return false;
    }
    if (comparableFields.some((field) => leftVariant[field] !== rightVariant[field])) {
      return false;
    }
    return !options.includePreviewUrls
      || leftVariant.backgroundPreviewUrl === rightVariant.backgroundPreviewUrl;
  });
}

export function preserveCustomTemplateLibraryIdentity(
  draft: CustomTemplate,
  currentTemplate: CustomTemplate | null | undefined
): CustomTemplate {
  const linkedId = currentTemplate?.libraryTemplateId;
  if (
    currentTemplate
    && typeof linkedId === "string"
    && linkedId.length > 0
    && areCustomTemplatesEquivalent(draft, currentTemplate, { includePreviewUrls: true })
  ) {
    return {
      ...currentTemplate,
      ...draft,
      libraryTemplateId: linkedId,
      variants: {
        vertical: {
          ...currentTemplate.variants.vertical,
          ...draft.variants.vertical,
        },
        horizontal: {
          ...currentTemplate.variants.horizontal,
          ...draft.variants.horizontal,
        },
      },
    };
  }

  const { libraryTemplateId: _staleLibraryId, ...unlinkedDraft } = draft;
  return unlinkedDraft;
}

export function resolveCustomTemplateSelectionValue(
  currentTemplate: CustomTemplate | null | undefined,
  savedTemplates: SavedTemplateRecord[]
): string {
  const linkedRecord = typeof currentTemplate?.libraryTemplateId === "string"
    ? savedTemplates.find((record) => record.id === currentTemplate.libraryTemplateId)
    : undefined;
  return linkedRecord && areCustomTemplatesEquivalent(currentTemplate, linkedRecord.template)
    ? `custom:${linkedRecord.id}`
    : "custom-draft";
}

export function buildTemplateLibrary(
  presets: Template[],
  savedTemplates: SavedTemplateRecord[],
  currentCustomTemplate: CustomTemplate | null
): TemplateLibraryItem[] {
  const hiddenPresetIds = new Set(loadHiddenPresetTemplateIds());
  const storedOrder = loadStoredStringArray(ORDER_STORAGE_KEY);
  const orderIndex = new Map(storedOrder.map((id, index) => [id, index]));

  const presetItems: TemplateLibraryItem[] = presets
    .filter((template) => !hiddenPresetIds.has(template.id))
    .map((template) => ({
      id: `preset:${template.id}`,
      value: `preset:${template.id}`,
      kind: "preset",
      label: template.name,
      meta: formatPresetMeta(template),
      presetId: template.id,
    }));

  const customItems: TemplateLibraryItem[] = savedTemplates.map((record) => ({
    id: `custom:${record.id}`,
    value: `custom:${record.id}`,
    kind: "custom",
    label: record.name,
    meta: record.summary,
    record,
  }));

  const orderedItems = [...presetItems, ...customItems].sort((left, right) => {
    const leftIndex = orderIndex.get(left.id);
    const rightIndex = orderIndex.get(right.id);

    if (leftIndex === undefined && rightIndex === undefined) {
      return 0;
    }

    if (leftIndex === undefined) {
      return 1;
    }

    if (rightIndex === undefined) {
      return -1;
    }

    return leftIndex - rightIndex;
  });

  if (!currentCustomTemplate) {
    return orderedItems;
  }

  const linkedSavedTemplate = typeof currentCustomTemplate.libraryTemplateId === "string"
    ? savedTemplates.find((record) => record.id === currentCustomTemplate.libraryTemplateId)
    : undefined;
  if (linkedSavedTemplate && areCustomTemplatesEquivalent(currentCustomTemplate, linkedSavedTemplate.template)) {
    return orderedItems;
  }

  return [
    {
      id: "custom-draft",
      value: "custom-draft",
      kind: "custom-draft",
      label: currentCustomTemplate.name || "Template Custom corrente",
      meta: linkedSavedTemplate
        ? "Modifiche correnti non ancora salvate nella libreria"
        : "Template corrente non ancora salvato nella libreria",
      locked: true,
    },
    ...orderedItems,
  ];
}
