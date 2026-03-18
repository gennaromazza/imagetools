import type { CustomTemplate } from "../contexts/ProjectContext";
import { setCustomTemplateBackgroundFile } from "../contexts/ProjectContext";

export type SavedTemplateRecord = {
  id: string;
  name: string;
  createdAt: string;
  summary: string;
  template: CustomTemplate;
};

type PortableTemplateAsset = {
  fileName: string;
  mimeType: string;
  dataUrl: string;
};

export type PortableSavedTemplatesPackage = {
  version: 1;
  exportedAt: string;
  templates: Array<{
    record: SavedTemplateRecord;
    assets?: Partial<Record<"vertical" | "horizontal", PortableTemplateAsset>>;
  }>;
};

const STORAGE_KEY = "desktop-frame-composer.saved-templates";
const STORAGE_EVENT = "desktop-frame-composer:saved-templates-updated";
const ASSET_DB_NAME = "desktop-frame-composer-assets";
const ASSET_STORE_NAME = "template-backgrounds";

function safeLocalStorageGet(): SavedTemplateRecord[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as SavedTemplateRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Failed to load saved templates", error);
    return [];
  }
}

function safeLocalStorageSet(records: SavedTemplateRecord[]): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  window.dispatchEvent(new Event(STORAGE_EVENT));
}

function openAssetsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(ASSET_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ASSET_STORE_NAME)) {
        db.createObjectStore(ASSET_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
  });
}

async function setAssetBlob(assetKey: string, file: File): Promise<void> {
  const db = await openAssetsDb();

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(ASSET_STORE_NAME, "readwrite");
    const store = transaction.objectStore(ASSET_STORE_NAME);
    store.put(file, assetKey);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Failed to store template asset"));
  });

  db.close();
}

async function getAssetBlob(assetKey: string): Promise<Blob | null> {
  const db = await openAssetsDb();

  const blob = await new Promise<Blob | null>((resolve, reject) => {
    const transaction = db.transaction(ASSET_STORE_NAME, "readonly");
    const store = transaction.objectStore(ASSET_STORE_NAME);
    const request = store.get(assetKey);

    request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Failed to load template asset"));
  });

  db.close();
  return blob;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to convert blob to data URL"));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToFile(asset: PortableTemplateAsset): File {
  const [header, content] = asset.dataUrl.split(",", 2);
  const mimeMatch = header?.match(/data:(.*?);base64/);
  const mimeType = mimeMatch?.[1] || asset.mimeType || "image/png";
  const binary = window.atob(content || "");
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new File([bytes], asset.fileName, { type: mimeType });
}

async function deleteAssetBlob(assetKey: string): Promise<void> {
  const db = await openAssetsDb();

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(ASSET_STORE_NAME, "readwrite");
    const store = transaction.objectStore(ASSET_STORE_NAME);
    store.delete(assetKey);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Failed to delete template asset"));
  });

  db.close();
}

async function clearAssetStore(): Promise<void> {
  const db = await openAssetsDb();

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(ASSET_STORE_NAME, "readwrite");
    const store = transaction.objectStore(ASSET_STORE_NAME);
    store.clear();

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Failed to clear template assets"));
  });

  db.close();
}

export function loadSavedTemplates(): SavedTemplateRecord[] {
  return safeLocalStorageGet();
}

function collectRecordAssetKeys(record: SavedTemplateRecord): string[] {
  return (["vertical", "horizontal"] as const)
    .map((orientation) => record.template.variants[orientation].backgroundAssetKey)
    .filter((assetKey): assetKey is string => typeof assetKey === "string" && assetKey.length > 0);
}

export function onSavedTemplatesUpdated(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  window.addEventListener(STORAGE_EVENT, listener);
  return () => window.removeEventListener(STORAGE_EVENT, listener);
}

export async function saveTemplateToLibrary(
  template: CustomTemplate,
  backgroundFiles?: Partial<Record<"vertical" | "horizontal", File | null>>
): Promise<SavedTemplateRecord> {
  const cleanedName = template.name.trim();
  if (!cleanedName) {
    throw new Error("Template name is required");
  }

  const recordId = `tpl_${Date.now()}`;
  const vertical = template.variants.vertical;
  const horizontal = template.variants.horizontal;
  const summary = `Verticale ${vertical.widthCm}x${vertical.heightCm} cm | Orizzontale ${horizontal.widthCm}x${horizontal.heightCm} cm`;

  const recordTemplate: CustomTemplate = {
    ...template,
    libraryTemplateId: recordId,
    name: cleanedName,
    variants: {
      vertical: { ...vertical },
      horizontal: { ...horizontal },
    },
  };

  for (const orientation of ["vertical", "horizontal"] as const) {
    const variant = recordTemplate.variants[orientation];
    if (variant.backgroundDataUrl) {
      delete variant.backgroundDataUrl;
    }
    if (backgroundFiles?.[orientation]) {
      delete variant.backgroundPreviewUrl;
    } else if (variant.backgroundPreviewUrl?.startsWith("data:")) {
      delete variant.backgroundPreviewUrl;
    }
  }

  const record: SavedTemplateRecord = {
    id: recordId,
    name: cleanedName,
    createdAt: new Date().toISOString(),
    summary,
    template: recordTemplate,
  };

  for (const orientation of ["vertical", "horizontal"] as const) {
    const sourceFile = backgroundFiles?.[orientation];
    if (!sourceFile) {
      continue;
    }

    const assetKey = await attachTemplateBackgroundAsset(recordId, orientation, sourceFile);
    record.template.variants[orientation].backgroundAssetKey = assetKey;
  }

  const existing = safeLocalStorageGet().filter((item) => item.name !== cleanedName);
  const next = [record, ...existing].slice(0, 20);
  safeLocalStorageSet(next);
  return record;
}

export function renameSavedTemplate(templateId: string, nextName: string): SavedTemplateRecord[] {
  const cleanedName = nextName.trim();
  if (!cleanedName) {
    return loadSavedTemplates();
  }

  const next = loadSavedTemplates().map((record) =>
    record.id === templateId
      ? {
          ...record,
          name: cleanedName,
          template: {
            ...record.template,
            libraryTemplateId: record.id,
            name: cleanedName,
          },
        }
      : record
  );

  safeLocalStorageSet(next);
  return next;
}

export function deleteSavedTemplate(templateId: string): SavedTemplateRecord[] {
  const current = loadSavedTemplates();
  const deletedRecord = current.find((record) => record.id === templateId);
  const next = current.filter((record) => record.id !== templateId);
  safeLocalStorageSet(next);

  if (deletedRecord) {
    const stillReferencedAssetKeys = new Set(next.flatMap((record) => collectRecordAssetKeys(record)));
    const removableAssetKeys = collectRecordAssetKeys(deletedRecord).filter((assetKey) => !stillReferencedAssetKeys.has(assetKey));

    for (const assetKey of removableAssetKeys) {
      void deleteAssetBlob(assetKey).catch((error) => {
        console.warn(`Failed to cleanup template asset ${assetKey}`, error);
      });
    }
  }

  return next;
}

export async function clearSavedTemplatesLibrary(): Promise<SavedTemplateRecord[]> {
  safeLocalStorageSet([]);
  await clearAssetStore();
  return [];
}

export function duplicateSavedTemplate(templateId: string, nextName?: string): SavedTemplateRecord[] {
  const source = loadSavedTemplates().find((record) => record.id === templateId);
  if (!source) {
    return loadSavedTemplates();
  }

  const duplicateName = (nextName?.trim() || `${source.name} Copy`).trim();
  const duplicateId = `tpl_${Date.now()}`;
  const duplicateRecord: SavedTemplateRecord = {
    ...source,
    id: duplicateId,
    name: duplicateName,
    createdAt: new Date().toISOString(),
    template: {
      ...source.template,
      libraryTemplateId: duplicateId,
      name: duplicateName,
      variants: {
        vertical: { ...source.template.variants.vertical },
        horizontal: { ...source.template.variants.horizontal },
      },
    },
  };

  const next = [duplicateRecord, ...loadSavedTemplates()].slice(0, 20);
  safeLocalStorageSet(next);
  return next;
}

export function templateRecordDateLabel(record: SavedTemplateRecord): string {
  return new Date(record.createdAt).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export async function attachTemplateBackgroundAsset(
  templateId: string,
  orientation: "vertical" | "horizontal",
  file: File
): Promise<string> {
  const assetKey = `${templateId}:${orientation}`;
  await setAssetBlob(assetKey, file);
  return assetKey;
}

export async function hydrateSavedTemplate(record: SavedTemplateRecord): Promise<CustomTemplate> {
  const nextTemplate: CustomTemplate = {
    ...record.template,
    libraryTemplateId: record.id,
    variants: {
      vertical: { ...record.template.variants.vertical },
      horizontal: { ...record.template.variants.horizontal },
    },
  };

  for (const orientation of ["vertical", "horizontal"] as const) {
    const variant = nextTemplate.variants[orientation] as typeof nextTemplate.variants[typeof orientation] & {
      backgroundAssetKey?: string;
    };

    if (!variant.backgroundAssetKey || !variant.backgroundFileName) {
      continue;
    }

    const blob = await getAssetBlob(variant.backgroundAssetKey);
    if (!blob) {
      continue;
    }

    const type = blob.type || "image/png";
    const file = new File([blob], variant.backgroundFileName, { type });
    const previewUrl = URL.createObjectURL(file);

    setCustomTemplateBackgroundFile(orientation, file);
    variant.backgroundPreviewUrl = previewUrl;
  }

  return nextTemplate;
}

export async function exportSavedTemplatesPackage(): Promise<PortableSavedTemplatesPackage> {
  const records = loadSavedTemplates();
  const templates = await Promise.all(
    records.map(async (record) => {
      const assets: Partial<Record<"vertical" | "horizontal", PortableTemplateAsset>> = {};

      for (const orientation of ["vertical", "horizontal"] as const) {
        const variant = record.template.variants[orientation];
        if (!variant.backgroundAssetKey || !variant.backgroundFileName) {
          continue;
        }

        const blob = await getAssetBlob(variant.backgroundAssetKey);
        if (!blob) {
          continue;
        }

        assets[orientation] = {
          fileName: variant.backgroundFileName,
          mimeType: blob.type || "image/png",
          dataUrl: await blobToDataUrl(blob),
        };
      }

      return {
        record,
        assets: Object.keys(assets).length > 0 ? assets : undefined,
      };
    })
  );

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    templates,
  };
}

export async function importSavedTemplatesPackage(
  payload: PortableSavedTemplatesPackage,
  mode: "merge" | "replace" = "merge"
): Promise<SavedTemplateRecord[]> {
  const current = mode === "replace" ? [] : loadSavedTemplates();
  if (mode === "replace") {
    await clearAssetStore();
  }

  const importedRecords: SavedTemplateRecord[] = [];

  for (const entry of payload.templates ?? []) {
    const record: SavedTemplateRecord = {
      ...entry.record,
      template: {
        ...entry.record.template,
        libraryTemplateId: entry.record.id,
        variants: {
          vertical: { ...entry.record.template.variants.vertical },
          horizontal: { ...entry.record.template.variants.horizontal },
        },
      },
    };

    for (const orientation of ["vertical", "horizontal"] as const) {
      const asset = entry.assets?.[orientation];
      if (!asset) {
        continue;
      }

      const file = dataUrlToFile(asset);
      const assetKey = `${record.id}:${orientation}`;
      await setAssetBlob(assetKey, file);
      record.template.variants[orientation].backgroundAssetKey = assetKey;
      record.template.variants[orientation].backgroundFileName = file.name;
    }

    importedRecords.push(record);
  }

  const existingById = new Map(current.map((record) => [record.id, record]));
  for (const record of importedRecords) {
    existingById.set(record.id, record);
  }

  const next = Array.from(existingById.values())
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 50);

  safeLocalStorageSet(next);
  return next;
}
