/**
 * IndexedDB storage for image assets persistence.
 * Solves the issue where blob URLs become invalid after page reload.
 */

import type { ImageAsset, ImageOrientation } from "@photo-tools/shared-types";

const DB_NAME = "imagetool-db";
const DB_VERSION = 1;
const STORE_NAME = "images";

interface StoredImage {
  id: string;
  projectId: string;
  fileName: string;
  path: string;
  sourceFileKey?: string;
  width: number;
  height: number;
  orientation: ImageOrientation;
  aspectRatio: number;
  blob: Blob;
  thumbnailBlob?: Blob;
  previewBlob?: Blob;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

type DesktopFile = File & {
  webkitRelativePath: string;
};

interface LoadImageAssetsOptions {
  sourceFolderPath?: string;
}

function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && typeof window.filexDesktop !== "undefined";
}

function isAbsolutePath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("/") || path.startsWith("\\\\");
}

function normalizePathSeparators(path: string): string {
  return path.replace(/\//g, "\\");
}

function trimPath(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

function getFileLookupKeys(asset: ImageAsset): string[] {
  const parsedSourcePath = extractSourceFilePathFromKey(asset.sourceFileKey);
  const keys = [asset.sourceFileKey, parsedSourcePath, asset.path, asset.fileName];
  const normalized = new Set<string>();

  for (const key of keys) {
    if (typeof key !== "string") {
      continue;
    }
    const trimmed = key.trim();
    if (!trimmed) {
      continue;
    }
    normalized.add(trimmed);
  }

  return Array.from(normalized);
}

function extractSourceFilePathFromKey(sourceFileKey?: string): string | null {
  if (typeof sourceFileKey !== "string") {
    return null;
  }

  const trimmed = sourceFileKey.trim();
  if (!trimmed) {
    return null;
  }

  const separatorIndex = trimmed.indexOf("::");
  if (separatorIndex > 0) {
    return trimmed.slice(0, separatorIndex).trim() || null;
  }

  return trimmed;
}

function getRelativePathCandidates(asset: ImageAsset): string[] {
  const candidates: string[] = [];
  const sourceFileKeyPath = extractSourceFilePathFromKey(asset.sourceFileKey);
  if (sourceFileKeyPath && !isAbsolutePath(sourceFileKeyPath)) {
    candidates.push(sourceFileKeyPath);
  }

  if (typeof asset.path === "string" && asset.path.trim().length > 0 && !isAbsolutePath(asset.path.trim())) {
    candidates.push(asset.path.trim());
  }

  if (typeof asset.fileName === "string" && asset.fileName.trim().length > 0) {
    candidates.push(asset.fileName.trim());
  }

  return Array.from(new Set(candidates));
}

function combinePaths(basePath: string, relativePath: string): string {
  const normalizedBase = trimPath(normalizePathSeparators(basePath));
  const normalizedRelative = normalizePathSeparators(relativePath).replace(/^[\\/]+/, "");
  return `${normalizedBase}\\${normalizedRelative}`;
}

function resolveDesktopAssetPath(asset: ImageAsset, sourceFolderPath?: string): string | null {
  const directCandidates = [asset.path, extractSourceFilePathFromKey(asset.sourceFileKey)];
  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0 && isAbsolutePath(candidate.trim())) {
      return candidate.trim();
    }
  }

  if (!sourceFolderPath || !isAbsolutePath(sourceFolderPath)) {
    return null;
  }

  const relativeCandidates = getRelativePathCandidates(asset);
  if (relativeCandidates.length === 0) {
    return null;
  }

  const sourceFolderName = trimPath(normalizePathSeparators(sourceFolderPath))
    .split("\\")
    .filter(Boolean)
    .at(-1)
    ?.toLocaleLowerCase();

  for (const relativePath of relativeCandidates) {
    const candidate = combinePaths(sourceFolderPath, relativePath);
    if (isAbsolutePath(candidate)) {
      return candidate;
    }

    if (!sourceFolderName) {
      continue;
    }

    const segments = normalizePathSeparators(relativePath).split("\\").filter(Boolean);
    if (segments.length > 1 && segments[0].toLocaleLowerCase() === sourceFolderName) {
      const withoutRootFolder = segments.slice(1).join("\\");
      if (withoutRootFolder) {
        const adjustedCandidate = combinePaths(sourceFolderPath, withoutRootFolder);
        if (isAbsolutePath(adjustedCandidate)) {
          return adjustedCandidate;
        }
      }
    }
  }
  return null;
}

async function loadDesktopPreviewUrl(
  absolutePath: string,
  options: { maxDimension?: number; sourceFileKey?: string } = {}
): Promise<string | null> {
  if (!isDesktopRuntime() || typeof window.filexDesktop?.getPreview !== "function") {
    return null;
  }

  const rendered = await window.filexDesktop.getPreview(absolutePath, {
    maxDimension: options.maxDimension ?? 1600,
    sourceFileKey: options.sourceFileKey
  });
  if (!rendered) {
    return null;
  }

  const bytes = new Uint8Array(rendered.bytes.length);
  bytes.set(rendered.bytes);
  const blob = new Blob([bytes], { type: rendered.mimeType || "image/jpeg" });
  return URL.createObjectURL(blob);
}

function getFileLookupKey(file: File): string {
  const desktopFile = file as DesktopFile;
  return desktopFile.webkitRelativePath || file.name;
}

async function blobFromUrl(url?: string): Promise<Blob | undefined> {
  if (!url) {
    return undefined;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Impossibile leggere il blob da ${url}.`);
  }

  return response.blob();
}

async function safeBlobFromUrl(url?: string): Promise<Blob | undefined> {
  try {
    return await blobFromUrl(url);
  } catch {
    return undefined;
  }
}

function inferMimeTypeFromFileName(fileName: string): string {
  const lower = fileName.toLocaleLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".gif")) {
    return "image/gif";
  }
  if (lower.endsWith(".tif") || lower.endsWith(".tiff")) {
    return "image/tiff";
  }
  if (
    lower.endsWith(".raw") ||
    lower.endsWith(".cr2") ||
    lower.endsWith(".cr3") ||
    lower.endsWith(".nef") ||
    lower.endsWith(".arw") ||
    lower.endsWith(".dng")
  ) {
    return "image/x-raw";
  }
  return "image/jpeg";
}

async function readDesktopFileBlob(absolutePath: string): Promise<Blob | undefined> {
  if (!isDesktopRuntime() || typeof window.filexDesktop?.readFile !== "function") {
    return undefined;
  }

  try {
    const payload = await window.filexDesktop.readFile(absolutePath);
    if (!payload) {
      return undefined;
    }

    const bytes = new Uint8Array(payload.bytes.length);
    bytes.set(payload.bytes);
    return new Blob([bytes], { type: inferMimeTypeFromFileName(payload.name || absolutePath) });
  } catch {
    return undefined;
  }
}

async function loadImageAssetsFromIndexedDb(projectId: string): Promise<Map<string, ImageAsset>> {
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  const projectIndex = store.index("projectId");

  const range = IDBKeyRange.only(projectId);
  const request = projectIndex.getAll(range);

  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const storedImages = request.result as StoredImage[];
      const assetMap = new Map<string, ImageAsset>();

      storedImages.forEach((stored) => {
        const sourceUrl = URL.createObjectURL(stored.blob);
        const thumbnailUrl = stored.thumbnailBlob
          ? URL.createObjectURL(stored.thumbnailBlob)
          : sourceUrl;
        const previewUrl = stored.previewBlob
          ? URL.createObjectURL(stored.previewBlob)
          : sourceUrl;

        assetMap.set(stored.id, {
          id: stored.id,
          fileName: stored.fileName,
          path: stored.path,
          sourceFileKey: stored.sourceFileKey ?? stored.path,
          width: stored.width,
          height: stored.height,
          orientation: stored.orientation,
          aspectRatio: stored.aspectRatio,
          sourceUrl,
          thumbnailUrl,
          previewUrl
        });
      });

      resolve(assetMap);
    };

    request.onerror = () => reject(request.error);
  });
}

async function getStoredImageCount(projectId: string): Promise<number> {
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  const projectIndex = store.index("projectId");
  const range = IDBKeyRange.only(projectId);
  const countRequest = projectIndex.count(range);

  return new Promise((resolve, reject) => {
    countRequest.onsuccess = () => resolve(countRequest.result);
    countRequest.onerror = () => reject(countRequest.error);
  });
}

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("projectId", "projectId");
        store.createIndex("createdAt", "createdAt");
      }
    };
  });

  return dbPromise;
}

export async function saveImageAssets(
  projectId: string,
  files: File[],
  imageAssets: ImageAsset[],
  sourceFolderPath?: string
): Promise<void> {
  const fileMap = new Map(files.map((file) => [getFileLookupKey(file), file]));
  const preparedAssets = await Promise.all(
    imageAssets.map(async (asset) => {
      try {
        const fileLookupKeys = getFileLookupKeys(asset);
        const fileFromSession = fileLookupKeys
          .map((key) => fileMap.get(key))
          .find((file): file is File => Boolean(file));

        let sourceBlob: Blob | undefined = fileFromSession;

        if (!sourceBlob && isDesktopRuntime()) {
          const absolutePath = resolveDesktopAssetPath(asset, sourceFolderPath);
          if (absolutePath) {
            sourceBlob = await readDesktopFileBlob(absolutePath);
          }
        }

        if (!sourceBlob) {
          sourceBlob = await safeBlobFromUrl(asset.sourceUrl ?? asset.previewUrl ?? asset.thumbnailUrl);
        }

        if (!sourceBlob) {
          return null;
        }

        const thumbnailBlob =
          asset.thumbnailUrl && asset.thumbnailUrl !== asset.sourceUrl
            ? await safeBlobFromUrl(asset.thumbnailUrl)
            : undefined;
        const previewBlob =
          asset.previewUrl &&
          asset.previewUrl !== asset.sourceUrl &&
          asset.previewUrl !== asset.thumbnailUrl
            ? await safeBlobFromUrl(asset.previewUrl)
            : thumbnailBlob;

        return {
          asset,
          sourceBlob,
          thumbnailBlob,
          previewBlob
        };
      } catch {
        return null;
      }
    })
  );

  const db = await getDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);

  // Delete old images for this project
  const projectIndex = store.index("projectId");
  const range = IDBKeyRange.only(projectId);
  const deleteRequest = projectIndex.getAll(range);

  deleteRequest.onsuccess = () => {
    deleteRequest.result.forEach((image) => {
      store.delete(image.id);
    });
  };

  // Save new images
  preparedAssets.forEach((prepared) => {
    if (!prepared) return;

    const stored: StoredImage = {
      id: prepared.asset.id,
        projectId,
        fileName: prepared.asset.fileName,
        path: prepared.asset.path,
        sourceFileKey: prepared.asset.sourceFileKey ?? prepared.asset.path,
        width: prepared.asset.width,
        height: prepared.asset.height,
      orientation: prepared.asset.orientation,
      aspectRatio: prepared.asset.aspectRatio,
      blob: prepared.sourceBlob,
      thumbnailBlob: prepared.thumbnailBlob,
      previewBlob: prepared.previewBlob,
      createdAt: Date.now()
    };

    store.put(stored);
  });

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadImageAssets(
  projectId: string,
  desktopSeedAssets: ImageAsset[] = [],
  options: LoadImageAssetsOptions = {}
): Promise<Map<string, ImageAsset>> {
  if (isDesktopRuntime()) {
    const assetMap = new Map<string, ImageAsset>();
    for (const asset of desktopSeedAssets) {
      const absolutePath = resolveDesktopAssetPath(asset, options.sourceFolderPath);
      if (!absolutePath) {
        continue;
      }

      try {
        const previewUrl = await loadDesktopPreviewUrl(absolutePath, {
          maxDimension: 1600,
          sourceFileKey: asset.sourceFileKey
        });
        if (!previewUrl) {
          continue;
        }

        assetMap.set(asset.id, {
          ...asset,
          path: absolutePath,
          sourceFileKey: absolutePath,
          sourceUrl: previewUrl,
          thumbnailUrl: previewUrl,
          previewUrl: previewUrl
        });
      } catch {
        // Ignore unreadable assets and continue restoring remaining previews.
      }
    }

    if (assetMap.size < desktopSeedAssets.length) {
      const fallbackMap = await loadImageAssetsFromIndexedDb(projectId);
      fallbackMap.forEach((asset, id) => {
        if (!assetMap.has(id)) {
          assetMap.set(id, asset);
        }
      });
    }

    return assetMap;
  }

  return loadImageAssetsFromIndexedDb(projectId);
}

export async function deleteProjectImages(projectId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  const projectIndex = store.index("projectId");

  const range = IDBKeyRange.only(projectId);
  const deleteRequest = projectIndex.getAll(range);

  return new Promise((resolve, reject) => {
    deleteRequest.onsuccess = () => {
      deleteRequest.result.forEach((image) => {
        store.delete(image.id);
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };

    deleteRequest.onerror = () => reject(deleteRequest.error);
  });
}

export async function hasProjectImages(
  projectId: string,
  desktopSeedAssets: ImageAsset[] = [],
  sourceFolderPath?: string
): Promise<boolean> {
  if (isDesktopRuntime()) {
    if (desktopSeedAssets.some((asset) => Boolean(resolveDesktopAssetPath(asset, sourceFolderPath)))) {
      return true;
    }
  }

  return (await getStoredImageCount(projectId)) > 0;
}
