export interface PreviewOptions {
  maxDimension?: number;
  quality?: number;
}

export interface ImagePreview {
  url: string;
  width: number;
  height: number;
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file);

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Unable to decode image ${file.name}`));
    };

    image.src = objectUrl;
  });
}

export async function createCompressedPreview(
  file: File,
  options: PreviewOptions = {}
): Promise<ImagePreview> {
  const { maxDimension = 1800, quality = 0.76 } = options;
  const image = await loadImage(file);
  const largestSide = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = largestSide > maxDimension ? maxDimension / largestSide : 1;
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context is not available");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", quality);
  });

  if (!blob) {
    throw new Error(`Unable to create preview for ${file.name}`);
  }

  return {
    url: URL.createObjectURL(blob),
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
}

export async function createCompressedPreviewUrl(
  file: File,
  options: PreviewOptions = {}
): Promise<string> {
  return (await createCompressedPreview(file, options)).url;
}
