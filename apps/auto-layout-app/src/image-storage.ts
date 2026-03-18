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

type BrowserFile = File & {
  webkitRelativePath: string;
};

function getFileLookupKey(file: File): string {
  const browserFile = file as BrowserFile;
  return browserFile.webkitRelativePath || file.name;
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
  imageAssets: ImageAsset[]
): Promise<void> {
  const fileMap = new Map(files.map((file) => [getFileLookupKey(file), file]));
  const preparedAssets = await Promise.all(
    imageAssets.map(async (asset) => {
      const sourceBlob =
        fileMap.get(asset.sourceFileKey ?? asset.path ?? asset.fileName) ??
        (await blobFromUrl(asset.sourceUrl ?? asset.previewUrl ?? asset.thumbnailUrl));

      if (!sourceBlob) {
        return null;
      }

      const thumbnailBlob =
        asset.thumbnailUrl && asset.thumbnailUrl !== asset.sourceUrl
          ? await blobFromUrl(asset.thumbnailUrl)
          : undefined;
      const previewBlob =
        asset.previewUrl &&
        asset.previewUrl !== asset.sourceUrl &&
        asset.previewUrl !== asset.thumbnailUrl
          ? await blobFromUrl(asset.previewUrl)
          : thumbnailBlob;

      return {
        asset,
        sourceBlob,
        thumbnailBlob,
        previewBlob
      };
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

export async function loadImageAssets(projectId: string): Promise<Map<string, ImageAsset>> {
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

export async function hasProjectImages(projectId: string): Promise<boolean> {
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  const projectIndex = store.index("projectId");

  const range = IDBKeyRange.only(projectId);
  const countRequest = projectIndex.count(range);

  return new Promise((resolve, reject) => {
    countRequest.onsuccess = () => {
      resolve(countRequest.result > 0);
    };
    countRequest.onerror = () => reject(countRequest.error);
  });
}
