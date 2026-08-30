import fs from "node:fs";
import { mkdir, open, realpath, rename, rm, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import sharp, { type Metadata } from "sharp";
import {
  PARTY_FRAME_PRESETS,
  createPresetFrameSvg,
  orientPartyFramePreset,
  type PartyFrameOrientation,
  type PartyFramePresetTemplate,
} from "./templateCatalog.js";

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_BATCH_FILES = 500;
export const MAX_BATCH_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;
export const MAX_TEMPLATE_SIDE_PX = 16_000;
export const MAX_TEMPLATE_PIXELS = 80_000_000;
export const MAX_WORKING_PIXELS = 120_000_000;
export const MAX_INPUT_PIXELS = 200_000_000;

const MAX_OUTPUT_PATH_LENGTH = 1_024;
const MAX_PATTERN_LENGTH = 180;
const MAX_PROJECT_NAME_LENGTH = 120;
const MAX_ITEM_TEXT_LENGTH = 512;
const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".tif",
  ".tiff",
  ".heic",
  ".heif",
]);

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export class ExportCancelledError extends Error {
  readonly result: ExportResult;

  constructor(result: ExportResult) {
    super("Export cancelled");
    this.name = "ExportCancelledError";
    this.result = result;
  }
}

export interface TemplateConfig {
  name: string;
  width: number;
  height: number;
  dpi: number;
  frameLeftTop: number;
  frameRightBottom: number;
  photoAreaX: number;
  photoAreaY: number;
  photoAreaWidth: number;
  photoAreaHeight: number;
  photoBorderSize: number;
  photoBorderColor: string;
  frameImagePath?: string | null;
  presetId?: string;
  presetOrientation?: PartyFrameOrientation;
}

export interface BatchExportCrop {
  x?: number;
  y?: number;
  offsetX?: number;
  offsetY?: number;
  zoom?: number;
}

export interface BatchExportItem {
  id: string;
  originalName?: string;
  relativePath?: string;
  absolutePath?: string;
  orientation: "vertical" | "horizontal";
  crop: BatchExportCrop;
}

export interface CustomTemplateVariantPayload {
  widthPx: number;
  heightPx: number;
  dpi: number;
  photoAreaX: number;
  photoAreaY: number;
  photoAreaWidth: number;
  photoAreaHeight: number;
  borderSizePx?: number;
  borderColor?: string;
  backgroundFileName?: string;
}

export interface CustomTemplatePayload {
  name?: string;
  variants: {
    vertical: CustomTemplateVariantPayload;
    horizontal: CustomTemplateVariantPayload;
  };
}

export interface UploadedFileDescriptor {
  path: string;
  originalname: string;
  size: number;
}

export interface ExportRequestBody {
  templateId?: unknown;
  quality?: unknown;
  format?: unknown;
  colorProfile?: unknown;
  namingPattern?: unknown;
  projectName?: unknown;
  outputPath?: unknown;
  createSubfolder?: unknown;
  embedColorProfile?: unknown;
  overwrite?: unknown;
  items?: unknown;
  customTemplate?: unknown;
}

export interface PrepareExportOptions {
  allowNativePaths?: boolean;
}

export interface PreparedExportRequest {
  templateId: string;
  baseTemplate: TemplateConfig | null;
  customTemplate: CustomTemplatePayload | null;
  files: UploadedFileDescriptor[];
  templateBackgroundFiles: Partial<Record<"vertical" | "horizontal", UploadedFileDescriptor>>;
  items: BatchExportItem[];
  quality: number;
  format: "jpeg" | "png";
  colorProfile: "sRGB";
  namingPattern: string;
  projectName: string;
  outputDir: string;
  embedColorProfile: boolean;
  overwrite: boolean;
}

export interface ExportResult {
  success: Array<{ id: string; filename: string; size: number }>;
  failed: Array<{ id: string; error: string }>;
  totalTime: number;
  outputDir: string;
}

export type ExportExecutionPhase = "preparing" | "rendering" | "writing" | "cleaning";

export interface ExportExecutionHooks {
  signal?: AbortSignal;
  onPhase?: (phase: ExportExecutionPhase, item: BatchExportItem | null) => void;
  onItemSettled?: (completed: number, total: number, item: BatchExportItem) => void;
}

export interface CoverGeometry {
  scaledWidth: number;
  scaledHeight: number;
  extractLeft: number;
  extractTop: number;
  overflowX: number;
  overflowY: number;
}

function presetToTemplateConfig(
  preset: PartyFramePresetTemplate,
  orientation: PartyFrameOrientation = "horizontal",
): TemplateConfig {
  const oriented = orientPartyFramePreset(preset, orientation);
  return {
    name: oriented.name,
    width: oriented.width,
    height: oriented.height,
    dpi: oriented.dpi,
    frameLeftTop: oriented.photoAreaX,
    frameRightBottom: Math.max(0, oriented.width - oriented.photoAreaX - oriented.photoAreaWidth),
    photoAreaX: oriented.photoAreaX,
    photoAreaY: oriented.photoAreaY,
    photoAreaWidth: oriented.photoAreaWidth,
    photoAreaHeight: oriented.photoAreaHeight,
    photoBorderSize: 0,
    photoBorderColor: "#ffffff",
    frameImagePath: null,
    presetId: oriented.id,
    presetOrientation: orientation,
  };
}

export const templates: Record<string, TemplateConfig> = Object.fromEntries(
  Object.entries(PARTY_FRAME_PRESETS).map(([id, preset]) => [id, presetToTemplateConfig(preset)]),
);

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function parseNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : fallback;
}

function parseBooleanField(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new HttpError(400, "INVALID_BOOLEAN", `${label} must be true or false`);
}

function parseOptionalFiniteNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw new HttpError(400, "INVALID_CROP", `${label} must be a finite number`);
  }
  return parsed;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function sanitizeHexColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#([0-9a-fA-F]{6})$/.test(value) ? value : fallback;
}

function assertFinitePositiveInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new HttpError(400, "INVALID_TEMPLATE_GEOMETRY", `${label} must be a positive integer`);
  }
  return parsed;
}

function assertFiniteNonNegativeInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new HttpError(400, "INVALID_TEMPLATE_GEOMETRY", `${label} must be a non-negative integer`);
  }
  return parsed;
}

function validateTemplateDimensions(width: number, height: number): void {
  if (width > MAX_TEMPLATE_SIDE_PX || height > MAX_TEMPLATE_SIDE_PX || width * height > MAX_TEMPLATE_PIXELS) {
    throw new HttpError(
      400,
      "TEMPLATE_TOO_LARGE",
      `Template exceeds the supported limit (${MAX_TEMPLATE_SIDE_PX}px per side, ${MAX_TEMPLATE_PIXELS} total pixels)`,
    );
  }
}

function parseCustomTemplateVariant(rawVariant: unknown): CustomTemplateVariantPayload {
  if (!rawVariant || typeof rawVariant !== "object") {
    throw new HttpError(400, "INVALID_CUSTOM_TEMPLATE", "Custom template variant is missing");
  }

  const parsed = rawVariant as Partial<CustomTemplateVariantPayload>;
  const widthPx = assertFinitePositiveInteger(parsed.widthPx, "widthPx");
  const heightPx = assertFinitePositiveInteger(parsed.heightPx, "heightPx");
  validateTemplateDimensions(widthPx, heightPx);

  const photoAreaX = assertFiniteNonNegativeInteger(parsed.photoAreaX, "photoAreaX");
  const photoAreaY = assertFiniteNonNegativeInteger(parsed.photoAreaY, "photoAreaY");
  const photoAreaWidth = assertFinitePositiveInteger(parsed.photoAreaWidth, "photoAreaWidth");
  const photoAreaHeight = assertFinitePositiveInteger(parsed.photoAreaHeight, "photoAreaHeight");
  if (photoAreaX + photoAreaWidth > widthPx || photoAreaY + photoAreaHeight > heightPx) {
    throw new HttpError(400, "INVALID_TEMPLATE_GEOMETRY", "Photo area must fit entirely inside the template");
  }
  const maxBorder = Math.max(0, Math.floor(Math.min(photoAreaWidth, photoAreaHeight) / 2) - 1);
  const borderSizePx = parsed.borderSizePx === undefined
    ? 0
    : assertFiniteNonNegativeInteger(parsed.borderSizePx, "borderSizePx");
  if (borderSizePx > maxBorder) {
    throw new HttpError(400, "INVALID_TEMPLATE_GEOMETRY", "Template border is too large for the photo area");
  }
  const dpi = assertFinitePositiveInteger(parsed.dpi, "dpi");
  if (dpi < 72 || dpi > 1_200) {
    throw new HttpError(400, "INVALID_TEMPLATE_GEOMETRY", "dpi must be between 72 and 1200");
  }
  if (parsed.borderColor !== undefined && sanitizeHexColor(parsed.borderColor, "") === "") {
    throw new HttpError(400, "INVALID_TEMPLATE_COLOR", "borderColor must use #RRGGBB format");
  }

  return {
    widthPx,
    heightPx,
    dpi,
    photoAreaX,
    photoAreaY,
    photoAreaWidth,
    photoAreaHeight,
    borderSizePx,
    borderColor: parsed.borderColor ?? "#ffffff",
    backgroundFileName:
      typeof parsed.backgroundFileName === "string" ? parsed.backgroundFileName.slice(0, MAX_ITEM_TEXT_LENGTH) : undefined,
  };
}

export function parseCustomTemplate(rawTemplate: unknown): CustomTemplatePayload | null {
  if (rawTemplate === undefined || rawTemplate === null || rawTemplate === "") {
    return null;
  }

  let parsed: unknown = rawTemplate;
  if (typeof rawTemplate === "string") {
    try {
      parsed = JSON.parse(rawTemplate);
    } catch {
      throw new HttpError(400, "INVALID_CUSTOM_TEMPLATE", "Custom template is not valid JSON");
    }
  }

  if (!parsed || typeof parsed !== "object") {
    throw new HttpError(400, "INVALID_CUSTOM_TEMPLATE", "Custom template is invalid");
  }

  const candidate = parsed as Partial<CustomTemplatePayload>;
  return {
    name: typeof candidate.name === "string" ? candidate.name.slice(0, MAX_PROJECT_NAME_LENGTH) : "Template Custom",
    variants: {
      vertical: parseCustomTemplateVariant(candidate.variants?.vertical),
      horizontal: parseCustomTemplateVariant(candidate.variants?.horizontal),
    },
  };
}

export function orientTemplate(
  template: TemplateConfig,
  orientation: "vertical" | "horizontal" = "horizontal",
): TemplateConfig {
  if (template.presetId && PARTY_FRAME_PRESETS[template.presetId]) {
    return presetToTemplateConfig(PARTY_FRAME_PRESETS[template.presetId], orientation);
  }
  if (orientation !== "vertical") return template;

  return {
    ...template,
    width: template.height,
    height: template.width,
    photoAreaX: template.height - (template.photoAreaY + template.photoAreaHeight),
    photoAreaY: template.photoAreaX,
    photoAreaWidth: template.photoAreaHeight,
    photoAreaHeight: template.photoAreaWidth,
  };
}

export function toTemplateConfig(
  customTemplate: CustomTemplatePayload,
  orientation: "vertical" | "horizontal",
  backgroundPaths: Partial<Record<"vertical" | "horizontal", string | undefined>> = {},
): TemplateConfig {
  const variant = customTemplate.variants[orientation];
  return {
    name: customTemplate.name || "Template Custom",
    width: variant.widthPx,
    height: variant.heightPx,
    dpi: variant.dpi,
    frameLeftTop: 0,
    frameRightBottom: 0,
    photoAreaX: variant.photoAreaX,
    photoAreaY: variant.photoAreaY,
    photoAreaWidth: variant.photoAreaWidth,
    photoAreaHeight: variant.photoAreaHeight,
    photoBorderSize: variant.borderSizePx ?? 0,
    photoBorderColor: variant.borderColor ?? "#ffffff",
    frameImagePath: backgroundPaths[orientation] || null,
  };
}

export function sanitizeSegment(value: string, fallback: string, maxLength = 140): string {
  let sanitized = value
    .trim()
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, maxLength);

  if (!sanitized || sanitized === "." || sanitized === "..") sanitized = fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(sanitized)) sanitized = `_${sanitized}`;
  return sanitized;
}

function normalizeRelativePath(value: string): string[] {
  if (!value || path.isAbsolute(value) || /^[a-zA-Z]:/.test(value)) {
    throw new HttpError(400, "INVALID_RELATIVE_PATH", "relativePath must be relative");
  }

  const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new HttpError(400, "INVALID_RELATIVE_PATH", "relativePath cannot traverse directories");
  }
  return parts;
}

function originalBaseForItem(item: BatchExportItem, index: number): string {
  if (item.relativePath) {
    const parts = normalizeRelativePath(item.relativePath);
    if (parts.length > 0) {
      const last = parts.pop()!;
      const stem = path.parse(last).name;
      const joined = [...parts, stem].map((part) => sanitizeSegment(part, "item", 60)).join("__");
      if (joined.length <= 140) return sanitizeSegment(joined, `image_${index + 1}`);
      const digest = createHash("sha256").update(item.relativePath).digest("hex").slice(0, 8);
      return `${sanitizeSegment(joined, `image_${index + 1}`, 125)}_${digest}`;
    }
  }

  return sanitizeSegment(path.parse(item.originalName || item.id || `image_${index + 1}`).name, `image_${index + 1}`);
}

export function buildOutputFilename(
  item: BatchExportItem,
  pattern: string,
  projectName: string,
  index: number,
  format: "jpeg" | "png",
): string {
  const originalBase = originalBaseForItem(item, index);
  const template = pattern || "original_frame";
  const resolved = template
    .replace(/\{originale\}/g, originalBase)
    .replace(/\{progetto\}/g, sanitizeSegment(projectName || "Project", "Project"))
    .replace(/\{contatore\}/g, String(index + 1).padStart(3, "0"))
    .replace(/\{data\}/g, new Date().toISOString().slice(0, 10))
    .replace(/^original_frame$/g, `${originalBase}_frame`);
  const basename = sanitizeSegment(resolved, `${originalBase}_frame`);
  return `${basename}.${format === "png" ? "png" : "jpg"}`;
}

const activeOutputReservations = new Set<string>();

function reservationKey(filePath: string): string {
  const resolved = path.resolve(filePath);
  let canonical = resolved;
  try {
    canonical = path.join(fs.realpathSync(path.dirname(resolved)), path.basename(resolved));
  } catch {
    // The output parent can legitimately be absent until the validated job starts.
  }
  return process.platform === "win32" || process.platform === "darwin" ? canonical.toLowerCase() : canonical;
}

export class OutputReservationMap {
  private readonly reserved = new Set<string>();
  private readonly nextCounters = new Map<string, number>();

  reserve(desiredPath: string, overwrite: boolean, forbiddenKeys: ReadonlySet<string> = new Set()): string {
    const parsed = path.parse(desiredPath);
    const baseKey = reservationKey(desiredPath);
    let counter = this.nextCounters.get(baseKey) ?? 0;

    while (true) {
      const candidate = counter === 0
        ? desiredPath
        : path.join(parsed.dir, `${parsed.name}_${String(counter).padStart(2, "0")}${parsed.ext}`);
      const key = reservationKey(candidate);
      const alreadyReserved = this.reserved.has(key) || activeOutputReservations.has(key);
      const blockedByExistingFile = forbiddenKeys.has(key) || (!overwrite && fs.existsSync(candidate));

      counter += 1;
      if (alreadyReserved || blockedByExistingFile) continue;

      this.nextCounters.set(baseKey, counter);
      this.reserved.add(key);
      activeOutputReservations.add(key);
      return candidate;
    }
  }

  releaseAll(): void {
    for (const key of this.reserved) activeOutputReservations.delete(key);
    this.reserved.clear();
    this.nextCounters.clear();
  }
}

function parseItems(rawItems: unknown): BatchExportItem[] {
  let parsed: unknown = rawItems;
  if (typeof rawItems === "string") {
    try {
      parsed = JSON.parse(rawItems);
    } catch {
      throw new HttpError(400, "INVALID_ITEMS", "Export items are not valid JSON");
    }
  }

  if (!Array.isArray(parsed)) throw new HttpError(400, "INVALID_ITEMS", "Export items must be an array");
  if (parsed.length === 0) throw new HttpError(400, "EMPTY_EXPORT", "At least one image is required");
  if (parsed.length > MAX_BATCH_FILES) {
    throw new HttpError(413, "TOO_MANY_FILES", `A maximum of ${MAX_BATCH_FILES} images can be exported in one job`);
  }

  const seenIds = new Set<string>();
  return parsed.map((rawItem, index) => {
    if (!rawItem || typeof rawItem !== "object") {
      throw new HttpError(400, "INVALID_ITEM", `Export item ${index + 1} is invalid`);
    }

    const item = rawItem as Partial<BatchExportItem>;
    const rawId = asString(item.id).trim();
    if (rawId.length > MAX_ITEM_TEXT_LENGTH) {
      throw new HttpError(400, "INVALID_ITEM_ID", `Export item ${index + 1} id is too long`);
    }
    const id = rawId;
    if (!id) throw new HttpError(400, "INVALID_ITEM_ID", `Export item ${index + 1} has no id`);
    if (seenIds.has(id)) throw new HttpError(400, "DUPLICATE_ITEM_ID", `Duplicate export item id: ${id}`);
    seenIds.add(id);

    if (item.orientation !== undefined && item.orientation !== "vertical" && item.orientation !== "horizontal") {
      throw new HttpError(400, "INVALID_ORIENTATION", `Export item ${index + 1} orientation is invalid`);
    }
    const orientation = item.orientation === "vertical" ? "vertical" : "horizontal";
    if (item.crop !== undefined && (!item.crop || typeof item.crop !== "object" || Array.isArray(item.crop))) {
      throw new HttpError(400, "INVALID_CROP", `Export item ${index + 1} crop is invalid`);
    }
    const rawCrop = item.crop && typeof item.crop === "object" ? item.crop : {};
    const parsedOffsetX = parseOptionalFiniteNumber(rawCrop.offsetX, `Export item ${index + 1} offsetX`);
    const parsedOffsetY = parseOptionalFiniteNumber(rawCrop.offsetY, `Export item ${index + 1} offsetY`);
    const parsedLegacyX = parseOptionalFiniteNumber(rawCrop.x, `Export item ${index + 1} x`);
    const parsedLegacyY = parseOptionalFiniteNumber(rawCrop.y, `Export item ${index + 1} y`);
    const parsedZoom = parseOptionalFiniteNumber(rawCrop.zoom, `Export item ${index + 1} zoom`);
    const offsetX = parsedOffsetX === undefined ? undefined : clamp(parsedOffsetX, -1, 1);
    const offsetY = parsedOffsetY === undefined ? undefined : clamp(parsedOffsetY, -1, 1);
    if (typeof item.relativePath === "string" && item.relativePath.length > MAX_ITEM_TEXT_LENGTH) {
      throw new HttpError(400, "INVALID_RELATIVE_PATH", `Export item ${index + 1} relativePath is too long`);
    }
    const relativePath = typeof item.relativePath === "string" ? item.relativePath : undefined;
    if (relativePath) normalizeRelativePath(relativePath);
    if (item.absolutePath !== undefined && typeof item.absolutePath !== "string") {
      throw new HttpError(400, "INVALID_SOURCE_PATH", `Export item ${index + 1} absolutePath must be a string`);
    }
    const absolutePath = typeof item.absolutePath === "string" ? item.absolutePath : undefined;
    if (absolutePath !== undefined && (!absolutePath.trim() || absolutePath.length > MAX_OUTPUT_PATH_LENGTH || absolutePath.includes("\0"))) {
      throw new HttpError(400, "INVALID_SOURCE_PATH", `Export item ${index + 1} absolutePath is invalid`);
    }

    return {
      id,
      originalName:
        typeof item.originalName === "string" ? item.originalName.slice(0, MAX_ITEM_TEXT_LENGTH) : undefined,
      relativePath,
      absolutePath,
      orientation,
      crop: {
        x: parsedLegacyX ?? 0,
        y: parsedLegacyY ?? 0,
        offsetX,
        offsetY,
        zoom: clamp(parsedZoom ?? 100, 100, 400),
      },
    };
  });
}

export function isSupportedImageFilename(filename: string): boolean {
  return SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(filename).toLocaleLowerCase());
}

export function validateUploadedFile(file: UploadedFileDescriptor, label: string): void {
  if (!file.path || !file.originalname || !Number.isFinite(file.size) || file.size <= 0) {
    throw new HttpError(400, "INVALID_UPLOAD", `${label} is invalid or empty`);
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new HttpError(413, "FILE_TOO_LARGE", `${label} exceeds the ${MAX_FILE_BYTES / 1024 / 1024} MB limit`);
  }
  if (!isSupportedImageFilename(file.originalname)) {
    throw new HttpError(415, "UNSUPPORTED_IMAGE", `${label} uses an unsupported image format`);
  }
}

export async function resolveNativeImageFile(absolutePath: string, label: string): Promise<UploadedFileDescriptor> {
  if (!path.isAbsolute(absolutePath) || absolutePath.includes("\0") || /^\\\\[.?]\\/.test(absolutePath)) {
    throw new HttpError(400, "INVALID_SOURCE_PATH", `${label} must use a valid absolute file path`);
  }

  let resolvedPath: string;
  let stats;
  try {
    resolvedPath = await realpath(absolutePath);
    stats = await stat(resolvedPath);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "EACCES" || code === "EPERM") {
      throw new HttpError(403, "SOURCE_NOT_READABLE", `${label} is not readable`);
    }
    throw new HttpError(404, "SOURCE_NOT_FOUND", `${label} was not found`);
  }
  if (!stats.isFile()) throw new HttpError(400, "INVALID_SOURCE_PATH", `${label} is not a regular file`);

  const nativeFile = { path: resolvedPath, originalname: path.basename(resolvedPath), size: stats.size };
  validateUploadedFile(nativeFile, label);
  return nativeFile;
}

function validateOutputBase(outputPath: unknown, defaultExportDir: string): string {
  const requested = asString(outputPath).trim();
  if (!requested) return path.resolve(defaultExportDir);
  if (requested.length > MAX_OUTPUT_PATH_LENGTH || requested.includes("\0") || /^\\\\[.?]\\/.test(requested)) {
    throw new HttpError(400, "INVALID_OUTPUT_PATH", "Output path is invalid or too long");
  }
  if (!path.isAbsolute(requested)) {
    throw new HttpError(400, "INVALID_OUTPUT_PATH", "Output path must be absolute");
  }

  const resolved = path.resolve(requested);
  if (fs.existsSync(resolved) && !fs.statSync(resolved).isDirectory()) {
    throw new HttpError(400, "INVALID_OUTPUT_PATH", "Output path points to a file");
  }
  return resolved;
}

export function planOutputDirectory(
  outputPath: unknown,
  defaultExportDir: string,
  projectName: string,
  createSubfolder: boolean,
  jobId: string,
): string {
  const baseDir = validateOutputBase(outputPath, defaultExportDir);
  if (!createSubfolder) return baseDir;
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return path.join(baseDir, `${sanitizeSegment(projectName || "Project", "Project")}_${timestamp}_${jobId.slice(0, 8)}`);
}

/**
 * Verify the real operation PartyFrame needs instead of relying on access(),
 * whose result can differ from the subsequent create/write on Windows.
 */
export async function ensureOutputDirectoryWritable(outputDir: string): Promise<void> {
  const probePath = path.join(outputDir, `.partyframe-write-probe-${randomUUID()}.tmp`);
  let probe: Awaited<ReturnType<typeof open>> | null = null;
  try {
    await mkdir(outputDir, { recursive: true });
    probe = await open(probePath, "wx", 0o600);
    await probe.writeFile("partyframe-output-probe", "utf8");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
      throw new HttpError(403, "OUTPUT_NOT_WRITABLE", "La cartella di esportazione non è scrivibile");
    }
    if (code === "EEXIST" || code === "EINVAL" || code === "ENAMETOOLONG" || code === "ENOTDIR") {
      throw new HttpError(400, "INVALID_OUTPUT_PATH", "Il percorso di esportazione non è una cartella valida");
    }
    throw error;
  } finally {
    await probe?.close().catch(() => undefined);
    await rm(probePath, { force: true }).catch(() => undefined);
  }
}

export async function prepareExportRequest(
  body: ExportRequestBody | null | undefined,
  uploadedFiles: UploadedFileDescriptor[],
  templateBackgroundFiles: Partial<Record<"vertical" | "horizontal", UploadedFileDescriptor>>,
  defaultExportDir: string,
  jobId: string,
  options: PrepareExportOptions = {},
): Promise<PreparedExportRequest> {
  const requestBody = body && typeof body === "object" ? body : {};
  const templateId = asString(requestBody.templateId).trim();
  const customTemplate = parseCustomTemplate(requestBody.customTemplate);
  const baseTemplate = templateId === "custom" ? null : templates[templateId] ?? null;
  if (templateId === "custom" ? !customTemplate : !baseTemplate) {
    throw new HttpError(400, "INVALID_TEMPLATE", "Template is invalid");
  }

  const items = parseItems(requestBody.items);
  const nativeItemCount = items.filter((item) => item.absolutePath !== undefined).length;
  if (nativeItemCount > 0 && !options.allowNativePaths) {
    throw new HttpError(403, "NATIVE_PATHS_DISABLED", "Native source paths require an authenticated desktop session");
  }
  if (items.length - nativeItemCount !== uploadedFiles.length) {
    throw new HttpError(400, "INVALID_EXPORT_PAYLOAD", "The number of files does not match the export items");
  }

  uploadedFiles.forEach((file, index) => validateUploadedFile(file, `Image upload ${index + 1}`));
  for (const [orientation, file] of Object.entries(templateBackgroundFiles)) {
    if (file) validateUploadedFile(file, `${orientation} template background`);
  }
  const nativeFiles = await Promise.all(items.map(async (item, index) =>
    item.absolutePath ? resolveNativeImageFile(item.absolutePath, `Image ${index + 1}`) : null
  ));
  let uploadedIndex = 0;
  const files = items.map((_item, index) => nativeFiles[index] ?? uploadedFiles[uploadedIndex++]!);
  items.forEach((item, index) => {
    item.originalName ??= files[index].originalname;
  });
  const totalBytes = [...files, ...Object.values(templateBackgroundFiles)].reduce(
    (total, file) => total + (file?.size ?? 0),
    0,
  );
  if (totalBytes > MAX_BATCH_TOTAL_BYTES) {
    throw new HttpError(413, "BATCH_TOO_LARGE", `Export upload exceeds the ${MAX_BATCH_TOTAL_BYTES / 1024 / 1024} MB aggregate limit`);
  }
  files.forEach((file, index) => validateUploadedFile(file, `Image ${index + 1}`));

  if (requestBody.format !== undefined && requestBody.format !== "" && requestBody.format !== "jpeg" && requestBody.format !== "png") {
    throw new HttpError(400, "INVALID_FORMAT", "Export format must be jpeg or png");
  }
  const format = requestBody.format === "png" ? "png" : "jpeg";
  const parsedQuality = parseOptionalFiniteNumber(requestBody.quality, "quality") ?? 100;
  const quality = clamp(Math.round(parsedQuality), 60, 100);
  if (requestBody.colorProfile !== undefined && requestBody.colorProfile !== "" && requestBody.colorProfile !== "sRGB" && requestBody.colorProfile !== "AdobeRGB") {
    throw new HttpError(400, "INVALID_COLOR_PROFILE", "Color profile is invalid");
  }
  if (requestBody.colorProfile === "AdobeRGB") {
    throw new HttpError(
      422,
      "UNSUPPORTED_COLOR_PROFILE",
      "AdobeRGB export is unavailable because no verified Adobe RGB ICC profile is installed; use sRGB",
    );
  }
  const namingPattern = asString(requestBody.namingPattern, "original_frame").trim() || "original_frame";
  if (namingPattern.length > MAX_PATTERN_LENGTH || /[\u0000-\u001f]/.test(namingPattern)) {
    throw new HttpError(400, "INVALID_NAMING_PATTERN", "Naming pattern is invalid or too long");
  }
  const projectName = asString(requestBody.projectName, "Project").trim().slice(0, MAX_PROJECT_NAME_LENGTH) || "Project";
  const createSubfolder = parseBooleanField(requestBody.createSubfolder, true, "createSubfolder");
  const outputDir = planOutputDirectory(requestBody.outputPath, defaultExportDir, projectName, createSubfolder, jobId);
  // Keep accepting the legacy toggle, while the supported output baseline is always color-managed sRGB.
  parseBooleanField(requestBody.embedColorProfile, true, "embedColorProfile");

  return {
    templateId,
    baseTemplate,
    customTemplate,
    files,
    templateBackgroundFiles,
    items,
    quality,
    format,
    colorProfile: "sRGB",
    namingPattern,
    projectName,
    outputDir,
    embedColorProfile: true,
    overwrite: parseBooleanField(requestBody.overwrite, false, "overwrite"),
  };
}

function orientedDimensions(metadata: Metadata): { width: number; height: number } {
  if (metadata.autoOrient?.width && metadata.autoOrient?.height) {
    return { width: metadata.autoOrient.width, height: metadata.autoOrient.height };
  }
  if (!metadata.width || !metadata.height) {
    throw new HttpError(422, "INVALID_IMAGE", "Could not read image dimensions");
  }
  return metadata.orientation && metadata.orientation >= 5 && metadata.orientation <= 8
    ? { width: metadata.height, height: metadata.width }
    : { width: metadata.width, height: metadata.height };
}

export async function getAutoOrientedDimensions(imagePath: string): Promise<{ width: number; height: number }> {
  const metadata = await sharp(imagePath, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  return orientedDimensions(metadata);
}

export function computeCoverGeometry({
  sourceWidth,
  sourceHeight,
  targetWidth,
  targetHeight,
  zoom,
  offsetX,
  offsetY,
  legacyX = 0,
  legacyY = 0,
}: {
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  zoom: number;
  offsetX?: number;
  offsetY?: number;
  legacyX?: number;
  legacyY?: number;
}): CoverGeometry {
  if ([sourceWidth, sourceHeight, targetWidth, targetHeight].some((value) => !Number.isFinite(value) || value < 1)) {
    throw new HttpError(422, "INVALID_GEOMETRY", "Image or target geometry is invalid");
  }

  const baseScale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const zoomFactor = clamp(Number.isFinite(zoom) ? zoom / 100 : 1, 1, 4);
  const scaledWidth = Math.max(targetWidth, Math.round(sourceWidth * baseScale * zoomFactor));
  const scaledHeight = Math.max(targetHeight, Math.round(sourceHeight * baseScale * zoomFactor));
  if (scaledWidth * scaledHeight > MAX_WORKING_PIXELS) {
    throw new HttpError(422, "WORKING_IMAGE_TOO_LARGE", "Zoomed working image exceeds the processing pixel limit");
  }

  const overflowX = Math.max(0, scaledWidth - targetWidth);
  const overflowY = Math.max(0, scaledHeight - targetHeight);
  const translationX = offsetX === undefined ? legacyX : clamp(offsetX, -1, 1) * overflowX / 2;
  const translationY = offsetY === undefined ? legacyY : clamp(offsetY, -1, 1) * overflowY / 2;
  const extractLeft = clamp(Math.round(overflowX / 2 - translationX), 0, overflowX);
  const extractTop = clamp(Math.round(overflowY / 2 - translationY), 0, overflowY);

  return { scaledWidth, scaledHeight, extractLeft, extractTop, overflowX, overflowY };
}

async function buildPhotoAreaBuffer(
  imagePath: string,
  template: TemplateConfig,
  crop: BatchExportCrop,
  sourceDimensions?: { width: number; height: number },
): Promise<Buffer> {
  const targetWidth = Math.max(1, template.photoAreaWidth - template.photoBorderSize * 2);
  const targetHeight = Math.max(1, template.photoAreaHeight - template.photoBorderSize * 2);
  const dimensions = sourceDimensions ?? await getAutoOrientedDimensions(imagePath);
  const geometry = computeCoverGeometry({
    sourceWidth: dimensions.width,
    sourceHeight: dimensions.height,
    targetWidth,
    targetHeight,
    zoom: parseNumber(crop.zoom, 100),
    offsetX: crop.offsetX,
    offsetY: crop.offsetY,
    legacyX: parseNumber(crop.x, 0),
    legacyY: parseNumber(crop.y, 0),
  });

  return sharp(imagePath, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize(geometry.scaledWidth, geometry.scaledHeight, { fit: "fill" })
    .extract({
      left: geometry.extractLeft,
      top: geometry.extractTop,
      width: targetWidth,
      height: targetHeight,
    })
    .png()
    .toBuffer();
}

async function buildFrameBuffer(template: TemplateConfig): Promise<Buffer> {
  if (template.frameImagePath) {
    return sharp(template.frameImagePath, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize(template.width, template.height, { fit: "cover" })
      .png()
      .toBuffer();
  }

  if (template.presetId && PARTY_FRAME_PRESETS[template.presetId]) {
    const preset = orientPartyFramePreset(
      PARTY_FRAME_PRESETS[template.presetId],
      template.presetOrientation ?? "horizontal",
    );
    return sharp(Buffer.from(createPresetFrameSvg(preset))).png().toBuffer();
  }

  return sharp({
    create: {
      width: template.width,
      height: template.height,
      channels: 4,
      background:
        template.frameLeftTop === 0 && template.frameRightBottom === 0
          ? { r: 28, g: 28, b: 28, alpha: 1 }
          : { r: 220, g: 180, b: 100, alpha: 1 },
    },
  }).png().toBuffer();
}

export async function renderFramedImageAtomic({
  imagePath,
  template,
  outputPath,
  crop = {},
  quality = 95,
  format = "jpeg",
  frameBuffer,
  sourceDimensions,
  onPhase,
}: {
  imagePath: string;
  template: TemplateConfig;
  outputPath: string;
  crop?: BatchExportCrop;
  quality?: number;
  format?: "jpeg" | "png";
  frameBuffer?: Buffer;
  sourceDimensions?: { width: number; height: number };
  onPhase?: (phase: "rendering" | "writing") => void;
}): Promise<{ size: number }> {
  validateTemplateDimensions(template.width, template.height);
  onPhase?.("rendering");
  const resolvedFrameBuffer = frameBuffer ?? await buildFrameBuffer(template);
  const photoAreaBuffer = await buildPhotoAreaBuffer(imagePath, template, crop, sourceDimensions);
  const borderedPhotoBuffer = template.photoBorderSize > 0
    ? await sharp({
        create: {
          width: template.photoAreaWidth,
          height: template.photoAreaHeight,
          channels: 4,
          background: template.photoBorderColor,
        },
      })
        .composite([{ input: photoAreaBuffer, left: template.photoBorderSize, top: template.photoBorderSize }])
        .png()
        .toBuffer()
    : photoAreaBuffer;

  const output = sharp(resolvedFrameBuffer).composite([{
    input: borderedPhotoBuffer,
    left: template.photoAreaX,
    top: template.photoAreaY,
  }]);
  const partialPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.${randomUUID()}.partial`,
  );

  try {
    onPhase?.("writing");
    const result = format === "png"
      ? await output.withMetadata({ density: template.dpi }).png().toFile(partialPath)
      : await output.withMetadata({ density: template.dpi }).jpeg({ quality }).toFile(partialPath);
    await rename(partialPath, outputPath);
    return { size: result.size };
  } catch (error) {
    await rm(partialPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function templateForItem(request: PreparedExportRequest, item: BatchExportItem): TemplateConfig {
  if (request.templateId === "custom") {
    if (!request.customTemplate) throw new HttpError(400, "INVALID_TEMPLATE", "Custom template is missing");
    return toTemplateConfig(request.customTemplate, item.orientation, {
      vertical: request.templateBackgroundFiles.vertical?.path,
      horizontal: request.templateBackgroundFiles.horizontal?.path,
    });
  }
  return orientTemplate(request.baseTemplate!, item.orientation);
}

function publicProcessingError(error: unknown): string {
  if (error instanceof HttpError) {
    if (error.code === "WORKING_IMAGE_TOO_LARGE") return "Il livello di zoom genera un'immagine troppo grande";
    if (error.code === "INVALID_GEOMETRY") return "Il ritaglio non è valido per questa immagine";
    return "Immagine o parametri di elaborazione non validi";
  }
  if (error instanceof Error && /unsupported image format/i.test(error.message)) return "Immagine non supportata o danneggiata";
  if (error instanceof Error && /Input file contains unsupported image format/i.test(error.message)) return "Immagine non supportata o danneggiata";
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "ENOSPC") return "Spazio su disco insufficiente";
  if (code === "EACCES" || code === "EPERM") return "Cartella di esportazione non scrivibile";
  return "Elaborazione dell'immagine non riuscita";
}

export async function executeExport(
  request: PreparedExportRequest,
  hooks: ExportExecutionHooks = {},
): Promise<ExportResult> {
  const startedAt = Date.now();
  const result: ExportResult = { success: [], failed: [], totalTime: 0, outputDir: request.outputDir };
  if (hooks.signal?.aborted) throw new ExportCancelledError(result);

  hooks.onPhase?.("preparing", null);
  const sourceDimensions: Array<{ width: number; height: number } | null> = [];
  const preflightErrors = new Map<number, string>();
  for (const [index, file] of request.files.entries()) {
    if (hooks.signal?.aborted) throw new ExportCancelledError(result);
    const item = request.items[index];
    hooks.onPhase?.("preparing", item);
    try {
      const dimensions = await getAutoOrientedDimensions(file.path);
      const template = templateForItem(request, item);
      computeCoverGeometry({
        sourceWidth: dimensions.width,
        sourceHeight: dimensions.height,
        targetWidth: Math.max(1, template.photoAreaWidth - template.photoBorderSize * 2),
        targetHeight: Math.max(1, template.photoAreaHeight - template.photoBorderSize * 2),
        zoom: parseNumber(item.crop.zoom, 100),
        offsetX: item.crop.offsetX,
        offsetY: item.crop.offsetY,
        legacyX: parseNumber(item.crop.x, 0),
        legacyY: parseNumber(item.crop.y, 0),
      });
      sourceDimensions[index] = dimensions;
    } catch (error) {
      sourceDimensions[index] = null;
      preflightErrors.set(index, publicProcessingError(error));
    }
  }
  for (const background of Object.values(request.templateBackgroundFiles)) {
    if (!background) continue;
    if (hooks.signal?.aborted) throw new ExportCancelledError(result);
    try {
      await getAutoOrientedDimensions(background.path);
    } catch {
      throw new HttpError(422, "INVALID_TEMPLATE_BACKGROUND", "Lo sfondo del template è danneggiato o non supportato");
    }
  }
  if (sourceDimensions.some((dimensions) => dimensions !== null)) {
    await ensureOutputDirectoryWritable(request.outputDir);
  }
  const reservations = new OutputReservationMap();
  const frameCache = new Map<string, Buffer>();
  const protectedSourceKeys = new Set([
    ...request.files.map((file) => reservationKey(file.path)),
    ...Object.values(request.templateBackgroundFiles)
      .filter((file): file is UploadedFileDescriptor => Boolean(file))
      .map((file) => reservationKey(file.path)),
  ]);

  try {
    for (const [index, file] of request.files.entries()) {
      const item = request.items[index];
      if (hooks.signal?.aborted) {
        result.totalTime = Date.now() - startedAt;
        throw new ExportCancelledError(result);
      }

      const dimensions = sourceDimensions[index];
      if (!dimensions) {
        result.failed.push({ id: item.id, error: preflightErrors.get(index) ?? "Immagine non valida" });
        hooks.onItemSettled?.(index + 1, request.files.length, item);
        continue;
      }

      try {
        const template = templateForItem(request, item);
        const outputFilename = buildOutputFilename(
          item,
          request.namingPattern,
          request.projectName,
          index,
          request.format,
        );
        const outputPath = reservations.reserve(
          path.join(request.outputDir, outputFilename),
          request.overwrite,
          protectedSourceKeys,
        );
        const frameKey = [request.templateId, item.orientation, template.frameImagePath ?? "solid"].join("|");
        let frameBuffer = frameCache.get(frameKey);
        if (!frameBuffer) {
          frameBuffer = await buildFrameBuffer(template);
          frameCache.set(frameKey, frameBuffer);
        }

        const rendered = await renderFramedImageAtomic({
          imagePath: file.path,
          template,
          outputPath,
          crop: item.crop,
          quality: request.quality,
          format: request.format,
          frameBuffer,
          sourceDimensions: dimensions,
          onPhase: (phase) => hooks.onPhase?.(phase, item),
        });
        result.success.push({ id: item.id, filename: path.basename(outputPath), size: rendered.size });
      } catch (error) {
        result.failed.push({ id: item.id, error: publicProcessingError(error) });
      }

      hooks.onItemSettled?.(index + 1, request.files.length, item);
      if (hooks.signal?.aborted) {
        result.totalTime = Date.now() - startedAt;
        throw new ExportCancelledError(result);
      }
    }

    result.totalTime = Date.now() - startedAt;
    return result;
  } finally {
    reservations.releaseAll();
  }
}
