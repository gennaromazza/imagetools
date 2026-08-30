import { useCallback, useEffect, useRef, useState } from "react";
import type { CustomTemplate } from "../contexts/ProjectContext";
import type { CropTransform } from "../lib/cropGeometry";
import { API_URL, getPartyFrameApiHeaders, resolveApiAssetUrl } from "../lib/apiUrls";
import { isExportJobSnapshot, type ExportJobSnapshot } from "../lib/exportSession";
import {
  PARTY_FRAME_API_CONTRACT,
  isCompatiblePartyFrameApiHealth,
  type PartyFrameApiHealth,
} from "../../../server/apiContract";

export {
  createExportIntent,
  isExportJobSnapshot,
  loadExportSession,
  normalizeExportSession,
  updateExportSession,
  type BatchExportResult,
  type ExportClientStatus,
  type ExportJobPhase,
  type ExportJobSnapshot,
  type ExportJobStatus,
  type ExportSessionRecord,
} from "../lib/exportSession";

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isFiniteRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

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

export interface BatchExportImage {
  id: string;
  originalName?: string;
  relativePath?: string;
  absolutePath?: string;
  orientation: "vertical" | "horizontal";
  file?: File;
  crop: CropTransform;
}

export interface BatchExportRequestOptions {
  format?: "jpeg" | "png";
  quality?: number;
  colorProfile?: "sRGB";
  namingPattern?: string;
  projectName?: string;
  outputPath?: string;
  createSubfolder?: boolean;
  embedColorProfile?: boolean;
  overwrite?: boolean;
  customTemplate?: CustomTemplate | null;
  customTemplateBackgroundFiles?: Partial<Record<"vertical" | "horizontal", File | null>>;
}

export interface UploadProgressSnapshot {
  loaded: number;
  total: number;
  percent: number | null;
}

export class PartyFrameApiError extends Error {
  readonly status: number | null;
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;

  constructor(options: {
    message: string;
    code?: string;
    status?: number | null;
    retryable?: boolean;
    retryAfterMs?: number | null;
  }) {
    super(options.message);
    this.name = "PartyFrameApiError";
    this.status = options.status ?? null;
    this.code = options.code ?? "REQUEST_FAILED";
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

function retryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function errorFromPayload(
  status: number,
  rawPayload: string,
  retryAfterHeader: string | null
): PartyFrameApiError {
  let payload: { error?: unknown; code?: unknown } = {};
  try {
    payload = rawPayload ? JSON.parse(rawPayload) as typeof payload : {};
  } catch {
    // Preserve the HTTP status when a proxy returns non-JSON content.
  }
  const code = typeof payload.code === "string" && payload.code.trim()
    ? payload.code
    : `HTTP_${status}`;
  const friendlyMessages: Record<string, string> = {
    SESSION_TOKEN_REQUIRED: "La sessione desktop non è più valida. Riavvia PartyFrame e riprova.",
    JOB_QUEUE_FULL: "Il motore sta già gestendo il numero massimo di esportazioni. Attendi qualche secondo e riprova.",
    JOB_NOT_FOUND: "Il job non è più disponibile nel motore locale. Riapri il progetto per avviare una nuova esportazione.",
    FILE_TOO_LARGE: "Uno dei file supera il limite supportato.",
    LIMIT_FILE_SIZE: "Uno dei file supera il limite supportato.",
    BATCH_TOO_LARGE: "Il gruppo di immagini supera il limite massimo per una singola esportazione.",
    TOO_MANY_FILES: "Il progetto contiene più immagini di quante ne possano essere esportate in un solo job.",
    UNSUPPORTED_IMAGE: "Uno dei file usa un formato immagine non supportato.",
    INVALID_IMAGE: "Una delle immagini è danneggiata o non può essere letta.",
    SOURCE_NOT_FOUND: "Uno dei file sorgente non è più disponibile. Ricollega la cartella del progetto.",
    SOURCE_NOT_READABLE: "Uno dei file sorgente non può essere letto. Verifica i permessi della cartella.",
    OUTPUT_NOT_WRITABLE: "La cartella di destinazione non è scrivibile.",
    SERVER_CONTRACT_MISMATCH: "Il motore locale appartiene a una versione diversa. Chiudi e riavvia PartyFrame prima di esportare.",
    DISK_FULL: "Lo spazio disponibile non è sufficiente per completare l'esportazione.",
    NATIVE_PATHS_DISABLED: "L'accesso ai file originali richiede una sessione desktop valida.",
    INVALID_TEMPLATE_BACKGROUND: "Lo sfondo del template è danneggiato o non supportato.",
    INVALID_COLOR_PROFILE: "Il profilo colore richiesto non è supportato.",
    EXPORT_CANCELLED: "L'esportazione è stata annullata.",
  };
  const message = friendlyMessages[code]
    ?? (typeof payload.error === "string" && payload.error.trim() ? payload.error : `Richiesta non riuscita (${status})`);
  return new PartyFrameApiError({
    message,
    code,
    status,
    retryable: status === 408 || status === 429 || status >= 500,
    retryAfterMs: status === 429 ? retryAfterMs(retryAfterHeader) ?? 3_000 : null,
  });
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const raw = await response.text();
  if (!response.ok) {
    throw errorFromPayload(response.status, raw, response.headers.get("retry-after"));
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new PartyFrameApiError({
      message: "Il server ha restituito una risposta non valida.",
      code: "INVALID_RESPONSE",
      status: response.status,
      retryable: true,
    });
  }
}

export async function requireCompatiblePartyFrameApi(signal?: AbortSignal): Promise<PartyFrameApiHealth> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/health`, {
      headers: await getPartyFrameApiHeaders(),
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (signal?.aborted) {
      throw new PartyFrameApiError({
        message: "Verifica del motore locale annullata.",
        code: "REQUEST_ABORTED",
        retryable: true,
      });
    }
    throw new PartyFrameApiError({
      message: "Motore locale non raggiungibile. Riavvia PartyFrame e riprova.",
      code: "NETWORK_ERROR",
      retryable: true,
    });
  }

  const payload = await readJsonResponse<unknown>(response);
  if (!isCompatiblePartyFrameApiHealth(payload)) {
    throw new PartyFrameApiError({
      message: "Il motore locale appartiene a una versione diversa. Chiudi e riavvia PartyFrame prima di esportare.",
      code: "SERVER_CONTRACT_MISMATCH",
      status: 409,
      retryable: false,
    });
  }
  return payload;
}

function createBatchExportFormData(
  images: BatchExportImage[],
  templateId: string,
  options: BatchExportRequestOptions
): FormData {
  const formData = new FormData();
  const items = images.map((image) => ({
    id: image.id,
    originalName: image.originalName ?? image.file?.name ?? image.relativePath ?? image.id,
    relativePath: image.relativePath,
    absolutePath: image.absolutePath,
    orientation: image.orientation,
    crop: image.crop,
  }));

  images.forEach((image) => {
    if (!image.absolutePath && image.file) {
      formData.append("images", image.file, image.file.name);
    }
  });
  formData.append("items", JSON.stringify(items));
  formData.append("templateId", templateId);
  formData.append("quality", String(options.quality ?? 100));
  formData.append("format", options.format ?? "jpeg");
  formData.append("colorProfile", "sRGB");
  formData.append("namingPattern", options.namingPattern ?? "original_frame");
  formData.append("projectName", options.projectName ?? "Project");
  formData.append("outputPath", options.outputPath ?? "");
  formData.append("createSubfolder", String(options.createSubfolder ?? true));
  formData.append("embedColorProfile", "true");
  formData.append("overwrite", String(options.overwrite ?? false));

  if (templateId === "custom" && options.customTemplate) {
    formData.append("customTemplate", JSON.stringify(options.customTemplate));
    const verticalFile = options.customTemplateBackgroundFiles?.vertical;
    const horizontalFile = options.customTemplateBackgroundFiles?.horizontal;
    if (verticalFile) formData.append("templateBackgroundVertical", verticalFile, verticalFile.name);
    if (horizontalFile) formData.append("templateBackgroundHorizontal", horizontalFile, horizontalFile.name);
  }
  return formData;
}

// Hook: Get all templates
export const useGetTemplates = () => {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestGenerationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const fetchTemplates = useCallback(async () => {
    const requestId = ++requestGenerationRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${API_URL}/templates`, {
        headers: await getPartyFrameApiHeaders(),
        signal: controller.signal,
      });
      const data = await readJsonResponse<{ templates?: unknown }>(response);
      if (
        !Array.isArray(data.templates)
        || data.templates.length > 50
        || !data.templates.every((template): template is Template => {
          if (!template || typeof template !== "object") return false;
          const candidate = template as Partial<Template>;
          return isBoundedString(candidate.id, 128)
            && isBoundedString(candidate.name, 256)
            && isFiniteRange(candidate.width, 1, 12_000)
            && isFiniteRange(candidate.height, 1, 12_000)
            && isFiniteRange(candidate.dpi, 72, 600);
        })
      ) {
        throw new PartyFrameApiError({
          message: "Il catalogo template ricevuto non è valido.",
          code: "INVALID_TEMPLATE_CATALOG",
          retryable: true,
        });
      }
      if (requestId === requestGenerationRef.current) setTemplates(data.templates);
    } catch (err) {
      if (requestId !== requestGenerationRef.current || controller.signal.aborted) return;
      const errorMsg = err instanceof Error ? err.message : "Catalogo template non disponibile.";
      setError(errorMsg);
    } finally {
      if (requestId === requestGenerationRef.current) {
        setLoading(false);
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    }
  }, []);

  useEffect(() => () => {
    requestGenerationRef.current += 1;
    controllerRef.current?.abort();
  }, []);

  return { templates, loading, error, fetchTemplates };
};

// Hook: Process single image
export const useProcessImage = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const requestGenerationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const cancelProcessing = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  useEffect(
    () => () => {
      requestGenerationRef.current += 1;
      controllerRef.current?.abort();
    },
    []
  );

  const processImage = useCallback(
    async (
      file: File | null,
      templateId: string,
      crop: CropTransform,
      orientation: "vertical" | "horizontal" = "horizontal",
      customTemplate: CustomTemplate | null = null,
      customTemplateBackgroundFiles: Partial<Record<"vertical" | "horizontal", File | null>> = {},
      requestOptions: { signal?: AbortSignal; timeoutMs?: number; absolutePath?: string } = {}
    ): Promise<ProcessImageResponse | null> => {
      const requestId = ++requestGenerationRef.current;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      let timedOut = false;
      const timeoutMs = Math.max(5_000, requestOptions.timeoutMs ?? 120_000);
      const timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const abortFromCaller = () => controller.abort();
      if (requestOptions.signal?.aborted) {
        controller.abort();
      } else {
        requestOptions.signal?.addEventListener("abort", abortFromCaller, { once: true });
      }

      try {
        setLoading(true);
        setError(null);
        setProgress(0);

        const formData = new FormData();
        if (requestOptions.absolutePath) {
          formData.append("absolutePath", requestOptions.absolutePath);
        } else if (file) {
          formData.append("image", file);
        } else {
          throw new PartyFrameApiError({
            message: "Nessuna sorgente immagine disponibile.",
            code: "IMAGE_SOURCE_REQUIRED",
          });
        }
        formData.append("templateId", templateId);
        formData.append("offsetX", String(crop.offsetX));
        formData.append("offsetY", String(crop.offsetY));
        formData.append("zoom", String(crop.zoom));
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

        const response = await fetch(`${API_URL}/process-image`, {
          method: "POST",
          headers: await getPartyFrameApiHeaders(),
          body: formData,
          signal: controller.signal,
        });
        const result = await readJsonResponse<ProcessImageResponse>(response);
        if (requestId === requestGenerationRef.current) setProgress(100);
        return {
          ...result,
          imageUrl: resolveApiAssetUrl(result.imageUrl) ?? result.imageUrl,
        };
      } catch (err) {
        let errorMsg = err instanceof Error ? err.message : "Elaborazione immagine non riuscita.";
        if (controller.signal.aborted) {
          errorMsg = timedOut
            ? `Tempo massimo superato (${Math.round(timeoutMs / 1_000)} secondi).`
            : "Elaborazione annullata.";
        }
        if (requestId === requestGenerationRef.current) setError(errorMsg);
        return null;
      } finally {
        window.clearTimeout(timeoutId);
        requestOptions.signal?.removeEventListener("abort", abortFromCaller);
        if (requestId === requestGenerationRef.current) {
          controllerRef.current = null;
          setLoading(false);
        }
      }
    },
    []
  );

  return { processImage, cancelProcessing, loading, error, progress };
};

export async function createExportJob(
  images: BatchExportImage[],
  templateId: string,
  options: BatchExportRequestOptions,
  idempotencyKey: string,
  onUploadProgress?: (progress: UploadProgressSnapshot) => void,
  signal?: AbortSignal
): Promise<ExportJobSnapshot> {
  await requireCompatiblePartyFrameApi(signal);
  const requestHeaders = await getPartyFrameApiHeaders({
    "Idempotency-Key": idempotencyKey,
    "X-PartyFrame-Api-Contract": PARTY_FRAME_API_CONTRACT,
  });
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new PartyFrameApiError({
        message: "Caricamento annullato.",
        code: "REQUEST_ABORTED",
        retryable: true,
      }));
      return;
    }

    const xhr = new XMLHttpRequest();
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abortRequest);
      callback();
    };
    const abortRequest = () => xhr.abort();

    xhr.open("POST", `${API_URL}/export-jobs`);
    requestHeaders.forEach((value, name) => xhr.setRequestHeader(name, value));
    xhr.upload.onprogress = (event) => {
      const total = event.lengthComputable ? event.total : 0;
      onUploadProgress?.({
        loaded: event.loaded,
        total,
        percent: total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : null,
      });
    };
    xhr.onload = () => {
      finish(() => {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(errorFromPayload(xhr.status, xhr.responseText, xhr.getResponseHeader("retry-after")));
          return;
        }
        try {
          const snapshot = JSON.parse(xhr.responseText) as unknown;
          if (!isExportJobSnapshot(snapshot)) {
            throw new Error("Invalid export job response");
          }
          resolve(snapshot);
        } catch {
          reject(new PartyFrameApiError({
            message: "Il server ha restituito un job non valido.",
            code: "INVALID_JOB_RESPONSE",
            status: xhr.status,
            retryable: true,
          }));
        }
      });
    };
    xhr.onerror = () => {
      finish(() => reject(new PartyFrameApiError({
        message: "Connessione al server interrotta durante il caricamento.",
        code: "NETWORK_ERROR",
        retryable: true,
      })));
    };
    xhr.onabort = () => {
      finish(() => reject(new PartyFrameApiError({
        message: "Caricamento annullato.",
        code: "REQUEST_ABORTED",
        retryable: true,
      })));
    };

    signal?.addEventListener("abort", abortRequest, { once: true });
    onUploadProgress?.({ loaded: 0, total: 0, percent: null });
    xhr.send(createBatchExportFormData(images, templateId, options));
  });
}

async function jobRequest(
  jobId: string,
  method: "GET" | "DELETE",
  signal?: AbortSignal
): Promise<ExportJobSnapshot> {
  try {
    const response = await fetch(`${API_URL}/export-jobs/${encodeURIComponent(jobId)}`, {
      method,
      signal,
      headers: await getPartyFrameApiHeaders(),
    });
    const snapshot = await readJsonResponse<ExportJobSnapshot>(response);
    if (!isExportJobSnapshot(snapshot)) {
      throw new PartyFrameApiError({
        message: "Il server ha restituito uno stato export non valido.",
        code: "INVALID_JOB_RESPONSE",
        status: response.status,
        retryable: true,
      });
    }
    return snapshot;
  } catch (error) {
    if (error instanceof PartyFrameApiError) throw error;
    if (signal?.aborted) {
      throw new PartyFrameApiError({
        message: "Richiesta annullata.",
        code: "REQUEST_ABORTED",
        retryable: true,
      });
    }
    throw new PartyFrameApiError({
      message: "Server export non raggiungibile.",
      code: "NETWORK_ERROR",
      retryable: true,
    });
  }
}

export function getExportJob(jobId: string, signal?: AbortSignal): Promise<ExportJobSnapshot> {
  return jobRequest(jobId, "GET", signal);
}

export function cancelExportJob(jobId: string, signal?: AbortSignal): Promise<ExportJobSnapshot> {
  return jobRequest(jobId, "DELETE", signal);
}

export async function openExportFolder(folderPath?: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/open-folder`, {
      method: "POST",
      headers: await getPartyFrameApiHeaders({ "Content-Type": "application/json" }),
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
      headers: await getPartyFrameApiHeaders({ "Content-Type": "application/json" }),
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
  const [status, setStatus] = useState<"checking" | "online" | "offline" | "incompatible">("checking");
  const [error, setError] = useState<string | null>(null);
  const healthControllerRef = useRef<AbortController | null>(null);
  const healthRequestRef = useRef(0);

  const checkHealth = useCallback(async () => {
    const requestId = ++healthRequestRef.current;
    healthControllerRef.current?.abort();
    const controller = new AbortController();
    healthControllerRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), 4_000);
    setStatus((current) => current === "online" ? current : "checking");
    try {
      await requireCompatiblePartyFrameApi(controller.signal);
      if (requestId !== healthRequestRef.current) return;
      setStatus("online");
      setError(null);
    } catch (err) {
      if (requestId !== healthRequestRef.current) return;
      const incompatible = err instanceof PartyFrameApiError && err.code === "SERVER_CONTRACT_MISMATCH";
      setStatus(incompatible ? "incompatible" : "offline");
      const errorMsg = incompatible
        ? err.message
        : controller.signal.aborted
        ? "Il servizio locale non ha risposto entro 4 secondi."
        : err instanceof Error ? err.message : "Servizio locale non raggiungibile";
      setError(errorMsg);
    } finally {
      window.clearTimeout(timeoutId);
      if (healthControllerRef.current === controller) {
        healthControllerRef.current = null;
      }
    }
  }, []);

  useEffect(() => () => {
    healthRequestRef.current += 1;
    healthControllerRef.current?.abort();
  }, []);

  return { isOnline: status === "online", status, error, checkHealth };
};
