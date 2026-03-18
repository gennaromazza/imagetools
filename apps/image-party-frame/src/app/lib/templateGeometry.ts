import type { CustomTemplate, CustomTemplateVariant } from "../contexts/ProjectContext";

export type ImageOrientation = "vertical" | "horizontal";

export type TemplateGeometry = {
  width: number;
  height: number;
  photoAreaX: number;
  photoAreaY: number;
  photoAreaWidth: number;
  photoAreaHeight: number;
  borderSizePx?: number;
  borderColor?: string;
};

const baseTemplates: Record<string, TemplateGeometry> = {
  "classic-gold": {
    width: 1772,
    height: 1181,
    photoAreaX: 120,
    photoAreaY: 95,
    photoAreaWidth: 1530,
    photoAreaHeight: 990,
  },
  "modern-blue": {
    width: 1959,
    height: 1307,
    photoAreaX: 150,
    photoAreaY: 120,
    photoAreaWidth: 1659,
    photoAreaHeight: 1067,
  },
  floral: {
    width: 1772,
    height: 1181,
    photoAreaX: 140,
    photoAreaY: 105,
    photoAreaWidth: 1492,
    photoAreaHeight: 971,
  },
};

function rotateTemplateClockwise(template: TemplateGeometry): TemplateGeometry {
  return {
    width: template.height,
    height: template.width,
    photoAreaX: template.height - (template.photoAreaY + template.photoAreaHeight),
    photoAreaY: template.photoAreaX,
    photoAreaWidth: template.photoAreaHeight,
    photoAreaHeight: template.photoAreaWidth,
  };
}

export function getTemplateGeometry(templateId: string, orientation: ImageOrientation): TemplateGeometry {
  const baseTemplate = baseTemplates[templateId] ?? baseTemplates["classic-gold"];

  if (orientation === "vertical") {
    return rotateTemplateClockwise(baseTemplate);
  }

  return baseTemplate;
}

export function getProjectTemplateGeometry(
  templateId: string,
  orientation: ImageOrientation,
  customTemplate: CustomTemplate | null
): TemplateGeometry {
  if (templateId === "custom" && customTemplate) {
    const variant = customTemplate.variants[orientation] ?? customTemplate.variants.horizontal;
    return {
      width: variant.widthPx,
      height: variant.heightPx,
      photoAreaX: variant.photoAreaX,
      photoAreaY: variant.photoAreaY,
      photoAreaWidth: variant.photoAreaWidth,
      photoAreaHeight: variant.photoAreaHeight,
      borderSizePx: variant.borderSizePx,
      borderColor: variant.borderColor,
    };
  }

  return getTemplateGeometry(templateId, orientation);
}

export function cmToPx(cm: number, dpi: number): number {
  return Math.max(1, Math.round((cm / 2.54) * dpi));
}

export function getCustomTemplateVariant(
  customTemplate: CustomTemplate | null,
  orientation: ImageOrientation
): CustomTemplateVariant | null {
  if (!customTemplate) {
    return null;
  }

  return customTemplate.variants[orientation] ?? customTemplate.variants.horizontal;
}
