import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { get } from "node:https";
import { basename, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import type { DesktopIdPhotoBackgroundRequest, DesktopIdPhotoBackgroundResult } from "@photo-tools/desktop-contracts";

export const ID_PHOTO_BACKGROUND_MODEL = {
  version: "birefnet-general-tiny-v1",
  fileName: "BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx",
  url: "https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx",
  size: 224_005_088,
  sha256: "5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333",
  license: "MIT",
} as const;

let sessionPromise: Promise<ort.InferenceSession> | null = null;

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function download(url: string, destination: string, redirects = 0): Promise<void> {
  return new Promise((accept, reject) => {
    const request = get(url, { headers: { "User-Agent": "FileX-ID-Photo" } }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (redirects >= 5) return reject(new Error("Troppi reindirizzamenti durante il download del modello."));
        download(response.headers.location, destination, redirects + 1).then(accept, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download del modello non riuscito (${response.statusCode ?? "nessuna risposta"}).`));
        return;
      }
      pipeline(response, createWriteStream(destination, { flags: "wx" })).then(accept, reject);
    });
    request.on("error", reject);
  });
}

async function ensureModel(modelDirectory: string): Promise<string> {
  await mkdir(modelDirectory, { recursive: true });
  const target = join(modelDirectory, ID_PHOTO_BACKGROUND_MODEL.fileName);
  const existing = await stat(target).catch(() => null);
  if (existing?.size === ID_PHOTO_BACKGROUND_MODEL.size && await sha256(target) === ID_PHOTO_BACKGROUND_MODEL.sha256) return target;
  if (existing) await rm(target, { force: true });
  const temporary = `${target}.download`;
  await rm(temporary, { force: true });
  try {
    await download(ID_PHOTO_BACKGROUND_MODEL.url, temporary);
    const downloaded = await stat(temporary);
    if (downloaded.size !== ID_PHOTO_BACKGROUND_MODEL.size || await sha256(temporary) !== ID_PHOTO_BACKGROUND_MODEL.sha256) {
      throw new Error("Il modello scaricato non supera la verifica SHA-256.");
    }
    await rename(temporary, target);
    return target;
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function getSession(modelDirectory: string): Promise<ort.InferenceSession> {
  sessionPromise ??= ensureModel(modelDirectory).then((modelPath) => ort.InferenceSession.create(modelPath, {
    executionProviders: process.platform === "win32" ? ["dml", "cpu"] : ["cpu"],
    graphOptimizationLevel: "all",
  })).catch((error) => {
    sessionPromise = null;
    throw error;
  });
  return sessionPromise;
}

function safeJobId(value: string): string {
  const normalized = value.replace(/[^a-z0-9_-]/gi, "-").slice(0, 80);
  if (!normalized) throw new Error("Identificatore commessa non valido.");
  return normalized;
}

function parseColor(value: string): [number, number, number] {
  if (!/^#[0-9a-f]{6}$/i.test(value)) return [255, 255, 255];
  return [Number.parseInt(value.slice(1, 3), 16), Number.parseInt(value.slice(3, 5), 16), Number.parseInt(value.slice(5, 7), 16)];
}

export async function processIdPhotoBackground(
  dataRoot: string,
  request: DesktopIdPhotoBackgroundRequest,
): Promise<DesktopIdPhotoBackgroundResult> {
  if (request.mode !== "uniform" && request.mode !== "replace") throw new Error("Modalità sfondo non valida.");
  const sourcePath = resolve(request.sourcePath);
  const metadata = await sharp(sourcePath, { failOn: "error", limitInputPixels: 80_000_000 }).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Dimensioni della fotografia non disponibili.");
  const input = await sharp(sourcePath).rotate().resize(1024, 1024, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const tensor = new Float32Array(3 * 1024 * 1024);
  const means = [0.485, 0.456, 0.406];
  const deviations = [0.229, 0.224, 0.225];
  for (let pixel = 0; pixel < 1024 * 1024; pixel += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      tensor[channel * 1024 * 1024 + pixel] = (input[pixel * 3 + channel] / 255 - means[channel]) / deviations[channel];
    }
  }
  const session = await getSession(join(dataRoot, "models"));
  const output = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", tensor, [1, 3, 1024, 1024]) });
  const rawPrediction = output[session.outputNames[0]].data as Float32Array;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const value of rawPrediction) { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
  const mask = Buffer.alloc(1024 * 1024);
  const range = Math.max(1e-6, maximum - minimum);
  for (let index = 0; index < mask.length; index += 1) {
    const normalized = Math.max(0, Math.min(1, (rawPrediction[index] - minimum) / range));
    mask[index] = Math.round(normalized * 255);
  }
  const orientedMetadata = await sharp(sourcePath).rotate().metadata();
  const width = orientedMetadata.width ?? metadata.width;
  const height = orientedMetadata.height ?? metadata.height;
  const fullMask = await sharp(mask, { raw: { width: 1024, height: 1024, channels: 1 } })
    .resize(width, height, { kernel: "lanczos3" }).blur(0.45).png().toBuffer();
  const source = await sharp(sourcePath).rotate().removeAlpha().raw().toBuffer();
  const alpha = await sharp(fullMask).raw().toBuffer();
  const [red, green, blue] = parseColor(request.backgroundColor);
  const strength = request.mode === "replace" ? 1 : Math.max(0, Math.min(1, request.strength / 100));
  const composed = Buffer.alloc(source.length);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const backgroundWeight = (1 - alpha[pixel] / 255) * strength;
    composed[pixel * 3] = Math.round(source[pixel * 3] * (1 - backgroundWeight) + red * backgroundWeight);
    composed[pixel * 3 + 1] = Math.round(source[pixel * 3 + 1] * (1 - backgroundWeight) + green * backgroundWeight);
    composed[pixel * 3 + 2] = Math.round(source[pixel * 3 + 2] * (1 - backgroundWeight) + blue * backgroundWeight);
  }
  const jobDirectory = join(dataRoot, safeJobId(request.jobId), "background");
  await mkdir(jobDirectory, { recursive: true });
  const stem = basename(sourcePath).replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]/gi, "-").slice(0, 60) || "photo";
  const maskPath = join(jobDirectory, `${stem}-mask.png`);
  const processedPath = join(jobDirectory, `${stem}-background.png`);
  await writeFile(maskPath, fullMask);
  await sharp(composed, { raw: { width, height, channels: 3 } }).png().toFile(processedPath);
  return {
    status: "completed",
    processedPath,
    maskPath,
    maskSha256: await sha256(maskPath),
    modelVersion: ID_PHOTO_BACKGROUND_MODEL.version,
  };
}
