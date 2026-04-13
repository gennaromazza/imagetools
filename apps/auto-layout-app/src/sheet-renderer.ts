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
  outputDirectoryPath?: string | null;
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

export function cmToPx(cm: number, dpi: number): number {
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

export function getRenderedSlotRect(
  page: GeneratedPageLayout,
  slot: GeneratedPageLayout["slotDefinitions"][number],
  trimX: number,
  trimY: number,
  trimWidth: number,
  trimHeight: number,
  dpi: number
): { x: number; y: number; width: number; height: number } {
  const marginPx = cmToPx(page.sheetSpec.marginCm, dpi);
  const innerWidth = trimWidth - marginPx * 2;
  const innerHeight = trimHeight - marginPx * 2;

  let x = trimX + marginPx + slot.x * innerWidth;
  let y = trimY + marginPx + slot.y * innerHeight;
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

function drawCropMarks(
  ctx: CanvasRenderingContext2D,
  trimX: number,
  trimY: number,
  trimWidth: number,
  trimHeight: number,
  bleedPx: number
) {
  if (bleedPx <= 0) {
    return;
  }

  const markLength = Math.max(6, Math.min(bleedPx * 0.8, 24));
  const markInset = Math.max(2, Math.min(bleedPx * 0.3, 10));

  ctx.save();
  ctx.strokeStyle = "rgba(20, 16, 12, 0.9)";
  ctx.lineWidth = 1;

  // Top-left
  ctx.beginPath();
  ctx.moveTo(trimX - markInset - markLength, trimY);
  ctx.lineTo(trimX - markInset, trimY);
  ctx.moveTo(trimX, trimY - markInset - markLength);
  ctx.lineTo(trimX, trimY - markInset);

  // Top-right
  ctx.moveTo(trimX + trimWidth + markInset, trimY);
  ctx.lineTo(trimX + trimWidth + markInset + markLength, trimY);
  ctx.moveTo(trimX + trimWidth, trimY - markInset - markLength);
  ctx.lineTo(trimX + trimWidth, trimY - markInset);

  // Bottom-left
  ctx.moveTo(trimX - markInset - markLength, trimY + trimHeight);
  ctx.lineTo(trimX - markInset, trimY + trimHeight);
  ctx.moveTo(trimX, trimY + trimHeight + markInset);
  ctx.lineTo(trimX, trimY + trimHeight + markInset + markLength);

  // Bottom-right
  ctx.moveTo(trimX + trimWidth + markInset, trimY + trimHeight);
  ctx.lineTo(trimX + trimWidth + markInset + markLength, trimY + trimHeight);
  ctx.moveTo(trimX + trimWidth, trimY + trimHeight + markInset);
  ctx.lineTo(trimX + trimWidth, trimY + trimHeight + markInset + markLength);

  ctx.stroke();
  ctx.restore();
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
  const croppedImageAspect = crop.sw / Math.max(crop.sh, 0.001);
  const renderAssignment = {
    ...assignment,
    cropLeft: 0,
    cropTop: 0,
    cropWidth: 1,
    cropHeight: 1
  };
  const metrics = getAssignmentCanvasDrawMetrics(renderAssignment, croppedImageAspect, width, height);

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
  const bleedCm = Math.max(0, page.sheetSpec.bleedCm ?? 0);
  const bleedPx = cmToPx(bleedCm, dpi);
  const trimWidth = cmToPx(page.sheetSpec.widthCm, dpi);
  const trimHeight = cmToPx(page.sheetSpec.heightCm, dpi);
  const canvas = document.createElement("canvas");
  canvas.width = trimWidth + bleedPx * 2;
  canvas.height = trimHeight + bleedPx * 2;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D non disponibile nel runtime corrente.");
  }
  const trimX = bleedPx;
  const trimY = bleedPx;

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
      trimX,
      trimY,
      trimWidth,
      trimHeight,
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

  ctx.save();
  ctx.strokeStyle = "rgba(255, 134, 92, 0.92)";
  ctx.lineWidth = Math.max(1, Math.round(canvas.width / 1500));
  ctx.strokeRect(trimX, trimY, trimWidth, trimHeight);
  ctx.restore();

  drawCropMarks(ctx, trimX, trimY, trimWidth, trimHeight, bleedPx);

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

async function writeToDesktopFile(absolutePath: string, blob: Blob): Promise<void> {
  if (typeof window === "undefined" || typeof window.filexDesktop?.writeFile !== "function") {
    throw new Error("Scrittura desktop non disponibile.");
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const ok = await window.filexDesktop.writeFile(absolutePath, bytes);
  if (!ok) {
    throw new Error(`Impossibile salvare il file su disco: ${absolutePath}`);
  }
}

function joinOutputPath(directoryPath: string, fileName: string): string {
  const separator = directoryPath.includes("\\") ? "\\" : "/";
  return directoryPath.endsWith(separator) ? `${directoryPath}${fileName}` : `${directoryPath}${separator}${fileName}`;
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

      if (options.outputDirectoryPath && typeof window.filexDesktop?.writeFile === "function") {
        const absolutePath = joinOutputPath(options.outputDirectoryPath, fileName);
        await writeToDesktopFile(absolutePath, blob);
      } else if (options.directoryHandle) {
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
      savedToDirectory: Boolean(options.directoryHandle || options.outputDirectoryPath)
    };
  });
}
