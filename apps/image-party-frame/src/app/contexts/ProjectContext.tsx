import { createContext, useState, ReactNode, useContext } from "react";
import { normalizeCropTransform, type CropTransform } from "../lib/cropGeometry";

// File objects are session-only. Keep them isolated by project so identical legacy
// image names can never make one project resolve another project's source files.
const imageFilesByProject = new Map<string, Map<string, File>>();
let activeProjectFileScope = "";
const customTemplateBackgroundFiles: Record<"vertical" | "horizontal", File | null> = {
  vertical: null,
  horizontal: null,
};

function imageProjectScope(imageId: string, projectId?: string): string {
  if (projectId) {
    return projectId;
  }

  const separatorIndex = imageId.indexOf("::");
  return separatorIndex > 0 ? imageId.slice(0, separatorIndex) : activeProjectFileScope;
}

export const getImageFile = (imageId: string, projectId?: string): File | undefined => {
  return imageFilesByProject.get(imageProjectScope(imageId, projectId))?.get(imageId);
};

export const setImageFile = (imageId: string, file: File, projectId?: string): void => {
  const scope = imageProjectScope(imageId, projectId);
  const projectFiles = imageFilesByProject.get(scope) ?? new Map<string, File>();
  projectFiles.set(imageId, file);
  imageFilesByProject.set(scope, projectFiles);
};

export const setImageFiles = (files: File[], imageIds: string[], projectId?: string): void => {
  const scope = projectId || imageProjectScope(imageIds[0] ?? "");
  const nextFiles = new Map<string, File>();

  files.forEach((file, index) => {
    if (imageIds[index]) {
      nextFiles.set(imageIds[index], file);
    }
  });

  imageFilesByProject.set(scope, nextFiles);
};

export const clearImageFiles = (projectId?: string): void => {
  const scope = projectId || activeProjectFileScope;
  if (scope) {
    imageFilesByProject.delete(scope);
    return;
  }

  imageFilesByProject.clear();
};

export interface CustomTemplateVariant {
  widthCm: number;
  heightCm: number;
  dpi: number;
  widthPx: number;
  heightPx: number;
  photoAreaX: number;
  photoAreaY: number;
  photoAreaWidth: number;
  photoAreaHeight: number;
  lockAspectRatio: boolean;
  photoAspectRatio: number;
  backgroundPreviewUrl?: string;
  backgroundFileName?: string;
  backgroundDataUrl?: string;
  backgroundAssetKey?: string;
  borderSizePx: number;
  borderColor: string;
}

export const getCustomTemplateBackgroundFile = (orientation: "vertical" | "horizontal"): File | null => {
  return customTemplateBackgroundFiles[orientation];
};

export const getCustomTemplateBackgroundFiles = (): Record<"vertical" | "horizontal", File | null> => {
  return { ...customTemplateBackgroundFiles };
};

export const setCustomTemplateBackgroundFile = (
  orientation: "vertical" | "horizontal",
  file: File | null
): void => {
  customTemplateBackgroundFiles[orientation] = file;
};

export const clearCustomTemplateBackgroundFiles = (): void => {
  customTemplateBackgroundFiles.vertical = null;
  customTemplateBackgroundFiles.horizontal = null;
};

export interface CustomTemplate {
  id: "custom";
  libraryTemplateId?: string;
  name: string;
  variants: {
    vertical: CustomTemplateVariant;
    horizontal: CustomTemplateVariant;
  };
}

export interface ImageItem {
  id: string;
  path: string;
  relativePath?: string;
  absolutePath?: string;
  size?: number;
  lastModified?: number;
  url?: string;
  orientation: "vertical" | "horizontal";
  approval: "pending" | "approved" | "needs-adjustment";
  crop: CropTransform & {
    /** One-time migration data from PartyFrame 0.1.x viewport-pixel crops. */
    legacyX?: number;
    legacyY?: number;
    /** Accepted only while importing old project packages. */
    x?: number;
    y?: number;
  };
  cropRevision: number;
  approvedRevision?: number;
  processingStatus: "idle" | "processing" | "error";
  processingError?: string;
}

export interface ProjectState {
  projectId: string;
  name: string;
  template: string;
  sourcePath: string;
  outputPath: string;
  customTemplate: CustomTemplate | null;
  images: ImageItem[];
  imageCount: {
    total: number;
    vertical: number;
    horizontal: number;
  };
  exportSettings: {
    format: "jpeg" | "png";
    quality: number;
    colorProfile: "sRGB";
    namingPattern: string; // "original" | "original_frame"
    onlyApproved: boolean;
    embedColorProfile: boolean;
    createSubfolder: boolean;
    overwrite: boolean;
  };
}

interface ProjectContextType {
  project: ProjectState;
  setProject: (project: Partial<ProjectState>) => void;
  resetProject: () => void;
  updateProjectBasics: (name: string, template: string, sourcePath: string, outputPath: string) => void;
  updateOutputPath: (outputPath: string) => void;
  setCustomTemplate: (template: CustomTemplate | null) => void;
  setImages: (images: ImageItem[]) => void;
  updateImageCrop: (imageId: string, crop: CropTransform) => void;
  migrateImageCrop: (imageId: string, crop: CropTransform) => void;
  updateImagesCrop: (imageIds: string[], crop: CropTransform) => void;
  updateImageApproval: (imageId: string, approval: "pending" | "approved" | "needs-adjustment") => void;
  updateImageProcessing: (
    imageId: string,
    status: ImageItem["processingStatus"],
    error?: string
  ) => void;
  updateExportSettings: (settings: Partial<ProjectState["exportSettings"]>) => void;
}

export const defaultProjectExportSettings: ProjectState["exportSettings"] = {
  format: "jpeg",
  quality: 100,
  colorProfile: "sRGB",
  namingPattern: "original_frame",
  onlyApproved: true,
  embedColorProfile: true,
  createSubfolder: true,
  overwrite: false,
};

function normalizeProjectExportSettings(
  value: Partial<ProjectState["exportSettings"]> | null | undefined
): ProjectState["exportSettings"] {
  const quality = Number(value?.quality);
  const namingPattern = typeof value?.namingPattern === "string"
    ? value.namingPattern.trim().slice(0, 180)
    : "";
  return {
    format: value?.format === "png" ? "png" : "jpeg",
    quality: Number.isFinite(quality) ? Math.min(100, Math.max(60, Math.round(quality))) : 100,
    colorProfile: "sRGB",
    namingPattern: namingPattern || defaultProjectExportSettings.namingPattern,
    onlyApproved: typeof value?.onlyApproved === "boolean"
      ? value.onlyApproved
      : defaultProjectExportSettings.onlyApproved,
    // PartyFrame always writes the verified sRGB profile together with output DPI.
    embedColorProfile: true,
    createSubfolder: typeof value?.createSubfolder === "boolean"
      ? value.createSubfolder
      : defaultProjectExportSettings.createSubfolder,
    overwrite: typeof value?.overwrite === "boolean"
      ? value.overwrite
      : defaultProjectExportSettings.overwrite,
  };
}

const defaultProjectShape: Omit<ProjectState, "projectId"> = {
  name: "",
  template: "classic-gold",
  sourcePath: "",
  outputPath: "",
  customTemplate: null,
  images: [],
  imageCount: { total: 0, vertical: 0, horizontal: 0 },
  exportSettings: defaultProjectExportSettings,
};

let projectSequence = 0;

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function validProjectId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{6,160}$/.test(value.trim());
}

export function normalizeImageRelativePath(value: string): string {
  const normalized = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/{2,}/g, "/");
  return normalized.replace(/^\/+/, "") || "image";
}

function legacyProjectId(project?: Partial<ProjectState> | null): string {
  const imagePaths = Array.isArray(project?.images)
    ? project.images.map((image) => normalizeImageRelativePath(image?.path || "")).join("|")
    : "";
  const seed = [project?.name || "", project?.sourcePath || "", imagePaths].join("\u0000");
  return `project_legacy_${stableHash(seed)}`;
}

export function createProjectId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) {
    return `project_${randomUuid.replace(/-/g, "")}`;
  }

  projectSequence += 1;
  return `project_${Date.now().toString(36)}_${projectSequence.toString(36)}`;
}

export function buildProjectImageId(projectId: string, relativePath: string, occurrence = 0): string {
  const pathKey = normalizeImageRelativePath(relativePath).toLocaleLowerCase();
  return `${projectId}::img_${stableHash(pathKey)}_${occurrence + 1}`;
}

export function createEmptyProjectState(): ProjectState {
  return {
    ...defaultProjectShape,
    projectId: createProjectId(),
    imageCount: { ...defaultProjectShape.imageCount },
    exportSettings: { ...defaultProjectExportSettings },
  };
}

export interface ImageRelinkCandidate {
  path: string;
  relativePath?: string;
  absolutePath?: string;
  size?: number;
  lastModified?: number;
  orientation: "vertical" | "horizontal";
}

export interface ImageRelinkPlan {
  images: ImageItem[];
  missingImageIds: string[];
  matchedImageIds: string[];
  addedImageIds: string[];
}

function imagePathKey(value: string): string {
  return normalizeImageRelativePath(value).toLocaleLowerCase();
}

function imageBasenameKey(value: string): string {
  return imagePathKey(value).split("/").pop() || "image";
}

/**
 * Reconcile freshly selected files with a serialized project without mutating it.
 * Exact relative paths win; a basename fallback is allowed only when unique on
 * both sides. Existing crop/review objects are intentionally preserved intact.
 */
export function planProjectImageRelink(
  project: ProjectState,
  candidates: ImageRelinkCandidate[]
): ImageRelinkPlan {
  const projectId = validProjectId(project.projectId) ? project.projectId : legacyProjectId(project);
  const existingImages = Array.isArray(project.images) ? project.images : [];
  const exactMatches = new Map<string, ImageItem[]>();
  const existingBasenameCounts = new Map<string, number>();
  const candidateBasenameCounts = new Map<string, number>();

  for (const image of existingImages) {
    const key = imagePathKey(image.path);
    exactMatches.set(key, [...(exactMatches.get(key) ?? []), image]);
    const basename = imageBasenameKey(image.path);
    existingBasenameCounts.set(basename, (existingBasenameCounts.get(basename) ?? 0) + 1);
  }

  for (const candidate of candidates) {
    const basename = imageBasenameKey(candidate.path);
    candidateBasenameCounts.set(basename, (candidateBasenameCounts.get(basename) ?? 0) + 1);
  }

  const usedExistingIds = new Set<string>();
  const usedImageIds = new Set(existingImages.map((image) => image.id));
  const pathOccurrences = new Map<string, number>();
  const matchedImageIds: string[] = [];
  const addedImageIds: string[] = [];

  const images = candidates.map((candidate) => {
    const normalizedPath = normalizeImageRelativePath(candidate.relativePath || candidate.path);
    const key = imagePathKey(normalizedPath);
    const exactQueue = exactMatches.get(key) ?? [];
    let existing = exactQueue.find((image) => !usedExistingIds.has(image.id));

    if (!existing) {
      const basename = imageBasenameKey(normalizedPath);
      if (existingBasenameCounts.get(basename) === 1 && candidateBasenameCounts.get(basename) === 1) {
        existing = existingImages.find(
          (image) => !usedExistingIds.has(image.id) && imageBasenameKey(image.path) === basename
        );
      }
    }

    if (existing) {
      usedExistingIds.add(existing.id);
      matchedImageIds.push(existing.id);
      return {
        ...existing,
        path: normalizedPath,
        relativePath: normalizedPath,
        absolutePath: candidate.absolutePath ?? existing.absolutePath,
        size: candidate.size ?? existing.size,
        lastModified: candidate.lastModified ?? existing.lastModified,
        orientation: candidate.orientation,
        crop: existing.crop,
      };
    }

    let occurrence = pathOccurrences.get(key) ?? 0;
    let id = buildProjectImageId(projectId, normalizedPath, occurrence);
    while (usedImageIds.has(id)) {
      occurrence += 1;
      id = buildProjectImageId(projectId, normalizedPath, occurrence);
    }
    pathOccurrences.set(key, occurrence + 1);
    usedImageIds.add(id);
    addedImageIds.push(id);

    return {
      id,
      path: normalizedPath,
      relativePath: normalizedPath,
      absolutePath: candidate.absolutePath,
      size: candidate.size,
      lastModified: candidate.lastModified,
      orientation: candidate.orientation,
      approval: "pending" as const,
      crop: { offsetX: 0, offsetY: 0, zoom: 100 },
      cropRevision: 0,
      processingStatus: "idle" as const,
    };
  });

  return {
    images,
    missingImageIds: existingImages
      .filter((image) => !usedExistingIds.has(image.id))
      .map((image) => image.id),
    matchedImageIds,
    addedImageIds,
  };
}

export function normalizeProjectState(project?: Partial<ProjectState> | null): ProjectState {
  const projectId = validProjectId(project?.projectId) ? project.projectId.trim() : legacyProjectId(project);
  const pathOccurrences = new Map<string, number>();
  const usedImageIds = new Set<string>();
  const normalizedImages = Array.isArray(project?.images)
    ? project.images.map((image, index) => {
        const path = normalizeImageRelativePath(image?.relativePath || image?.path || `image_${index + 1}.jpg`);
        const pathKey = imagePathKey(path);
        let occurrence = pathOccurrences.get(pathKey) ?? 0;
        const suppliedId = typeof image?.id === "string" && image.id.startsWith(`${projectId}::`)
          ? image.id
          : null;
        let id = suppliedId || buildProjectImageId(projectId, path, occurrence);
        while (usedImageIds.has(id)) {
          occurrence += 1;
          id = buildProjectImageId(projectId, path, occurrence);
        }
        pathOccurrences.set(pathKey, occurrence + 1);
        usedImageIds.add(id);

        const rawCrop = image?.crop as (Partial<CropTransform> & {
          x?: number;
          y?: number;
          legacyX?: number;
          legacyY?: number;
        }) | undefined;
        const hasNormalizedOffsets = Number.isFinite(rawCrop?.offsetX) && Number.isFinite(rawCrop?.offsetY);
        const normalizedCrop = normalizeCropTransform({
          offsetX: hasNormalizedOffsets ? rawCrop?.offsetX : 0,
          offsetY: hasNormalizedOffsets ? rawCrop?.offsetY : 0,
          zoom: rawCrop?.zoom,
        });
        const legacyX = !hasNormalizedOffsets && Number.isFinite(rawCrop?.x)
          ? Number(rawCrop?.x)
          : Number.isFinite(rawCrop?.legacyX)
            ? Number(rawCrop?.legacyX)
            : undefined;
        const legacyY = !hasNormalizedOffsets && Number.isFinite(rawCrop?.y)
          ? Number(rawCrop?.y)
          : Number.isFinite(rawCrop?.legacyY)
            ? Number(rawCrop?.legacyY)
            : undefined;
        const cropRevision = Number.isFinite(image?.cropRevision) && image!.cropRevision >= 0
          ? Math.floor(image!.cropRevision)
          : 0;
        const normalizedApproval =
          image?.approval === "approved" || image?.approval === "needs-adjustment" ? image.approval : "pending" as const;

        return {
          id,
          path,
          relativePath: path,
          absolutePath: typeof image?.absolutePath === "string" ? image.absolutePath : undefined,
          size: Number.isFinite(image?.size) && image!.size! >= 0 ? image!.size : undefined,
          lastModified: Number.isFinite(image?.lastModified) && image!.lastModified! >= 0 ? image!.lastModified : undefined,
          url: image?.url,
          orientation: image?.orientation === "horizontal" ? "horizontal" as const : "vertical" as const,
          approval: normalizedApproval,
          crop: {
            ...normalizedCrop,
            ...(legacyX !== undefined ? { legacyX } : {}),
            ...(legacyY !== undefined ? { legacyY } : {}),
          },
          cropRevision,
          approvedRevision: normalizedApproval === "approved"
            ? Number.isFinite(image?.approvedRevision)
              ? Math.floor(image!.approvedRevision!)
              : cropRevision
            : undefined,
          processingStatus: "idle" as const,
          processingError: undefined,
        };
      })
    : [];

  const vertical = normalizedImages.filter((image) => image.orientation === "vertical").length;
  const horizontal = normalizedImages.length - vertical;

  return {
    ...defaultProjectShape,
    ...project,
    projectId,
    customTemplate: project?.customTemplate ?? null,
    images: normalizedImages,
    imageCount: {
      total: normalizedImages.length,
      vertical,
      horizontal,
    },
    exportSettings: normalizeProjectExportSettings(project?.exportSettings),
  };
}

export const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [project, setProjectState] = useState<ProjectState>(() => {
    const initialProject = createEmptyProjectState();
    activeProjectFileScope = initialProject.projectId;
    return initialProject;
  });

  const setProject = (nextProject: Partial<ProjectState>) => {
    if (nextProject.template !== "custom" || !nextProject.customTemplate) {
      clearCustomTemplateBackgroundFiles();
    }

    const normalizedProject = normalizeProjectState(nextProject);
    activeProjectFileScope = normalizedProject.projectId;
    setProjectState(normalizedProject);
  };

  const resetProject = () => {
    clearImageFiles(project.projectId);
    clearCustomTemplateBackgroundFiles();
    const nextProject = createEmptyProjectState();
    activeProjectFileScope = nextProject.projectId;
    setProjectState(nextProject);
  };

  const updateProjectBasics = (
    name: string,
    template: string,
    sourcePath: string,
    outputPath: string
  ) => {
    if (template !== "custom") {
      clearCustomTemplateBackgroundFiles();
    }

    setProjectState((prev) => ({
      ...prev,
      name,
      template,
      sourcePath,
      outputPath,
      customTemplate: template === "custom" ? prev.customTemplate : null,
    }));
  };

  const setImages = (images: ImageItem[]) => {
    const vertical = images.filter((img) => img.orientation === "vertical").length;
    const horizontal = images.filter((img) => img.orientation === "horizontal").length;

    setProjectState((prev) => ({
      ...prev,
      images,
      imageCount: {
        total: images.length,
        vertical,
        horizontal,
      },
    }));
  };

  const updateOutputPath = (outputPath: string) => {
    setProjectState((prev) => ({
      ...prev,
      outputPath,
    }));
  };

  const setCustomTemplate = (template: CustomTemplate | null) => {
    if (!template) {
      clearCustomTemplateBackgroundFiles();
    }

    setProjectState((prev) => ({
      ...prev,
      customTemplate: template,
      template: template ? "custom" : prev.template === "custom" ? "classic-gold" : prev.template,
    }));
  };

  const updateImageCrop = (imageId: string, crop: CropTransform) => {
    const normalizedCrop = normalizeCropTransform(crop);
    setProjectState((prev) => ({
      ...prev,
      images: prev.images.map((img) => (img.id === imageId ? {
        ...img,
        crop: normalizedCrop,
        cropRevision: img.cropRevision + 1,
        approval: "pending",
        approvedRevision: undefined,
        processingStatus: "idle",
        processingError: undefined,
      } : img)),
    }));
  };

  const migrateImageCrop = (imageId: string, crop: CropTransform) => {
    const normalizedCrop = normalizeCropTransform(crop);
    setProjectState((prev) => ({
      ...prev,
      images: prev.images.map((img) => (img.id === imageId ? { ...img, crop: normalizedCrop } : img)),
    }));
  };

  const updateImagesCrop = (imageIds: string[], crop: CropTransform) => {
    const ids = new Set(imageIds);
    const normalizedCrop = normalizeCropTransform(crop);
    setProjectState((prev) => ({
      ...prev,
      images: prev.images.map((img) => ids.has(img.id) ? {
        ...img,
        crop: { ...normalizedCrop },
        cropRevision: img.cropRevision + 1,
        approval: "pending",
        approvedRevision: undefined,
        processingStatus: "idle",
        processingError: undefined,
      } : img),
    }));
  };

  const updateImageApproval = (imageId: string, approval: "pending" | "approved" | "needs-adjustment") => {
    setProjectState((prev) => ({
      ...prev,
      images: prev.images.map((img) => (img.id === imageId ? {
        ...img,
        approval,
        approvedRevision: approval === "approved" ? img.cropRevision : undefined,
        processingStatus: "idle",
        processingError: undefined,
      } : img)),
    }));
  };

  const updateImageProcessing = (
    imageId: string,
    status: ImageItem["processingStatus"],
    error?: string
  ) => {
    setProjectState((prev) => ({
      ...prev,
      images: prev.images.map((img) => (img.id === imageId ? {
        ...img,
        processingStatus: status,
        processingError: status === "error" ? error || "Errore di elaborazione" : undefined,
      } : img)),
    }));
  };

  const updateExportSettings = (settings: Partial<ProjectState["exportSettings"]>) => {
    setProjectState((prev) => ({
      ...prev,
      exportSettings: normalizeProjectExportSettings({ ...prev.exportSettings, ...settings }),
    }));
  };

  const value: ProjectContextType = {
    project,
    setProject,
    resetProject,
    updateProjectBasics,
    updateOutputPath,
    setCustomTemplate,
    setImages,
    updateImageCrop,
    migrateImageCrop,
    updateImagesCrop,
    updateImageApproval,
    updateImageProcessing,
    updateExportSettings,
  };

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error("useProject must be used within ProjectProvider");
  }
  return context;
}
