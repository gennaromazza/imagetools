import type { DesktopAtomicWriteFile, FileXDesktopApi } from "@photo-tools/desktop-contracts";
import type {
  BatchCropState,
  BatchPrintPage,
  ExportFormat,
  GridLayout,
  ImageAdjustmentSpec,
  LogoOverlaySpec,
  PhotoAsset,
  PhotoPrintSpec,
  PrintFinishingSpec,
} from "./print-engine";
import { cmToPx, getPhotoContentRectCm, getRenderSafetyError, mmToPx } from "./print-engine";

export interface RenderInputs {
  assetsById: Map<string, PhotoAsset>;
  cropsById: Map<string, BatchCropState>;
  printSpec: PhotoPrintSpec;
  layout: GridLayout;
  logo: LogoOverlaySpec;
  adjustments: ImageAdjustmentSpec;
  finishing: PrintFinishingSpec;
  renderDpi?: number;
}

export interface ExportCommittedFile {
  fileName: string;
  size: number;
  sha256: string;
}

export interface ExportBatchResult {
  files: string[];
  committedFiles: ExportCommittedFile[];
}

export interface ExportCommitContext {
  atomicTransactionId: string | null;
}

export function validateSupplementaryOutputFiles(files: readonly DesktopAtomicWriteFile[]): DesktopAtomicWriteFile[] {
  const names = new Set<string>();
  return files.map((file) => {
    const fileName = file.fileName.trim();
    const normalized = fileName.toLocaleLowerCase();
    if (!fileName || fileName === "." || fileName === ".." || /[\\/]/u.test(fileName)) {
      throw new Error("Nome file supplementare non valido.");
    }
    if (!(file.bytes instanceof Uint8Array) || file.bytes.byteLength === 0) {
      throw new Error(`Il file supplementare ${fileName} è vuoto.`);
    }
    if (names.has(normalized)) {
      throw new Error(`File supplementare duplicato: ${fileName}.`);
    }
    names.add(normalized);
    return { fileName, bytes: file.bytes };
  });
}

export interface ExportOptions extends RenderInputs {
  pages: BatchPrintPage[];
  format: ExportFormat;
  outputDirectoryPath?: string | null;
  fileNamePrefix: string;
  quality: number;
  onProgress?: (completed: number, total: number, label: string) => void;
  resolveAssetForExport?: (
    asset: PhotoAsset,
    requiredMaxDimension: number,
  ) => Promise<{ asset: PhotoAsset; release?: () => void }>;
  validateBeforeSave?: () => Promise<void> | void;
  requireDesktopAtomicTransaction?: boolean;
  supplementaryFiles?: DesktopAtomicWriteFile[];
  onCommittedFiles?: (
    files: ExportCommittedFile[],
    context: ExportCommitContext,
  ) => void | Promise<void>;
}

type AssetExportResolver = NonNullable<ExportOptions["resolveAssetForExport"]>;

interface PageAssetResolutionGroup {
  representative: PhotoAsset;
  slotAssetIds: string[];
}

type DesktopAtomicWriteTransactionApi = Pick<
  FileXDesktopApi,
  | "beginAtomicWriteTransaction"
  | "stageAtomicWriteTransactionFile"
  | "commitAtomicWriteTransaction"
  | "finalizeAtomicWriteTransaction"
  | "rollbackAtomicWriteTransaction"
>;

type AtomicOutputProducer = (
  stageFile: (file: DesktopAtomicWriteFile) => Promise<void>,
) => Promise<void>;

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

export async function fingerprintPreparedOutput(
  fileName: string,
  bytes: Uint8Array,
): Promise<ExportCommittedFile> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { fileName, size: bytes.byteLength, sha256 };
}

function assertPreparedOutputMetadata(
  preparedFiles: ExportCommittedFile[],
  expectedCount: number,
): void {
  if (preparedFiles.length !== expectedCount || preparedFiles.some((file) => (
    !file.fileName
    || !Number.isSafeInteger(file.size)
    || file.size < 0
    || !/^[a-f0-9]{64}$/i.test(file.sha256)
  ))) {
    throw new Error("Le impronte dei file preparati sono incomplete o non valide.");
  }
}

export function mapCommittedOutputMetadata(
  preparedFiles: ExportCommittedFile[],
  savedFileNames: string[],
): ExportCommittedFile[] {
  assertPreparedOutputMetadata(preparedFiles, savedFileNames.length);
  if (savedFileNames.some((fileName) => !fileName)) {
    throw new Error("I nomi dei file pubblicati non sono validi.");
  }
  return preparedFiles.map((file, index) => ({
    ...file,
    fileName: savedFileNames[index],
  }));
}

async function notifyCommittedFiles(
  options: ExportOptions,
  preparedFiles: ExportCommittedFile[],
  savedFileNames: string[],
  context: ExportCommitContext = { atomicTransactionId: null },
): Promise<void> {
  if (!options.onCommittedFiles) return;
  await options.onCommittedFiles(mapCommittedOutputMetadata(preparedFiles, savedFileNames), context);
}

function joinOutputPath(directoryPath: string, fileName: string): string {
  const separator = directoryPath.includes("\\") ? "\\" : "/";
  return directoryPath.endsWith(separator) ? `${directoryPath}${fileName}` : `${directoryPath}${separator}${fileName}`;
}

function splitFileName(fileName: string): { stem: string; extension: string } {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > 0
    ? { stem: fileName.slice(0, dotIndex), extension: fileName.slice(dotIndex) }
    : { stem: fileName, extension: "" };
}

async function resolveAvailableDesktopFileName(directoryPath: string, requestedFileName: string): Promise<string> {
  if (typeof window.filexDesktop?.statFiles !== "function") {
    return requestedFileName;
  }

  const { stem, extension } = splitFileName(requestedFileName);
  for (let suffix = 1; suffix <= 9999; suffix += 1) {
    const candidate = suffix === 1 ? requestedFileName : `${stem}-${suffix}${extension}`;
    const absolutePath = joinOutputPath(directoryPath, candidate);
    const existing = await window.filexDesktop.statFiles([absolutePath]);
    if (existing.length === 0) {
      return candidate;
    }
  }
  throw new Error(`Troppi file omonimi per ${requestedFileName}. Cambia il nome dell'export.`);
}

async function saveBytes(fileName: string, bytes: Uint8Array, outputDirectoryPath?: string | null): Promise<string> {
  if (outputDirectoryPath && typeof window.filexDesktop?.writeFile === "function") {
    const availableFileName = await resolveAvailableDesktopFileName(outputDirectoryPath, fileName);
    const absolutePath = joinOutputPath(outputDirectoryPath, availableFileName);
    const ok = await window.filexDesktop.writeFile(absolutePath, bytes);
    if (!ok) {
      throw new Error(`Impossibile salvare ${absolutePath}`);
    }
    return availableFileName;
  }

  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([buffer]);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return fileName;
}

async function savePreparedFiles(
  files: Array<{ fileName: string; bytes: Uint8Array }>,
  outputDirectoryPath?: string | null,
): Promise<string[]> {
  if (outputDirectoryPath && typeof window.filexDesktop?.writeFilesAtomically === "function") {
    return window.filexDesktop.writeFilesAtomically(outputDirectoryPath, files);
  }
  const savedFileNames: string[] = [];
  for (const file of files) {
    savedFileNames.push(await saveBytes(file.fileName, file.bytes, outputDirectoryPath));
  }
  return savedFileNames;
}

function getDesktopAtomicWriteTransactionApi(): DesktopAtomicWriteTransactionApi | null {
  const api = window.filexDesktop;
  if (
    typeof api?.beginAtomicWriteTransaction !== "function"
    || typeof api.stageAtomicWriteTransactionFile !== "function"
    || typeof api.commitAtomicWriteTransaction !== "function"
    || typeof api.finalizeAtomicWriteTransaction !== "function"
    || typeof api.rollbackAtomicWriteTransaction !== "function"
  ) {
    return null;
  }
  return api;
}

export async function runDesktopAtomicWriteTransaction(
  api: DesktopAtomicWriteTransactionApi,
  directoryPath: string,
  produceFiles: AtomicOutputProducer,
  validateBeforeCommit?: () => Promise<void> | void,
  afterPublishBeforeFinalize?: (savedFileNames: string[], transactionId: string) => Promise<void> | void,
): Promise<string[]> {
  const transactionId = await api.beginAtomicWriteTransaction(directoryPath);
  let finalized = false;
  try {
    await produceFiles((file) => api.stageAtomicWriteTransactionFile(transactionId, file));
    await validateBeforeCommit?.();
    const savedFileNames = await api.commitAtomicWriteTransaction(transactionId);
    await afterPublishBeforeFinalize?.(savedFileNames, transactionId);
    await api.finalizeAtomicWriteTransaction(transactionId);
    finalized = true;
    return savedFileNames;
  } catch (error) {
    if (!finalized) {
      try {
        await api.rollbackAtomicWriteTransaction(transactionId);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Export fallito e rollback dei file incompleto.",
        );
      }
    }
    throw error;
  }
}

async function downloadZip(fileName: string, files: Array<{ name: string; bytes: Uint8Array }>): Promise<void> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.name, file.bytes);
  }
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
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

function patchJpegDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  if (bytes.length < 20 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || !Number.isFinite(dpi) || dpi <= 0) {
    return bytes;
  }

  const next = new Uint8Array(bytes);
  const density = Math.max(1, Math.min(65535, Math.round(dpi)));
  let offset = 2;

  while (offset + 4 < next.length && next[offset] === 0xff) {
    const marker = next[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;

    const segmentLength = (next[offset + 2] << 8) | next[offset + 3];
    if (segmentLength < 2 || offset + 2 + segmentLength > next.length) break;

    if (
      marker === 0xe0 &&
      segmentLength >= 16 &&
      next[offset + 4] === 0x4a &&
      next[offset + 5] === 0x46 &&
      next[offset + 6] === 0x49 &&
      next[offset + 7] === 0x46 &&
      next[offset + 8] === 0x00
    ) {
      next[offset + 11] = 1;
      next[offset + 12] = (density >> 8) & 0xff;
      next[offset + 13] = density & 0xff;
      next[offset + 14] = (density >> 8) & 0xff;
      next[offset + 15] = density & 0xff;
      return next;
    }

    offset += 2 + segmentLength;
  }

  return bytes;
}

function drawPhotoBorder(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  adjustments: ImageAdjustmentSpec,
): void {
  if (!adjustments.borderEnabled || adjustments.borderWidthPx <= 0) {
    return;
  }

  const lineWidth = Math.min(adjustments.borderWidthPx, width, height);
  ctx.save();
  ctx.strokeStyle = adjustments.borderColor;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(lineWidth / 2, lineWidth / 2, width - lineWidth, height - lineWidth);
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

export async function renderPhotoCanvas(
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

  const contentRect = getPhotoContentRectCm(printSpec);
  const contentX = cmToPx(contentRect.x, printSpec.dpi);
  const contentY = cmToPx(contentRect.y, printSpec.dpi);
  const contentWidth = cmToPx(contentRect.width, printSpec.dpi);
  const contentHeight = cmToPx(contentRect.height, printSpec.dpi);

  ctx.save();
  ctx.translate(contentX, contentY);
  if (adjustments.blackAndWhiteEnabled) {
    ctx.filter = "grayscale(1)";
  }
  if (adjustments.fitMode === "contain") {
    drawCroppedImageContain(ctx, image, effectiveCrop, contentWidth, contentHeight);
  } else {
    drawCroppedImageCover(ctx, image, effectiveCrop, contentWidth, contentHeight);
  }
  ctx.restore();

  if (logoImage) {
    ctx.save();
    ctx.translate(contentX, contentY);
    drawLogoFollowingPhotoRotation(ctx, logoImage, logo, contentWidth, contentHeight, effectiveCrop.rotation);
    ctx.restore();
  }

  drawPhotoBorder(ctx, width, height, adjustments);

  return canvas;
}

export async function renderPageCanvas(page: BatchPrintPage, inputs: RenderInputs): Promise<HTMLCanvasElement> {
  const renderDpi = inputs.renderDpi && inputs.renderDpi > 0 ? inputs.renderDpi : inputs.printSpec.dpi;
  const renderPrintSpec: PhotoPrintSpec = { ...inputs.printSpec, dpi: renderDpi };
  const canvas = document.createElement("canvas");
  canvas.width = cmToPx(inputs.layout.sheetWidthCm, renderDpi);
  canvas.height = cmToPx(inputs.layout.sheetHeightCm, renderDpi);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D non disponibile.");
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const logoImage = inputs.logo.enabled && inputs.logo.imageUrl ? await loadImage(inputs.logo.imageUrl) : null;
  const scaleX = canvas.width / Math.max(1, inputs.layout.sheetWidthPx);
  const scaleY = canvas.height / Math.max(1, inputs.layout.sheetHeightPx);

  for (const slot of page.slots) {
    const asset = inputs.assetsById.get(slot.assetId);
    if (!asset) {
      continue;
    }

    const photoCanvas = await renderPhotoCanvas(
      asset,
      inputs.cropsById.get(asset.id),
      renderPrintSpec,
      logoImage,
      inputs.logo,
      inputs.adjustments,
    );

    const slotX = slot.x * scaleX;
    const slotY = slot.y * scaleY;
    const slotWidth = slot.width * scaleX;
    const slotHeight = slot.height * scaleY;

    if (inputs.layout.photoRotated) {
      ctx.save();
      ctx.translate(slotX + slotWidth / 2, slotY + slotHeight / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(photoCanvas, -slotHeight / 2, -slotWidth / 2, slotHeight, slotWidth);
      ctx.restore();
    } else {
      ctx.drawImage(photoCanvas, slotX, slotY, slotWidth, slotHeight);
    }
  }

  if (inputs.finishing.cutGuidesEnabled) {
    drawCutGuides(ctx, page, inputs.layout, renderDpi, scaleX, scaleY, inputs.finishing);
  }

  return canvas;
}

const WINDOWS_RESERVED_FILE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function sanitizeFileNamePrefix(value: string): string {
  const normalized = String(value ?? "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\.\.+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 80);
  if (!normalized || WINDOWS_RESERVED_FILE_NAMES.test(normalized)) {
    return "batch-print";
  }
  return normalized;
}

export function buildPageFileName(prefix: string, pageNumber: number, ext: string): string {
  const safePrefix = sanitizeFileNamePrefix(prefix);
  const safePage = Math.max(1, Math.floor(Number.isFinite(pageNumber) ? pageNumber : 1));
  const safeExtension = String(ext).toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  return `${safePrefix}-${String(safePage).padStart(3, "0")}.${safeExtension}`;
}

function drawCutGuides(
  ctx: CanvasRenderingContext2D,
  page: BatchPrintPage,
  layout: GridLayout,
  renderDpi: number,
  scaleX: number,
  scaleY: number,
  finishing: PrintFinishingSpec,
): void {
  const lineWidth = Math.max(1, mmToPx(finishing.cutGuideWidthMm, renderDpi));
  const offset = Math.max(lineWidth, mmToPx(0.1, renderDpi));
  const gapAllowance = Math.max(1, (layout.gapPx * Math.min(scaleX, scaleY)) / 2 - offset);
  const markLength = Math.max(1, Math.min(mmToPx(2, renderDpi), gapAllowance));

  ctx.save();
  ctx.strokeStyle = finishing.cutGuideColor;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  for (const slot of page.slots) {
    const left = slot.x * scaleX;
    const top = slot.y * scaleY;
    const right = (slot.x + slot.width) * scaleX;
    const bottom = (slot.y + slot.height) * scaleY;

    ctx.moveTo(left - offset - markLength, top);
    ctx.lineTo(left - offset, top);
    ctx.moveTo(left, top - offset - markLength);
    ctx.lineTo(left, top - offset);

    ctx.moveTo(right + offset, top);
    ctx.lineTo(right + offset + markLength, top);
    ctx.moveTo(right, top - offset - markLength);
    ctx.lineTo(right, top - offset);

    ctx.moveTo(left - offset - markLength, bottom);
    ctx.lineTo(left - offset, bottom);
    ctx.moveTo(left, bottom + offset);
    ctx.lineTo(left, bottom + offset + markLength);

    ctx.moveTo(right + offset, bottom);
    ctx.lineTo(right + offset + markLength, bottom);
    ctx.moveTo(right, bottom + offset);
    ctx.lineTo(right, bottom + offset + markLength);
  }
  ctx.stroke();
  ctx.restore();
}

export async function exportRasterPage(
  canvas: HTMLCanvasElement,
  format: Exclude<ExportFormat, "pdf">,
  quality: number,
  dpi: number,
): Promise<Uint8Array> {
  if (format === "tif") {
    const UTIF = await import("utif");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas 2D non disponibile.");
    }
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return new Uint8Array(UTIF.encodeImage(new Uint8Array(rgba), canvas.width, canvas.height));
  }

  const mimeType = format === "jpg" ? "image/jpeg" : "image/png";
  const blob = await canvasToBlob(canvas, mimeType, format === "jpg" ? quality : undefined);
  const bytes = await blobToBytes(blob);
  return format === "jpg" ? patchJpegDpi(bytes, dpi) : bytes;
}

async function renderExportPage(page: BatchPrintPage, options: ExportOptions): Promise<HTMLCanvasElement> {
  if (!options.resolveAssetForExport) {
    return renderPageCanvas(page, { ...options, renderDpi: options.printSpec.dpi });
  }

  const contentRect = getPhotoContentRectCm(options.printSpec);
  const requiredMaxDimension = Math.max(
    cmToPx(contentRect.width, options.printSpec.dpi),
    cmToPx(contentRect.height, options.printSpec.dpi),
  );
  const resolvedPage = await resolvePageAssetsForExport(
    page,
    options.assetsById,
    options.cropsById,
    requiredMaxDimension,
    options.resolveAssetForExport,
  );

  try {
    return await renderPageCanvas(page, {
      ...options,
      assetsById: resolvedPage.assetsById,
      renderDpi: options.printSpec.dpi,
    });
  } finally {
    resolvedPage.release();
  }
}

function comparableSourcePath(absolutePath: string | undefined): string | null {
  if (!absolutePath) return null;
  return /^[a-z]:[\\/]/i.test(absolutePath) || absolutePath.startsWith("\\\\")
    ? absolutePath.replaceAll("/", "\\").toLocaleLowerCase("en-US")
    : absolutePath;
}

function assetResolutionIdentity(
  asset: PhotoAsset,
  crop: BatchCropState | undefined,
  requiredMaxDimension: number,
): string {
  // Exclude only the logical asset/crop ids: ID Photo deliberately creates
  // photo-copy-1...N aliases for the same source and transformation.
  // Every field that can distinguish the effective input stays in the key so
  // unrelated files or differently transformed instances never share bytes.
  return JSON.stringify({
    source: {
      absolutePath: comparableSourcePath(asset.absolutePath),
      fileName: asset.fileName,
      relativePath: asset.relativePath ?? null,
      size: asset.size ?? null,
      lastModified: asset.lastModified ?? null,
      sourceUrl: asset.sourceUrl,
      previewUrl: asset.previewUrl,
      width: asset.width,
      height: asset.height,
    },
    transform: crop ? {
      cropLeft: crop.cropLeft,
      cropTop: crop.cropTop,
      cropWidth: crop.cropWidth,
      cropHeight: crop.cropHeight,
      rotation: crop.rotation,
    } : null,
    requiredMaxDimension,
  });
}

function buildPageAssetResolutionGroups(
  page: BatchPrintPage,
  assetsById: Map<string, PhotoAsset>,
  cropsById: Map<string, BatchCropState>,
  requiredMaxDimension: number,
): PageAssetResolutionGroup[] {
  const groups = new Map<string, PageAssetResolutionGroup>();
  for (const slot of page.slots) {
    const asset = assetsById.get(slot.assetId);
    if (!asset) continue;
    const identity = assetResolutionIdentity(
      asset,
      cropsById.get(slot.assetId) ?? cropsById.get(asset.id),
      requiredMaxDimension,
    );
    const existing = groups.get(identity);
    if (existing) {
      if (!existing.slotAssetIds.includes(slot.assetId)) existing.slotAssetIds.push(slot.assetId);
    } else {
      groups.set(identity, { representative: asset, slotAssetIds: [slot.assetId] });
    }
  }
  return Array.from(groups.values());
}

export async function resolvePageAssetsForExport(
  page: BatchPrintPage,
  assetsById: Map<string, PhotoAsset>,
  cropsById: Map<string, BatchCropState>,
  requiredMaxDimension: number,
  resolveAsset: AssetExportResolver,
): Promise<{ assetsById: Map<string, PhotoAsset>; release: () => void }> {
  const groups = buildPageAssetResolutionGroups(page, assetsById, cropsById, requiredMaxDimension);
  const outcomes = await Promise.allSettled(
    groups.map(async (group) => ({ group, resolved: await resolveAsset(group.representative, requiredMaxDimension) })),
  );
  const fulfilled = outcomes
    .filter((outcome): outcome is PromiseFulfilledResult<{
      group: PageAssetResolutionGroup;
      resolved: Awaited<ReturnType<AssetExportResolver>>;
    }> => outcome.status === "fulfilled")
    .map((outcome) => outcome.value);
  const rejected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
  if (rejected) {
    for (const { resolved } of fulfilled) resolved.release?.();
    throw rejected.reason;
  }

  const renderAssetsById = new Map(assetsById);
  for (const { group, resolved } of fulfilled) {
    for (const assetId of group.slotAssetIds) {
      renderAssetsById.set(assetId, { ...resolved.asset, id: assetId });
    }
  }

  let released = false;
  return {
    assetsById: renderAssetsById,
    release: () => {
      if (released) return;
      released = true;
      for (const { resolved } of fulfilled) resolved.release?.();
    },
  };
}

export async function exportBatch(options: ExportOptions): Promise<string[]> {
  const renderSafetyError = getRenderSafetyError(options.layout, options.printSpec.dpi);
  if (renderSafetyError) {
    throw new Error(renderSafetyError);
  }
  const safePrefix = sanitizeFileNamePrefix(options.fileNamePrefix);
  const supplementaryFiles = validateSupplementaryOutputFiles(options.supplementaryFiles ?? []);
  const desktopTransactionApi = options.outputDirectoryPath
    ? getDesktopAtomicWriteTransactionApi()
    : null;
  if (options.outputDirectoryPath && options.requireDesktopAtomicTransaction && !desktopTransactionApi) {
    throw new Error(
      "Questa funzione richiede una versione aggiornata della FileX Suite con export transazionale. Aggiorna la Suite e riprova.",
    );
  }

  if (options.format === "pdf") {
    const { jsPDF } = await import("jspdf");
    const orientation = options.layout.sheetWidthPx >= options.layout.sheetHeightPx ? "l" : "p";
    const pdf = new jsPDF({
      orientation,
      unit: "cm",
      format: [options.layout.sheetWidthCm, options.layout.sheetHeightCm],
      compress: false,
    });

    for (let index = 0; index < options.pages.length; index += 1) {
      const page = options.pages[index];
      options.onProgress?.(index, options.pages.length, `Foglio ${page.pageNumber}`);
      const canvas = await renderExportPage(page, options);
      try {
        if (index > 0) {
          pdf.addPage([options.layout.sheetWidthCm, options.layout.sheetHeightCm], orientation);
        }
        pdf.addImage(canvas.toDataURL("image/jpeg", options.quality), "JPEG", 0, 0, options.layout.sheetWidthCm, options.layout.sheetHeightCm, undefined, "NONE");
      } finally {
        // jsPDF conserva i byte incorporati: il backing store del foglio può
        // essere rilasciato subito, prima di renderizzare la pagina seguente.
        canvas.width = 1;
        canvas.height = 1;
      }
    }

    const bytes = new Uint8Array(pdf.output("arraybuffer"));
    const fileName = `${safePrefix}.pdf`;
    const outputFiles = [{ fileName, bytes }, ...supplementaryFiles];
    const preparedFiles = options.onCommittedFiles
      ? await Promise.all(outputFiles.map((file) => fingerprintPreparedOutput(file.fileName, file.bytes)))
      : [];
    if (options.onCommittedFiles) assertPreparedOutputMetadata(preparedFiles, outputFiles.length);
    let savedFileNames: string[];
    if (options.outputDirectoryPath && desktopTransactionApi) {
      savedFileNames = await runDesktopAtomicWriteTransaction(
        desktopTransactionApi,
        options.outputDirectoryPath,
        async (stageFile) => {
          for (const file of outputFiles) await stageFile(file);
        },
        options.validateBeforeSave,
        async (savedFileNames, transactionId) => notifyCommittedFiles(
          options,
          preparedFiles,
          savedFileNames,
          { atomicTransactionId: transactionId },
        ),
      );
    } else {
      await options.validateBeforeSave?.();
      savedFileNames = await savePreparedFiles(outputFiles, options.outputDirectoryPath);
      await notifyCommittedFiles(options, preparedFiles, savedFileNames);
    }
    options.onProgress?.(options.pages.length, options.pages.length, savedFileNames.join(", "));
    return savedFileNames;
  }
  const rasterFormat: Exclude<ExportFormat, "pdf"> = options.format;

  if (!options.outputDirectoryPath && options.pages.length > 1) {
    const zipFiles: Array<{ name: string; bytes: Uint8Array }> = supplementaryFiles
      .map((file) => ({ name: file.fileName, bytes: file.bytes }));
    for (let index = 0; index < options.pages.length; index += 1) {
      const page = options.pages[index];
      const fileName = buildPageFileName(safePrefix, page.pageNumber, options.format);
      options.onProgress?.(index, options.pages.length, fileName);
      const canvas = await renderExportPage(page, options);
      let bytes: Uint8Array;
      try {
        bytes = await exportRasterPage(canvas, options.format, options.quality, options.printSpec.dpi);
      } finally {
        canvas.width = 1;
        canvas.height = 1;
      }
      zipFiles.push({ name: fileName, bytes });
      options.onProgress?.(index + 1, options.pages.length, fileName);
    }
    const zipName = `${safePrefix}.zip`;
    await options.validateBeforeSave?.();
    await downloadZip(zipName, zipFiles);
    return [zipName];
  }

  if (options.outputDirectoryPath && desktopTransactionApi) {
    const preparedFiles: ExportCommittedFile[] = [];
    const savedFileNames = await runDesktopAtomicWriteTransaction(
      desktopTransactionApi,
      options.outputDirectoryPath,
      async (stageFile) => {
        for (const file of supplementaryFiles) {
          if (options.onCommittedFiles) {
            preparedFiles.push(await fingerprintPreparedOutput(file.fileName, file.bytes));
          }
          await stageFile(file);
        }
        for (let index = 0; index < options.pages.length; index += 1) {
          const page = options.pages[index];
          const fileName = buildPageFileName(safePrefix, page.pageNumber, rasterFormat);
          options.onProgress?.(index, options.pages.length, fileName);
          const canvas = await renderExportPage(page, options);
          try {
            const bytes = await exportRasterPage(canvas, rasterFormat, options.quality, options.printSpec.dpi);
            if (options.onCommittedFiles) {
              preparedFiles.push(await fingerprintPreparedOutput(fileName, bytes));
            }
            await stageFile({ fileName, bytes });
          } finally {
            // Release the large backing store before rendering the next sheet;
            // the encoded bytes have already crossed IPC and reached staging.
            canvas.width = 1;
            canvas.height = 1;
          }
          options.onProgress?.(index + 1, options.pages.length, `${fileName} preparato`);
        }
        if (options.onCommittedFiles) {
          // Questa verifica avviene ancora nello staging: un errore impedisce il
          // commit, quindi non può lasciare file pubblicati privi di impronta.
          assertPreparedOutputMetadata(preparedFiles, options.pages.length + supplementaryFiles.length);
        }
      },
      options.validateBeforeSave,
      async (committedFileNames, transactionId) => notifyCommittedFiles(
        options,
        preparedFiles,
        committedFileNames,
        { atomicTransactionId: transactionId },
      ),
    );
    for (let index = 0; index < savedFileNames.length; index += 1) {
      options.onProgress?.(index + 1, savedFileNames.length, savedFileNames[index]);
    }
    return savedFileNames;
  }

  if (options.outputDirectoryPath && options.pages.length > 1) {
    throw new Error(
      "La shell FileX in uso non supporta l'export progressivo. Aggiorna la Suite prima di esportare piu' fogli.",
    );
  }

  const page = options.pages[0];
  if (!page) return [];
  const fileName = buildPageFileName(safePrefix, page.pageNumber, rasterFormat);
  options.onProgress?.(0, 1, fileName);
  const canvas = await renderExportPage(page, options);
  let bytes: Uint8Array;
  try {
    bytes = await exportRasterPage(canvas, rasterFormat, options.quality, options.printSpec.dpi);
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
  await options.validateBeforeSave?.();
  const outputFiles = [{ fileName, bytes }, ...supplementaryFiles];
  const preparedFiles = options.onCommittedFiles
    ? await Promise.all(outputFiles.map((file) => fingerprintPreparedOutput(file.fileName, file.bytes)))
    : [];
  if (options.onCommittedFiles) assertPreparedOutputMetadata(preparedFiles, outputFiles.length);
  const savedFileNames = await savePreparedFiles(outputFiles, options.outputDirectoryPath);
  await notifyCommittedFiles(options, preparedFiles, savedFileNames);
  options.onProgress?.(1, 1, savedFileNames.join(", "));
  return savedFileNames;
}

export async function exportBatchWithMetadata(
  options: ExportOptions,
): Promise<ExportBatchResult> {
  let committedFiles: ExportCommittedFile[] = [];
  const persistCommittedFiles = options.onCommittedFiles;
  const files = await exportBatch({
    ...options,
    onCommittedFiles: async (nextFiles, context) => {
      committedFiles = nextFiles;
      await persistCommittedFiles?.(nextFiles, context);
    },
  });
  if (options.outputDirectoryPath) {
    assertPreparedOutputMetadata(committedFiles, files.length);
  }
  return { files, committedFiles };
}
