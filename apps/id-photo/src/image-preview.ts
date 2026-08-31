import { loadImage } from "./image-analysis";

export const ID_PHOTO_RAIL_THUMBNAIL_MAX_DIMENSION = 192;
export const ID_PHOTO_DETAIL_PREVIEW_MAX_DIMENSION = 1600;

export interface FittedPreviewSize {
  width: number;
  height: number;
}

export interface BrowserRenderedPreview extends FittedPreviewSize {
  blob: Blob;
  sourceWidth: number;
  sourceHeight: number;
}

export interface BrowserAssetPreviewResources extends BrowserRenderedPreview {
  sourceUrl: string;
  thumbnailUrl: string;
}

export interface DetailPreviewReference extends FittedPreviewSize {
  url: string;
}

export function withDetailPreview<Asset extends {
  sourceUrl: string;
  previewUrl: string;
  width: number;
  height: number;
}>(asset: Asset, detail: DetailPreviewReference): Asset {
  return {
    ...asset,
    sourceUrl: detail.url,
    previewUrl: detail.url,
    width: detail.width,
    height: detail.height,
  };
}

interface BrowserPreviewUrlApi {
  createObjectURL: (value: Blob) => string;
  revokeObjectURL: (url: string) => void;
}

interface BrowserPreviewDependencies {
  urlApi?: BrowserPreviewUrlApi;
  renderPreview?: (sourceUrl: string, maxDimension: number) => Promise<BrowserRenderedPreview>;
}

export function fitPreviewWithinBounds(
  sourceWidth: number,
  sourceHeight: number,
  maxDimension: number,
): FittedPreviewSize {
  if (
    !Number.isFinite(sourceWidth)
    || !Number.isFinite(sourceHeight)
    || !Number.isFinite(maxDimension)
    || sourceWidth <= 0
    || sourceHeight <= 0
    || maxDimension <= 0
  ) {
    throw new Error("Dimensioni anteprima non valide.");
  }

  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

export function collectDistinctBlobUrls(...urls: Array<string | null | undefined>): string[] {
  return Array.from(new Set(urls.filter((url): url is string => Boolean(url?.startsWith("blob:")))));
}

export function revokeBlobUrls(
  urls: Array<string | null | undefined>,
  revokeObjectURL: (url: string) => void = (url) => URL.revokeObjectURL(url),
): void {
  for (const url of collectDistinctBlobUrls(...urls)) {
    try {
      revokeObjectURL(url);
    } catch {
      // Best effort: un URL problematico non deve impedire il rilascio degli altri.
    }
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Impossibile creare l’anteprima ridotta."));
    }, mimeType, quality);
  });
}

export async function renderBrowserPreview(
  sourceUrl: string,
  maxDimension: number,
): Promise<BrowserRenderedPreview> {
  const image = await loadImage(sourceUrl);
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  const fitted = fitPreviewWithinBounds(sourceWidth, sourceHeight, maxDimension);
  const canvas = document.createElement("canvas");
  canvas.width = fitted.width;
  canvas.height = fitted.height;
  try {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas anteprima non disponibile.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, fitted.width, fitted.height);
    context.drawImage(image, 0, 0, fitted.width, fitted.height);
    const blob = await canvasToBlob(canvas, "image/jpeg", 0.86);
    return {
      blob,
      width: fitted.width,
      height: fitted.height,
      sourceWidth,
      sourceHeight,
    };
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}

export async function createBrowserAssetPreviewResources(
  file: Blob,
  maxDimension = ID_PHOTO_RAIL_THUMBNAIL_MAX_DIMENSION,
  dependencies: BrowserPreviewDependencies = {},
): Promise<BrowserAssetPreviewResources> {
  const urlApi = dependencies.urlApi ?? URL;
  const renderPreview = dependencies.renderPreview ?? renderBrowserPreview;
  const createdUrls: string[] = [];

  try {
    const sourceUrl = urlApi.createObjectURL(file);
    createdUrls.push(sourceUrl);
    const rendered = await renderPreview(sourceUrl, maxDimension);
    const thumbnailUrl = urlApi.createObjectURL(rendered.blob);
    createdUrls.push(thumbnailUrl);
    return { ...rendered, sourceUrl, thumbnailUrl };
  } catch (error) {
    revokeBlobUrls(createdUrls, (url) => urlApi.revokeObjectURL(url));
    throw error;
  }
}
