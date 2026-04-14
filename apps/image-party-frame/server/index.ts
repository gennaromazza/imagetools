import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import multer, { Multer } from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

dotenv.config({ path: path.join(process.cwd(), "server/.env") });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const dataDir = process.env.IMAGE_PARTY_FRAME_DATA_DIR
  ? path.resolve(process.env.IMAGE_PARTY_FRAME_DATA_DIR)
  : path.join(__dirname, "..");

const uploadDir = path.join(dataDir, "uploads");
const exportDir = path.join(dataDir, "exports");
[dataDir, uploadDir, exportDir].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(exportDir));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    cb(null, unique + path.extname(file.originalname));
  },
});

const upload: Multer = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
});
const processImageUpload = upload.fields([
  { name: "image", maxCount: 1 },
  { name: "templateBackgroundVertical", maxCount: 1 },
  { name: "templateBackgroundHorizontal", maxCount: 1 },
]);
const batchExportUpload = upload.fields([
  { name: "images", maxCount: 500 },
  { name: "templateBackgroundVertical", maxCount: 1 },
  { name: "templateBackgroundHorizontal", maxCount: 1 },
]);

interface TemplateConfig {
  name: string;
  width: number;
  height: number;
  dpi: number;
  frameLeftTop: number;
  frameRightBottom: number;
  photoAreaX: number;
  photoAreaY: number;
  photoAreaWidth: number;
  photoAreaHeight: number;
  photoBorderSize: number;
  photoBorderColor: string;
  frameImagePath?: string | null;
}

interface ProcessImageRequest {
  templateId: string;
  orientation?: "vertical" | "horizontal" | string;
  customTemplate?: string;
  positionX?: number | string;
  positionY?: number | string;
  zoom?: number | string;
  quality?: number | string;
  format?: "jpeg" | "png" | string;
}

interface BatchExportItem {
  id: string;
  originalName?: string;
  orientation?: "vertical" | "horizontal";
  crop?: {
    x?: number;
    y?: number;
    zoom?: number;
  };
}

interface CustomTemplateVariantPayload {
  widthPx: number;
  heightPx: number;
  dpi: number;
  photoAreaX: number;
  photoAreaY: number;
  photoAreaWidth: number;
  photoAreaHeight: number;
  borderSizePx?: number;
  borderColor?: string;
  backgroundFileName?: string;
}

interface CustomTemplatePayload {
  name?: string;
  variants: {
    vertical: CustomTemplateVariantPayload;
    horizontal: CustomTemplateVariantPayload;
  };
}

interface ExportResult {
  success: Array<{ id: string; filename: string; size: number }>;
  failed: Array<{ id: string; error: string }>;
  totalTime: number;
  outputDir: string;
}

function ensureAvailableOutputPath(filePath: string, overwrite: boolean): string {
  if (overwrite || !fs.existsSync(filePath)) {
    return filePath;
  }

  const parsed = path.parse(filePath);
  let counter = 1;
  let candidate = filePath;

  while (fs.existsSync(candidate)) {
    candidate = path.join(parsed.dir, `${parsed.name}_${String(counter).padStart(2, "0")}${parsed.ext}`);
    counter += 1;
  }

  return candidate;
}

const templates: Record<string, TemplateConfig> = {
  "classic-gold": {
    name: "Cornice Oro Classica",
    width: 1772,
    height: 1181,
    dpi: 300,
    frameLeftTop: 120,
    frameRightBottom: 95,
    photoAreaX: 120,
    photoAreaY: 95,
    photoAreaWidth: 1530,
    photoAreaHeight: 990,
    photoBorderSize: 0,
    photoBorderColor: "#ffffff",
    frameImagePath: null,
  },
  "modern-blue": {
    name: "Bordo Blu Moderno",
    width: 1959,
    height: 1307,
    dpi: 300,
    frameLeftTop: 150,
    frameRightBottom: 120,
    photoAreaX: 150,
    photoAreaY: 120,
    photoAreaWidth: 1659,
    photoAreaHeight: 1067,
    photoBorderSize: 0,
    photoBorderColor: "#ffffff",
  },
  floral: {
    name: "Cornice Floreale",
    width: 1772,
    height: 1181,
    dpi: 300,
    frameLeftTop: 140,
    frameRightBottom: 105,
    photoAreaX: 140,
    photoAreaY: 105,
    photoAreaWidth: 1492,
    photoAreaHeight: 971,
    photoBorderSize: 0,
    photoBorderColor: "#ffffff",
  },
};

function orientTemplate(template: TemplateConfig, orientation: "vertical" | "horizontal" = "horizontal"): TemplateConfig {
  if (orientation !== "vertical") {
    return template;
  }

  return {
    ...template,
    width: template.height,
    height: template.width,
    photoAreaX: template.height - (template.photoAreaY + template.photoAreaHeight),
    photoAreaY: template.photoAreaX,
    photoAreaWidth: template.photoAreaHeight,
    photoAreaHeight: template.photoAreaWidth,
  };
}

function sanitizeHexColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#([0-9a-fA-F]{6})$/.test(value) ? value : fallback;
}

function parseCustomTemplateVariant(rawVariant: unknown): CustomTemplateVariantPayload | null {
  if (!rawVariant || typeof rawVariant !== "object") {
    return null;
  }

  const parsed = rawVariant as Partial<CustomTemplateVariantPayload>;
  const widthPx = Math.max(1, Math.round(Number(parsed.widthPx)));
  const heightPx = Math.max(1, Math.round(Number(parsed.heightPx)));
  const photoAreaX = Math.max(0, Math.round(Number(parsed.photoAreaX)));
  const photoAreaY = Math.max(0, Math.round(Number(parsed.photoAreaY)));
  const photoAreaWidth = Math.max(1, Math.round(Number(parsed.photoAreaWidth)));
  const photoAreaHeight = Math.max(1, Math.round(Number(parsed.photoAreaHeight)));
  const borderSizePx = Math.max(0, Math.round(Number(parsed.borderSizePx) || 0));

  if (
    !Number.isFinite(widthPx) ||
    !Number.isFinite(heightPx) ||
    !Number.isFinite(photoAreaX) ||
    !Number.isFinite(photoAreaY) ||
    !Number.isFinite(photoAreaWidth) ||
    !Number.isFinite(photoAreaHeight)
  ) {
    return null;
  }

  const clampedPhotoAreaX = Math.min(photoAreaX, widthPx - 1);
  const clampedPhotoAreaY = Math.min(photoAreaY, heightPx - 1);
  const clampedPhotoAreaWidth = Math.min(photoAreaWidth, widthPx - clampedPhotoAreaX);
  const clampedPhotoAreaHeight = Math.min(photoAreaHeight, heightPx - clampedPhotoAreaY);
  const maxBorder = Math.max(0, Math.floor(Math.min(clampedPhotoAreaWidth, clampedPhotoAreaHeight) / 2) - 1);

  return {
    widthPx,
    heightPx,
    dpi: Math.max(72, Math.round(Number(parsed.dpi) || 300)),
    photoAreaX: clampedPhotoAreaX,
    photoAreaY: clampedPhotoAreaY,
    photoAreaWidth: clampedPhotoAreaWidth,
    photoAreaHeight: clampedPhotoAreaHeight,
    borderSizePx: Math.min(borderSizePx, maxBorder),
    borderColor: sanitizeHexColor(parsed.borderColor, "#ffffff"),
    backgroundFileName: typeof parsed.backgroundFileName === "string" ? parsed.backgroundFileName : undefined,
  };
}

function parseCustomTemplate(rawTemplate: unknown): CustomTemplatePayload | null {
  if (typeof rawTemplate !== "string" || !rawTemplate.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawTemplate) as Partial<CustomTemplatePayload>;
    const vertical = parseCustomTemplateVariant(parsed.variants?.vertical);
    const horizontal = parseCustomTemplateVariant(parsed.variants?.horizontal);

    if (!vertical || !horizontal) {
      return null;
    }

    return {
      name: typeof parsed.name === "string" ? parsed.name : "Template Custom",
      variants: {
        vertical,
        horizontal,
      },
    };
  } catch (error) {
    console.warn("Failed to parse custom template:", error);
    return null;
  }
}

function toTemplateConfig(
  customTemplate: CustomTemplatePayload,
  orientation: "vertical" | "horizontal",
  backgroundPaths?: Partial<Record<"vertical" | "horizontal", string | undefined>>
): TemplateConfig {
  const variant = customTemplate.variants[orientation];
  return {
    name: customTemplate.name || "Template Custom",
    width: variant.widthPx,
    height: variant.heightPx,
    dpi: variant.dpi,
    frameLeftTop: 0,
    frameRightBottom: 0,
    photoAreaX: variant.photoAreaX,
    photoAreaY: variant.photoAreaY,
    photoAreaWidth: variant.photoAreaWidth,
    photoAreaHeight: variant.photoAreaHeight,
    photoBorderSize: variant.borderSizePx ?? 0,
    photoBorderColor: variant.borderColor ?? "#ffffff",
    frameImagePath: backgroundPaths?.[orientation] || null,
  };
}

function parseNumber(value: number | string | undefined, fallback: number): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(parsed) ? Number(parsed) : fallback;
}

function clampQuality(value: number | string | undefined, fallback: number): number {
  return Math.min(100, Math.max(60, Math.round(parseNumber(value, fallback))));
}

function resolveFormat(value: unknown): "jpeg" | "png" {
  return value === "png" ? "png" : "jpeg";
}

function cleanupTempFile(filePath?: string): void {
  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }

  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    console.warn(`Failed to cleanup temp file ${filePath}:`, error);
  }
}

function sanitizeSegment(value: string, fallback: string): string {
  const sanitized = value.trim().replace(/[<>:\"/\\\\|?*]+/g, "-").replace(/\s+/g, "_");
  return sanitized || fallback;
}

function resolveOutputDir(outputPath?: string, projectName?: string, createSubfolder?: boolean): string {
  const trimmedOutputPath = outputPath?.trim();
  const baseDir = trimmedOutputPath ? path.resolve(trimmedOutputPath) : exportDir;
  const finalDir = createSubfolder
    ? path.join(
        baseDir,
        `${sanitizeSegment(projectName || "Project", "Project")}_${new Date()
          .toISOString()
          .slice(0, 19)
          .replace(/[:T]/g, "-")}`
      )
    : baseDir;

  fs.mkdirSync(finalDir, { recursive: true });
  return finalDir;
}

function buildOutputFilename({
  item,
  pattern,
  projectName,
  index,
  format,
}: {
  item: BatchExportItem;
  pattern: string;
  projectName?: string;
  index: number;
  format: "jpeg" | "png";
}): string {
  const originalBase = sanitizeSegment(
    path.parse(item.originalName || item.id || `image_${index + 1}`).name,
    `image_${index + 1}`
  );
  const template = pattern || "original_frame";
  const resolved = template
    .replace(/\{originale\}/g, originalBase)
    .replace(/\{progetto\}/g, sanitizeSegment(projectName || "Project", "Project"))
    .replace(/\{contatore\}/g, String(index + 1).padStart(3, "0"))
    .replace(/\{data\}/g, new Date().toISOString().slice(0, 10))
    .replace(/^original_frame$/g, `${originalBase}_frame`);

  const basename = sanitizeSegment(resolved, `${originalBase}_frame`);
  return `${basename}.${format === "png" ? "png" : "jpg"}`;
}

async function buildPhotoAreaBuffer(
  imagePath: string,
  template: TemplateConfig,
  positionX: number,
  positionY: number,
  zoom: number
): Promise<Buffer> {
  const innerPhotoWidth = Math.max(1, template.photoAreaWidth - template.photoBorderSize * 2);
  const innerPhotoHeight = Math.max(1, template.photoAreaHeight - template.photoBorderSize * 2);
  const metadata = await sharp(imagePath).metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error("Could not read image dimensions");
  }

  const baseScale = Math.max(
    innerPhotoWidth / metadata.width,
    innerPhotoHeight / metadata.height
  );
  const zoomFactor = Math.max(0.5, zoom / 100);
  const scaledWidth = Math.max(
    innerPhotoWidth,
    Math.round(metadata.width * baseScale * zoomFactor)
  );
  const scaledHeight = Math.max(
    innerPhotoHeight,
    Math.round(metadata.height * baseScale * zoomFactor)
  );
  const centeredLeft = Math.round((scaledWidth - innerPhotoWidth) / 2);
  const centeredTop = Math.round((scaledHeight - innerPhotoHeight) / 2);
  const extractLeft = Math.max(
    0,
    Math.min(scaledWidth - innerPhotoWidth, centeredLeft - Math.round(positionX))
  );
  const extractTop = Math.max(
    0,
    Math.min(scaledHeight - innerPhotoHeight, centeredTop - Math.round(positionY))
  );

  return sharp(imagePath)
    .rotate()
    .resize(scaledWidth, scaledHeight)
    .extract({
      left: extractLeft,
      top: extractTop,
      width: innerPhotoWidth,
      height: innerPhotoHeight,
    })
    .png()
    .toBuffer();
}

async function renderFramedImage({
  imagePath,
  template,
  outputPath,
  positionX = 0,
  positionY = 0,
  zoom = 100,
  quality = 95,
  format = "jpeg",
}: {
  imagePath: string;
  template: TemplateConfig;
  outputPath: string;
  positionX?: number;
  positionY?: number;
  zoom?: number;
  quality?: number;
  format?: "jpeg" | "png";
}) {
  const frameBuffer = template.frameImagePath
    ? await sharp(template.frameImagePath)
        .rotate()
        .resize(template.width, template.height, { fit: "cover" })
        .png()
        .toBuffer()
    : await sharp({
        create: {
          width: template.width,
          height: template.height,
          channels: 4,
          background:
            template.frameLeftTop === 0 && template.frameRightBottom === 0
              ? { r: 28, g: 28, b: 28, alpha: 1 }
              : { r: 220, g: 180, b: 100, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

  const photoAreaBuffer = await buildPhotoAreaBuffer(
    imagePath,
    template,
    positionX,
    positionY,
    zoom
  );

  const borderedPhotoBuffer =
    template.photoBorderSize > 0
      ? await sharp({
          create: {
            width: template.photoAreaWidth,
            height: template.photoAreaHeight,
            channels: 4,
            background: template.photoBorderColor,
          },
        })
          .composite([
            {
              input: photoAreaBuffer,
              left: template.photoBorderSize,
              top: template.photoBorderSize,
            },
          ])
          .png()
          .toBuffer()
      : photoAreaBuffer;

  const output = sharp(frameBuffer).composite([
    {
      input: borderedPhotoBuffer,
      left: template.photoAreaX,
      top: template.photoAreaY,
    },
  ]);

  if (format === "png") {
    return output.png().toFile(outputPath);
  }

  return output.jpeg({ quality }).toFile(outputPath);
}

app.get("/api/templates", (_req: Request, res: Response) => {
  res.json({
    templates: Object.entries(templates).map(([key, value]) => ({
      id: key,
      name: value.name,
      width: value.width,
      height: value.height,
      dpi: value.dpi,
    })),
  });
});

app.post(
  "/api/process-image",
  processImageUpload,
  async (req: Request, res: Response): Promise<void> => {
    const uploadedFields = req.files as Record<string, Express.Multer.File[]> | undefined;
    const uploadedFile = uploadedFields?.image?.[0];
    const templateBackgroundFiles = {
      vertical: uploadedFields?.templateBackgroundVertical?.[0],
      horizontal: uploadedFields?.templateBackgroundHorizontal?.[0],
    };

    try {
      const { templateId, positionX, positionY, zoom, quality, format, orientation, customTemplate: rawCustomTemplate } =
        req.body as ProcessImageRequest;
      const customTemplate = parseCustomTemplate(rawCustomTemplate);
      const requestedOrientation = orientation === "vertical" ? "vertical" : "horizontal";
      const outputFormat = resolveFormat(format);
      const outputQuality = clampQuality(quality, 82);
      const baseTemplate =
        templateId === "custom" && customTemplate
          ? toTemplateConfig(customTemplate, requestedOrientation, {
              vertical: templateBackgroundFiles.vertical?.path,
              horizontal: templateBackgroundFiles.horizontal?.path,
            })
          : templates[templateId];
      const template =
        templateId === "custom"
          ? baseTemplate
          : baseTemplate
            ? orientTemplate(baseTemplate, orientation === "vertical" ? "vertical" : "horizontal")
            : undefined;

      if (!template || !uploadedFile) {
        res.status(400).json({ error: "Invalid template or no image" });
        return;
      }

      const outputFilename = `processed_${Date.now()}.${outputFormat === "png" ? "png" : "jpg"}`;
      const outputPath = path.join(exportDir, outputFilename);
      const finalImage = await renderFramedImage({
        imagePath: uploadedFile.path,
        template,
        outputPath,
        positionX: parseNumber(positionX, 0),
        positionY: parseNumber(positionY, 0),
        zoom: parseNumber(zoom, 100),
        quality: outputQuality,
        format: outputFormat,
      });

      res.json({
        success: true,
        imageUrl: `/${outputFilename}`,
        path: outputPath,
        size: finalImage.size,
      });
    } catch (error) {
      console.error("Error processing image:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      cleanupTempFile(uploadedFile?.path);
      cleanupTempFile(templateBackgroundFiles.vertical?.path);
      cleanupTempFile(templateBackgroundFiles.horizontal?.path);
    }
  }
);

app.post(
  "/api/batch-export",
  batchExportUpload,
  async (req: Request, res: Response): Promise<void> => {
    const uploadedFields = (req.files as Record<string, Express.Multer.File[]>) || {};
    const uploadedFiles = uploadedFields.images || [];
    const templateBackgroundFiles = {
      vertical: uploadedFields.templateBackgroundVertical?.[0],
      horizontal: uploadedFields.templateBackgroundHorizontal?.[0],
    };

    try {
      const {
        templateId,
        quality,
        format,
        colorProfile,
        namingPattern,
        projectName,
        outputPath,
        createSubfolder,
        embedColorProfile,
        overwrite,
        items: rawItems,
      } = req.body as {
        templateId: string;
        quality?: number | string;
        format?: "jpeg" | "png" | string;
        colorProfile?: "sRGB" | "AdobeRGB" | string;
        namingPattern?: string;
        projectName?: string;
        outputPath?: string;
        createSubfolder?: string;
        embedColorProfile?: string;
        overwrite?: string;
        items?: string;
        customTemplate?: string;
      };

      const customTemplate = parseCustomTemplate(req.body.customTemplate);
      const baseTemplate = templateId === "custom" ? null : templates[templateId];
      const exportFormat = resolveFormat(format);
      const exportQuality = clampQuality(quality, 100);
      const items = rawItems ? (JSON.parse(String(rawItems)) as BatchExportItem[]) : [];
      const finalOutputDir = resolveOutputDir(outputPath, projectName, createSubfolder !== "false");
      const shouldOverwrite = String(overwrite) === "true";

      if (templateId === "custom" ? !customTemplate : !baseTemplate) {
        res.status(400).json({ error: "Invalid template" });
        return;
      }

      if (uploadedFiles.length === 0 || items.length !== uploadedFiles.length) {
        res.status(400).json({ error: "Invalid export payload" });
        return;
      }

      const results: ExportResult = {
        success: [],
        failed: [],
        totalTime: 0,
        outputDir: finalOutputDir,
      };

      const startTime = Date.now();

      for (const [index, file] of uploadedFiles.entries()) {
        const item = items[index];

        try {
          const template =
            templateId === "custom"
              ? customTemplate
                ? toTemplateConfig(customTemplate, item?.orientation === "vertical" ? "vertical" : "horizontal", {
                    vertical: templateBackgroundFiles.vertical?.path,
                    horizontal: templateBackgroundFiles.horizontal?.path,
                  })
                : null
              : orientTemplate(baseTemplate!, item?.orientation === "vertical" ? "vertical" : "horizontal");
          if (!template) {
            throw new Error("Invalid custom template");
          }
          const outputFilename = buildOutputFilename({
            item,
            pattern: namingPattern || "original_frame",
            projectName,
            index,
            format: exportFormat,
          });
          const outputPath = ensureAvailableOutputPath(path.join(finalOutputDir, outputFilename), shouldOverwrite);
          const result = await renderFramedImage({
            imagePath: file.path,
            template,
            outputPath,
            positionX: parseNumber(item.crop?.x, 0),
            positionY: parseNumber(item.crop?.y, 0),
            zoom: parseNumber(item.crop?.zoom, 100),
            quality: exportQuality,
            format: exportFormat,
          });

          if (String(embedColorProfile) === "true" && colorProfile === "AdobeRGB") {
            // Placeholder for future ICC embedding support; current flow keeps the file and reports success.
          }

          results.success.push({
            id: item.id,
            filename: path.basename(outputPath),
            size: result.size,
          });
        } catch (error) {
          results.failed.push({
            id: item?.id || `item_${index + 1}`,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      results.totalTime = Date.now() - startTime;
      res.json(results);
    } catch (error) {
      console.error("Error in batch export:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      uploadedFiles.forEach((file) => cleanupTempFile(file.path));
      cleanupTempFile(templateBackgroundFiles.vertical?.path);
      cleanupTempFile(templateBackgroundFiles.horizontal?.path);
    }
  }
);

app.post("/api/open-folder", (req: Request, res: Response) => {
  const requestedPath = typeof req.body?.folderPath === "string" && req.body.folderPath.trim() ? req.body.folderPath : exportDir;
  const finalPath = path.resolve(requestedPath);

  if (!fs.existsSync(finalPath)) {
    res.status(404).json({ error: "Folder not found" });
    return;
  }

  try {
    if (process.platform === "win32") {
      spawn("cmd.exe", ["/c", "start", "", finalPath], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [finalPath], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [finalPath], { detached: true, stdio: "ignore" }).unref();
    }

    res.json({ success: true, path: finalPath });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to open folder",
    });
  }
});

app.post("/api/pick-folder", (req: Request, res: Response) => {
  if (process.platform !== "win32") {
    res.status(501).json({ error: "Folder picker is currently implemented only for Windows" });
    return;
  }

  const initialPath =
    typeof req.body?.initialPath === "string" && req.body.initialPath.trim()
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

  const child = spawn("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
    windowsHide: true,
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  child.on("close", (code) => {
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

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({
    error: err.message || "Internal Server Error",
  });
});

const server = app.listen(PORT, () => {
  console.log(`
+----------------------------------------+
|  Image Party Frame - API Server        |
|  Running on http://localhost:${PORT}     |
+----------------------------------------+
  `);
});

process.on("SIGINT", () => {
  console.log("Shutting down gracefully...");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});
