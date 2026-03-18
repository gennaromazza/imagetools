const API_BASE_URL = "http://localhost:3001/api";

export interface ProcessImageRequest {
  templateId: string;
  positionX?: number;
  positionY?: number;
  zoom?: number;
  image: File;
}

export interface ProcessImageResponse {
  success: boolean;
  imageUrl: string;
  path: string;
}

export interface ExportSettings {
  templateId: string;
  quality: number;
  colorProfile: string;
}

export interface BatchExportRequest {
  images: Array<{ id: string; path: string }>;
  templateId: string;
  quality: number;
  colorProfile: string;
}

export interface BatchExportResponse {
  success: Array<{ id: string; filename: string; size: number }>;
  failed: Array<{ id: string; error: string }>;
  totalTime: number;
}

/**
 * Fetch available templates from API
 */
export async function getTemplates() {
  try {
    const response = await fetch(`${API_BASE_URL}/templates`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error("Failed to fetch templates:", error);
    throw error;
  }
}

/**
 * Process single image with crop and overlay
 */
export async function processImage(request: ProcessImageRequest): Promise<ProcessImageResponse> {
  try {
    const formData = new FormData();
    formData.append("image", request.image);
    formData.append("templateId", request.templateId);
    if (request.positionX !== undefined) formData.append("positionX", String(request.positionX));
    if (request.positionY !== undefined) formData.append("positionY", String(request.positionY));
    if (request.zoom !== undefined) formData.append("zoom", String(request.zoom));

    const response = await fetch(`${API_BASE_URL}/process-image`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Failed to process image:", error);
    throw error;
  }
}

/**
 * Export batch of images with frame
 */
export async function batchExport(request: BatchExportRequest): Promise<BatchExportResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/batch-export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Failed to batch export:", error);
    throw error;
  }
}

/**
 * Check API server health
 */
export async function checkHealth() {
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}
