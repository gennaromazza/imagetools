/**
 * Riduzione di qualità per la stampa. Il canvas da solo, passando per esempio da 5000 a 500 pixel,
 * crea grana finta e bordi a scaletta: qui si dimezza a passi e si finisce con un filtro Lanczos.
 */

const LOBES = 3;

function lanczos(x: number): number {
  if (x === 0) return 1;
  if (x <= -LOBES || x >= LOBES) return 0;
  const px = Math.PI * x;
  return (LOBES * Math.sin(px) * Math.sin(px / LOBES)) / (px * px);
}

interface Taps {
  start: number;
  weights: Float32Array;
}

function taps(sourceSize: number, targetSize: number): Taps[] {
  const ratio = sourceSize / targetSize;
  const stretch = Math.max(1, ratio);
  const radius = LOBES * stretch;
  return Array.from({ length: targetSize }, (_, index) => {
    const center = (index + 0.5) * ratio - 0.5;
    const start = Math.max(0, Math.ceil(center - radius));
    const end = Math.min(sourceSize - 1, Math.floor(center + radius));
    const weights = new Float32Array(end - start + 1);
    let sum = 0;
    for (let i = 0; i < weights.length; i += 1) {
      weights[i] = lanczos((start + i - center) / stretch);
      sum += weights[i];
    }
    for (let i = 0; i < weights.length; i += 1) weights[i] /= sum;
    return { start, weights };
  });
}

/** Ridimensiona pixel RGBA con due passate separate (prima in orizzontale, poi in verticale). */
export function resampleRgba(
  source: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
): Uint8ClampedArray<ArrayBuffer> {
  const horizontal = taps(sourceWidth, width);
  const vertical = taps(sourceHeight, height);
  const middle = new Float32Array(width * sourceHeight * 4);

  for (let y = 0; y < sourceHeight; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const { start, weights } = horizontal[x];
      let r = 0, g = 0, b = 0, a = 0;
      for (let i = 0; i < weights.length; i += 1) {
        const offset = (y * sourceWidth + start + i) * 4;
        r += source[offset] * weights[i];
        g += source[offset + 1] * weights[i];
        b += source[offset + 2] * weights[i];
        a += source[offset + 3] * weights[i];
      }
      const out = (y * width + x) * 4;
      middle[out] = r;
      middle[out + 1] = g;
      middle[out + 2] = b;
      middle[out + 3] = a;
    }
  }

  const result = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const { start, weights } = vertical[y];
    for (let x = 0; x < width; x += 1) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let i = 0; i < weights.length; i += 1) {
        const offset = ((start + i) * width + x) * 4;
        r += middle[offset] * weights[i];
        g += middle[offset + 1] * weights[i];
        b += middle[offset + 2] * weights[i];
        a += middle[offset + 3] * weights[i];
      }
      const out = (y * width + x) * 4;
      result[out] = r;
      result[out + 1] = g;
      result[out + 2] = b;
      result[out + 3] = a;
    }
  }
  return result;
}

function createCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: false });
  if (!context) throw new Error("Canvas 2D non disponibile.");
  context.imageSmoothingQuality = "high";
  return [canvas, context];
}

/** Oltre questa misura la riduzione è piccola e il filtro del canvas basta; Lanczos costerebbe troppa memoria. */
const LANCZOS_MAX_PIXELS = 6_000_000;

/** Riduce un'intera immagine alla misura richiesta. Il chiamante libera il canvas restituito. */
export function downscaleImage(image: ImageBitmap, width: number, height: number): HTMLCanvasElement {
  let source: CanvasImageSource = image;
  let sourceWidth = image.width;
  let sourceHeight = image.height;
  let previous: HTMLCanvasElement | null = null;
  const release = () => {
    if (previous) previous.width = previous.height = 1;
  };

  // Dimezzamenti finché si resta sopra la misura finale: al filtro arriva un rapporto tra 1 e 2.
  while (sourceWidth / 2 >= width * 1.15 && sourceHeight / 2 >= height * 1.15) {
    const [canvas, context] = createCanvas(Math.round(sourceWidth / 2), Math.round(sourceHeight / 2));
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    release();
    previous = canvas;
    source = canvas;
    sourceWidth = canvas.width;
    sourceHeight = canvas.height;
  }

  if (width * height > LANCZOS_MAX_PIXELS) {
    const [large, largeContext] = createCanvas(width, height);
    largeContext.drawImage(source, 0, 0, width, height);
    release();
    return large;
  }

  const [input, inputContext] = createCanvas(sourceWidth, sourceHeight);
  inputContext.drawImage(source, 0, 0);
  release();
  const pixels = inputContext.getImageData(0, 0, sourceWidth, sourceHeight).data;
  input.width = input.height = 1;

  const [output, outputContext] = createCanvas(width, height);
  outputContext.putImageData(new ImageData(resampleRgba(pixels, sourceWidth, sourceHeight, width, height), width, height), 0, 0);
  return output;
}
