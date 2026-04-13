import type { ImageAsset, ImageOrientation } from "@photo-tools/shared-types";
import type { Project } from "./components/ProjectDashboard";
import { normalizeProjectRecord } from "./project-storage";

interface ExportedProject {
  version: "1.1.0" | "1.0.0";
  exportedAt: number;
  project: Project;
  assets: Array<{
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
    orientation: ImageOrientation;
    aspectRatio: number;
    sourceBlob: string;
  }>;
}

function getProjectActiveAssets(project: Project): ImageAsset[] {
  return project.result?.request.assets ?? project.request.assets;
}

function getProjectCatalogAssets(project: Project): ImageAsset[] {
  return project.catalogAssets ?? getProjectActiveAssets(project);
}

function isAbsolutePath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("/") || path.startsWith("\\\\");
}

function resolveDesktopAssetPath(asset: ImageAsset): string | null {
  const candidates = [asset.path, asset.sourceFileKey];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0 && isAbsolutePath(candidate.trim())) {
      return candidate.trim();
    }
  }
  return null;
}

async function readAssetBlob(asset: ImageAsset): Promise<Blob> {
  const desktopPath = resolveDesktopAssetPath(asset);
  if (desktopPath && typeof window !== "undefined" && typeof window.filexDesktop?.readFile === "function") {
    const payload = await window.filexDesktop.readFile(desktopPath);
    if (!payload) {
      throw new Error(`Impossibile leggere ${asset.fileName} dal disco.`);
    }
    const bytes = new Uint8Array(payload.bytes.length);
    bytes.set(payload.bytes);
    return new Blob([bytes]);
  }

  const sourceUrl = asset.sourceUrl ?? asset.previewUrl ?? asset.thumbnailUrl;
  if (!sourceUrl) {
    throw new Error(`Impossibile esportare ${asset.fileName}: URL sorgente assente.`);
  }

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Impossibile esportare ${asset.fileName}: sorgente non leggibile.`);
  }
  return response.blob();
}

async function imageAssetToExportFormat(asset: ImageAsset): Promise<ExportedProject["assets"][0]> {
  const blob = await readAssetBlob(asset);
  const base64String = await blobToDataUrl(blob);

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
    sourceBlob: base64String
  };
}

function exportedAssetToImageAsset(exported: ExportedProject["assets"][0]): ImageAsset {
  const blob = dataUrlToBlob(exported.sourceBlob);
  const sourceUrl = URL.createObjectURL(blob);

  return {
    id: exported.id,
    fileName: exported.fileName,
    path: exported.path,
    sourceFileKey: exported.sourceFileKey ?? exported.path,
    rating: exported.rating ?? 0,
    pickStatus: exported.pickStatus ?? "unmarked",
    colorLabel: exported.colorLabel ?? null,
    customLabels: exported.customLabels ?? [],
    width: exported.width,
    height: exported.height,
    orientation: exported.orientation,
    aspectRatio: exported.aspectRatio,
    sourceUrl,
    thumbnailUrl: sourceUrl,
    previewUrl: sourceUrl
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Impossibile serializzare il file del progetto."));
        return;
      }

      resolve(reader.result);
    };

    reader.onerror = () => reject(reader.error ?? new Error("Impossibile leggere il file del progetto."));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, payload] = dataUrl.split(",", 2);

  if (!header || !payload) {
    throw new Error("Contenuto asset non valido nel file progetto.");
  }

  const mimeMatch = header.match(/^data:(.*?);base64$/);
  const mimeType = mimeMatch?.[1] || "application/octet-stream";
  const binaryString = atob(payload);
  const bytes = new Uint8Array(binaryString.length);

  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

async function compressJsonPayload(jsonString: string): Promise<Blob> {
  const CompressionCtor = globalThis.CompressionStream;

  if (typeof CompressionCtor !== "function") {
    return new Blob([jsonString], { type: "application/json" });
  }

  const compressedStream = new Blob([jsonString], { type: "application/json" })
    .stream()
    .pipeThrough(new CompressionCtor("gzip"));

  const compressedBlob = await new Response(compressedStream).blob();
  return new Blob([compressedBlob], { type: "application/gzip" });
}

async function readProjectPayload(fileContent: string | ArrayBuffer): Promise<string> {
  if (typeof fileContent === "string") {
    return fileContent;
  }

  const bytes = new Uint8Array(fileContent);
  const isGzipPayload = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

  if (!isGzipPayload) {
    return new TextDecoder().decode(bytes);
  }

  const DecompressionCtor = globalThis.DecompressionStream;
  if (typeof DecompressionCtor !== "function") {
    throw new Error("Questa build Windows non supporta l'importazione di progetti compressi.");
  }

  const decompressedStream = new Blob([fileContent], { type: "application/gzip" })
    .stream()
    .pipeThrough(new DecompressionCtor("gzip"));

  return new Response(decompressedStream).text();
}

export async function exportProject(project: Project): Promise<Blob> {
  const assets = getProjectCatalogAssets(project);
  const exportedAssets = await Promise.all(assets.map((asset) => imageAssetToExportFormat(asset)));

  const exported: ExportedProject = {
    version: "1.1.0",
    exportedAt: Date.now(),
    project,
    assets: exportedAssets
  };

  const jsonString = JSON.stringify(exported, null, 2);
  return compressJsonPayload(jsonString);
}

export async function importProject(fileContent: string | ArrayBuffer): Promise<{
  project: Project;
  assets: ImageAsset[];
}> {
  let exported: ExportedProject;
  const payload = await readProjectPayload(fileContent);

  try {
    exported = JSON.parse(payload);
  } catch {
    throw new Error("Il file del progetto non e valido. Assicurati che sia un file .imagetool.");
  }

  if (!exported.project || !Array.isArray(exported.assets)) {
    throw new Error("Struttura del file non riconosciuta.");
  }

  const assets = exported.assets.map((asset) => exportedAssetToImageAsset(asset));
  const project = normalizeProjectRecord(exported.project, { fallbackCatalogAssets: assets });

  if (!project) {
    throw new Error("Il progetto importato non ha una struttura valida.");
  }

  return {
    project: {
      ...project,
      catalogAssets: assets,
      assetCount: assets.length
    },
    assets
  };
}

export async function downloadFile(blob: Blob, fileName: string): Promise<void> {
  if (typeof window !== "undefined" && typeof window.filexDesktop?.saveNewFileAs === "function") {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await window.filexDesktop.saveNewFileAs(fileName, bytes);
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
