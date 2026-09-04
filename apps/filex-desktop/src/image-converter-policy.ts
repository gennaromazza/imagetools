import type { ImageConverterJobConfig, ImageConverterOutputFormat, ImageConverterPreset } from "@photo-tools/desktop-contracts";

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

export function resolveImageConverterFormat(
  config: ImageConverterJobConfig,
  preset: ImageConverterPreset,
): ImageConverterOutputFormat {
  const override = config.overrides?.format;
  if ((override === "jpg" || override === "webp") && preset.format !== "dng") return override;
  return preset.format;
}

export function resolveImageConverterQuality(
  config: ImageConverterJobConfig,
  preset: ImageConverterPreset,
): number {
  const value = Number(config.overrides?.quality);
  if (Number.isFinite(value)) return Math.max(1, Math.min(100, Math.round(value)));
  return preset.quality;
}

export function resolveImageConverterKeepMetadata(config: ImageConverterJobConfig): boolean {
  return config.overrides?.keepMetadata !== false;
}

export function resolveImageConverterOutputDirectory(config: ImageConverterJobConfig): string | null {
  const value = config.overrides?.outputDirectory;
  if (typeof value !== "string" || value.trim().length === 0) return null;
  return value;
}

export function isInsideImageConverterOutput(pathValue: string): boolean {
  return pathValue
    .split(/[\\/]+/u)
    .some((part) => part.toLocaleLowerCase("en-US") === OUTPUT_ROOT_NAME.toLocaleLowerCase("en-US"));
}
