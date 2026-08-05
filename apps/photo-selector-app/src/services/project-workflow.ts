import type {
  DesktopFolderCatalogAssetState,
  DesktopPhotoSelectorProjectFile,
  DesktopPhotoSelectorProjectLocation,
} from "@photo-tools/desktop-contracts";
import type { ImageAsset } from "@photo-tools/shared-types";

function normalizePath(value: string | undefined): string {
  return (value ?? "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+|\/+$/g, "").toLocaleLowerCase();
}

function pathSuffixes(value: string | undefined): string[] {
  const normalized = normalizePath(value);
  const segments = normalized.split("/").filter(Boolean);
  const suffixes = [normalized];
  if (segments.length > 1) {
    suffixes.push(segments.slice(1).join("/"));
  }
  return suffixes.filter(Boolean);
}

function stateEditScore(state: DesktopFolderCatalogAssetState): number {
  return (state.rating > 0 ? 8 : 0)
    + (state.pickStatus !== "unmarked" ? 4 : 0)
    + (state.colorLabel ? 2 : 0)
    + (state.customLabels.length > 0 ? 1 : 0);
}

function chooseState(
  current: DesktopFolderCatalogAssetState | undefined,
  candidate: DesktopFolderCatalogAssetState,
): DesktopFolderCatalogAssetState {
  if (!current) {
    return candidate;
  }
  const scoreDifference = stateEditScore(candidate) - stateEditScore(current);
  if (scoreDifference !== 0) {
    return scoreDifference > 0 ? candidate : current;
  }
  return candidate.updatedAt >= current.updatedAt ? candidate : current;
}

export interface MasterProjectMergeResult {
  project: DesktopPhotoSelectorProjectFile;
  legacyProjectCount: number;
  migratedSelectionCount: number;
  migratedMetadataCount: number;
}

export function buildMasterProject(
  rootFolderName: string,
  projectName: string,
  assets: ImageAsset[],
  getAbsolutePath: (assetId: string) => string | null | undefined,
  legacyProjects: DesktopPhotoSelectorProjectLocation[],
): MasterProjectMergeResult {
  const legacyStateByPath = new Map<string, DesktopFolderCatalogAssetState>();
  const selectedLegacyPaths = new Set<string>();

  for (const location of legacyProjects) {
    const states = location.project.folderState?.assetStates ?? [];
    const activeIds = new Set(location.project.folderState?.activeAssetIds ?? []);
    for (const state of states) {
      const keys = new Set([
        ...pathSuffixes(state.relativePath),
        ...pathSuffixes(state.absolutePath),
      ]);
      for (const key of keys) {
        legacyStateByPath.set(key, chooseState(legacyStateByPath.get(key), state));
        if (activeIds.has(state.assetId)) {
          selectedLegacyPaths.add(key);
        }
      }
    }
  }

  const now = Date.now();
  let migratedMetadataCount = 0;
  const activeAssetIds: string[] = [];
  const assetStates = assets.map((asset): DesktopFolderCatalogAssetState => {
    const absolutePath = getAbsolutePath(asset.id) ?? undefined;
    const keys = new Set([
      ...pathSuffixes(asset.path),
      ...pathSuffixes(absolutePath),
    ]);
    let legacyState: DesktopFolderCatalogAssetState | undefined;
    let selected = false;
    for (const key of keys) {
      legacyState = chooseState(legacyState, legacyStateByPath.get(key) ?? {
        assetId: asset.id,
        fileName: asset.fileName,
        relativePath: asset.path,
        rating: 0,
        pickStatus: "unmarked",
        colorLabel: null,
        customLabels: [],
        updatedAt: 0,
      });
      selected ||= selectedLegacyPaths.has(key);
    }
    if (selected) {
      activeAssetIds.push(asset.id);
    }
    const hasMigratedMetadata = legacyState
      && (legacyState.rating > 0
        || legacyState.pickStatus !== "unmarked"
        || legacyState.colorLabel !== null
        || legacyState.customLabels.length > 0);
    if (hasMigratedMetadata) {
      migratedMetadataCount += 1;
    }
    return {
      assetId: asset.id,
      fileName: asset.fileName,
      relativePath: asset.path,
      absolutePath,
      sourceFileKey: asset.sourceFileKey,
      rating: legacyState?.rating ?? 0,
      pickStatus: legacyState?.pickStatus ?? "unmarked",
      colorLabel: legacyState?.colorLabel ?? null,
      customLabels: legacyState?.customLabels ?? [],
      updatedAt: legacyState?.updatedAt ?? now,
    };
  });

  return {
    project: {
      schemaVersion: 1,
      app: "image-select-pro",
      updatedAt: now,
      createdAt: now,
      projectMode: "master",
      projectId: globalThis.crypto?.randomUUID?.() ?? `project-${now}`,
      projectRootFolderName: rootFolderName,
      projectName: projectName.trim() || rootFolderName,
      folderState: {
        activeAssetIds,
        assetStates,
      },
    },
    legacyProjectCount: new Set(legacyProjects.map((location) => normalizePath(location.rootPath))).size,
    migratedSelectionCount: activeAssetIds.length,
    migratedMetadataCount,
  };
}
