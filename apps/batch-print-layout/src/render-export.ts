import { jsPDF } from "jspdf";
import JSZip from "jszip";
import * as UTIF from "utif";
import type {
  BatchCropState,
  BatchPrintPage,
  ExportFormat,
  GridLayout,
  ImageAdjustmentSpec,
  LogoOverlaySpec,
  PhotoAsset,
  PhotoPrintSpec,
  PrintSheetSpec,
} from "./print-engine";
import { cmToPx } from "./print-engine";

export interface RenderInputs {
  assetsById: Map<string, PhotoAsset>;
  cropsById: Map<string, BatchCropState>;
  printSpec: PhotoPrintSpec;
  layout: GridLayout;
  logo: LogoOverlaySpec;
  adjustments: ImageAdjustmentSpec;
}

interface ExportOptions extends RenderInputs {
  pages: BatchPrintPage[];
  sheetSpec: PrintSheetSpec;
  format: ExportFormat;
  outputDirectoryPath?: string | null;
  fileNamePrefix: string;
  quality: number;
  onProgress?: (completed: number, total: number, label: string) => void;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Impossibile caricare immagine: ${src}`));
    image.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Impossibile creare il file di stampa."));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality,
    );
  });
}

function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

function joinOutputPath(directoryPath: string, fileName: string): string {
  const separator = directoryPath.includes("\\") ? "\\" : "/";
  return directoryPath.endsWith(separator) ? `${directoryPath}${fileName}` : `${directoryPath}${separator}${fileName}`;
}

async function saveBytes(fileName: string, bytes: Uint8Array, outputDirectoryPath?: string | null): Promise<string | null> {
  if (outputDirectoryPath && typeof window.filexDesktop?.writeFile === "function") {
    const absolutePath = joinOutputPath(outputDirectoryPath, fileName);
    const ok = await window.filexDesktop.writeFile(absolutePath, bytes);
    if (!ok) {
      throw new Error(`Impossibile salvare ${absolutePath}`);
    }
    return absolutePath;
  }

  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([buffer]);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return null;
}

async function downloadZip(fileName: string, files: Array<{ name: string; bytes: Uint8Array }>): Promise<void> {
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.name, file.bytes);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function drawLogo(ctx: CanvasRenderingContext2D, logoImage: HTMLImageElement, logo: LogoOverlaySpec, width: number, height: number): void {
  if (!logo.enabled || logo.opacity <= 0 || logo.scalePct <= 0) {
    return;
  }

  const maxLogoWidth = width * (logo.scalePct / 100);
  const maxLogoHeight = height * (logo.scalePct / 100);
  const logoScale = Math.min(
    maxLogoWidth / Math.max(logoImage.naturalWidth, 1),
    maxLogoHeight / Math.max(logoImage.naturalHeight, 1),
  );
  const logoWidth = Math.max(1, logoImage.naturalWidth * logoScale);
  const logoHeight = Math.max(1, logoImage.naturalHeight * logoScale);
  const margin = Math.min(width, height) * (logo.marginPct / 100);

  let x = margin;
  let y = margin;
  if (logo.position.includes("right")) x = width - logoWidth - margin;
  if (logo.position.includes("bottom")) y = height - logoHeight - margin;
  if (logo.position === "center") {
    x = (width - logoWidth) / 2;
    y = (height - logoHeight) / 2;
  }

  ctx.save();
  ctx.globalAlpha = logo.opacity;
  ctx.drawImage(logoImage, x, y, logoWidth, logoHeight);
  ctx.restore();
}

function drawLogoFollowingPhotoRotation(
  ctx: CanvasRenderingContext2D,
  logoImage: HTMLImageElement,
  logo: LogoOverlaySpec,
  width: number,
  height: number,
  rotation: number,
): void {
  if (!logo.enabled || logo.opacity <= 0 || logo.scalePct <= 0) {
    return;
  }

  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const quarterTurn = Math.abs(normalizedRotation - 90) < 0.001 || Math.abs(normalizedRotation - 270) < 0.001;
  const logoBoxWidth = quarterTurn ? height : width;
  const logoBoxHeight = quarterTurn ? width : height;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  ctx.translate(width / 2, height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.translate(-logoBoxWidth / 2, -logoBoxHeight / 2);
  drawLogo(ctx, logoImage, logo, logoBoxWidth, logoBoxHeight);
  ctx.restore();
}

function drawCroppedImageCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  crop: BatchCropState,
  width: number,
  height: number,
): void {
  const sx = crop.cropLeft * image.naturalWidth;
  const sy = crop.cropTop * image.naturalHeight;
  const sw = crop.cropWidth * image.naturalWidth;
  const sh = crop.cropHeight * image.naturalHeight;
  const sourceAspect = sw / Math.max(sh, 1);
  const angle = (crop.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const coverScale = Math.max(
    width / Math.max(sourceAspect * cos + sin, 0.001),
    height / Math.max(sourceAspect * sin + cos, 0.001),
  );
  const drawHeight = coverScale;
  const drawWidth = drawHeight * sourceAspect;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(angle);
  ctx.drawImage(image, sx, sy, sw, sh, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  ctx.restore();
}

function drawCroppedImageContain(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  crop: BatchCropState,
  width: number,
  height: number,
): void {
  const sx = crop.cropLeft * image.naturalWidth;
  const sy = crop.cropTop * image.naturalHeight;
  const sw = crop.cropWidth * image.naturalWidth;
  const sh = crop.cropHeight * image.naturalHeight;
  const sourceAspect = sw / Math.max(sh, 1);
  const angle = (crop.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const containScale = Math.min(
    width / Math.max(sourceAspect * cos + sin, 0.001),
    height / Math.max(sourceAspect * sin + cos, 0.001),
  );
  const drawHeight = containScale;
  const drawWidth = drawHeight * sourceAspect;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(angle);
  ctx.drawImage(image, sx, sy, sw, sh, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  ctx.restore();
}

async function renderPhotoCanvas(
  asset: PhotoAsset,
  crop: BatchCropState | undefined,
  printSpec: PhotoPrintSpec,
  logoImage: HTMLImageElement | null,
  logo: LogoOverlaySpec,
  adjustments: ImageAdjustmentSpec,
): Promise<HTMLCanvasElement> {
  const image = await loadImage(asset.sourceUrl || asset.previewUrl);
  const width = cmToPx(printSpec.widthCm, printSpec.dpi);
  const height = cmToPx(printSpec.heightCm, printSpec.dpi);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D non disponibile.");
  }

  const effectiveCrop = crop ?? {
    assetId: asset.id,
    cropLeft: 0,
    cropTop: 0,
    cropWidth: 1,
    cropHeight: 1,
    rotation: 0,
    reviewed: false,
  };
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  if (adjustments.blackAndWhiteEnabled) {
    ctx.filter = "grayscale(1)";
  }
  if (adjustments.fitMode === "contain") {
    drawCroppedImageContain(ctx, image, effectiveCrop, width, height);
  } else {
    drawCroppedImageCover(ctx, image, effectiveCrop, width, height);
  }
  ctx.restore();

  if (logoImage) {
    drawLogoFollowingPhotoRotation(ctx, logoImage, logo, width, height, effectiveCrop.rotation);
  }

  return canvas;
}

export async function renderPageCanvas(page: BatchPrintPage, inputs: RenderInputs): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = inputs.layout.sheetWidthPx;
  canvas.height = inputs.layout.sheetHeightPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D non disponibile.");
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const logoImage = inputs.logo.enabled && inputs.logo.imageUrl ? await loadImage(inputs.logo.imageUrl) : null;

  for (const slot of page.slots) {
    const asset = inputs.assetsById.get(slot.assetId);
    if (!asset) {
      continue;
    }

    const photoCanvas = await renderPhotoCanvas(
      asset,
      inputs.cropsById.get(asset.id),
      inputs.printSpec,
      logoImage,
      inputs.logo,
      inputs.adjustments,
    );

    if (inputs.layout.photoRotated) {
      ctx.save();
      ctx.translate(slot.x + slot.width / 2, slot.y + slot.height / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(photoCanvas, -slot.height / 2, -slot.width / 2, slot.height, slot.width);
      ctx.restore();
    } else {
      ctx.drawImage(photoCanvas, slot.x, slot.y, slot.width, slot.height);
    }
  }

  return canvas;
}

function buildPageFileName(prefix: string, pageNumber: number, ext: string): string {
  return `${prefix || "batch-print"}-${String(pageNumber).padStart(3, "0")}.${ext}`;
}

async function exportRasterPage(canvas: HTMLCanvasElement, format: Exclude<ExportFormat, "pdf">, quality: number): Promise<Uint8Array> {
  if (format === "tif") {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas 2D non disponibile.");
    }
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return new Uint8Array(UTIF.encodeImage(new Uint8Array(rgba), canvas.width, canvas.height));
  }

  const mimeType = format === "jpg" ? "image/jpeg" : "image/png";
  const blob = await canvasToBlob(canvas, mimeType, format === "jpg" ? quality : undefined);
  return blobToBytes(blob);
}

export async function exportBatch(options: ExportOptions): Promise<string[]> {
  const exportedFiles: string[] = [];

  if (options.format === "pdf") {
    const orientation = options.layout.sheetWidthPx >= options.layout.sheetHeightPx ? "l" : "p";
    const pdf = new jsPDF({
      orientation,
      unit: "cm",
      format: [options.sheetSpec.widthCm, options.sheetSpec.heightCm],
      compress: false,
    });

    for (let index = 0; index < options.pages.length; index += 1) {
      const page = options.pages[index];
      options.onProgress?.(index, options.pages.length, `Foglio ${page.pageNumber}`);
      const canvas = await renderPageCanvas(page, options);
      if (index > 0) {
        pdf.addPage([options.sheetSpec.widthCm, options.sheetSpec.heightCm], orientation);
      }
      pdf.addImage(canvas.toDataURL("image/jpeg", 1), "JPEG", 0, 0, options.sheetSpec.widthCm, options.sheetSpec.heightCm, undefined, "NONE");
    }

    const bytes = new Uint8Array(pdf.output("arraybuffer"));
    const fileName = `${options.fileNamePrefix || "batch-print"}.pdf`;
    await saveBytes(fileName, bytes, options.outputDirectoryPath);
    options.onProgress?.(options.pages.length, options.pages.length, fileName);
    return [fileName];
  }

  if (!options.outputDirectoryPath && options.pages.length > 1) {
    const zipFiles: Array<{ name: string; bytes: Uint8Array }> = [];
    for (let index = 0; index < options.pages.length; index += 1) {
      const page = options.pages[index];
      const fileName = buildPageFileName(options.fileNamePrefix, page.pageNumber, options.format);
      options.onProgress?.(index, options.pages.length, fileName);
      const canvas = await renderPageCanvas(page, options);
      const bytes = await exportRasterPage(canvas, options.format, options.quality);
      zipFiles.push({ name: fileName, bytes });
      exportedFiles.push(fileName);
      options.onProgress?.(index + 1, options.pages.length, fileName);
    }
    const zipName = `${options.fileNamePrefix || "batch-print"}.zip`;
    await downloadZip(zipName, zipFiles);
    return [zipName];
  }

  for (let index = 0; index < options.pages.length; index += 1) {
    const page = options.pages[index];
    const fileName = buildPageFileName(options.fileNamePrefix, page.pageNumber, options.format);
    options.onProgress?.(index, options.pages.length, fileName);
    const canvas = await renderPageCanvas(page, options);
    const bytes = await exportRasterPage(canvas, options.format, options.quality);
    await saveBytes(fileName, bytes, options.outputDirectoryPath);
    exportedFiles.push(fileName);
    options.onProgress?.(index + 1, options.pages.length, fileName);
  }

  return exportedFiles;
}
