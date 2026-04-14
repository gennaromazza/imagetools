import { useState, useCallback } from "react";
import { CustomTemplate } from "../contexts/ProjectContext";
import { API_URL } from "../lib/apiUrls";

// Type definitions
export interface Template {
  id: string;
  name: string;
  width: number;
  height: number;
  dpi: number;
}

export interface ProcessImageResponse {
  success: boolean;
  imageUrl: string;
  path: string;
  size: number;
}

export interface BatchExportResult {
  success: Array<{ id: string; filename: string; size: number }>;
  failed: Array<{ id: string; error: string }>;
  totalTime: number;
  outputDir: string;
}

export interface BatchExportImage {
  id: string;
  originalName?: string;
  orientation: "vertical" | "horizontal";
  file: File;
  crop: {
    x: number;
    y: number;
    zoom: number;
  };
}

export interface BatchExportRequestOptions {
  format?: "jpeg" | "png";
  quality?: number;
  colorProfile?: "sRGB" | "AdobeRGB";
  namingPattern?: string;
  projectName?: string;
  outputPath?: string;
  createSubfolder?: boolean;
  embedColorProfile?: boolean;
  overwrite?: boolean;
  customTemplate?: CustomTemplate | null;
  customTemplateBackgroundFiles?: Partial<Record<"vertical" | "horizontal", File | null>>;
}

// Hook: Get all templates
export const useGetTemplates = () => {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${API_URL}/templates`);
      if (!response.ok) throw new Error("Failed to fetch templates");
      const data = await response.json();
      setTemplates(data.templates || []);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      setError(errorMsg);
      console.error("Error fetching templates:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  return { templates, loading, error, fetchTemplates };
};

// Hook: Process single image
export const useProcessImage = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const processImage = useCallback(
    async (
      file: File,
      templateId: string,
      positionX: number = 0,
      positionY: number = 0,
      zoom: number = 100,
      orientation: "vertical" | "horizontal" = "horizontal",
      customTemplate: CustomTemplate | null = null,
      customTemplateBackgroundFiles: Partial<Record<"vertical" | "horizontal", File | null>> = {}
    ): Promise<ProcessImageResponse | null> => {
      try {
        setLoading(true);
        setError(null);
        setProgress(0);

        console.log(`Processing image: ${file.name} with template: ${templateId}`);

        const formData = new FormData();
        formData.append("image", file);
        formData.append("templateId", templateId);
        formData.append("positionX", String(positionX));
        formData.append("positionY", String(positionY));
        formData.append("zoom", String(zoom));
        formData.append("orientation", orientation);
        if (templateId === "custom" && customTemplate) {
          formData.append("customTemplate", JSON.stringify(customTemplate));
          const verticalFile = customTemplateBackgroundFiles.vertical;
          const horizontalFile = customTemplateBackgroundFiles.horizontal;
          if (verticalFile) {
            formData.append("templateBackgroundVertical", verticalFile, verticalFile.name);
          }
          if (horizontalFile) {
            formData.append("templateBackgroundHorizontal", horizontalFile, horizontalFile.name);
          }
        }

        setProgress(30);

        // Create AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

        let response: Response;
        try {
          response = await fetch(`${API_URL}/process-image`, {
            method: "POST",
            body: formData,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }

        setProgress(70);

        if (!response.ok) {
          const contentType = response.headers.get("content-type");
          let errorMsg = `Server error: ${response.status}`;
          if (contentType?.includes("application/json")) {
            const data = await response.json();
            errorMsg = data.error || errorMsg;
          }
          throw new Error(errorMsg);
        }

        const result: ProcessImageResponse = await response.json();
        console.log(`Image processed successfully:`, result);
        setProgress(100);
        return result;
      } catch (err) {
        let errorMsg = "Unknown error";
        if (err instanceof Error) {
          errorMsg = err.message;
          if (err.name === "AbortError") {
            errorMsg = "Image processing timeout (30s) - server may be busy";
          }
        }
        setError(errorMsg);
        console.error("Error processing image:", errorMsg, err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { processImage, loading, error, progress };
};

// Hook: Batch export
export const useBatchExport = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const batchExport = useCallback(
    async (
      images: BatchExportImage[],
      templateId: string,
      options: BatchExportRequestOptions = {}
    ): Promise<BatchExportResult> => {
      try {
        setLoading(true);
        setError(null);
        setProgress(0);

        const formData = new FormData();
        const items = images.map((image) => ({
          id: image.id,
          originalName: image.originalName ?? image.file.name,
          orientation: image.orientation,
          crop: image.crop,
        }));

        images.forEach((image) => {
          formData.append("images", image.file, image.file.name);
        });

        formData.append("items", JSON.stringify(items));
        formData.append("templateId", templateId);
        formData.append("quality", String(options.quality ?? 100));
        formData.append("format", options.format ?? "jpeg");
        formData.append("colorProfile", options.colorProfile ?? "sRGB");
        formData.append("namingPattern", options.namingPattern ?? "original_frame");
        formData.append("projectName", options.projectName ?? "Project");
        formData.append("outputPath", options.outputPath ?? "");
        formData.append("createSubfolder", String(options.createSubfolder ?? true));
        formData.append("embedColorProfile", String(options.embedColorProfile ?? false));
        formData.append("overwrite", String(options.overwrite ?? false));
        if (templateId === "custom" && options.customTemplate) {
          formData.append("customTemplate", JSON.stringify(options.customTemplate));
          const verticalFile = options.customTemplateBackgroundFiles?.vertical;
          const horizontalFile = options.customTemplateBackgroundFiles?.horizontal;
          if (verticalFile) {
            formData.append("templateBackgroundVertical", verticalFile, verticalFile.name);
          }
          if (horizontalFile) {
            formData.append("templateBackgroundHorizontal", horizontalFile, horizontalFile.name);
          }
        }

        setProgress(20);

        const response = await fetch(`${API_URL}/batch-export`, {
          method: "POST",
          body: formData,
        });

        setProgress(60);

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to batch export");
        }

        const result: BatchExportResult = await response.json();
        setProgress(100);
        return result;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        setError(errorMsg);
        console.error("Error in batch export:", err);
        throw new Error(errorMsg);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { batchExport, loading, error, progress };
};

export async function openExportFolder(folderPath?: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/open-folder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderPath }),
    });

    return response.ok;
  } catch (error) {
    console.error("Failed to open export folder:", error);
    return false;
  }
}

export async function pickExportFolder(initialPath?: string): Promise<string | null> {
  try {
    if (window.filexDesktop?.chooseOutputFolder) {
      return await window.filexDesktop.chooseOutputFolder();
    }

    const response = await fetch(`${API_URL}/pick-folder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initialPath }),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { path?: string };
    return typeof data.path === "string" && data.path.trim() ? data.path : null;
  } catch (error) {
    console.error("Failed to pick export folder:", error);
    return null;
  }
}

// Hook: Health check
export const useHealthCheck = () => {
  const [isOnline, setIsOnline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkHealth = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/health`);
      if (response.ok) {
        setIsOnline(true);
        setError(null);
      } else {
        setIsOnline(false);
        setError("Server responded with error");
      }
    } catch (err) {
      setIsOnline(false);
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      setError(errorMsg);
      console.error("Health check failed:", err);
    }
  }, []);

  return { isOnline, error, checkHealth };
};
