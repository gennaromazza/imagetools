import type { ExportFormat } from "@photo-tools/batch-print-layout/print-engine";
import { sanitizeFileNamePrefix } from "@photo-tools/batch-print-layout/render-export";

const IMAGE_FILE_PATTERN = /\.(?:jpe?g|png|webp|heic|heif|tiff?|psd)$/iu;

export interface IdPhotoOutputPlan {
  safeJobName: string;
  layoutPrefix: string;
  singlePhotoFileName: string;
  layoutDescription: string;
}

export function createIdPhotoOutputPlan(jobName: string, format: ExportFormat): IdPhotoOutputPlan {
  const safeName = sanitizeFileNamePrefix(jobName);
  return {
    safeJobName: safeName,
    layoutPrefix: `${safeName}-foglio`,
    singlePhotoFileName: `${safeName}-foto-singola.jpg`,
    layoutDescription: format === "pdf" ? "foglio PDF + foto singola JPG" : "foglio JPG + foto singola JPG",
  };
}

export function selectDroppedIdPhotoFile(files: FileList | readonly File[]): File | null {
  return Array.from(files).find((file) => file.type.startsWith("image/") || IMAGE_FILE_PATTERN.test(file.name)) ?? null;
}
