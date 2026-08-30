import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import cors from "cors";
import express, {
  type Application,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import multer from "multer";
import {
  HttpError,
  MAX_BATCH_FILES,
  MAX_BATCH_TOTAL_BYTES,
  MAX_FILE_BYTES,
  isSupportedImageFilename,
  orientTemplate,
  parseCustomTemplate,
  prepareExportRequest,
  renderFramedImageAtomic,
  resolveNativeImageFile,
  templates,
  toTemplateConfig,
  validateUploadedFile,
  type BatchExportCrop,
  type ExportRequestBody,
  type UploadedFileDescriptor,
} from "./pipeline.js";
import {
  cleanupUploadedFiles,
  ExportJobManager,
  type ExportJobManagerOptions,
  type ExportJobSnapshot,
} from "./jobs.js";
import { PARTY_FRAME_API_CONTRACT } from "./apiContract.js";

const MULTIPART_FIELD_BYTES = 2 * 1024 * 1024;
const PROCESS_UPLOAD_AGGREGATE_BYTES = MAX_FILE_BYTES * 3;
const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

export interface PartyFrameAppOptions extends ExportJobManagerOptions {
  dataDir: string;
  allowedOrigins?: string[];
  sessionToken?: string | null;
}

export interface PartyFrameAppRuntime {
  app: Application;
  jobs: ExportJobManager;
  dataDir: string;
  uploadDir: string;
  exportDir: string;
  instanceId: string;
  startedAt: string;
  close: () => Promise<void>;
}

class BoundedDiskStorage implements multer.StorageEngine {
  private readonly aggregateBytes = new WeakMap<Request, number>();

  constructor(
    private readonly uploadDir: string,
    private readonly maxAggregateBytes: number,
  ) {}

  _handleFile(
    req: Request,
    file: Express.Multer.File,
    callback: (error?: unknown, info?: Partial<Express.Multer.File>) => void,
  ): void {
    const originalExtension = path.extname(file.originalname).toLocaleLowerCase();
    const safeExtension = /^\.[a-z0-9]{1,8}$/.test(originalExtension) ? originalExtension : ".upload";
    const storedPath = path.join(this.uploadDir, `${randomUUID()}${safeExtension}`);
    let fileBytes = 0;
    const counter = new Transform({
      transform: (chunk: Buffer, _encoding, done) => {
        const requestBytes = (this.aggregateBytes.get(req) ?? 0) + chunk.length;
        if (requestBytes > this.maxAggregateBytes) {
          done(new HttpError(413, "BATCH_TOO_LARGE", "The aggregate upload limit was exceeded"));
          return;
        }
        this.aggregateBytes.set(req, requestBytes);
        fileBytes += chunk.length;
        done(null, chunk);
      },
    });

    void streamPipeline(file.stream, counter, createWriteStream(storedPath, { flags: "wx" }))
      .then(() => callback(undefined, {
        destination: this.uploadDir,
        filename: path.basename(storedPath),
        path: storedPath,
        size: fileBytes,
      }))
      .catch(async (error: unknown) => {
        await rm(storedPath, { force: true }).catch(() => undefined);
        callback(error);
      });
  }

  _removeFile(
    _req: Request,
    file: Express.Multer.File,
    callback: (error: Error | null) => void,
  ): void {
    if (!file.path) {
      callback(null);
      return;
    }
    void rm(file.path, { force: true }).then(() => callback(null), (error: Error) => callback(error));
  }
}

function uploadedFields(req: Request): Record<string, Express.Multer.File[]> {
  return (req.files as Record<string, Express.Multer.File[]> | undefined) ?? {};
}

function descriptor(file: Express.Multer.File): UploadedFileDescriptor {
  return { path: file.path, originalname: file.originalname, size: file.size };
}

function uploadPaths(req: Request): string[] {
  return Object.values(uploadedFields(req)).flatMap((files) => files.map((file) => file.path)).filter(Boolean);
}

function fileFilter(
  _req: Request,
  file: Express.Multer.File,
  callback: multer.FileFilterCallback,
): void {
  if (!isSupportedImageFilename(file.originalname)) {
    callback(new HttpError(415, "UNSUPPORTED_IMAGE", `Unsupported image type: ${path.extname(file.originalname) || "unknown"}`));
    return;
  }
  callback(null, true);
}

function createUploader(uploadDir: string, maxFiles: number, maxAggregateBytes: number): multer.Multer {
  return multer({
    storage: new BoundedDiskStorage(uploadDir, maxAggregateBytes),
    fileFilter,
    limits: {
      fileSize: MAX_FILE_BYTES,
      files: maxFiles,
      fields: 32,
      fieldSize: MULTIPART_FIELD_BYTES,
      parts: maxFiles + 32,
    },
  });
}

function allowedLocalOrigin(origin: string | undefined, explicitOrigins: Set<string>): boolean {
  if (!origin || origin === "null" || explicitOrigins.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && parsed.origin === origin
      && !parsed.username
      && !parsed.password
      && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]");
  } catch {
    return false;
  }
}

function parseIdempotencyKey(req: Request): string | undefined {
  const value = req.get("Idempotency-Key") ?? req.get("X-Idempotency-Key");
  if (!value) return undefined;
  const key = value.trim();
  if (!key || key.length > IDEMPOTENCY_KEY_MAX_LENGTH || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new HttpError(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency key is invalid");
  }
  return key;
}

function matchesSessionToken(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const providedBytes = Buffer.from(provided, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
}

function numberField(value: unknown, fallback: number, label: string): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw new HttpError(400, "INVALID_NUMBER", `${label} must be a finite number`);
  }
  return parsed;
}

function optionalNormalizedOffset(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return Math.min(1, Math.max(-1, numberField(value, 0, "crop offset")));
}

function sendJobNotFound(res: Response): void {
  res.status(404).json({ error: "Export job not found", code: "JOB_NOT_FOUND" });
}

function routeId(value: string | string[]): string {
  return Array.isArray(value) ? value[0] ?? "" : value;
}

function sendSynchronousJobResult(snapshot: ExportJobSnapshot, res: Response): void {
  if (snapshot.status === "completed" && snapshot.result) {
    res.json(snapshot.result);
    return;
  }
  if (snapshot.status === "cancelled") {
    res.status(409).json({ error: "Export was cancelled", code: "EXPORT_CANCELLED", job: snapshot });
    return;
  }
  res.status(500).json({
    error: snapshot.error?.message ?? "Export failed",
    code: snapshot.error?.code ?? "EXPORT_FAILED",
    job: snapshot,
  });
}

async function openFolder(folderPath: string): Promise<void> {
  const command = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [folderPath], { detached: true, stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}

export async function createPartyFrameApp(options: PartyFrameAppOptions): Promise<PartyFrameAppRuntime> {
  const dataDir = path.resolve(options.dataDir);
  const uploadDir = path.join(dataDir, "uploads");
  const exportDir = path.join(dataDir, "exports");
  const instanceId = randomUUID();
  const startedAt = new Date().toISOString();
  await Promise.all([mkdir(uploadDir, { recursive: true }), mkdir(exportDir, { recursive: true })]);

  const jobs = new ExportJobManager(options);
  const app = express();
  const envOrigins = (process.env.IMAGE_PARTY_FRAME_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const explicitOrigins = new Set([...(options.allowedOrigins ?? []), ...envOrigins]);
  const configuredSessionToken = options.sessionToken === undefined
    ? process.env.IMAGE_PARTY_FRAME_SESSION_TOKEN
    : options.sessionToken ?? undefined;
  const nativePathsEnabled = Boolean(configuredSessionToken);
  app.disable("x-powered-by");
  app.use(cors({
    origin: (origin, callback) => {
      if (allowedLocalOrigin(origin, explicitOrigins)) callback(null, true);
      else callback(new HttpError(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed"));
    },
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Idempotency-Key",
      "X-Idempotency-Key",
      "X-PartyFrame-Token",
      "X-PartyFrame-Api-Contract",
    ],
    exposedHeaders: ["Location", "X-Export-Job-Id"],
  }));
  app.use(express.json({ limit: "128kb" }));
  app.use("/api/export-jobs", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const clientContract = req.get("X-PartyFrame-Api-Contract");
    if (clientContract && clientContract !== PARTY_FRAME_API_CONTRACT) {
      res.status(409).json({
        error: "PartyFrame API contract mismatch",
        code: "SERVER_CONTRACT_MISMATCH",
      });
      return;
    }
    next();
  });

  const processUpload = createUploader(uploadDir, 3, PROCESS_UPLOAD_AGGREGATE_BYTES).fields([
    { name: "image", maxCount: 1 },
    { name: "templateBackgroundVertical", maxCount: 1 },
    { name: "templateBackgroundHorizontal", maxCount: 1 },
  ]);
  const batchUpload = createUploader(uploadDir, MAX_BATCH_FILES + 2, MAX_BATCH_TOTAL_BYTES).fields([
    { name: "images", maxCount: MAX_BATCH_FILES },
    { name: "templateBackgroundVertical", maxCount: 1 },
    { name: "templateBackgroundHorizontal", maxCount: 1 },
  ]);
  const requireJobCapacity = (_req: Request, _res: Response, next: NextFunction): void => {
    if (!jobs.hasCapacity()) {
      next(new HttpError(429, "JOB_QUEUE_FULL", "The export queue is full; wait for a running job to finish"));
      return;
    }
    next();
  };
  const requireSessionToken = (req: Request, res: Response, next: NextFunction): void => {
    if (!configuredSessionToken) {
      next();
      return;
    }
    if (!matchesSessionToken(req.get("X-PartyFrame-Token"), configuredSessionToken)) {
      res.status(401).json({
        error: "A valid PartyFrame desktop session token is required",
        code: "SESSION_TOKEN_REQUIRED",
      });
      return;
    }
    next();
  };

  app.get("/api/templates", (_req, res) => {
    res.json({
      templates: Object.entries(templates).map(([id, template]) => ({
        id,
        name: template.name,
        width: template.width,
        height: template.height,
        dpi: template.dpi,
      })),
    });
  });

  app.post("/api/process-image", requireSessionToken, processUpload, asyncRoute(async (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
    const fields = uploadedFields(req);
    const uploadedImage = fields.image?.[0];
    const backgroundFiles = {
      vertical: fields.templateBackgroundVertical?.[0],
      horizontal: fields.templateBackgroundHorizontal?.[0],
    };

    try {
      const nativePath = typeof body.absolutePath === "string" ? body.absolutePath : undefined;
      if (nativePath && uploadedImage) {
        throw new HttpError(400, "AMBIGUOUS_IMAGE_SOURCE", "Provide either an image upload or absolutePath, not both");
      }
      if (nativePath && !nativePathsEnabled) {
        throw new HttpError(403, "NATIVE_PATHS_DISABLED", "Native source paths require an authenticated desktop session");
      }
      const image = nativePath
        ? await resolveNativeImageFile(nativePath, "Image")
        : uploadedImage
          ? descriptor(uploadedImage)
          : null;
      if (!image) throw new HttpError(400, "IMAGE_REQUIRED", "An image is required");
      validateUploadedFile(image, "Image");
      if (backgroundFiles.vertical) validateUploadedFile(descriptor(backgroundFiles.vertical), "Vertical template background");
      if (backgroundFiles.horizontal) validateUploadedFile(descriptor(backgroundFiles.horizontal), "Horizontal template background");

      const templateId = typeof body.templateId === "string" ? body.templateId : "";
      if (body.orientation !== undefined && body.orientation !== "" && body.orientation !== "vertical" && body.orientation !== "horizontal") {
        throw new HttpError(400, "INVALID_ORIENTATION", "Image orientation must be vertical or horizontal");
      }
      const orientation = body.orientation === "vertical" ? "vertical" : "horizontal";
      const customTemplate = parseCustomTemplate(body.customTemplate);
      const template = templateId === "custom"
        ? customTemplate
          ? toTemplateConfig(customTemplate, orientation, {
              vertical: backgroundFiles.vertical?.path,
              horizontal: backgroundFiles.horizontal?.path,
            })
          : null
        : templates[templateId]
          ? orientTemplate(templates[templateId], orientation)
          : null;
      if (!template) throw new HttpError(400, "INVALID_TEMPLATE", "Template is invalid");

      if (body.format !== undefined && body.format !== "" && body.format !== "jpeg" && body.format !== "png") {
        throw new HttpError(400, "INVALID_FORMAT", "Image format must be jpeg or png");
      }
      const format = body.format === "png" ? "png" : "jpeg";
      const quality = Math.min(100, Math.max(60, Math.round(numberField(body.quality, 82, "quality"))));
      const crop: BatchExportCrop = {
        offsetX: optionalNormalizedOffset(body.offsetX),
        offsetY: optionalNormalizedOffset(body.offsetY),
        x: numberField(body.positionX, 0, "positionX"),
        y: numberField(body.positionY, 0, "positionY"),
        zoom: Math.min(400, Math.max(100, numberField(body.zoom, 100, "zoom"))),
      };
      const outputFilename = `processed_${randomUUID()}.${format === "png" ? "png" : "jpg"}`;
      const outputPath = path.join(exportDir, outputFilename);
      const rendered = await renderFramedImageAtomic({
        imagePath: image.path,
        template,
        outputPath,
        crop,
        quality,
        format,
      });
      res.json({
        success: true,
        imageUrl: `/${outputFilename}`,
        path: outputPath,
        size: rendered.size,
      });
    } finally {
      await cleanupUploadedFiles(uploadPaths(req));
    }
  }));

  app.post("/api/batch-export", requireSessionToken, requireJobCapacity, batchUpload, asyncRoute(async (req, res) => {
    const id = randomUUID();
    const fields = uploadedFields(req);
    const images = fields.images ?? [];
    const backgroundFiles = {
      vertical: fields.templateBackgroundVertical?.[0],
      horizontal: fields.templateBackgroundHorizontal?.[0],
    };
    const cleanupPaths = uploadPaths(req);
    let transferred = false;

    try {
      const prepared = await prepareExportRequest(
        (req.body && typeof req.body === "object" ? req.body : {}) as ExportRequestBody,
        images.map(descriptor),
        {
          ...(backgroundFiles.vertical ? { vertical: descriptor(backgroundFiles.vertical) } : {}),
          ...(backgroundFiles.horizontal ? { horizontal: descriptor(backgroundFiles.horizontal) } : {}),
        },
        exportDir,
        id,
        { allowNativePaths: nativePathsEnabled },
      );
      const created = await jobs.create({ id, request: prepared, cleanupPaths });
      transferred = true;
      res.setHeader("X-Export-Job-Id", created.snapshot.id);
      let responseFinished = false;
      res.once("finish", () => { responseFinished = true; });
      res.once("close", () => {
        if (!responseFinished) void jobs.cancel(id);
      });
      const completed = await jobs.wait(id);
      if (!completed) throw new HttpError(404, "JOB_NOT_FOUND", "Export job not found");
      sendSynchronousJobResult(completed, res);
    } finally {
      if (!transferred) await cleanupUploadedFiles(cleanupPaths);
    }
  }));

  const idempotencyPrecheck = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const key = parseIdempotencyKey(req);
      if (key) {
        const existing = jobs.getByIdempotencyKey(key);
        if (existing) {
          res.status(200).json(existing);
          return;
        }
      }
      res.locals.exportIdempotencyKey = key;
      next();
    } catch (error) {
      next(error);
    }
  };

  app.post("/api/export-jobs", requireSessionToken, idempotencyPrecheck, requireJobCapacity, batchUpload, asyncRoute(async (req, res) => {
    const id = randomUUID();
    const fields = uploadedFields(req);
    const images = fields.images ?? [];
    const backgroundFiles = {
      vertical: fields.templateBackgroundVertical?.[0],
      horizontal: fields.templateBackgroundHorizontal?.[0],
    };
    const cleanupPaths = uploadPaths(req);
    let transferred = false;

    try {
      const prepared = await prepareExportRequest(
        (req.body && typeof req.body === "object" ? req.body : {}) as ExportRequestBody,
        images.map(descriptor),
        {
          ...(backgroundFiles.vertical ? { vertical: descriptor(backgroundFiles.vertical) } : {}),
          ...(backgroundFiles.horizontal ? { horizontal: descriptor(backgroundFiles.horizontal) } : {}),
        },
        exportDir,
        id,
        { allowNativePaths: nativePathsEnabled },
      );
      const created = await jobs.create({
        id,
        request: prepared,
        cleanupPaths,
        idempotencyKey: res.locals.exportIdempotencyKey as string | undefined,
      });
      transferred = true;
      res.setHeader("Location", `/api/export-jobs/${created.snapshot.id}`);
      res.status(created.reused ? 200 : 202).json(created.snapshot);
    } finally {
      if (!transferred) await cleanupUploadedFiles(cleanupPaths);
    }
  }));

  app.get("/api/export-jobs/:id", requireSessionToken, (req, res) => {
    const snapshot = jobs.get(routeId(req.params.id));
    if (!snapshot) {
      sendJobNotFound(res);
      return;
    }
    res.json(snapshot);
  });

  const cancelJob = asyncRoute(async (req, res) => {
    const id = routeId(req.params.id);
    const before = jobs.get(id);
    if (!before) {
      sendJobNotFound(res);
      return;
    }
    const snapshot = await jobs.cancel(id);
    if (!snapshot) {
      sendJobNotFound(res);
      return;
    }
    const pending = before.status === "queued" || before.status === "running" || before.status === "cancelling";
    res.status(pending && snapshot.status === "cancelling" ? 202 : 200).json(snapshot);
  });
  app.delete("/api/export-jobs/:id", requireSessionToken, cancelJob);
  app.post("/api/export-jobs/:id/cancel", requireSessionToken, cancelJob);

  app.post("/api/open-folder", requireSessionToken, asyncRoute(async (req, res) => {
    const requestedPath = typeof req.body?.folderPath === "string" && req.body.folderPath.trim()
      ? path.resolve(req.body.folderPath)
      : exportDir;
    let stats;
    try {
      stats = await stat(requestedPath);
    } catch {
      throw new HttpError(404, "FOLDER_NOT_FOUND", "Folder not found");
    }
    if (!stats.isDirectory()) throw new HttpError(400, "INVALID_FOLDER", "Selected path is not a folder");
    await openFolder(requestedPath);
    res.json({ success: true, path: requestedPath });
  }));

  app.post("/api/pick-folder", requireSessionToken, (req, res) => {
    if (process.platform !== "win32") {
      res.status(501).json({ error: "Folder picker is currently implemented only for Windows" });
      return;
    }
    const initialPath = typeof req.body?.initialPath === "string" && req.body.initialPath.trim()
      ? path.resolve(req.body.initialPath)
      : exportDir;
    const escapedInitialPath = initialPath.replace(/'/g, "''");
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      `$dialog.SelectedPath = '${escapedInitialPath}'`,
      "$dialog.ShowNewFolderButton = $true",
      "$result = $dialog.ShowDialog()",
      "if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }",
    ].join("; ");
    const child = spawn("powershell.exe", ["-NoProfile", "-STA", "-Command", script], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      res.status(504).json({ error: "Folder picker timed out" });
    }, 120_000);
    timeout.unref?.();
    child.stdout.on("data", (chunk: Buffer) => { if (stdout.length < 32_768) stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < 32_768) stderr += chunk.toString(); });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      res.status(500).json({ error: error.message || "Unable to pick folder" });
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0 && !stdout.trim()) {
        res.status(500).json({ error: stderr.trim() || "Unable to pick folder" });
        return;
      }
      const selectedPath = stdout.trim();
      if (!selectedPath) {
        res.json({ success: false, cancelled: true, path: "" });
        return;
      }
      res.json({ success: true, path: selectedPath });
    });
  });

  app.get("/api/health", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      status: "ok",
      apiContract: PARTY_FRAME_API_CONTRACT,
      instanceId,
      startedAt,
      timestamp: new Date().toISOString(),
    });
  });

  app.use(express.static(exportDir, { dotfiles: "ignore", index: false }));

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof multer.MulterError) {
      const status = ["LIMIT_FILE_SIZE", "LIMIT_FILE_COUNT", "LIMIT_FIELD_VALUE", "LIMIT_PART_COUNT"].includes(error.code)
        ? 413
        : 400;
      res.status(status).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof HttpError) {
      if (error.status === 429) res.setHeader("Retry-After", "3");
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof SyntaxError && "status" in error && error.status === 400) {
      res.status(400).json({ error: "Request JSON is invalid", code: "INVALID_JSON" });
      return;
    }
    console.error("PartyFrame server error:", error);
    res.status(500).json({ error: "Internal Server Error", code: "INTERNAL_ERROR" });
  });

  return {
    app,
    jobs,
    dataDir,
    uploadDir,
    exportDir,
    instanceId,
    startedAt,
    close: async () => jobs.close(),
  };
}
