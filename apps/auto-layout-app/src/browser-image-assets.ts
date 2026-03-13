import type { ImageAsset } from "@photo-tools/shared-types";

const SUPPORTED_EXTENSIONS = [".jpg", ".jpeg", ".png"];

type BrowserFile = File & {
  webkitRelativePath: string;
};

function hasSupportedExtension(fileName: string): boolean {
  const lowerFileName = fileName.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((extension) => lowerFileName.endsWith(extension));
}

function detectOrientation(width: number, height: number): ImageAsset["orientation"] {
  if (width === height) {
    return "square";
  }

  return height > width ? "vertical" : "horizontal";
}

function sanitizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight
      });
      URL.revokeObjectURL(objectUrl);
    };

    image.onerror = () => {
      reject(new Error(`Impossibile leggere le dimensioni dell'immagine ${file.name}.`));
      URL.revokeObjectURL(objectUrl);
    };

    image.src = objectUrl;
  });
}

export async function loadImageAssetsFromFiles(files: File[]): Promise<ImageAsset[]> {
  const supportedFiles = files.filter((file) => hasSupportedExtension(file.name));

  const assets = await Promise.all(
    supportedFiles.map(async (file) => {
      const browserFile = file as BrowserFile;
      const { width, height } = await readImageDimensions(file);
      const relativePath = browserFile.webkitRelativePath || file.name;
      const objectUrl = URL.createObjectURL(file);

      return {
        id: sanitizeId(relativePath),
        fileName: file.name,
        path: relativePath,
        width,
        height,
        orientation: detectOrientation(width, height),
        aspectRatio: width / height,
        previewUrl: objectUrl,
        sourceUrl: objectUrl
      } satisfies ImageAsset;
    })
  );

  return assets.sort((left, right) => left.fileName.localeCompare(right.fileName));
}

export function inferFolderLabelFromFiles(files: File[]): string {
  const firstFile = files[0] as BrowserFile | undefined;

  if (!firstFile) {
    return "";
  }

  if (firstFile.webkitRelativePath) {
    return firstFile.webkitRelativePath.split("/")[0];
  }

  return `${files.length} file selezionati`;
}
