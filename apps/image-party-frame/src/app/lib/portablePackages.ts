import {
  clearCustomTemplateBackgroundFiles,
  getCustomTemplateBackgroundFiles,
  normalizeProjectState,
  setCustomTemplateBackgroundFile,
  type CustomTemplate,
  type ProjectState,
} from "../contexts/ProjectContext";
import {
  importSavedTemplatesPackage,
  exportSavedTemplatesPackage,
  type PortableSavedTemplatesPackage,
} from "./savedTemplates";

type PortableTemplateAsset = {
  fileName: string;
  mimeType: string;
  dataUrl: string;
};

export type PortableProjectPackage = {
  version: 1;
  exportedAt: string;
  project: ProjectState;
  customTemplateAssets?: Partial<Record<"vertical" | "horizontal", PortableTemplateAsset>>;
};

function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function readJsonFile<T>(file: File): Promise<T> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)) as T);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("Impossibile leggere il file JSON."));
    reader.readAsText(file, "utf-8");
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Impossibile convertire il file in data URL."));
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

async function exportCustomTemplateAssets(customTemplate: CustomTemplate | null): Promise<PortableProjectPackage["customTemplateAssets"]> {
  if (!customTemplate) {
    return undefined;
  }

  const backgroundFiles = getCustomTemplateBackgroundFiles();
  const assets: PortableProjectPackage["customTemplateAssets"] = {};

  for (const orientation of ["vertical", "horizontal"] as const) {
    const sourceFile = backgroundFiles[orientation];
    if (!sourceFile) {
      continue;
    }

    assets[orientation] = {
      fileName: sourceFile.name,
      mimeType: sourceFile.type || "image/png",
      dataUrl: await blobToDataUrl(sourceFile),
    };
  }

  return Object.keys(assets).length > 0 ? assets : undefined;
}

export async function exportCurrentProjectPackage(project: ProjectState): Promise<void> {
  const normalizedProject = normalizeProjectState(project);
  const payload: PortableProjectPackage = {
    version: 1,
    exportedAt: new Date().toISOString(),
    project: normalizedProject,
    customTemplateAssets: await exportCustomTemplateAssets(normalizedProject.customTemplate),
  };

  const safeName = (normalizedProject.name || "project").replace(/[<>:"/\\|?*]+/g, "-").trim() || "project";
  downloadJson(`${safeName}.image-party-project.json`, payload);
}

export async function importProjectPackage(file: File): Promise<ProjectState> {
  const payload = await readJsonFile<PortableProjectPackage>(file);
  const normalizedProject = normalizeProjectState(payload.project);

  clearCustomTemplateBackgroundFiles();

  if (payload.customTemplateAssets && normalizedProject.customTemplate) {
    for (const orientation of ["vertical", "horizontal"] as const) {
      const asset = payload.customTemplateAssets[orientation];
      if (!asset) {
        continue;
      }

      const importedFile = dataUrlToFile(asset);
      const previewUrl = URL.createObjectURL(importedFile);
      setCustomTemplateBackgroundFile(orientation, importedFile);
      normalizedProject.customTemplate.variants[orientation].backgroundFileName = importedFile.name;
      normalizedProject.customTemplate.variants[orientation].backgroundPreviewUrl = previewUrl;
    }
  }

  return normalizedProject;
}

export async function exportTemplateLibraryPackage(): Promise<void> {
  const payload = await exportSavedTemplatesPackage();
  downloadJson(`image-party-template-library.json`, payload);
}

export async function importTemplateLibraryPackage(file: File): Promise<void> {
  const payload = await readJsonFile<PortableSavedTemplatesPackage>(file);
  await importSavedTemplatesPackage(payload, "merge");
}
