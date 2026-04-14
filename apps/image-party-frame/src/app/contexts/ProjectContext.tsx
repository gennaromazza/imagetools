import { createContext, useState, ReactNode, useContext } from "react";

// Global Map to store File objects associated with image IDs (non-serializable, session-only)
const imageFilesMap = new Map<string, File>();
const customTemplateBackgroundFiles: Record<"vertical" | "horizontal", File | null> = {
  vertical: null,
  horizontal: null,
};

export const getImageFile = (imageId: string): File | undefined => {
  return imageFilesMap.get(imageId);
};

export const setImageFile = (imageId: string, file: File): void => {
  imageFilesMap.set(imageId, file);
};

export const setImageFiles = (files: File[], imageIds: string[]): void => {
  files.forEach((file, index) => {
    if (imageIds[index]) {
      imageFilesMap.set(imageIds[index], file);
    }
  });
};

export const clearImageFiles = (): void => {
  imageFilesMap.clear();
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
  url?: string;
  orientation: "vertical" | "horizontal";
  approval: "pending" | "approved" | "needs-adjustment";
  crop: {
    x: number;
    y: number;
    zoom: number;
  };
}

export interface ProjectState {
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
    colorProfile: "sRGB" | "AdobeRGB";
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
  updateProjectBasics: (name: string, template: string, sourcePath: string, outputPath: string) => void;
  updateOutputPath: (outputPath: string) => void;
  setCustomTemplate: (template: CustomTemplate | null) => void;
  setImages: (images: ImageItem[]) => void;
  updateImageCrop: (imageId: string, crop: { x: number; y: number; zoom: number }) => void;
  updateImageApproval: (imageId: string, approval: "pending" | "approved" | "needs-adjustment") => void;
  updateExportSettings: (settings: Partial<ProjectState["exportSettings"]>) => void;
}

export const defaultProjectExportSettings: ProjectState["exportSettings"] = {
  format: "jpeg",
  quality: 100,
  colorProfile: "sRGB",
  namingPattern: "original_frame",
  onlyApproved: true,
  embedColorProfile: false,
  createSubfolder: true,
  overwrite: false,
};

const defaultProject: ProjectState = {
  name: "",
  template: "classic-gold",
  sourcePath: "",
  outputPath: "",
  customTemplate: null,
  images: [],
  imageCount: { total: 0, vertical: 0, horizontal: 0 },
  exportSettings: defaultProjectExportSettings,
};

export function normalizeProjectState(project?: Partial<ProjectState> | null): ProjectState {
  const normalizedImages = Array.isArray(project?.images)
    ? project.images.map((image, index) => ({
        id: image?.id || `img_${String(index + 1).padStart(3, "0")}`,
        path: image?.path || `image_${index + 1}.jpg`,
        url: image?.url,
        orientation: image?.orientation === "horizontal" ? "horizontal" : "vertical",
        approval:
          image?.approval === "approved" || image?.approval === "needs-adjustment" ? image.approval : "pending",
        crop: {
          x: typeof image?.crop?.x === "number" ? image.crop.x : 0,
          y: typeof image?.crop?.y === "number" ? image.crop.y : 0,
          zoom: typeof image?.crop?.zoom === "number" ? image.crop.zoom : 100,
        },
      }))
    : [];

  const vertical = normalizedImages.filter((image) => image.orientation === "vertical").length;
  const horizontal = normalizedImages.length - vertical;

  return {
    ...defaultProject,
    ...project,
    customTemplate: project?.customTemplate ?? null,
    images: normalizedImages,
    imageCount: project?.imageCount ?? {
      total: normalizedImages.length,
      vertical,
      horizontal,
    },
    exportSettings: {
      ...defaultProjectExportSettings,
      ...(project?.exportSettings ?? {}),
    },
  };
}

export const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [project, setProjectState] = useState<ProjectState>(defaultProject);

  const setProject = (nextProject: Partial<ProjectState>) => {
    if (nextProject.template !== "custom" || !nextProject.customTemplate) {
      clearCustomTemplateBackgroundFiles();
    }

    setProjectState(normalizeProjectState(nextProject));
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

  const updateImageCrop = (imageId: string, crop: { x: number; y: number; zoom: number }) => {
    setProjectState((prev) => ({
      ...prev,
      images: prev.images.map((img) => (img.id === imageId ? { ...img, crop } : img)),
    }));
  };

  const updateImageApproval = (imageId: string, approval: "pending" | "approved" | "needs-adjustment") => {
    setProjectState((prev) => ({
      ...prev,
      images: prev.images.map((img) => (img.id === imageId ? { ...img, approval } : img)),
    }));
  };

  const updateExportSettings = (settings: Partial<ProjectState["exportSettings"]>) => {
    setProjectState((prev) => ({
      ...prev,
      exportSettings: { ...prev.exportSettings, ...settings },
    }));
  };

  const value: ProjectContextType = {
    project,
    setProject,
    updateProjectBasics,
    updateOutputPath,
    setCustomTemplate,
    setImages,
    updateImageCrop,
    updateImageApproval,
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
