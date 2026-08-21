import type { ImageConverterJobConfig, ImageConverterPreset } from "@photo-tools/desktop-contracts";

const OUTPUT_ROOT_NAME = "Image Converter Output";

export function resolveImageConverterMaxLongEdge(
  config: ImageConverterJobConfig,
  preset: ImageConverterPreset,
): number {
  const value = Number(config.overrides?.maxLongEdge);
  if (Number.isFinite(value) && value >= 200 && value <= 12000) return Math.round(value);
  return preset.maxLongEdge;
}

export function resolveImageConverterTargetMaxBytes(config: ImageConverterJobConfig): number | null {
  const value = Number(config.overrides?.targetMaxBytesMb);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(Math.min(value, 200) * 1024 * 1024);
}

export function isInsideImageConverterOutput(pathValue: string): boolean {
  return pathValue
    .split(/[\\/]+/u)
    .some((part) => part.toLocaleLowerCase("en-US") === OUTPUT_ROOT_NAME.toLocaleLowerCase("en-US"));
}
