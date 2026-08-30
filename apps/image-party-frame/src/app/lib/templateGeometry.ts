import type { CustomTemplate, CustomTemplateVariant } from "../contexts/ProjectContext";
import {
  getPartyFramePreset,
  orientPartyFramePreset,
  presetFrameDataUrl,
} from "../../../server/templateCatalog";

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

export function getTemplateGeometry(templateId: string, orientation: ImageOrientation): TemplateGeometry {
  const preset = orientPartyFramePreset(getPartyFramePreset(templateId), orientation);
  return {
    width: preset.width,
    height: preset.height,
    photoAreaX: preset.photoAreaX,
    photoAreaY: preset.photoAreaY,
    photoAreaWidth: preset.photoAreaWidth,
    photoAreaHeight: preset.photoAreaHeight,
  };
}

export function getPresetFrameDataUrl(templateId: string, orientation: ImageOrientation): string {
  return presetFrameDataUrl(orientPartyFramePreset(getPartyFramePreset(templateId), orientation));
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
