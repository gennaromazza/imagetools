import {
  createDefaultCrop,
  getPhotoContentRectCm,
  normalizeCrop,
  type BatchCropState,
  type PhotoAsset,
  type PhotoFitMode,
  type PhotoPrintSpec,
} from "../print-engine";

export function getZoomFromCrop(
  crop: BatchCropState,
  asset: PhotoAsset,
  printSpec: PhotoPrintSpec,
  fitMode: PhotoFitMode,
  autoRotateBySourceOrientation: boolean,
): number {
  const defaultCrop = createDefaultCrop(asset, printSpec, fitMode, autoRotateBySourceOrientation);
  const area = Math.max(0.0001, crop.cropWidth * crop.cropHeight);
  const defaultArea = Math.max(0.0001, defaultCrop.cropWidth * defaultCrop.cropHeight);
  return Math.max(1, Math.sqrt(defaultArea / area));
}

export function applyZoomToCrop(
  crop: BatchCropState,
  asset: PhotoAsset,
  printSpec: PhotoPrintSpec,
  fitMode: PhotoFitMode,
  autoRotateBySourceOrientation: boolean,
  zoom: number,
): BatchCropState {
  const defaultCrop = createDefaultCrop(asset, printSpec, fitMode, autoRotateBySourceOrientation);
  const centerX = crop.cropLeft + crop.cropWidth / 2;
  const centerY = crop.cropTop + crop.cropHeight / 2;
  const width = defaultCrop.cropWidth / Math.max(1, zoom);
  const height = defaultCrop.cropHeight / Math.max(1, zoom);
  return normalizeCrop({
    ...crop,
    cropLeft: centerX - width / 2,
    cropTop: centerY - height / 2,
    cropWidth: width,
    cropHeight: height,
  });
}

export function normalizeRotationDegrees(value: number): number {
  let next = value % 360;
  if (next > 180) next -= 360;
  if (next < -180) next += 360;
  return next;
}

/**
 * Chiave della geometria che determina il taglio automatico. Cambiare solo DPI
 * o foglio non la modifica, quindi i ritagli già fatti dall'utente restano.
 */
export function cropGeometryKey(spec: PhotoPrintSpec, fitMode: PhotoFitMode, autoRotate: boolean): string {
  const content = getPhotoContentRectCm(spec);
  const contentAspect = content.width / Math.max(0.001, content.height);
  const outerLandscape = spec.widthCm > spec.heightCm;
  return `${contentAspect.toFixed(6)}:${outerLandscape ? "landscape" : "portrait"}:${fitMode}:${autoRotate ? "rot" : "norot"}`;
}
