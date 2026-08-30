import {
  clearCustomTemplateBackgroundFiles,
  getCustomTemplateBackgroundFiles,
  normalizeProjectState,
  setCustomTemplateBackgroundFile,
  type ImageItem,
  type ProjectState,
} from "../contexts/ProjectContext";
import {
  commitPreparedSavedTemplatesPackageImport,
  decodePortableImageAsset,
  exportSavedTemplatesPackage,
  isSavedTemplatesImportGenerationCurrent,
  MAX_PORTABLE_PACKAGE_BYTES,
  normalizePortableCustomTemplate,
  normalizePortableImageFile,
  prepareSavedTemplatesPackageImport,
  reserveSavedTemplatesImportGeneration,
  type PortableSavedTemplatesPackage,
  type PortableTemplateAsset,
} from "./savedTemplates";

export type PortableProjectPackage = {
  version: 1;
  exportedAt: string;
  project: ProjectState;
  customTemplateAssets?: Partial<Record<Orientation, PortableTemplateAsset>>;
};

export type PreparedProjectPackageImport = {
  generation: number;
  project: ProjectState;
  backgroundFiles: Partial<Record<Orientation, File>>;
  previewUrls: string[];
  disposed: boolean;
};

type Orientation = "vertical" | "horizontal";
type ValidatedProjectPackage = {
  project: ProjectState;
  assets: Partial<Record<Orientation, unknown>>;
};

const ORIENTATIONS = ["vertical", "horizontal"] as const;
const MAX_PROJECT_IMAGES = 500;
const MAX_PROJECT_NAME_LENGTH = 120;
const MAX_PROJECT_TEXT_LENGTH = 1_024;
let latestProjectImportGeneration = 0;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, field: string, maximumLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximumLength || value.includes("\0")) {
    throw new Error(`Il campo ${field} del progetto non e valido.`);
  }
  return value.trim();
}

function optionalText(value: unknown, field: string, maximumLength: number): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  if (typeof value !== "string" || value.length > maximumLength || value.includes("\0")) {
    throw new Error(`Il campo ${field} del progetto non e valido.`);
  }
  return value;
}

function optionalNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizePortableCrop(value: unknown): ImageItem["crop"] {
  const crop = isPlainRecord(value) ? value : {};
  const finite = (candidate: unknown, fallback: number) =>
    typeof candidate === "number" && Number.isFinite(candidate) ? candidate : fallback;
  const normalized: ImageItem["crop"] = {
    offsetX: finite(crop.offsetX, 0),
    offsetY: finite(crop.offsetY, 0),
    zoom: finite(crop.zoom, 100),
  };
  for (const legacyField of ["x", "y", "legacyX", "legacyY"] as const) {
    if (typeof crop[legacyField] === "number" && Number.isFinite(crop[legacyField])) {
      normalized[legacyField] = crop[legacyField];
    }
  }
  return normalized;
}

function validatePortableImages(value: unknown): ImageItem[] {
  if (!Array.isArray(value)) {
    throw new Error("L'elenco immagini del progetto non e valido.");
  }
  if (value.length > MAX_PROJECT_IMAGES) {
    throw new Error(`Il progetto contiene piu di ${MAX_PROJECT_IMAGES} immagini.`);
  }

  return value.map((candidate, index) => {
    if (!isPlainRecord(candidate)) {
      throw new Error(`Immagine ${index + 1}: record non valido.`);
    }
    const path = requiredText(candidate.relativePath ?? candidate.path, `percorso immagine ${index + 1}`, MAX_PROJECT_TEXT_LENGTH);
    const absolutePath = candidate.absolutePath === undefined
      ? undefined
      : optionalText(candidate.absolutePath, `percorso assoluto immagine ${index + 1}`, MAX_PROJECT_TEXT_LENGTH) || undefined;
    const cropRevision = optionalNonNegativeNumber(candidate.cropRevision);
    const approvedRevision = optionalNonNegativeNumber(candidate.approvedRevision);
    return {
      id: typeof candidate.id === "string" && candidate.id.length <= MAX_PROJECT_TEXT_LENGTH ? candidate.id : "",
      path,
      relativePath: path,
      absolutePath,
      size: optionalNonNegativeNumber(candidate.size),
      lastModified: optionalNonNegativeNumber(candidate.lastModified),
      orientation: candidate.orientation === "horizontal" ? "horizontal" : "vertical",
      approval: candidate.approval === "approved" || candidate.approval === "needs-adjustment"
        ? candidate.approval
        : "pending",
      crop: normalizePortableCrop(candidate.crop),
      cropRevision: cropRevision === undefined ? 0 : Math.floor(cropRevision),
      approvedRevision: approvedRevision === undefined ? undefined : Math.floor(approvedRevision),
      processingStatus: "idle",
    };
  });
}

function validateExportSettings(value: unknown): ProjectState["exportSettings"] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isPlainRecord(value)) {
    throw new Error("Le impostazioni export del progetto non sono valide.");
  }
  return {
    format: value.format === "png" ? "png" : "jpeg",
    quality: typeof value.quality === "number" && Number.isFinite(value.quality) ? value.quality : 100,
    colorProfile: "sRGB",
    namingPattern: typeof value.namingPattern === "string" && value.namingPattern.length <= 180
      ? value.namingPattern
      : "original_frame",
    onlyApproved: value.onlyApproved !== false,
    embedColorProfile: true,
    createSubfolder: value.createSubfolder !== false,
    overwrite: value.overwrite === true,
  };
}

function clonePortableProjectForExport(project: ProjectState): ProjectState {
  const normalized = normalizeProjectState(project);
  const customTemplate = normalized.customTemplate
    ? normalizePortableCustomTemplate(normalized.customTemplate)
    : null;
  if (normalized.template === "custom" && !customTemplate) {
    throw new Error("Il template custom del progetto e incompleto o non valido.");
  }
  if (customTemplate) {
    for (const orientation of ORIENTATIONS) {
      delete customTemplate.variants[orientation].backgroundAssetKey;
      delete customTemplate.variants[orientation].backgroundPreviewUrl;
      delete customTemplate.variants[orientation].backgroundDataUrl;
    }
  }
  return {
    ...normalized,
    customTemplate,
    images: normalized.images.map(({ url: _url, processingError: _error, ...image }) => ({
      ...image,
      processingStatus: "idle",
    })),
  };
}

export function validatePortableProjectPackage(value: unknown): ValidatedProjectPackage {
  if (!isPlainRecord(value) || value.version !== 1) {
    throw new Error("File progetto non valido o versione non supportata.");
  }
  if (typeof value.exportedAt !== "string" || !Number.isFinite(Date.parse(value.exportedAt))) {
    throw new Error("La data di esportazione del progetto non e valida.");
  }
  if (!isPlainRecord(value.project)) {
    throw new Error("Il contenuto del progetto non e valido.");
  }

  const source = value.project;
  const name = requiredText(source.name, "nome", MAX_PROJECT_NAME_LENGTH);
  const templateId = requiredText(source.template, "template", MAX_PROJECT_NAME_LENGTH);
  let customTemplate = null;
  if (source.customTemplate !== undefined && source.customTemplate !== null) {
    customTemplate = normalizePortableCustomTemplate(source.customTemplate);
    if (!customTemplate) {
      throw new Error("Il template custom del pacchetto e danneggiato o fuori limite.");
    }
  }
  if (templateId === "custom" && !customTemplate) {
    throw new Error("Il progetto dichiara un template custom ma non contiene entrambe le varianti valide.");
  }

  const project = normalizeProjectState({
    projectId: typeof source.projectId === "string" && source.projectId.length <= 180 ? source.projectId : undefined,
    name,
    template: templateId,
    sourcePath: optionalText(source.sourcePath, "cartella sorgente", MAX_PROJECT_TEXT_LENGTH),
    outputPath: optionalText(source.outputPath, "cartella output", MAX_PROJECT_TEXT_LENGTH),
    customTemplate: templateId === "custom" ? customTemplate : null,
    images: validatePortableImages(source.images),
    exportSettings: validateExportSettings(source.exportSettings),
  });

  const assetsValue = value.customTemplateAssets;
  if (assetsValue !== undefined && !isPlainRecord(assetsValue)) {
    throw new Error("L'elenco degli asset template non e valido.");
  }
  if (assetsValue !== undefined && !project.customTemplate) {
    throw new Error("Il pacchetto contiene asset template senza un template custom valido.");
  }
  const assets: Partial<Record<Orientation, unknown>> = {};
  if (isPlainRecord(assetsValue)) {
    for (const key of Object.keys(assetsValue)) {
      if (!ORIENTATIONS.includes(key as Orientation)) {
        throw new Error(`Orientamento asset non supportato: ${key}.`);
      }
    }
    for (const orientation of ORIENTATIONS) {
      if (assetsValue[orientation] !== undefined) {
        assets[orientation] = assetsValue[orientation];
      }
    }
  }
  return { project, assets };
}

function downloadJson(filename: string, payload: unknown): void {
  const serialized = JSON.stringify(payload, null, 2);
  const blob = new Blob([serialized], { type: "application/json" });
  if (blob.size > MAX_PORTABLE_PACKAGE_BYTES) {
    throw new Error("Il pacchetto supera il limite portabile di 100 MB.");
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function assertPortablePackageSize(size: number): void {
  if (!Number.isFinite(size) || size < 1) {
    throw new Error("Il file JSON e vuoto.");
  }
  if (size > MAX_PORTABLE_PACKAGE_BYTES) {
    throw new Error("Il pacchetto supera il limite portabile di 100 MB.");
  }
}

export async function readPortableJsonFile(file: File): Promise<unknown> {
  assertPortablePackageSize(file.size);
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new Error("Impossibile leggere il file JSON.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Il file non contiene JSON valido.");
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Impossibile convertire il file in data URL."));
    reader.readAsDataURL(blob);
  });
}

async function exportCustomTemplateAssets(
  customTemplate: ProjectState["customTemplate"]
): Promise<PortableProjectPackage["customTemplateAssets"]> {
  if (!customTemplate) {
    return undefined;
  }
  const backgroundFiles = getCustomTemplateBackgroundFiles();
  const assets: NonNullable<PortableProjectPackage["customTemplateAssets"]> = {};
  for (const orientation of ORIENTATIONS) {
    const sourceFile = backgroundFiles[orientation];
    const variant = customTemplate.variants[orientation];
    delete variant.backgroundAssetKey;
    if (!sourceFile) {
      delete variant.backgroundFileName;
      continue;
    }
    const file = await normalizePortableImageFile(sourceFile, sourceFile.name, `background-${orientation}`);
    variant.backgroundFileName = file.name;
    assets[orientation] = {
      fileName: file.name,
      mimeType: file.type,
      dataUrl: await blobToDataUrl(file),
    };
  }
  return Object.keys(assets).length > 0 ? assets : undefined;
}

export async function exportCurrentProjectPackage(project: ProjectState): Promise<void> {
  const portableProject = clonePortableProjectForExport(project);
  const payload: PortableProjectPackage = {
    version: 1,
    exportedAt: new Date().toISOString(),
    project: portableProject,
    customTemplateAssets: await exportCustomTemplateAssets(portableProject.customTemplate),
  };
  const safeName = portableProject.name
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, MAX_PROJECT_NAME_LENGTH) || "project";
  downloadJson(`${safeName}.image-party-project.json`, payload);
}

export async function prepareProjectPackageImport(file: File): Promise<PreparedProjectPackageImport> {
  const generation = ++latestProjectImportGeneration;
  const { project, assets } = validatePortableProjectPackage(await readPortableJsonFile(file));
  if (generation !== latestProjectImportGeneration) {
    throw new Error("Importazione progetto sostituita da una richiesta piu recente.");
  }
  const backgroundFiles: PreparedProjectPackageImport["backgroundFiles"] = {};
  const previewUrls: string[] = [];
  try {
    if (project.customTemplate) {
      for (const orientation of ORIENTATIONS) {
        const variant = project.customTemplate.variants[orientation];
        delete variant.backgroundAssetKey;
        delete variant.backgroundPreviewUrl;
        delete variant.backgroundDataUrl;
        const asset = assets[orientation];
        if (asset === undefined) {
          delete variant.backgroundFileName;
          continue;
        }
        const importedFile = decodePortableImageAsset(asset);
        const previewUrl = URL.createObjectURL(importedFile);
        backgroundFiles[orientation] = importedFile;
        previewUrls.push(previewUrl);
        variant.backgroundFileName = importedFile.name;
        variant.backgroundPreviewUrl = previewUrl;
      }
    }
  } catch (error) {
    previewUrls.forEach((previewUrl) => URL.revokeObjectURL(previewUrl));
    throw error;
  }
  return { generation, project, backgroundFiles, previewUrls, disposed: false };
}

export function commitPreparedProjectPackageImport(prepared: PreparedProjectPackageImport): ProjectState {
  if (prepared.disposed || prepared.generation !== latestProjectImportGeneration) {
    throw new Error("Questa importazione progetto e gia stata annullata o sostituita.");
  }
  clearCustomTemplateBackgroundFiles();
  for (const orientation of ORIENTATIONS) {
    const file = prepared.backgroundFiles[orientation];
    if (file) {
      setCustomTemplateBackgroundFile(orientation, file);
    }
  }
  return prepared.project;
}

export function disposePreparedProjectPackageImport(prepared: PreparedProjectPackageImport): void {
  if (prepared.disposed) {
    return;
  }
  prepared.disposed = true;
  prepared.previewUrls.splice(0).forEach((previewUrl) => URL.revokeObjectURL(previewUrl));
  for (const orientation of ORIENTATIONS) {
    delete prepared.backgroundFiles[orientation];
  }
}

export async function importProjectPackage(file: File): Promise<ProjectState> {
  return commitPreparedProjectPackageImport(await prepareProjectPackageImport(file));
}

export async function exportTemplateLibraryPackage(): Promise<void> {
  const payload = await exportSavedTemplatesPackage();
  downloadJson("image-party-template-library.json", payload);
}

export async function importTemplateLibraryPackage(file: File): Promise<void> {
  const generation = reserveSavedTemplatesImportGeneration();
  const payload = await readPortableJsonFile(file) as PortableSavedTemplatesPackage;
  if (!isSavedTemplatesImportGenerationCurrent(generation)) {
    return;
  }
  const prepared = prepareSavedTemplatesPackageImport(payload, "merge", generation);
  await commitPreparedSavedTemplatesPackageImport(prepared);
}
