import type {
  DesktopFolderCatalogAssetState,
  DesktopFreeSelectionSnapshot,
  DesktopSelectionMode,
  DesktopSourceIdentity,
} from "@photo-tools/desktop-contracts";
import type { ImageAsset } from "@photo-tools/shared-types";
import type { FolderEntry } from "./folder-access";
import { getAssetRotation, normalizeImageRotation } from "./photo-rotation";

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeInventoryPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").toLocaleLowerCase();
}

export function buildFallbackSourceIdentity(
  rootFolderName: string,
  rootPath: string,
  entries: FolderEntry[],
): DesktopSourceIdentity {
  const inventory = entries
    .map((entry) => `${normalizeInventoryPath(entry.relativePath)}:${entry.size}:${entry.lastModified}`)
    .sort()
    .join("|");
  const inventoryFingerprint = `fallback-${hashString(inventory)}`;
  const normalizedName = rootFolderName.trim().toLocaleLowerCase() || "cartella";

  return {
    schemaVersion: 1,
    sourceId: `source-${hashString(`${normalizedName}:${inventoryFingerprint}`)}`,
    inventoryFingerprint,
    rootPath,
    rootFolderName: rootFolderName.trim() || "Cartella",
    rootRelativePath: ".",
    fileCount: entries.length,
    totalBytes: entries.reduce((total, entry) => total + Math.max(0, entry.size), 0),
    isWritable: entries.some((entry) => Boolean(entry.absolutePath)),
  };
}

export function getWorkspaceCatalogKey(
  mode: DesktopSelectionMode,
  rootPath: string,
  sourceId?: string | null,
): string {
  if (mode === "free") {
    const normalizedSourceId = sourceId?.trim();
    return normalizedSourceId ? `free:${normalizedSourceId}` : `free-path:${rootPath}`;
  }
  return rootPath;
}

export function shouldWriteProjectFile(mode: DesktopSelectionMode | null): boolean {
  return mode === "project";
}

export function buildWorkspaceAssetStates(
  assets: ImageAsset[],
  updatedAt: number,
  getAbsolutePath: (assetId: string) => string | null,
  options: {
    activeAssetIds?: string[];
    previousStates?: DesktopFolderCatalogAssetState[];
  } = {},
): DesktopFolderCatalogAssetState[] {
  const activeIds = new Set(options.activeAssetIds ?? []);
  const previousByPath = new Map(
    (options.previousStates ?? []).map((state) => [normalizeInventoryPath(state.relativePath), state]),
  );

  return assets.map((asset) => {
    const active = activeIds.has(asset.id);
    const rating = asset.rating ?? 0;
    const pickStatus = asset.pickStatus ?? "unmarked";
    const colorLabel = asset.colorLabel ?? null;
    const customLabels = asset.customLabels ?? [];
    const rotationDegrees = getAssetRotation(asset);
    const previous = previousByPath.get(normalizeInventoryPath(asset.path));
    const classificationUnchanged = Boolean(
      previous
      && previous.rating === rating
      && previous.pickStatus === pickStatus
      && previous.colorLabel === colorLabel
      && normalizeImageRotation(previous.rotationDegrees) === rotationDegrees
      && previous.customLabels.length === customLabels.length
      && previous.customLabels.every((label, index) => label === customLabels[index]),
    );
    const selectionUnchanged = Boolean(previous && previous.active === active);
    const classificationUpdatedAt = classificationUnchanged
      ? previous?.classificationUpdatedAt ?? previous?.updatedAt ?? updatedAt
      : updatedAt;
    const selectionUpdatedAt = selectionUnchanged
      ? previous?.selectionUpdatedAt ?? previous?.updatedAt ?? updatedAt
      : updatedAt;

    return {
      assetId: asset.id,
      fileName: asset.fileName,
      relativePath: asset.path,
      absolutePath: getAbsolutePath(asset.id) ?? undefined,
      sourceFileKey: asset.sourceFileKey,
      rating,
      pickStatus,
      colorLabel,
      customLabels,
      rotationDegrees,
      active,
      classificationUpdatedAt,
      selectionUpdatedAt,
      updatedAt: Math.max(classificationUpdatedAt, selectionUpdatedAt),
    };
  });
}

export function buildFreeSelectionSnapshot(input: {
  source: DesktopSourceIdentity;
  displayName: string;
  createdAt: number;
  updatedAt: number;
  activeAssetIds: string[];
  assetStates: DesktopFolderCatalogAssetState[];
}): DesktopFreeSelectionSnapshot {
  return {
    schemaVersion: 1,
    app: "image-select-pro",
    mode: "free",
    source: input.source,
    displayName: input.displayName.trim() || input.source.rootFolderName || "Selezione libera",
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    activeAssetIds: [...input.activeAssetIds],
    assetStates: input.assetStates,
  };
}
