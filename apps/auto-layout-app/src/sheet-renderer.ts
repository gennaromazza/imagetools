import type {
  AutoLayoutResult,
  GeneratedPageLayout,
  ImageAsset,
  LayoutAssignment,
  OutputFormat
} from "@photo-tools/shared-types";
import { getAssignmentCanvasDrawMetrics, getNormalizedAssignmentCrop } from "./utils/assignment-rendering";
import { loadDecodedImage } from "./image-cache";
import { measureAsync } from "./performance-utils";

interface ExportOptions {
  directoryHandle?: FileSystemDirectoryHandle | null;
  onProgress?: (update: ExportProgressUpdate) => void;
}

interface ExportResult {
  exportedFiles: string[];
  effectiveFormat: "jpg" | "png";
  savedToDirectory: boolean;
}

export interface ExportProgressUpdate {
  completed: number;
  total: number;
  fileName: string;
  pageNumber: number;
  stage: "rendering" | "saving" | "completed";
}

function cmToPx(cm: number, dpi: number): number {
  return Math.round((cm / 2.54) * dpi);
}

function getAssetUrl(asset: ImageAsset): string | undefined {
  return asset.sourceUrl ?? asset.previewUrl;
}

function getMimeType(format: "jpg" | "png"): string {
  return format === "jpg" ? "image/jpeg" : "image/png";
}

function resolveEffectiveFormat(format: OutputFormat): "jpg" | "png" {
  return format === "png" ? "png" : "jpg";
}

function getRenderedSlotRect(
  page: GeneratedPageLayout,
  slot: GeneratedPageLayout["slotDefinitions"][number],
  canvasWidth: number,
  canvasHeight: number,
  dpi: number
): { x: number; y: number; width: number; height: number } {
  const marginPx = cmToPx(page.sheetSpec.marginCm, dpi);
  const innerWidth = canvasWidth - marginPx * 2;
  const innerHeight = canvasHeight - marginPx * 2;

  let x = marginPx + slot.x * innerWidth;
  let y = marginPx + slot.y * innerHeight;
  let width = slot.width * innerWidth;
  let height = slot.height * innerHeight;

  if (page.slotDefinitions.length > 1 && page.sheetSpec.gapCm > 0) {
    const gapInset = Math.min(cmToPx(page.sheetSpec.gapCm, dpi) / 2, Math.min(width, height) / 3);
    x += gapInset;
    y += gapInset;
    width = Math.max(2, width - gapInset * 2);
    height = Math.max(2, height - gapInset * 2);
  }

  return { x, y, width, height };
}

function buildFileName(result: AutoLayoutResult, page: GeneratedPageLayout, effectiveFormat: "jpg" | "png"): string {
  return `${result.request.output.fileNamePattern.replace("{index}", String(page.pageNumber))}.${effectiveFormat}`;
}

function getAssignmentCrop(assignment: LayoutAssignment, image: HTMLImageElement) {
  const { cropLeft, cropTop, cropWidth, cropHeight } = getNormalizedAssignmentCrop(assignment);

  return {
    sx: cropLeft * image.naturalWidth,
    sy: cropTop * image.naturalHeight,
    sw: cropWidth * image.naturalWidth,
    sh: cropHeight * image.naturalHeight
  };
}

async function drawAssignment(
  ctx: CanvasRenderingContext2D,
  asset: ImageAsset,
  assignment: LayoutAssignment,
  x: number,
  y: number,
  width: number,
  height: number,
  borderColor: string,
  borderWidthPx: number
): Promise<void> {
  const assetUrl = getAssetUrl(asset);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();

  if (!assetUrl) {
    ctx.fillStyle = "rgba(90, 78, 67, 0.12)";
    ctx.fillRect(x, y, width, height);
    ctx.restore();
    return;
  }

  const image = await loadDecodedImage(assetUrl);
  const crop = getAssignmentCrop(assignment, image);
  const imageAspect = crop.sw / Math.max(crop.sh, 0.001);
  const metrics = getAssignmentCanvasDrawMetrics(assignment, imageAspect, width, height);

  ctx.translate(x + width / 2, y + height / 2);
  ctx.rotate(metrics.rotationRad);
  ctx.drawImage(
    image,
    crop.sx,
    crop.sy,
    crop.sw,
    crop.sh,
    -metrics.drawWidth / 2 + metrics.translateX,
    -metrics.drawHeight / 2 + metrics.translateY,
    metrics.drawWidth,
    metrics.drawHeight
  );
  ctx.restore();

  if (borderWidthPx > 0) {
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = borderWidthPx;
    ctx.strokeRect(
      x + borderWidthPx / 2,
      y + borderWidthPx / 2,
      Math.max(0, width - borderWidthPx),
      Math.max(0, height - borderWidthPx)
    );
  }
}

export async function renderSheetPage(
  page: GeneratedPageLayout,
  assetsById: Map<string, ImageAsset>,
  dpi = page.sheetSpec.dpi
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = cmToPx(page.sheetSpec.widthCm, dpi);
  canvas.height = cmToPx(page.sheetSpec.heightCm, dpi);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D non disponibile nel browser corrente.");
  }

  const marginPx = cmToPx(page.sheetSpec.marginCm, dpi);

  ctx.fillStyle = page.sheetSpec.backgroundColor || "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (page.sheetSpec.backgroundImageUrl) {
    try {
      const backgroundImage = await loadDecodedImage(page.sheetSpec.backgroundImageUrl);
      ctx.drawImage(backgroundImage, 0, 0, canvas.width, canvas.height);
    } catch {
      // Ignore invalid background image and keep fallback color
    }
  }

  const borderWidthPx = cmToPx(page.sheetSpec.photoBorderWidthCm ?? 0, dpi);
  const borderColor = page.sheetSpec.photoBorderColor || "#ffffff";

  for (const slot of page.slotDefinitions) {
    const { x: slotX, y: slotY, width: slotWidth, height: slotHeight } = getRenderedSlotRect(
      page,
      slot,
      canvas.width,
      canvas.height,
      dpi
    );
    const assignment = page.assignments.find((item) => item.slotId === slot.id);

    if (assignment) {
      const asset = assetsById.get(assignment.imageId);
      if (asset) {
        await drawAssignment(ctx, asset, assignment, slotX, slotY, slotWidth, slotHeight, borderColor, borderWidthPx);
      }
    }

    ctx.strokeStyle = "rgba(80, 61, 45, 0.12)";
    ctx.lineWidth = Math.max(1, Math.round(canvas.width / 1200));
    ctx.strokeRect(slotX, slotY, slotWidth, slotHeight);
  }

  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, format: "jpg" | "png", quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Impossibile creare il file esportato."));
          return;
        }

        resolve(blob);
      },
      getMimeType(format),
      format === "jpg" ? Math.min(1, Math.max(0.1, quality / 100)) : undefined
    );
  });
}

function triggerDownload(blob: Blob, fileName: string): void {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

async function writeToDirectory(
  directoryHandle: FileSystemDirectoryHandle,
  fileName: string,
  blob: Blob
): Promise<void> {
  const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export async function exportSheets(
  result: AutoLayoutResult,
  options: ExportOptions = {}
): Promise<ExportResult> {
  return measureAsync("export-sheets", async () => {
    const assetsById = new Map(result.request.assets.map((asset) => [asset.id, asset]));
    const effectiveFormat = resolveEffectiveFormat(result.request.output.format);
    const exportedFiles: string[] = [];

    for (const page of result.pages) {
      const fileName = buildFileName(result, page, effectiveFormat);
      options.onProgress?.({
        completed: exportedFiles.length,
        total: result.pages.length,
        fileName,
        pageNumber: page.pageNumber,
        stage: "rendering"
      });

      const canvas = await renderSheetPage(page, assetsById);
      options.onProgress?.({
        completed: exportedFiles.length,
        total: result.pages.length,
        fileName,
        pageNumber: page.pageNumber,
        stage: "saving"
      });
      const blob = await canvasToBlob(canvas, effectiveFormat, result.request.output.quality);

      if (options.directoryHandle) {
        await writeToDirectory(options.directoryHandle, fileName, blob);
      } else {
        triggerDownload(blob, fileName);
      }

      exportedFiles.push(fileName);
      options.onProgress?.({
        completed: exportedFiles.length,
        total: result.pages.length,
        fileName,
        pageNumber: page.pageNumber,
        stage: "completed"
      });
    }

    return {
      exportedFiles,
      effectiveFormat,
      savedToDirectory: Boolean(options.directoryHandle)
    };
  });
}
