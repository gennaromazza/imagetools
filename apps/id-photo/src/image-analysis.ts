import type { ImageMetrics, NormalizedCrop } from "./domain";

export function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Immagine non leggibile."));
    image.src = source;
  });
}

export function bytesToObjectUrl(bytes: Uint8Array, mimeType: string): string {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return URL.createObjectURL(new Blob([buffer], { type: mimeType }));
}

function luma(data: Uint8ClampedArray, offset: number): number {
  return data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
}

export async function analyzeImage(
  source: string,
  originalWidth: number,
  originalHeight: number,
  crop?: NormalizedCrop | null,
  adjustments?: { brightness?: number; contrast?: number },
): Promise<ImageMetrics> {
  const image = await loadImage(source);
  const maxEdge = 420;
  const cropLeft = Math.max(0, Math.min(1, crop?.cropLeft ?? 0));
  const cropTop = Math.max(0, Math.min(1, crop?.cropTop ?? 0));
  const cropWidth = Math.max(0.001, Math.min(1 - cropLeft, crop?.cropWidth ?? 1));
  const cropHeight = Math.max(0.001, Math.min(1 - cropTop, crop?.cropHeight ?? 1));
  const sourceWidth = Math.max(1, image.naturalWidth * cropWidth);
  const sourceHeight = Math.max(1, image.naturalHeight * cropHeight);
  const normalizedRotation = (((crop?.rotation ?? 0) % 360) + 360) % 360;
  const quarterTurn = Math.abs(normalizedRotation - 90) < 0.001 || Math.abs(normalizedRotation - 270) < 0.001;
  const rotatedWidth = quarterTurn ? sourceHeight : sourceWidth;
  const rotatedHeight = quarterTurn ? sourceWidth : sourceHeight;
  const scale = Math.min(1, maxEdge / Math.max(rotatedWidth, rotatedHeight, 1));
  const width = Math.max(2, Math.round(rotatedWidth * scale));
  const height = Math.max(2, Math.round(rotatedHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Analisi canvas non disponibile.");
  context.save();
  const filters: string[] = [];
  if (adjustments?.brightness) filters.push(`brightness(${Math.max(0.5, Math.min(1.5, 1 + adjustments.brightness / 100))})`);
  if (adjustments?.contrast) filters.push(`contrast(${Math.max(0.5, Math.min(1.5, 1 + adjustments.contrast / 100))})`);
  if (filters.length) context.filter = filters.join(" ");
  context.translate(width / 2, height / 2);
  context.rotate((normalizedRotation * Math.PI) / 180);
  const drawWidth = Math.max(1, sourceWidth * scale);
  const drawHeight = Math.max(1, sourceHeight * scale);
  context.drawImage(
    image,
    cropLeft * image.naturalWidth,
    cropTop * image.naturalHeight,
    sourceWidth,
    sourceHeight,
    -drawWidth / 2,
    -drawHeight / 2,
    drawWidth,
    drawHeight,
  );
  context.restore();
  const data = context.getImageData(0, 0, width, height).data;
  let sum = 0;
  let sumSquared = 0;
  let sharpnessSum = 0;
  let sharpnessSamples = 0;
  const borderLumas: number[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const value = luma(data, offset);
      sum += value;
      sumSquared += value * value;
      if (x > 0) {
        sharpnessSum += Math.abs(value - luma(data, offset - 4));
        sharpnessSamples += 1;
      }
      if (x < width * 0.14 || x > width * 0.86 || y < height * 0.1) borderLumas.push(value);
    }
  }

  const samples = width * height;
  const meanLuma = sum / samples;
  const contrast = Math.sqrt(Math.max(0, sumSquared / samples - meanLuma * meanLuma));
  const borderMean = borderLumas.reduce((total, value) => total + value, 0) / Math.max(1, borderLumas.length);
  const borderDeviation = borderLumas.reduce((total, value) => total + Math.abs(value - borderMean), 0) / Math.max(1, borderLumas.length);
  const backgroundUniformity = Math.max(0, Math.min(100, 100 - borderDeviation * 2.5));

  return {
    width: originalWidth,
    height: originalHeight,
    meanLuma,
    contrast,
    sharpness: (sharpnessSum / Math.max(1, sharpnessSamples)) * 8,
    backgroundUniformity,
  };
}
