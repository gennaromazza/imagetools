import type { DesktopThumbnailCacheLookupEntry } from "@photo-tools/desktop-contracts";
import { measureAsync } from "./performance-utils";

export interface CachedThumbnailWrite {
  id: string;
  blob: Blob;
  width: number;
  height: number;
}

export interface ThumbnailCacheLookupEntry {
  id: string;
  absolutePath?: string;
  sourceFileKey?: string;
}

export type ThumbnailCacheLookup = string | ThumbnailCacheLookupEntry;

export interface ThumbnailCacheLoadOptions {
  maxDimension?: number;
  quality?: number;
}

const DEFAULT_THUMBNAIL_CACHE_MAX_DIMENSION = 320;
const DEFAULT_THUMBNAIL_CACHE_QUALITY = 0.72;

function canUseDesktopThumbnailCache(): boolean {
  return typeof window !== "undefined" && typeof window.filexDesktop?.getCachedThumbnails === "function";
}

function toDesktopLookupEntries(entries: ThumbnailCacheLookup[]): DesktopThumbnailCacheLookupEntry[] {
  return entries.flatMap((entry) => (
    typeof entry === "string" || !entry.absolutePath
      ? []
      : [{
          id: entry.id,
          absolutePath: entry.absolutePath,
          sourceFileKey: entry.sourceFileKey,
        }]
  ));
}

function toOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  return owned.buffer;
}

export async function cacheThumbnail(
  _id: string,
  _blob: Blob,
  _width: number,
  _height: number,
): Promise<void> {
  // Desktop-only mode: persistent thumbnail cache is owned by FileX native layer.
}

export async function cacheThumbnailBatch(_items: CachedThumbnailWrite[]): Promise<void> {
  // Desktop-only mode: persistent thumbnail cache is owned by FileX native layer.
}

export async function loadCachedThumbnails(
  entries: ThumbnailCacheLookup[],
  options?: ThumbnailCacheLoadOptions,
): Promise<Map<string, { url: string; width: number; height: number }>> {
  const result = new Map<string, { url: string; width: number; height: number }>();
  if (entries.length === 0) return result;
  if (!canUseDesktopThumbnailCache()) return result;

  const maxDimension = options?.maxDimension ?? DEFAULT_THUMBNAIL_CACHE_MAX_DIMENSION;
  const quality = options?.quality ?? DEFAULT_THUMBNAIL_CACHE_QUALITY;
  const desktopEntries = toDesktopLookupEntries(entries);
  if (desktopEntries.length === 0) {
    return result;
  }

  await measureAsync(`[PERF] desktop cache bulk-read (${desktopEntries.length})`, async () => {
    try {
      const cached = await window.filexDesktop!.getCachedThumbnails(
        desktopEntries,
        maxDimension,
        quality,
      );

      for (const hit of cached) {
        result.set(hit.id, {
          url: URL.createObjectURL(new Blob([toOwnedArrayBuffer(hit.bytes)], { type: hit.mimeType })),
          width: hit.width,
          height: hit.height,
        });
      }
    } catch {
      // Non-critical
    }
  });

  return result;
}

export async function clearThumbnailCache(): Promise<void> {
  if (!canUseDesktopThumbnailCache() || typeof window.filexDesktop?.clearThumbnailCache !== "function") {
    return;
  }

  try {
    await window.filexDesktop.clearThumbnailCache();
  } catch {
    // Ignore cache clear failures.
  }
}
