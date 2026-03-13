import type {
  AutoLayoutResult,
  GeneratedPageLayout,
  ImageAsset,
  LayoutAssignment,
  OutputFormat
} from "@photo-tools/shared-types";

const imageCache = new Map<string, Promise<HTMLImageElement>>();

interface ExportOptions {
  directoryHandle?: FileSystemDirectoryHandle | null;
}

interface ExportResult {
  exportedFiles: string[];
  effectiveFormat: "jpg" | "png";
  savedToDirectory: boolean;
}

function cmToPx(cm: number, dpi: number): number {
  return Math.round((cm / 2.54) * dpi);
}

function getAssetUrl(asset: ImageAsset): string | undefined {
  return asset.sourceUrl ?? asset.previewUrl;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(url);
  if (cached) {
    return cached;
  }

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Impossibile caricare l'anteprima ${url}.`));
    image.src = url;
  });

  imageCache.set(url, promise);
  return promise;
}

function getMimeType(format: "jpg" | "png"): string {
  return format === "jpg" ? "image/jpeg" : "image/png";
}

function resolveEffectiveFormat(format: OutputFormat): "jpg" | "png" {
  return format === "png" ? "png" : "jpg";
}

function buildFileName(result: AutoLayoutResult, page: GeneratedPageLayout, effectiveFormat: "jpg" | "png"): string {
  return `${result.request.output.fileNamePattern.replace("{index}", String(page.pageNumber))}.${effectiveFormat}`;
}

function getAssignmentTransform(
  assignment: LayoutAssignment,
  slotWidth: number,
  slotHeight: number
): { translateX: number; translateY: number; scale: number; rotationRad: number } {
  return {
    translateX: (assignment.offsetX / 100) * slotWidth * 0.22,
    translateY: (assignment.offsetY / 100) * slotHeight * 0.22,
    scale: Math.max(0.4, assignment.zoom),
    rotationRad: (assignment.rotation * Math.PI) / 180
  };
}

async function drawAssignment(
  ctx: CanvasRenderingContext2D,
  asset: ImageAsset,
  assignment: LayoutAssignment,
  x: number,
  y: number,
  width: number,
  height: number
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

  const image = await loadImage(assetUrl);
  const baseScale =
    assignment.fitMode === "fit"
      ? Math.min(width / image.naturalWidth, height / image.naturalHeight)
      : Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const transform = getAssignmentTransform(assignment, width, height);
  const drawWidth = image.naturalWidth * baseScale * transform.scale;
  const drawHeight = image.naturalHeight * baseScale * transform.scale;

  ctx.translate(x + width / 2, y + height / 2);
  ctx.rotate(transform.rotationRad);
  ctx.drawImage(
    image,
    -drawWidth / 2 + transform.translateX,
    -drawHeight / 2 + transform.translateY,
    drawWidth,
    drawHeight
  );
  ctx.restore();
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
  const innerWidth = canvas.width - marginPx * 2;
  const innerHeight = canvas.height - marginPx * 2;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const slot of page.slotDefinitions) {
    const slotX = marginPx + slot.x * innerWidth;
    const slotY = marginPx + slot.y * innerHeight;
    const slotWidth = slot.width * innerWidth;
    const slotHeight = slot.height * innerHeight;
    const assignment = page.assignments.find((item) => item.slotId === slot.id);

    ctx.fillStyle = "#f1ebe4";
    ctx.fillRect(slotX, slotY, slotWidth, slotHeight);

    if (assignment) {
      const asset = assetsById.get(assignment.imageId);
      if (asset) {
        await drawAssignment(ctx, asset, assignment, slotX, slotY, slotWidth, slotHeight);
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
  const assetsById = new Map(result.request.assets.map((asset) => [asset.id, asset]));
  const effectiveFormat = resolveEffectiveFormat(result.request.output.format);
  const exportedFiles: string[] = [];

  for (const page of result.pages) {
    const canvas = await renderSheetPage(page, assetsById);
    const blob = await canvasToBlob(canvas, effectiveFormat, result.request.output.quality);
    const fileName = buildFileName(result, page, effectiveFormat);

    if (options.directoryHandle) {
      await writeToDirectory(options.directoryHandle, fileName, blob);
    } else {
      triggerDownload(blob, fileName);
    }

    exportedFiles.push(fileName);
  }

  return {
    exportedFiles,
    effectiveFormat,
    savedToDirectory: Boolean(options.directoryHandle)
  };
}
