import { DEFAULT_AUTO_LAYOUT_REQUEST } from "@photo-tools/presets";
import type { ImageAsset } from "@photo-tools/shared-types";
import { getAssetAbsolutePath, isRawFile } from "./folder-access";

type ExportedProjectAsset = {
  id: string;
  fileName: string;
  path: string;
  sourceFileKey?: string;
  rating?: number;
  pickStatus?: ImageAsset["pickStatus"];
  colorLabel?: ImageAsset["colorLabel"];
  customLabels?: string[];
  width: number;
  height: number;
  orientation: ImageAsset["orientation"];
  aspectRatio: number;
  sourceBlob: string;
};

function getDesktopApi() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.filexDesktop ?? null;
}

function slugifyFileName(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-") || "photo-selector-selection";
}

function guessMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "application/octet-stream";
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Impossibile serializzare il contenuto del progetto."));
        return;
      }

      resolve(reader.result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Impossibile leggere il contenuto del progetto."));
    reader.readAsDataURL(blob);
  });
}

async function assetToExportFormat(asset: ImageAsset): Promise<ExportedProjectAsset> {
  const desktopApi = getDesktopApi();
  const absolutePath = getAssetAbsolutePath(asset.id);
  let sourceBlob: string | null = null;

  if (desktopApi?.readFile && absolutePath && !isRawFile(asset.fileName)) {
    const payload = await desktopApi.readFile(absolutePath);
    if (payload) {
      sourceBlob = await blobToDataUrl(new Blob([payload.bytes.slice()], { type: guessMimeType(asset.fileName) }));
    }
  }

  if (!sourceBlob) {
    const sourceUrl = asset.sourceUrl ?? asset.previewUrl ?? asset.thumbnailUrl;
    if (!sourceUrl) {
      throw new Error(`Impossibile preparare ${asset.fileName}: sorgente non disponibile.`);
    }

    const response = await fetch(sourceUrl);
    sourceBlob = await blobToDataUrl(await response.blob());
  }

  return {
    id: asset.id,
    fileName: asset.fileName,
    path: asset.path,
    sourceFileKey: asset.sourceFileKey ?? asset.path,
    rating: asset.rating ?? 0,
    pickStatus: asset.pickStatus ?? "unmarked",
    colorLabel: asset.colorLabel ?? null,
    customLabels: asset.customLabels ?? [],
    width: asset.width,
    height: asset.height,
    orientation: asset.orientation,
    aspectRatio: asset.aspectRatio,
    sourceBlob,
  };
}

export async function launchAutoLayoutFromSelection(input: {
  projectName: string;
  sourceFolderPath: string;
  allAssets: ImageAsset[];
  activeAssetIds: string[];
}): Promise<{ ok: boolean; message: string }> {
  const desktopApi = getDesktopApi();
  if (!desktopApi?.createAutoLayoutHandoffFile || !desktopApi?.openInstalledTool) {
    return { ok: false, message: "Bridge desktop non disponibile per Auto Layout." };
  }

  const selectedSet = new Set(input.activeAssetIds);
  const selectedAssets = input.allAssets.filter((asset) => selectedSet.has(asset.id));
  if (selectedAssets.length === 0) {
    return { ok: false, message: "Seleziona almeno una foto da impaginare." };
  }

  const exportedAssets = await Promise.all(selectedAssets.map((asset) => assetToExportFormat(asset)));
  const now = Date.now();
  const safeProjectName = input.projectName.trim() || "Impaginazione";
  const request = {
    ...DEFAULT_AUTO_LAYOUT_REQUEST,
    jobName: safeProjectName,
    sourceFolderPath: input.sourceFolderPath || DEFAULT_AUTO_LAYOUT_REQUEST.sourceFolderPath,
    assets: selectedAssets,
  };

  const exportedProject = {
    version: "1.1.0",
    exportedAt: now,
    project: {
      id: `photo-selector-handoff-${now}`,
      name: safeProjectName,
      createdAt: now,
      updatedAt: now,
      request,
      assetCount: selectedAssets.length,
      pageCount: 0,
      catalogAssets: selectedAssets,
    },
    assets: exportedAssets,
  };

  const handoffPath = await desktopApi.createAutoLayoutHandoffFile({
    fileName: `${slugifyFileName(safeProjectName)}.imagetool`,
    content: JSON.stringify(exportedProject, null, 2),
  });

  if (!handoffPath) {
    return { ok: false, message: "Impossibile creare il file temporaneo per Auto Layout." };
  }

  return desktopApi.openInstalledTool("auto-layout-app", ["--open-project", handoffPath]);
}