import type {
  DesktopNativeFileOpStatus,
} from "@photo-tools/desktop-contracts";
import type { ImageAsset } from "@photo-tools/shared-types";
import { preloadImageUrls } from "./image-cache";
import {
  getDesktopRecentFolders,
  removeDesktopRecentFolder,
  saveDesktopRecentFolder,
} from "./desktop-store";

const STANDARD_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const RAW_EXTENSIONS = new Set([
  ".cr2", ".cr3", ".crw",
  ".nef", ".nrw",
  ".arw", ".srf", ".sr2",
  ".raf",
  ".dng",
  ".rw2",
  ".orf",
  ".pef",
  ".srw",
  ".3fr",
  ".x3f",
  ".gpr",
]);

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

export function isImageFile(name: string): boolean {
  if (name.startsWith("._")) return false;
  const ext = extOf(name);
  return STANDARD_EXTENSIONS.has(ext) || RAW_EXTENSIONS.has(ext);
}

export function isRawFile(name: string): boolean {
  return RAW_EXTENSIONS.has(extOf(name));
}

export const fileStore = new Map<string, File>();
const filePromiseStore = new Map<string, Promise<File | null>>();
const assetPathStore = new Map<string, string>();
const assetAbsolutePathStore = new Map<string, string>();
const assetSourceFileKeyStore = new Map<string, string>();
const assetCompanionAbsolutePathStore = new Map<string, string>();
const assetCompanionRelativePathStore = new Map<string, string>();
const assetCompanionSourceFileKeyStore = new Map<string, string>();
const assetCompanionFileNameStore = new Map<string, string>();
const livePreviewStore = new Map<string, string>();
const onDemandPreviewStore = new Map<string, string>();
const onDemandPreviewPromiseStore = new Map<string, Promise<string | null>>();
let previewGeneration = 0;

function hasDesktopFolderBridge(): boolean {
  return typeof window !== "undefined" && typeof window.filexDesktop?.openFolder === "function";
}

function hasDesktopFileBridge(): boolean {
  return typeof window !== "undefined" && typeof window.filexDesktop?.readFile === "function";
}

function hasDesktopPreviewBridge(): boolean {
  return typeof window !== "undefined" && typeof window.filexDesktop?.getPreview === "function";
}

function hasDesktopThumbnailBridge(): boolean {
  return typeof window !== "undefined" && typeof window.filexDesktop?.getThumbnail === "function";
}

function hasDesktopPreviewWarmBridge(): boolean {
  return typeof window !== "undefined" && typeof window.filexDesktop?.warmPreview === "function";
}

function hasDesktopQuickPreviewWarmBridge(): boolean {
  return typeof window !== "undefined"
    && typeof window.filexDesktop?.warmQuickPreviewFrames === "function";
}

function hasDesktopSidecarBridge(): boolean {
  return typeof window !== "undefined"
    && typeof window.filexDesktop?.readSidecarXmp === "function"
    && typeof window.filexDesktop?.writeSidecarXmp === "function";
}

function hasDesktopCopyBridge(): boolean {
  return typeof window !== "undefined" && typeof window.filexDesktop?.copyFilesToFolder === "function";
}

function hasDesktopMoveBridge(): boolean {
  return typeof window !== "undefined" && typeof window.filexDesktop?.moveFilesToFolder === "function";
}

function hasDesktopSaveAsBridge(): boolean {
  return typeof window !== "undefined" && typeof window.filexDesktop?.saveFileAs === "function";
}

function detectOrientation(width: number, height: number): "horizontal" | "vertical" | "square" {
  if (width === height) return "square";
  return height > width ? "vertical" : "horizontal";
}

function toOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function revokeLivePreviewUrl(assetId: string): void {
  const current = livePreviewStore.get(assetId);
  if (current) {
    URL.revokeObjectURL(current);
    livePreviewStore.delete(assetId);
  }
}

function invalidateOnDemandPreview(assetId: string): void {
  const keyPrefix = `${assetId}::`;
  for (const [cacheKey, current] of onDemandPreviewStore.entries()) {
    if (cacheKey === assetId || cacheKey.startsWith(keyPrefix)) {
      URL.revokeObjectURL(current);
      onDemandPreviewStore.delete(cacheKey);
    }
  }

  for (const cacheKey of onDemandPreviewPromiseStore.keys()) {
    if (cacheKey === assetId || cacheKey.startsWith(keyPrefix)) {
      onDemandPreviewPromiseStore.delete(cacheKey);
    }
  }
}

export interface OnDemandPreviewOptions {
  maxDimension?: number;
  signal?: AbortSignal;
}

function getOnDemandPreviewCacheKey(assetId: string, options: OnDemandPreviewOptions = {}): string {
  const maxDimension = Math.max(0, Math.round(options.maxDimension ?? 0));
  return `${assetId}::${maxDimension}`;
}

export function getCachedOnDemandPreviewUrl(
  assetId: string,
  options: OnDemandPreviewOptions = {},
): string | null {
  return onDemandPreviewStore.get(getOnDemandPreviewCacheKey(assetId, options)) ?? null;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function sanitizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function buildSourceFileKey(file: File, relativePath: string): string {
  return `${relativePath}::${file.size}::${file.lastModified}`;
}

export function buildSourceFileKeyFromStats(
  relativePath: string,
  size: number,
  lastModified: number,
): string {
  return `${relativePath}::${size}::${lastModified}`;
}

function buildPlaceholderSourceFileKey(relativePath: string): string {
  return `${relativePath}::0::0`;
}

export function buildAssetId(relativePath: string): string {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  return `asset-${hashString(normalizedPath.toLowerCase())}-${sanitizeId(normalizedPath)}`;
}

export interface FolderEntry {
  name: string;
  relativePath: string;
  absolutePath: string;
  size: number;
  lastModified: number;
  createdAt: number;
}

export interface FolderOpenResult {
  name: string;
  entries: FolderEntry[];
  rootPath: string;
  diagnostics?: FolderOpenDiagnostics;
}

export interface FolderOpenDiagnostics {
  source: "desktop-native";
  selectedPath: string;
  topLevelSupportedCount: number;
  nestedSupportedDiscardedCount: number;
  totalSupportedSeen: number;
  nestedDirectoriesSeen: number;
  groupedAssetCount?: number;
}

function isTopLevelRelativePath(relativePath: string): boolean {
  const segments = relativePath.split("/").filter(Boolean);
  return segments.length <= 2;
}

function keepTopLevelEntries(entries: FolderEntry[]): FolderEntry[] {
  return entries.filter((entry) => isTopLevelRelativePath(entry.relativePath));
}

function buildFolderDiagnostics(
  selectedPath: string,
  topLevelSupportedCount: number,
  nestedSupportedDiscardedCount: number,
  nestedDirectoriesSeen = 0,
): FolderOpenDiagnostics {
  return {
    source: "desktop-native",
    selectedPath,
    topLevelSupportedCount,
    nestedSupportedDiscardedCount,
    totalSupportedSeen: topLevelSupportedCount + nestedSupportedDiscardedCount,
    nestedDirectoriesSeen,
  };
}

function toFolderOpenResult(
  name: string,
  rootPath: string,
  entries: FolderEntry[],
  diagnostics?: FolderOpenDiagnostics,
): FolderOpenResult {
  return {
    name,
    rootPath,
    entries,
    diagnostics,
  };
}

export function hasNativeFolderAccess(): boolean {
  return hasDesktopFolderBridge();
}

export async function openFolderNative(): Promise<FolderOpenResult | null> {
  if (!hasDesktopFolderBridge()) {
    return null;
  }

  const result = await window.filexDesktop!.openFolder();
  if (!result) {
    return null;
  }

  const mappedEntries = result.entries.map((entry) => ({
    name: entry.name,
    relativePath: entry.relativePath,
    absolutePath: entry.absolutePath,
    size: entry.size,
    lastModified: entry.lastModified,
    createdAt: entry.createdAt,
  }));
  const entries = keepTopLevelEntries(mappedEntries);
  const diagnostics = buildFolderDiagnostics(
    result.diagnostics?.selectedPath ?? result.rootPath,
    entries.length,
    result.diagnostics?.nestedSupportedDiscardedCount ?? Math.max(0, mappedEntries.length - entries.length),
    result.diagnostics?.nestedDirectoriesSeen ?? 0,
  );

  return toFolderOpenResult(
    result.name,
    result.rootPath,
    entries,
    diagnostics,
  );
}

export async function reopenRecentFolder(folder: RecentFolder): Promise<FolderOpenResult | null> {
  if (!hasDesktopFolderBridge() || !folder.path) {
    return null;
  }

  const result = await window.filexDesktop!.reopenFolder(folder.path);
  if (!result) {
    return null;
  }

  const mappedEntries = result.entries.map((entry) => ({
    name: entry.name,
    relativePath: entry.relativePath,
    absolutePath: entry.absolutePath,
    size: entry.size,
    lastModified: entry.lastModified,
    createdAt: entry.createdAt,
  }));
  const entries = keepTopLevelEntries(mappedEntries);
  const diagnostics = buildFolderDiagnostics(
    result.diagnostics?.selectedPath ?? result.rootPath,
    entries.length,
    result.diagnostics?.nestedSupportedDiscardedCount ?? Math.max(0, mappedEntries.length - entries.length),
    result.diagnostics?.nestedDirectoriesSeen ?? 0,
  );

  return toFolderOpenResult(
    result.name,
    result.rootPath,
    entries,
    diagnostics,
  );
}

export function buildPlaceholderAssets(entries: FolderEntry[]): ImageAsset[] {
  previewGeneration += 1;
  for (const url of onDemandPreviewStore.values()) {
    URL.revokeObjectURL(url);
  }
  for (const url of livePreviewStore.values()) {
    URL.revokeObjectURL(url);
  }
  onDemandPreviewStore.clear();
  onDemandPreviewPromiseStore.clear();
  livePreviewStore.clear();
  filePromiseStore.clear();
  assetPathStore.clear();
  assetAbsolutePathStore.clear();
  assetSourceFileKeyStore.clear();
  assetCompanionAbsolutePathStore.clear();
  assetCompanionRelativePathStore.clear();
  assetCompanionSourceFileKeyStore.clear();
  assetCompanionFileNameStore.clear();
  fileStore.clear();

  const groups = groupEntriesByBaseName(entries);

  return groups.map(({ primary, companion }) => {
    const id = buildAssetId(primary.relativePath);
    const sourceFileKey =
      buildSourceFileKeyFromStats(primary.relativePath, primary.size, primary.lastModified)
      || buildPlaceholderSourceFileKey(primary.relativePath);

    assetPathStore.set(id, primary.relativePath);
    assetAbsolutePathStore.set(id, primary.absolutePath);
    assetSourceFileKeyStore.set(id, sourceFileKey);

    let companionFileName: string | undefined;
    let companionPath: string | undefined;
    let companionSourceFileKey: string | undefined;
    let companionSize: number | undefined;
    let groupKind: "raw+jpg" | "raw" | "standard" = isRawFile(primary.name) ? "raw" : "standard";

    if (companion) {
      companionFileName = companion.name;
      companionPath = companion.relativePath;
      companionSourceFileKey =
        buildSourceFileKeyFromStats(companion.relativePath, companion.size, companion.lastModified)
        || buildPlaceholderSourceFileKey(companion.relativePath);
      companionSize = companion.size;
      groupKind = "raw+jpg";
      assetCompanionAbsolutePathStore.set(id, companion.absolutePath);
      assetCompanionRelativePathStore.set(id, companion.relativePath);
      assetCompanionSourceFileKeyStore.set(id, companionSourceFileKey);
      assetCompanionFileNameStore.set(id, companion.name);
    }

    return {
      id,
      fileName: primary.name,
      path: primary.relativePath,
      sourceFileKey,
      rating: 0,
      pickStatus: "unmarked",
      colorLabel: null,
      customLabels: [],
      createdAt: primary.createdAt,
      width: 0,
      height: 0,
      orientation: "horizontal" as const,
      aspectRatio: 4 / 3,
      thumbnailUrl: undefined,
      previewUrl: undefined,
      sourceUrl: undefined,
      size: primary.size,
      groupKind,
      companionFileName,
      companionPath,
      companionSourceFileKey,
      companionSize,
    };
  });
}

function getEntryParentPath(relativePath: string): string {
  const idx = relativePath.lastIndexOf("/");
  return idx >= 0 ? relativePath.slice(0, idx) : "";
}

function getEntryBaseName(name: string): string {
  const idx = name.lastIndexOf(".");
  return (idx >= 0 ? name.slice(0, idx) : name).toLowerCase();
}

interface EntryGroup {
  primary: FolderEntry;
  companion?: FolderEntry;
}

function groupEntriesByBaseName(entries: FolderEntry[]): EntryGroup[] {
  // Bucket by parent path + base name (case-insensitive). Within a bucket,
  // a JPG/JPEG entry pairs with a RAW entry to form a single grouped asset
  // (JPG as primary, RAW as companion). Any other entries pass through as
  // singletons preserving original order.
  type Bucket = { jpgs: FolderEntry[]; raws: FolderEntry[]; others: FolderEntry[] };
  const bucketByKey = new Map<string, Bucket>();
  const bucketKeyOrder: string[] = [];
  const orderIndex = new Map<FolderEntry, number>();

  entries.forEach((entry, index) => {
    orderIndex.set(entry, index);
    const parent = getEntryParentPath(entry.relativePath);
    const base = getEntryBaseName(entry.name);
    const key = `${parent.toLowerCase()}::${base}`;
    let bucket = bucketByKey.get(key);
    if (!bucket) {
      bucket = { jpgs: [], raws: [], others: [] };
      bucketByKey.set(key, bucket);
      bucketKeyOrder.push(key);
    }

    const ext = extOf(entry.name);
    if (ext === ".jpg" || ext === ".jpeg") {
      bucket.jpgs.push(entry);
    } else if (RAW_EXTENSIONS.has(ext)) {
      bucket.raws.push(entry);
    } else {
      bucket.others.push(entry);
    }
  });

  const groupsByPrimary = new Map<FolderEntry, EntryGroup>();

  for (const key of bucketKeyOrder) {
    const bucket = bucketByKey.get(key)!;
    const usedRaws = new Set<FolderEntry>();
    // Pair each JPG with the first unused RAW in the same bucket.
    for (const jpg of bucket.jpgs) {
      const companionRaw = bucket.raws.find((raw) => !usedRaws.has(raw));
      if (companionRaw) {
        usedRaws.add(companionRaw);
        groupsByPrimary.set(jpg, { primary: jpg, companion: companionRaw });
      } else {
        groupsByPrimary.set(jpg, { primary: jpg });
      }
    }
    for (const raw of bucket.raws) {
      if (!usedRaws.has(raw)) {
        groupsByPrimary.set(raw, { primary: raw });
      }
    }
    for (const other of bucket.others) {
      groupsByPrimary.set(other, { primary: other });
    }
  }

  // Emit groups in original file order so existing sorts and prefetch logic
  // remain stable for users who added a RAW companion mid-folder.
  const ordered: EntryGroup[] = [];
  const emitted = new Set<FolderEntry>();
  for (const entry of entries) {
    const group = groupsByPrimary.get(entry);
    if (!group || group.primary !== entry || emitted.has(group.primary)) {
      continue;
    }
    emitted.add(group.primary);
    if (group.companion) {
      emitted.add(group.companion);
    }
    ordered.push(group);
  }

  // Sanity-check: anything not yet emitted (companion before primary in iteration
  // order, or unexpected duplicates) is appended as a standalone group.
  for (const entry of entries) {
    if (!emitted.has(entry)) {
      const group = groupsByPrimary.get(entry);
      if (group && group.primary === entry) {
        emitted.add(entry);
        if (group.companion) emitted.add(group.companion);
        ordered.push(group);
      }
    }
  }

  ordered.sort((left, right) =>
    (orderIndex.get(left.primary) ?? 0) - (orderIndex.get(right.primary) ?? 0));

  return ordered;
}

export function getAssetCompanionAbsolutePath(assetId: string): string | null {
  return assetCompanionAbsolutePathStore.get(assetId) ?? null;
}

export function getAssetCompanionRelativePath(assetId: string): string | null {
  return assetCompanionRelativePathStore.get(assetId) ?? null;
}

export function getAssetCompanionFileName(assetId: string): string | null {
  return assetCompanionFileNameStore.get(assetId) ?? null;
}

export function hasAssetCompanion(assetId: string): boolean {
  return assetCompanionAbsolutePathStore.has(assetId);
}

export async function getFileForAsset(assetId: string): Promise<File | null> {
  const existing = fileStore.get(assetId);
  if (existing) {
    return existing;
  }

  const pending = filePromiseStore.get(assetId);
  if (pending) {
    return pending;
  }

  const absolutePath = assetAbsolutePathStore.get(assetId);
  if (!absolutePath || !hasDesktopFileBridge()) {
    return null;
  }

  const task = window.filexDesktop!.readFile(absolutePath)
    .then((payload) => {
      if (!payload) {
        return null;
      }

      const file = new File([toOwnedArrayBuffer(payload.bytes)], payload.name, {
        lastModified: payload.lastModified,
      });
      fileStore.set(assetId, file);
      return file;
    })
    .catch(() => null)
    .finally(() => {
      if (filePromiseStore.get(assetId) === task) {
        filePromiseStore.delete(assetId);
      }
    });

  filePromiseStore.set(assetId, task);
  return task;
}

export async function readSidecarXmp(assetId: string): Promise<string | null> {
  if (!hasDesktopSidecarBridge()) {
    return null;
  }

  const absolutePath = assetAbsolutePathStore.get(assetId);
  if (absolutePath) {
    const xml = await window.filexDesktop!.readSidecarXmp(absolutePath);
    if (xml) {
      return xml;
    }
  }

  // Fall back to the companion sidecar (e.g. RAW xmp written by Camera Raw)
  // when the primary JPG has no sidecar yet.
  const companionAbsolutePath = assetCompanionAbsolutePathStore.get(assetId);
  if (companionAbsolutePath) {
    return window.filexDesktop!.readSidecarXmp(companionAbsolutePath);
  }

  return absolutePath ? null : null;
}

export async function writeSidecarXmp(assetId: string, xml: string): Promise<boolean> {
  if (!hasDesktopSidecarBridge()) {
    return false;
  }

  const absolutePath = assetAbsolutePathStore.get(assetId);
  const companionAbsolutePath = assetCompanionAbsolutePathStore.get(assetId);

  if (!absolutePath && !companionAbsolutePath) {
    return false;
  }

  let allOk = true;
  if (absolutePath) {
    const ok = await window.filexDesktop!.writeSidecarXmp(absolutePath, xml);
    if (!ok) allOk = false;
  }
  if (companionAbsolutePath) {
    const ok = await window.filexDesktop!.writeSidecarXmp(companionAbsolutePath, xml);
    if (!ok) allOk = false;
  }

  return allOk;
}

export async function createOnDemandPreviewAsync(
  assetId: string,
  _priority = 0,
  options: OnDemandPreviewOptions = {},
): Promise<string | null> {
  const cacheKey = getOnDemandPreviewCacheKey(assetId, options);
  const cached = onDemandPreviewStore.get(cacheKey);
  if (cached) return cached;

  const pending = onDemandPreviewPromiseStore.get(cacheKey);
  if (pending) {
    return pending;
  }

  const absolutePath = assetAbsolutePathStore.get(assetId);
  if (!absolutePath || !hasDesktopPreviewBridge()) {
    return null;
  }

  const generation = previewGeneration;
  // NOTA: il task è condiviso tra più caller via `onDemandPreviewPromiseStore`,
  // quindi NON deve dipendere dal signal di un singolo caller. Il signal è
  // applicato sopra (sentinel pre-task) e dopo (filtro lato caller).
  const task = (async () => {
    try {
      const preview = await window.filexDesktop!.getPreview(absolutePath, {
        maxDimension: options.maxDimension,
        sourceFileKey: assetSourceFileKeyStore.get(assetId),
      });
      if (!preview) {
        return null;
      }
      if (generation !== previewGeneration) {
        return null;
      }

      const blob = new Blob([toOwnedArrayBuffer(preview.bytes)], { type: preview.mimeType });
      const url = URL.createObjectURL(blob);
      if (generation !== previewGeneration) {
        URL.revokeObjectURL(url);
        return null;
      }

      onDemandPreviewStore.set(cacheKey, url);
      preloadImageUrls([url]);
      return url;
    } catch {
      return null;
    }
  })();

  onDemandPreviewPromiseStore.set(cacheKey, task);
  task.finally(() => {
    if (onDemandPreviewPromiseStore.get(cacheKey) === task) {
      onDemandPreviewPromiseStore.delete(cacheKey);
    }
  });

  // Permette al singolo caller di "dimenticare" il risultato se il proprio
  // signal è stato abortito, senza propagare l'abort agli altri sottoscrittori
  // della stessa promise condivisa.
  const signal = options.signal;
  if (!signal) {
    return task;
  }
  return task.then((value) => (signal.aborted ? null : value));
}

export async function warmOnDemandPreviewCache(
  assetId: string,
  priority = 0,
  options: OnDemandPreviewOptions = {},
): Promise<boolean> {
  const absolutePath = assetAbsolutePathStore.get(assetId);
  const sourceFileKey = assetSourceFileKeyStore.get(assetId);
  if (absolutePath && hasDesktopQuickPreviewWarmBridge()) {
    try {
      const result = await window.filexDesktop!.warmQuickPreviewFrames([{
        absolutePath,
        maxDimension: Math.max(0, Math.round(options.maxDimension ?? 0)),
        sourceFileKey,
        stage: "fit",
        priority,
      }]);
      return result.warmedCount > 0;
    } catch {
      return false;
    }
  }

  if (absolutePath && hasDesktopPreviewWarmBridge()) {
    try {
      return await window.filexDesktop!.warmPreview(absolutePath, {
        maxDimension: options.maxDimension,
        sourceFileKey,
      });
    } catch {
      return false;
    }
  }

  const url = await createOnDemandPreviewAsync(assetId, priority, options);
  return Boolean(url);
}

export interface AssetDiskChange {
  id: string;
  sourceFileKey: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  sourceUrl?: string;
  width?: number;
  height?: number;
  orientation?: "horizontal" | "vertical" | "square";
  aspectRatio?: number;
}

export async function detectChangedAssetsOnDisk(assetIds: string[]): Promise<AssetDiskChange[]> {
  if (assetIds.length === 0) return [];

  const changes: AssetDiskChange[] = [];
  const uniqueIds = Array.from(new Set(assetIds));

  for (const assetId of uniqueIds) {
    const absolutePath = assetAbsolutePathStore.get(assetId);
    if (!absolutePath || !hasDesktopFileBridge()) continue;

    try {
      const payload = await window.filexDesktop!.readFile(absolutePath);
      if (!payload) {
        continue;
      }

      const relativePath = assetPathStore.get(assetId) ?? payload.name;
      const nextSourceFileKey = buildSourceFileKeyFromStats(
        relativePath,
        payload.size,
        payload.lastModified,
      );
      const currentSourceFileKey = assetSourceFileKeyStore.get(assetId);
      const currentFile = fileStore.get(assetId);
      const hasChanged =
        currentSourceFileKey
          ? currentSourceFileKey !== nextSourceFileKey
          : !currentFile
            || currentFile.lastModified !== payload.lastModified
            || currentFile.size !== payload.size;

      if (!hasChanged) continue;

      const latestFile = new File([toOwnedArrayBuffer(payload.bytes)], payload.name, {
        lastModified: payload.lastModified,
      });
      fileStore.set(assetId, latestFile);
      invalidateOnDemandPreview(assetId);

      assetSourceFileKeyStore.set(assetId, nextSourceFileKey);
      const next: AssetDiskChange = {
        id: assetId,
        sourceFileKey: nextSourceFileKey,
      };

      let refreshedPreview = false;
      if (hasDesktopPreviewBridge()) {
        const preview = await window.filexDesktop!.getPreview(absolutePath, {
          sourceFileKey: nextSourceFileKey,
        });
        if (preview) {
          const liveUrl = URL.createObjectURL(
            new Blob([toOwnedArrayBuffer(preview.bytes)], { type: preview.mimeType }),
          );
          revokeLivePreviewUrl(assetId);
          livePreviewStore.set(assetId, liveUrl);
          preloadImageUrls([liveUrl]);

          next.thumbnailUrl = liveUrl;
          next.previewUrl = liveUrl;
          next.sourceUrl = liveUrl;
          next.width = preview.width;
          next.height = preview.height;
          next.orientation = detectOrientation(preview.width, preview.height);
          next.aspectRatio = preview.width / preview.height;
          refreshedPreview = true;
        }
      }

      if (!refreshedPreview && hasDesktopThumbnailBridge()) {
        const thumbnail = await window.filexDesktop!.getThumbnail(
          absolutePath,
          320,
          0.72,
          nextSourceFileKey,
        );
        if (thumbnail) {
          const liveUrl = URL.createObjectURL(
            new Blob([toOwnedArrayBuffer(thumbnail.bytes)], { type: thumbnail.mimeType }),
          );
          revokeLivePreviewUrl(assetId);
          livePreviewStore.set(assetId, liveUrl);
          preloadImageUrls([liveUrl]);

          next.thumbnailUrl = liveUrl;
          next.previewUrl = liveUrl;
          next.sourceUrl = liveUrl;
          next.width = thumbnail.width;
          next.height = thumbnail.height;
          next.orientation = detectOrientation(thumbnail.width, thumbnail.height);
          next.aspectRatio = thumbnail.width / thumbnail.height;
        }
      }

      changes.push(next);
    } catch {
      // Ignore single-file read failures.
    }
  }

  return changes;
}

export function getSubfolder(assetPath: string): string {
  const parts = assetPath.split("/");
  if (parts.length <= 2) return "";
  return parts.slice(1, -1).join("/");
}

export function extractSubfolders(
  assets: ImageAsset[],
): { folder: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const asset of assets) {
    const folder = getSubfolder(asset.path);
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([folder, count]) => ({ folder, count }))
    .sort((a, b) => a.folder.localeCompare(b.folder));
}

type FileOpResult = "ok" | "cancelled" | "error" | "partial" | "no-file";

function mapDesktopFileOpStatus(status: DesktopNativeFileOpStatus | undefined): FileOpResult {
  switch (status) {
    case "ok":
    case "cancelled":
    case "partial":
    case "no-file":
      return status;
    default:
      return "error";
  }
}

export function getAssetRelativePath(assetId: string): string | null {
  return assetPathStore.get(assetId) ?? null;
}

export function getAssetAbsolutePath(assetId: string): string | null {
  return assetAbsolutePathStore.get(assetId) ?? null;
}

export function getAssetAbsolutePaths(assetIds: string[]): string[] {
  // Returns BOTH primary and companion absolute paths so file operations
  // (copy/move/drag-out) act on RAW + JPG together for grouped assets.
  const uniquePaths = new Set<string>();
  for (const assetId of assetIds) {
    const absolutePath = assetAbsolutePathStore.get(assetId);
    if (absolutePath) {
      uniquePaths.add(absolutePath);
    }
    const companionAbsolutePath = assetCompanionAbsolutePathStore.get(assetId);
    if (companionAbsolutePath) {
      uniquePaths.add(companionAbsolutePath);
    }
  }

  return Array.from(uniquePaths);
}

export async function copyAssetsToFolder(assetIds: string[]): Promise<FileOpResult> {
  if (assetIds.length === 0) return "no-file";
  if (!hasDesktopCopyBridge()) return "error";

  const absolutePaths = getAssetAbsolutePaths(assetIds);
  if (absolutePaths.length === 0) return "no-file";

  try {
    const result = await window.filexDesktop!.copyFilesToFolder(absolutePaths);
    return mapDesktopFileOpStatus(result.status);
  } catch {
    return "error";
  }
}

export async function moveAssetsToFolder(assetIds: string[]): Promise<{ result: FileOpResult; movedIds: string[] }> {
  if (assetIds.length === 0) return { result: "no-file", movedIds: [] };
  if (!hasDesktopMoveBridge()) return { result: "error", movedIds: [] };

  const idByAbsolutePath = new Map<string, string>();
  for (const assetId of assetIds) {
    const absolutePath = assetAbsolutePathStore.get(assetId);
    if (absolutePath && !idByAbsolutePath.has(absolutePath)) {
      idByAbsolutePath.set(absolutePath, assetId);
    }
    const companionAbsolutePath = assetCompanionAbsolutePathStore.get(assetId);
    if (companionAbsolutePath && !idByAbsolutePath.has(companionAbsolutePath)) {
      idByAbsolutePath.set(companionAbsolutePath, assetId);
    }
  }

  const absolutePaths = Array.from(idByAbsolutePath.keys());
  if (absolutePaths.length === 0) return { result: "no-file", movedIds: [] };

  try {
    const response = await window.filexDesktop!.moveFilesToFolder(absolutePaths);
    const movedIds = Array.from(new Set(response.movedPaths
      .map((path) => idByAbsolutePath.get(path) ?? null)
      .filter((id): id is string => id !== null)));

    for (const assetId of movedIds) {
      revokeLivePreviewUrl(assetId);
      invalidateOnDemandPreview(assetId);
      assetPathStore.delete(assetId);
      assetAbsolutePathStore.delete(assetId);
      assetSourceFileKeyStore.delete(assetId);
      assetCompanionAbsolutePathStore.delete(assetId);
      assetCompanionRelativePathStore.delete(assetId);
      assetCompanionSourceFileKeyStore.delete(assetId);
      assetCompanionFileNameStore.delete(assetId);
      fileStore.delete(assetId);
      filePromiseStore.delete(assetId);
    }

    return {
      result: mapDesktopFileOpStatus(response.status),
      movedIds,
    };
  } catch {
    return { result: "error", movedIds: [] };
  }
}

export async function saveAssetAs(assetId: string): Promise<FileOpResult> {
  const absolutePath = assetAbsolutePathStore.get(assetId);
  if (!absolutePath) return "no-file";
  if (!hasDesktopSaveAsBridge()) return "error";

  try {
    const result = await window.filexDesktop!.saveFileAs(absolutePath);
    return mapDesktopFileOpStatus(result.status);
  } catch {
    return "error";
  }
}

const MAX_RECENT = 8;
let recentFoldersCache: RecentFolder[] = [];

export interface RecentFolder {
  name: string;
  path?: string;
  imageCount: number;
  openedAt: number;
}

export function getRecentFolders(): RecentFolder[] {
  return recentFoldersCache;
}

export function addRecentFolder(name: string, imageCount: number, path?: string): void {
  const nextFolder: RecentFolder = { name, path, imageCount, openedAt: Date.now() };

  recentFoldersCache = [nextFolder, ...recentFoldersCache.filter((folder) => folder.path !== path || folder.name !== name)]
    .slice(0, MAX_RECENT);

  void saveDesktopRecentFolder(nextFolder).then((recentFolders) => {
    if (recentFolders) {
      recentFoldersCache = recentFolders;
    }
  });
}

export async function hydrateRecentFolders(): Promise<RecentFolder[]> {
  const recentFolders = await getDesktopRecentFolders();
  recentFoldersCache = recentFolders ?? [];
  return recentFoldersCache;
}

export async function removeRecentFolder(folderPathOrName: string): Promise<RecentFolder[]> {
  const recentFolders = await removeDesktopRecentFolder(folderPathOrName);
  recentFoldersCache = recentFolders ?? [];
  return recentFoldersCache;
}
