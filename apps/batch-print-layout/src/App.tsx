import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FolderOpen,
  ImagePlus,
  Info,
  Keyboard,
  MousePointer2,
  Printer,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import {
  calculateGridLayout,
  createDefaultCrop,
  getPhotoContentRectCm,
  getPreviewRenderDpi,
  normalizeCrop,
  paginateAssets,
  PHOTO_PRESETS,
  SHEET_PRESETS,
  type BatchCropState,
  type ExportFormat,
  type ImageAdjustmentSpec,
  type LogoOverlaySpec,
  type PhotoAsset,
  type PhotoFitMode,
  type PhotoPrintSpec,
  type PrintFinishingSpec,
  type PrintSheetSpec,
} from "./print-engine";
import { exportBatch, renderPageCanvas } from "./render-export";

const DEFAULT_PRINT_SPEC: PhotoPrintSpec = { widthCm: 6, heightCm: 7, dpi: 300 };
const DEFAULT_LOGO: LogoOverlaySpec = {
  enabled: false,
  imageUrl: null,
  position: "bottom-right",
  scalePct: 22,
  opacity: 0.82,
  marginPct: 4,
};
const DEFAULT_ADJUSTMENTS: ImageAdjustmentSpec = {
  blackAndWhiteEnabled: false,
  fitMode: "cover",
  autoRotateBySourceOrientation: false,
  borderEnabled: false,
  borderWidthPx: 2,
  borderColor: "#000000",
};
const DEFAULT_FINISHING: PrintFinishingSpec = {
  cutGuidesEnabled: false,
  cutGuideColor: "#777777",
  cutGuideWidthMm: 0.1,
};
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const KEYBOARD_STEP = 0.01;
const KEYBOARD_FAST_STEP = 0.04;
const DESKTOP_PREVIEW_CONCURRENCY = 8;

interface EditingWatchState {
  assetId: string;
  absolutePath: string;
  lastModified: number;
  size: number;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function loadBrowserImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Immagine non leggibile."));
    image.src = src;
  });
}

function bytesToObjectUrl(bytes: Uint8Array, mimeType: string): string {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return URL.createObjectURL(new Blob([buffer], { type: mimeType }));
}

function fileNameFromPath(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() || value;
}

function isExtendedDesktopImageName(fileName: string): boolean {
  return /\.(?:heic|heif|tif|tiff)$/i.test(fileName);
}

function revokeBlobUrl(value: string | null | undefined): void {
  if (value?.startsWith("blob:")) {
    URL.revokeObjectURL(value);
  }
}

function revokeAssetUrls(asset: PhotoAsset): void {
  revokeBlobUrl(asset.previewUrl);
  if (asset.sourceUrl !== asset.previewUrl) {
    revokeBlobUrl(asset.sourceUrl);
  }
}

async function fileToAsset(file: File): Promise<PhotoAsset | null> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return null;
  }
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await loadBrowserImage(sourceUrl);
    const absolutePath = window.filexDesktop?.getPathForFile?.(file) || undefined;
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const key = `${absolutePath || relativePath}:${file.size}:${file.lastModified}`;
    return {
      id: `asset-${hashString(key)}`,
      fileName: file.name,
      relativePath,
      absolutePath,
      size: file.size,
      lastModified: file.lastModified,
      sourceUrl,
      previewUrl: sourceUrl,
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  } catch (error) {
    URL.revokeObjectURL(sourceUrl);
    throw error;
  }
}

async function importDesktopFolder(onProgress?: (completed: number, total: number) => void): Promise<{
  assets: PhotoAsset[];
  folderName: string;
  nestedDirectoriesSeen: number;
  scannedDirectoryCount: number;
  failedPreviewCount: number;
  failedExtendedPreviewCount: number;
  cancelled: boolean;
}> {
  const folder = await window.filexDesktop?.openFolder?.({ includeExtendedImages: true });
  if (!folder) {
    return {
      assets: [],
      folderName: "",
      nestedDirectoriesSeen: 0,
      scannedDirectoryCount: 0,
      failedPreviewCount: 0,
      failedExtendedPreviewCount: 0,
      cancelled: true,
    };
  }

  const assets: Array<PhotoAsset | null> = new Array(folder.entries.length).fill(null);
  let nextIndex = 0;
  let completed = 0;
  let failedPreviewCount = 0;
  let failedExtendedPreviewCount = 0;

  const loadNextPreview = async () => {
    while (nextIndex < folder.entries.length) {
      const entryIndex = nextIndex;
      nextIndex += 1;
      const entry = folder.entries[entryIndex];
      try {
        const preview = await window.filexDesktop?.getPreview?.(entry.absolutePath, {
          maxDimension: 2400,
          sourceFileKey: `${entry.size}:${entry.lastModified}`,
        });
        if (!preview) {
          failedPreviewCount += 1;
          if (isExtendedDesktopImageName(entry.name)) failedExtendedPreviewCount += 1;
          continue;
        }
        const previewUrl = bytesToObjectUrl(preview.bytes, preview.mimeType);
        assets[entryIndex] = {
          id: `asset-${hashString(`${entry.absolutePath}:${entry.size}:${entry.lastModified}`)}`,
          fileName: entry.name,
          relativePath: entry.relativePath,
          absolutePath: entry.absolutePath,
          size: entry.size,
          lastModified: entry.lastModified,
          sourceUrl: previewUrl,
          previewUrl,
          width: preview.width,
          height: preview.height,
        };
      } catch {
        failedPreviewCount += 1;
        if (isExtendedDesktopImageName(entry.name)) failedExtendedPreviewCount += 1;
      } finally {
        completed += 1;
        onProgress?.(completed, folder.entries.length);
      }
    }
  };

  const workerCount = Math.min(DESKTOP_PREVIEW_CONCURRENCY, Math.max(1, folder.entries.length));
  await Promise.all(Array.from({ length: workerCount }, () => loadNextPreview()));

  return {
    assets: assets.filter((asset): asset is PhotoAsset => Boolean(asset)),
    folderName: folder.name,
    nestedDirectoriesSeen: folder.diagnostics?.nestedDirectoriesSeen ?? 0,
    scannedDirectoryCount: folder.diagnostics?.scannedDirectoryCount ?? 1,
    failedPreviewCount,
    failedExtendedPreviewCount,
    cancelled: false,
  };
}

function getZoomFromCrop(
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

function applyZoomToCrop(
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

function normalizeRotationDegrees(value: number): number {
  let next = value % 360;
  if (next > 180) next -= 360;
  if (next < -180) next += 360;
  return next;
}

function cropGeometryKey(spec: PhotoPrintSpec): string {
  const content = getPhotoContentRectCm(spec);
  const contentAspect = content.width / Math.max(0.001, content.height);
  const outerLandscape = spec.widthCm > spec.heightCm;
  return `${contentAspect.toFixed(6)}:${outerLandscape ? "landscape" : "portrait"}`;
}

export function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const assetsRef = useRef<PhotoAsset[]>([]);
  const logoUrlRef = useRef<string | null>(null);
  const previewRenderIdRef = useRef(0);
  const dragStateRef = useRef<{
    assetId: string;
    pointerId: number;
    startX: number;
    startY: number;
    initialCrop: BatchCropState;
    imageWidth: number;
    imageHeight: number;
  } | null>(null);
  const [assets, setAssets] = useState<PhotoAsset[]>([]);
  const [crops, setCrops] = useState<Record<string, BatchCropState>>({});
  const [printSpec, setPrintSpec] = useState<PhotoPrintSpec>(DEFAULT_PRINT_SPEC);
  const [photoPresetId, setPhotoPresetId] = useState("custom");
  const [sheetSpec, setSheetSpec] = useState<PrintSheetSpec>(SHEET_PRESETS[0]);
  const [logo, setLogo] = useState<LogoOverlaySpec>(DEFAULT_LOGO);
  const [adjustments, setAdjustments] = useState<ImageAdjustmentSpec>(DEFAULT_ADJUSTMENTS);
  const [finishing, setFinishing] = useState<PrintFinishingSpec>(DEFAULT_FINISHING);
  const [format, setFormat] = useState<ExportFormat>("jpg");
  const [quality, setQuality] = useState(1);
  const [fileNamePrefix, setFileNamePrefix] = useState("batch-print");
  const [outputDirectoryPath, setOutputDirectoryPath] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [previewPageIndex, setPreviewPageIndex] = useState(0);
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number } | null>(null);
  const [status, setStatus] = useState("Pronto");
  const [interactionHint, setInteractionHint] = useState("Doppio clic su una foto del foglio per modificarla.");
  const [editorPath, setEditorPath] = useState<string | null>(null);
  const [editingWatch, setEditingWatch] = useState<EditingWatchState | null>(null);
  const [isDraggingCrop, setIsDraggingCrop] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const layout = useMemo(() => calculateGridLayout(printSpec, sheetSpec), [printSpec, sheetSpec]);
  const pages = useMemo(() => paginateAssets(assets, layout), [assets, layout]);
  const assetsById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const cropsById = useMemo(() => new Map(Object.values(crops).map((crop) => [crop.assetId, crop])), [crops]);
  const activeAsset = assets[activeIndex] ?? null;
  const activeCrop = activeAsset ? crops[activeAsset.id] : null;
  const currentPage = pages[Math.min(previewPageIndex, Math.max(0, pages.length - 1))] ?? null;
  const zoom = activeAsset && activeCrop
    ? getZoomFromCrop(activeCrop, activeAsset, printSpec, adjustments.fitMode, adjustments.autoRotateBySourceOrientation)
    : 1;
  const reviewedCount = Object.values(crops).filter((crop) => crop.reviewed).length;

  useEffect(() => {
    setPreviewPageIndex((current) => Math.max(0, Math.min(current, Math.max(0, pages.length - 1))));
  }, [pages.length]);

  useEffect(() => {
    if (!fileInputRef.current) return;
    fileInputRef.current.setAttribute("webkitdirectory", "");
    fileInputRef.current.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  useEffect(() => {
    logoUrlRef.current = logo.imageUrl;
  }, [logo.imageUrl]);

  useEffect(() => {
    return () => {
      for (const asset of assetsRef.current) {
        revokeAssetUrls(asset);
      }
      revokeBlobUrl(logoUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (typeof window.filexDesktop?.getInstalledEditorCandidates !== "function") {
      return;
    }

    let active = true;
    void window.filexDesktop.getInstalledEditorCandidates().then((candidates) => {
      if (!active) return;
      const photoshop = candidates.find((candidate) => /photoshop/i.test(`${candidate.label} ${candidate.path}`));
      setEditorPath(photoshop?.path ?? null);
    }).catch(() => {
      if (active) setEditorPath(null);
    });

    return () => {
      active = false;
    };
  }, []);

  const resetCropsForAssets = useCallback((
    nextAssets: PhotoAsset[],
    nextPrintSpec = printSpec,
    nextFitMode = adjustments.fitMode,
    nextAutoRotate = adjustments.autoRotateBySourceOrientation,
  ) => {
    const nextCrops: Record<string, BatchCropState> = {};
    for (const asset of nextAssets) {
      nextCrops[asset.id] = createDefaultCrop(asset, nextPrintSpec, nextFitMode, nextAutoRotate);
    }
    setCrops(nextCrops);
  }, [adjustments.autoRotateBySourceOrientation, adjustments.fitMode, printSpec]);

  const handleAssetsImported = useCallback((nextAssets: PhotoAsset[]) => {
    for (const asset of assetsRef.current) {
      revokeAssetUrls(asset);
    }
    setAssets(nextAssets);
    resetCropsForAssets(nextAssets);
    setActiveIndex(0);
    setPreviewPageIndex(0);
    setStatus(nextAssets.length ? `${nextAssets.length} foto importate.` : "Nessuna foto importata.");
  }, [resetCropsForAssets]);

  const handleBrowseFolder = async () => {
    setIsBusy(true);
    setStatus("Importazione foto...");
    try {
      if (window.filexDesktop?.openFolder) {
        const result = await importDesktopFolder((completed, total) => {
          setStatus(`Anteprime desktop ${completed}/${total}...`);
        });
        if (result.cancelled) {
          setStatus("Importazione annullata. Le foto già caricate sono rimaste invariate.");
          return;
        }
        handleAssetsImported(result.assets);
        if (result.assets.length > 0) {
          const failureMessage = result.failedPreviewCount > 0
            ? ` ${result.failedPreviewCount} file non leggibili sono stati ignorati.`
            : "";
          const extendedDecoderHint = result.failedExtendedPreviewCount > 0
            ? " Per HEIC/HEIF/TIFF verifica la disponibilità dei codec immagini di Windows."
            : "";
          setStatus(
            `${result.assets.length} foto importate da ${result.folderName}.${failureMessage}${extendedDecoderHint} Scansione ricorsiva: ${result.scannedDirectoryCount} cartelle, ${result.nestedDirectoriesSeen} sottocartelle.`,
          );
        } else if (result.failedPreviewCount > 0) {
          const extendedDecoderHint = result.failedExtendedPreviewCount > 0
            ? " Per HEIC/HEIF/TIFF verifica la disponibilità dei codec immagini di Windows."
            : "";
          setStatus(`Nessuna foto leggibile: ${result.failedPreviewCount} file non sono stati decodificati.${extendedDecoderHint}`);
        }
      } else {
        fileInputRef.current?.click();
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Errore durante importazione.");
    } finally {
      setIsBusy(false);
    }
  };

  const handleFilesSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;

    setIsBusy(true);
    setStatus("Preparazione anteprime...");
    try {
      const settled = await Promise.allSettled(files.map(fileToAsset));
      const nextAssets = settled
        .filter((result): result is PromiseFulfilledResult<PhotoAsset | null> => result.status === "fulfilled")
        .map((result) => result.value)
        .filter((asset): asset is PhotoAsset => Boolean(asset));
      const skippedCount = files.length - nextAssets.length;
      handleAssetsImported(nextAssets);
      if (skippedCount > 0) {
        setStatus(`${nextAssets.length} foto importate; ${skippedCount} file non supportati o non leggibili ignorati.`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Errore durante lettura immagini.");
    } finally {
      setIsBusy(false);
    }
  };

  const updateActiveCrop = (changes: Partial<BatchCropState>) => {
    if (!activeAsset) return;
    setCrops((current) => {
      const currentCrop = current[activeAsset.id];
      if (!currentCrop) return current;
      return {
        ...current,
        [activeAsset.id]: normalizeCrop({ ...currentCrop, ...changes }),
      };
    });
  };

  const moveActiveCrop = useCallback((deltaX: number, deltaY: number) => {
    if (!activeAsset) return;
    setCrops((current) => {
      const currentCrop = current[activeAsset.id];
      if (!currentCrop) return current;
      return {
        ...current,
        [activeAsset.id]: normalizeCrop({
          ...currentCrop,
          cropLeft: currentCrop.cropLeft + deltaX,
          cropTop: currentCrop.cropTop + deltaY,
        }),
      };
    });
  }, [activeAsset]);

  const setActiveZoom = useCallback((nextZoom: number) => {
    if (!activeAsset) return;
    setCrops((current) => {
      const currentCrop = current[activeAsset.id];
      if (!currentCrop) return current;
      return {
        ...current,
        [activeAsset.id]: applyZoomToCrop(
          currentCrop,
          activeAsset,
          printSpec,
          adjustments.fitMode,
          adjustments.autoRotateBySourceOrientation,
          nextZoom,
        ),
      };
    });
  }, [activeAsset, adjustments.autoRotateBySourceOrientation, adjustments.fitMode, printSpec]);

  const resetActiveCrop = useCallback(() => {
    if (!activeAsset) return;
    setCrops((current) => ({
      ...current,
      [activeAsset.id]: createDefaultCrop(activeAsset, printSpec, adjustments.fitMode, adjustments.autoRotateBySourceOrientation),
    }));
    setInteractionHint("Crop resettato sul taglio automatico.");
  }, [activeAsset, adjustments.autoRotateBySourceOrientation, adjustments.fitMode, printSpec]);

  const rotateActiveCrop = useCallback(() => {
    if (!activeAsset) return;
    setCrops((current) => {
      const currentCrop = current[activeAsset.id];
      if (!currentCrop) return current;
      return {
        ...current,
        [activeAsset.id]: normalizeCrop({
          ...currentCrop,
          rotation: normalizeRotationDegrees(currentCrop.rotation + 90),
        }),
      };
    });
    setInteractionHint("Ritaglio ruotato di 90 gradi con X.");
  }, [activeAsset]);

  const markReviewedAndMove = (delta: number) => {
    if (activeAsset && activeCrop) {
      setCrops((current) => ({ ...current, [activeAsset.id]: { ...current[activeAsset.id], reviewed: true } }));
    }
    setActiveIndex((current) => {
      const nextIndex = Math.max(0, Math.min(assets.length - 1, current + delta));
      if (layout.photosPerSheet > 0) {
        setPreviewPageIndex(Math.floor(nextIndex / layout.photosPerSheet));
      }
      return nextIndex;
    });
    const isLastPhoto = activeIndex >= assets.length - 1;
    setInteractionHint(
      delta >= 0
        ? (isLastPhoto ? "Ultima foto confermata. Il lavoro è pronto per l'export." : "Foto confermata. Passo alla successiva.")
        : "Torno alla foto precedente.",
    );
  };

  const selectSheetAsset = useCallback((assetId: string) => {
    const nextIndex = assets.findIndex((asset) => asset.id === assetId);
    if (nextIndex < 0) return;
    setActiveIndex(nextIndex);
    if (layout.photosPerSheet > 0) {
      setPreviewPageIndex(Math.floor(nextIndex / layout.photosPerSheet));
    }
    setInteractionHint("Foto selezionata: trascina sul foglio, usa le frecce o premi X per ruotare.");
  }, [assets, layout.photosPerSheet]);

  const handlePrintSpecChange = (changes: Partial<PhotoPrintSpec>) => {
    const next = { ...printSpec, ...changes };
    setPrintSpec(next);
    if (cropGeometryKey(next) !== cropGeometryKey(printSpec)) {
      resetCropsForAssets(assets, next);
    }
    setPreviewPageIndex(0);
  };

  const applyPolaroidGoWorkflow = () => {
    const preset = PHOTO_PRESETS.find((item) => item.presetId === "polaroid-go");
    const sheet = SHEET_PRESETS.find((item) => item.presetId === "15x20");
    if (!preset || !sheet) {
      setStatus("Preset Polaroid Go 15×20 non disponibile.");
      return;
    }
    const nextPrintSpec: PhotoPrintSpec = {
      widthCm: preset.widthCm,
      heightCm: preset.heightCm,
      dpi: 300,
      frameStyle: "polaroid-go",
    };
    setPhotoPresetId(preset.presetId);
    setPrintSpec(nextPrintSpec);
    setSheetSpec(sheet);
    setAdjustments((current) => ({
      ...current,
      fitMode: "cover",
      autoRotateBySourceOrientation: false,
    }));
    setFinishing((current) => ({ ...current, cutGuidesEnabled: true }));
    setFileNamePrefix("polaroid-go-15x20");
    resetCropsForAssets(assets, nextPrintSpec, "cover", false);
    setPreviewPageIndex(0);
    setStatus("Preset rapido applicato: Polaroid Go su foglio 15×20 cm, 300 DPI.");
  };

  const handleLogoSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const imageUrl = URL.createObjectURL(file);
    revokeBlobUrl(logoUrlRef.current);
    setLogo((current) => ({ ...current, enabled: true, imageUrl }));
  };

  const handleFitModeChange = (fitMode: PhotoFitMode) => {
    setAdjustments((current) => ({ ...current, fitMode }));
    resetCropsForAssets(assets, printSpec, fitMode, adjustments.autoRotateBySourceOrientation);
    setPreviewPageIndex(0);
    setInteractionHint(fitMode === "contain"
      ? "Adatta attivo: foto intera visibile con eventuale bordo bianco."
      : "Riempi attivo: lo slot viene riempito ritagliando la foto.");
  };

  const handleAutoRotateChange = (autoRotateBySourceOrientation: boolean) => {
    setAdjustments((current) => ({ ...current, autoRotateBySourceOrientation }));
    resetCropsForAssets(assets, printSpec, adjustments.fitMode, autoRotateBySourceOrientation);
    setPreviewPageIndex(0);
    setInteractionHint(autoRotateBySourceOrientation
      ? "Rotazione automatica attiva: le foto vengono orientate rispetto al formato stampa."
      : "Rotazione automatica disattivata.");
  };

  const chooseOutputFolder = async () => {
    const folder = await window.filexDesktop?.chooseOutputFolder?.();
    if (folder) {
      setOutputDirectoryPath(folder);
    }
  };

  const refreshAssetFromDisk = useCallback(async (assetId: string) => {
    const asset = assets.find((item) => item.id === assetId);
    if (!asset?.absolutePath || typeof window.filexDesktop?.getPreview !== "function") {
      setStatus("Questa foto non ha un percorso file aggiornabile.");
      return false;
    }

    const stat = typeof window.filexDesktop.statFiles === "function"
      ? (await window.filexDesktop.statFiles([asset.absolutePath]))[0]
      : null;
    const sourceFileKey = stat ? `${stat.size}:${stat.lastModified}` : String(Date.now());
    const preview = await window.filexDesktop.getPreview(asset.absolutePath, { maxDimension: 2400, sourceFileKey });
    if (!preview) {
      setStatus("Impossibile aggiornare la preview della foto.");
      return false;
    }

    const previewUrl = bytesToObjectUrl(preview.bytes, preview.mimeType);
    setAssets((current) => current.map((item) => {
      if (item.id !== assetId) return item;
      window.setTimeout(() => revokeAssetUrls(item), 1000);
      return {
        ...item,
        sourceUrl: previewUrl,
        previewUrl,
        width: preview.width,
        height: preview.height,
        size: stat?.size ?? item.size,
        lastModified: stat?.lastModified ?? item.lastModified,
      };
    }));
    setStatus(`Foto aggiornata da file: ${asset.relativePath || asset.fileName}`);
    return true;
  }, [assets]);

  const openActiveInEditor = async () => {
    if (!activeAsset?.absolutePath) {
      setStatus("Per aprire nell'editor serve una foto importata da cartella desktop.");
      return;
    }
    if (typeof window.filexDesktop?.openWithEditor !== "function") {
      setStatus("Bridge desktop non disponibile per aprire un editor esterno.");
      return;
    }

    let selectedEditorPath = editorPath;
    if (!selectedEditorPath && typeof window.filexDesktop.chooseEditorExecutable === "function") {
      selectedEditorPath = await window.filexDesktop.chooseEditorExecutable();
      setEditorPath(selectedEditorPath);
    }
    if (!selectedEditorPath) {
      setStatus("Nessun editor selezionato.");
      return;
    }

    const stat = typeof window.filexDesktop.statFiles === "function"
      ? (await window.filexDesktop.statFiles([activeAsset.absolutePath]))[0]
      : null;
    const result = await window.filexDesktop.openWithEditor(selectedEditorPath, [activeAsset.absolutePath]);
    if (!result?.ok) {
      setStatus(result?.error || "Impossibile aprire la foto nell'editor esterno.");
      return;
    }

    setEditingWatch({
      assetId: activeAsset.id,
      absolutePath: activeAsset.absolutePath,
      size: stat?.size ?? activeAsset.size ?? 0,
      lastModified: stat?.lastModified ?? activeAsset.lastModified ?? 0,
    });
    setStatus(`Aperta nell'editor: ${activeAsset.absolutePath}. Se salvi una copia, usa "Usa file salvato".`);
  };

  const relinkActiveAssetFromSavedFile = async () => {
    if (!activeAsset) return;
    if (
      typeof window.filexDesktop?.chooseImageFile !== "function" ||
      typeof window.filexDesktop?.getPreview !== "function"
    ) {
      setStatus("Selezione file non disponibile in questa sessione desktop.");
      return;
    }

    const selectedPath = await window.filexDesktop.chooseImageFile(activeAsset.absolutePath);
    if (!selectedPath) return;

    const stat = typeof window.filexDesktop.statFiles === "function"
      ? (await window.filexDesktop.statFiles([selectedPath]))[0]
      : null;
    const sourceFileKey = stat ? `${stat.size}:${stat.lastModified}` : String(Date.now());
    const preview = await window.filexDesktop.getPreview(selectedPath, { maxDimension: 2400, sourceFileKey });
    if (!preview) {
      setStatus("Impossibile leggere il file salvato dall'editor.");
      return;
    }

    const previewUrl = bytesToObjectUrl(preview.bytes, preview.mimeType);
    const updatedAsset: PhotoAsset = {
      ...activeAsset,
      fileName: fileNameFromPath(selectedPath),
      relativePath: fileNameFromPath(selectedPath),
      absolutePath: selectedPath,
      sourceUrl: previewUrl,
      previewUrl,
      width: preview.width,
      height: preview.height,
      size: stat?.size ?? activeAsset.size,
      lastModified: stat?.lastModified ?? activeAsset.lastModified,
    };

    setAssets((current) => current.map((item) => {
      if (item.id !== activeAsset.id) return item;
      window.setTimeout(() => revokeAssetUrls(item), 1000);
      return updatedAsset;
    }));
    setCrops((current) => ({
      ...current,
      [activeAsset.id]: createDefaultCrop(
        updatedAsset,
        printSpec,
        adjustments.fitMode,
        adjustments.autoRotateBySourceOrientation,
      ),
    }));
    setEditingWatch({
      assetId: activeAsset.id,
      absolutePath: selectedPath,
      size: stat?.size ?? updatedAsset.size ?? 0,
      lastModified: stat?.lastModified ?? updatedAsset.lastModified ?? 0,
    });
    setStatus(`Foto selezionata collegata al file salvato: ${selectedPath}`);
    setInteractionHint("File salvato dall'editor collegato alla foto selezionata.");
  };

  useEffect(() => {
    let cancelled = false;
    let frameId = 0;
    let timerId = 0;
    const renderId = previewRenderIdRef.current + 1;
    previewRenderIdRef.current = renderId;
    const renderPreview = async () => {
      const page = pages[Math.min(previewPageIndex, Math.max(0, pages.length - 1))];
      const target = previewCanvasRef.current;
      if (!target || !page) {
        setPreviewSize(null);
        return;
      }

      try {
        const rendered = await renderPageCanvas(page, {
          assetsById,
          cropsById,
          printSpec,
          layout,
          logo,
          adjustments,
          finishing,
          renderDpi: getPreviewRenderDpi(layout, printSpec.dpi),
        });
        if (cancelled || previewRenderIdRef.current !== renderId) return;
        const ctx = target.getContext("2d");
        if (!ctx) return;
        const maxWidth = 430;
        const maxHeight = 560;
        const scale = Math.min(maxWidth / rendered.width, maxHeight / rendered.height);
        target.width = Math.round(rendered.width * scale);
        target.height = Math.round(rendered.height * scale);
        setPreviewSize({ width: target.width, height: target.height });
        ctx.drawImage(rendered, 0, 0, target.width, target.height);
      } catch (error) {
        if (!cancelled && previewRenderIdRef.current === renderId) {
          setStatus(error instanceof Error ? `Anteprima non disponibile: ${error.message}` : "Anteprima non disponibile.");
        }
      }
    };

    const scheduleRender = () => {
      frameId = window.requestAnimationFrame(() => {
        void renderPreview();
      });
    };

    if (isDraggingCrop) {
      timerId = window.setTimeout(scheduleRender, 33);
    } else {
      scheduleRender();
    }

    return () => {
      cancelled = true;
      if (frameId) window.cancelAnimationFrame(frameId);
      if (timerId) window.clearTimeout(timerId);
    };
  }, [adjustments, assetsById, cropsById, finishing, isDraggingCrop, layout, logo, pages, previewPageIndex, printSpec]);

  useEffect(() => {
    if (!editingWatch || typeof window.filexDesktop?.statFiles !== "function") {
      return;
    }

    let cancelled = false;
    const timer = window.setInterval(() => {
      void window.filexDesktop?.statFiles([editingWatch.absolutePath]).then(async ([stat]) => {
        if (cancelled || !stat) return;
        const changed = stat.lastModified !== editingWatch.lastModified || stat.size !== editingWatch.size;
        if (!changed) return;
        const refreshed = await refreshAssetFromDisk(editingWatch.assetId);
        if (refreshed && !cancelled) {
          setEditingWatch({
            assetId: editingWatch.assetId,
            absolutePath: editingWatch.absolutePath,
            lastModified: stat.lastModified,
            size: stat.size,
          });
          setInteractionHint("File salvato nell'editor: anteprima aggiornata.");
        }
      }).catch(() => undefined);
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [editingWatch, refreshAssetFromDisk]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        return;
      }
      if (!activeAsset || !activeCrop) {
        return;
      }

      const step = event.shiftKey ? KEYBOARD_FAST_STEP : KEYBOARD_STEP;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveActiveCrop(-step, 0);
        setInteractionHint(event.shiftKey ? "Spostamento veloce a sinistra." : "Spostamento a sinistra.");
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        moveActiveCrop(step, 0);
        setInteractionHint(event.shiftKey ? "Spostamento veloce a destra." : "Spostamento a destra.");
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveActiveCrop(0, -step);
        setInteractionHint(event.shiftKey ? "Spostamento veloce verso l'alto." : "Spostamento verso l'alto.");
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        moveActiveCrop(0, step);
        setInteractionHint(event.shiftKey ? "Spostamento veloce verso il basso." : "Spostamento verso il basso.");
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setActiveZoom(Math.min(4, zoom + 0.1));
        setInteractionHint("Zoom aumentato.");
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        setActiveZoom(Math.max(1, zoom - 0.1));
        setInteractionHint("Zoom ridotto.");
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        resetActiveCrop();
      } else if (event.key === "Enter") {
        event.preventDefault();
        markReviewedAndMove(1);
      } else if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        setAdjustments((current) => ({ ...current, blackAndWhiteEnabled: !current.blackAndWhiteEnabled }));
        setInteractionHint("Bianco e nero attivato/disattivato.");
      } else if (event.key.toLowerCase() === "x") {
        event.preventDefault();
        rotateActiveCrop();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeAsset, activeCrop, moveActiveCrop, resetActiveCrop, rotateActiveCrop, setActiveZoom, zoom]);

  const startSheetSlotDrag = (event: React.PointerEvent<HTMLButtonElement>, assetId: string) => {
    const crop = crops[assetId];
    if (!crop) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    selectSheetAsset(assetId);
    const rect = event.currentTarget.getBoundingClientRect();
    dragStateRef.current = {
      assetId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      initialCrop: crop,
      imageWidth: Math.max(1, rect.width),
      imageHeight: Math.max(1, rect.height),
    };
    setIsDraggingCrop(true);
    setInteractionHint("Drag attivo sul foglio: rilascia quando la foto e centrata.");
  };

  const moveSheetSlotDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const deltaX = ((event.clientX - dragState.startX) / dragState.imageWidth) * dragState.initialCrop.cropWidth;
    const deltaY = ((event.clientY - dragState.startY) / dragState.imageHeight) * dragState.initialCrop.cropHeight;
    setCrops((current) => ({
      ...current,
      [dragState.assetId]: normalizeCrop({
        ...dragState.initialCrop,
        cropLeft: dragState.initialCrop.cropLeft - deltaX,
        cropTop: dragState.initialCrop.cropTop - deltaY,
      }),
    }));
  };

  const stopSheetSlotDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    setCrops((current) => ({
      ...current,
      [dragState.assetId]: { ...current[dragState.assetId], reviewed: true },
    }));
    dragStateRef.current = null;
    setIsDraggingCrop(false);
    setInteractionHint("Foto riposizionata sul foglio. Premi Enter per confermare e andare avanti.");
  };

  const handleExport = async () => {
    if (pages.length === 0 || layout.photosPerSheet === 0) {
      setStatus("Nessun foglio esportabile.");
      return;
    }
    const unreviewedCount = Math.max(0, assets.length - reviewedCount);
    if (unreviewedCount > 0) {
      const shouldContinue = window.confirm(
        `${unreviewedCount} foto non risultano ancora controllate. Vuoi esportare comunque?`,
      );
      if (!shouldContinue) {
        setStatus("Export annullato: completa il controllo dei crop.");
        return;
      }
    }
    setIsBusy(true);
    setIsExporting(true);
    setStatus("Export in corso...");
    try {
      const exported = await exportBatch({
        pages,
        assetsById,
        cropsById,
        printSpec,
        layout,
        logo,
        adjustments,
        finishing,
        format,
        outputDirectoryPath,
        fileNamePrefix,
        quality,
        resolveAssetForExport: async (asset, requiredMaxDimension) => {
          if (!asset.absolutePath || typeof window.filexDesktop?.getPreview !== "function") {
            return { asset };
          }
          const sourceFileKey = `${asset.size ?? 0}:${asset.lastModified ?? 0}`;
          const preview = await window.filexDesktop.getPreview(asset.absolutePath, {
            maxDimension: requiredMaxDimension,
            sourceFileKey,
          });
          if (!preview) {
            throw new Error(`Impossibile preparare la sorgente ad alta risoluzione: ${asset.fileName}`);
          }
          const sourceUrl = bytesToObjectUrl(preview.bytes, preview.mimeType);
          return {
            asset: {
              ...asset,
              sourceUrl,
              width: preview.width,
              height: preview.height,
            },
            release: () => revokeBlobUrl(sourceUrl),
          };
        },
        onProgress: (completed, total, label) => setStatus(`${completed}/${total} ${label}`),
      });
      setStatus(`Export completato: ${exported.length} file.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Errore durante export.");
    } finally {
      setIsBusy(false);
      setIsExporting(false);
    }
  };

  const selectedSheetPreset = SHEET_PRESETS.find((preset) => preset.presetId === sheetSpec.presetId) ?? SHEET_PRESETS[0];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>Batch Print Layout</h1>
          <span>Crop, logo, bianco e nero e fogli pronti per stampa</span>
        </div>
        <div className="topbar__actions">
          <button type="button" className="secondary-button" onClick={applyPolaroidGoWorkflow} disabled={isBusy}>
            <Printer size={16} />
            Polaroid Go 15×20
          </button>
          <button type="button" className="secondary-button" onClick={handleBrowseFolder} disabled={isBusy}>
            <FolderOpen size={16} />
            Sfoglia cartella
          </button>
          <button type="button" className="primary-button" onClick={handleExport} disabled={isBusy || pages.length === 0}>
            <Download size={16} />
            {isExporting ? "Esportazione..." : "Esporta"}
          </button>
        </div>
      </header>

      <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden-input" onChange={handleFilesSelected} />
      <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden-input" onChange={handleLogoSelected} />

      <main className="workspace">
        <aside className="side-panel">
          <section className="panel-section">
            <h2>Foto</h2>
            <button type="button" className="wide-button" onClick={handleBrowseFolder} disabled={isBusy}>
              <ImagePlus size={16} />
              Seleziona cartella foto
            </button>
            <div className="metric-row">
              <span>Foto</span>
              <strong>{assets.length}</strong>
            </div>
            <div className="metric-row">
              <span>Controllate</span>
              <strong>{reviewedCount}</strong>
            </div>
          </section>

          <section className="panel-section">
            <h2>Formato foto</h2>
            <div className="grid-two">
              <SelectField
                label="Preset formato foto"
                value={photoPresetId}
                onChange={(value) => {
                  setPhotoPresetId(value);
                  if (value === "custom") {
                    handlePrintSpecChange({ frameStyle: "none" });
                    return;
                  }
                  const preset = PHOTO_PRESETS.find((item) => item.presetId === value);
                  if (preset) {
                    const nextSpec = {
                      ...printSpec,
                      widthCm: preset.widthCm,
                      heightCm: preset.heightCm,
                      frameStyle: preset.frameStyle ?? "none",
                    };
                    handlePrintSpecChange(nextSpec);
                    if (preset.frameStyle === "polaroid-go") {
                      setAdjustments((current) => ({ ...current, fitMode: "cover", autoRotateBySourceOrientation: false }));
                      setFinishing((current) => ({ ...current, cutGuidesEnabled: true }));
                      resetCropsForAssets(assets, nextSpec, "cover", false);
                    }
                  }
                }}
                options={[{ value: "custom", label: "Personalizzato" }, ...PHOTO_PRESETS.map((preset) => ({ value: preset.presetId, label: preset.label }))]}
              />
              {PHOTO_PRESETS.find((preset) => preset.presetId === photoPresetId) ? (
                <p className="field-help">{PHOTO_PRESETS.find((preset) => preset.presetId === photoPresetId)?.description}</p>
              ) : null}
              <NumberField label="Larghezza cm" value={printSpec.widthCm} min={1} max={50} step={0.1} onChange={(widthCm) => { setPhotoPresetId("custom"); handlePrintSpecChange({ widthCm, frameStyle: "none" }); }} />
              <NumberField label="Altezza cm" value={printSpec.heightCm} min={1} max={50} step={0.1} onChange={(heightCm) => { setPhotoPresetId("custom"); handlePrintSpecChange({ heightCm, frameStyle: "none" }); }} />
            </div>
            <SelectField
              label="DPI"
              value={String(printSpec.dpi)}
              onChange={(value) => handlePrintSpecChange({ dpi: Number(value) })}
              options={["150", "300", "600"].map((value) => ({ value, label: `${value} DPI` }))}
            />
            <SelectField
              label="Adattamento"
              value={adjustments.fitMode}
              onChange={(value) => handleFitModeChange(value as PhotoFitMode)}
              options={[
                { value: "cover", label: "Riempi ritagliando" },
                { value: "contain", label: "Adatta con bordo bianco" },
              ]}
            />
            <p className="field-help">“Riempi” taglia l’eccedenza per riempire tutta la foto. “Adatta” conserva tutta l’immagine e aggiunge bianco quando serve.</p>
            <label className="check-row">
              <input
                type="checkbox"
                checked={adjustments.autoRotateBySourceOrientation}
                onChange={(event) => handleAutoRotateChange(event.target.checked)}
              />
              <span>Ruota foto per seguire il formato</span>
            </label>
            <p className="field-help">Normalmente lascialo disattivato: l'orientamento EXIF è già applicato durante l'import.</p>
          </section>

          <section className="panel-section">
            <h2>Foglio</h2>
            <SelectField
              label="Formato"
              value={sheetSpec.presetId}
              onChange={(value) => {
                if (value === "custom") {
                  setSheetSpec((current) => ({ ...current, presetId: "custom", label: "Personalizzato" }));
                  return;
                }
                const preset = SHEET_PRESETS.find((item) => item.presetId === value);
                if (preset) setSheetSpec(preset);
              }}
              options={SHEET_PRESETS.map((preset) => ({ value: preset.presetId, label: preset.label }))}
            />
            <div className="grid-two">
              <NumberField label="Larghezza cm" value={sheetSpec.widthCm} min={2} max={120} step={0.1} disabled={selectedSheetPreset.presetId !== "custom"} onChange={(widthCm) => setSheetSpec((current) => ({ ...current, widthCm }))} />
              <NumberField label="Altezza cm" value={sheetSpec.heightCm} min={2} max={120} step={0.1} disabled={selectedSheetPreset.presetId !== "custom"} onChange={(heightCm) => setSheetSpec((current) => ({ ...current, heightCm }))} />
              <NumberField label="Margine esterno mm" value={sheetSpec.marginMm} min={0} max={100} step={0.1} onChange={(marginMm) => setSheetSpec((current) => ({ ...current, marginMm }))} />
              <NumberField label="Distanza tra foto mm" value={sheetSpec.gapMm} min={0} max={100} step={0.1} onChange={(gapMm) => setSheetSpec((current) => ({ ...current, gapMm }))} />
            </div>
            <p className="field-help">Il margine è la distanza minima dal bordo del foglio; la griglia viene centrata. La distanza è lo spazio vuoto tra due foto.</p>
            {layout.photosPerSheet > 0 ? (
              <p className="field-help">Margine effettivo: sinistra/destra {((layout.outerMarginLeftPx * 25.4) / printSpec.dpi).toFixed(1)} / {((layout.outerMarginRightPx * 25.4) / printSpec.dpi).toFixed(1)} mm · alto/basso {((layout.outerMarginTopPx * 25.4) / printSpec.dpi).toFixed(1)} / {((layout.outerMarginBottomPx * 25.4) / printSpec.dpi).toFixed(1)} mm.</p>
            ) : null}
          </section>

          <section className="panel-section">
            <h2>Logo e B/N</h2>
            <label className="check-row">
              <input type="checkbox" checked={adjustments.blackAndWhiteEnabled} onChange={(event) => setAdjustments((current) => ({ ...current, blackAndWhiteEnabled: event.target.checked }))} />
              <span>Bianco e nero</span>
            </label>
            <label className="check-row">
              <input type="checkbox" checked={logo.enabled} onChange={(event) => setLogo((current) => ({ ...current, enabled: event.target.checked }))} />
              <span>Logo su ogni foto</span>
            </label>
            <button type="button" className="wide-button" onClick={() => logoInputRef.current?.click()}>
              <ImagePlus size={16} />
              Carica logo
            </button>
            <SelectField
              label="Posizione"
              value={logo.position}
              disabled={!logo.enabled || !logo.imageUrl}
              onChange={(position) => setLogo((current) => ({ ...current, position: position as LogoOverlaySpec["position"] }))}
              options={[
                { value: "bottom-right", label: "Basso destra" },
                { value: "bottom-left", label: "Basso sinistra" },
                { value: "top-right", label: "Alto destra" },
                { value: "top-left", label: "Alto sinistra" },
                { value: "center", label: "Centro" },
              ]}
            />
            <RangeField label="Scala logo" value={logo.scalePct} min={5} max={80} step={1} suffix="%" disabled={!logo.enabled || !logo.imageUrl} onChange={(scalePct) => setLogo((current) => ({ ...current, scalePct }))} />
            <RangeField label="Opacità" value={Math.round(logo.opacity * 100)} min={5} max={100} step={1} suffix="%" disabled={!logo.enabled || !logo.imageUrl} onChange={(opacity) => setLogo((current) => ({ ...current, opacity: opacity / 100 }))} />
          </section>

          <section className="panel-section">
            <h2>Bordi e taglio</h2>
            <label className="check-row">
              <input
                type="checkbox"
                checked={finishing.cutGuidesEnabled}
                onChange={(event) => setFinishing((current) => ({ ...current, cutGuidesEnabled: event.target.checked }))}
              />
              <span>Segni di taglio</span>
            </label>
            <p className="field-help">Aggiunge piccoli riferimenti fuori dagli angoli, utili con cornici bianche su foglio bianco.</p>
            <label className="check-row">
              <input
                type="checkbox"
                checked={adjustments.borderEnabled}
                onChange={(event) => setAdjustments((current) => ({ ...current, borderEnabled: event.target.checked }))}
              />
              <span>Mostra bordo</span>
            </label>
            <div className="grid-two">
              <NumberField
                label="Spessore px"
                value={adjustments.borderWidthPx}
                min={1}
                max={50}
                step={1}
                disabled={!adjustments.borderEnabled}
                onChange={(borderWidthPx) => setAdjustments((current) => ({ ...current, borderWidthPx }))}
              />
              <label className="field">
                <span>Colore</span>
                <input
                  type="color"
                  value={adjustments.borderColor}
                  disabled={!adjustments.borderEnabled}
                  onChange={(event) => setAdjustments((current) => ({ ...current, borderColor: event.target.value }))}
                />
              </label>
            </div>
            <p className="field-help">Il bordo è stampato dentro il formato della foto e non ne aumenta la dimensione.</p>
          </section>

          <section className="panel-section">
            <h2>Export</h2>
            <SelectField
              label="Formato file"
              value={format}
              onChange={(value) => setFormat(value as ExportFormat)}
              options={[
                { value: "jpg", label: "JPG" },
                { value: "png", label: "PNG" },
                { value: "pdf", label: "PDF" },
                { value: "tif", label: "TIF" },
              ]}
            />
            <TextField label="Nome file" value={fileNamePrefix} onChange={setFileNamePrefix} />
            <RangeField label="Qualità JPG/PDF" value={Math.round(quality * 100)} min={50} max={100} step={1} suffix="%" disabled={format === "png" || format === "tif"} onChange={(value) => setQuality(value / 100)} />
            <button type="button" className="wide-button" onClick={chooseOutputFolder} disabled={!window.filexDesktop?.chooseOutputFolder}>
              <FolderOpen size={16} />
              Cartella output
            </button>
            {outputDirectoryPath ? <p className="path-label">{outputDirectoryPath}</p> : <p className="path-label">Browser: export multiplo in un file ZIP.</p>}
          </section>
        </aside>

        <section className="preview-panel sheet-workbench">
          <div className="section-head">
            <div>
              <h2>Foglio stampa</h2>
              <p>
                {layout.photosPerSheet > 0
                  ? `${layout.photosPerSheet} foto/foglio · ${pages.length} fogli`
                  : "Formato non inseribile nel foglio"}
              </p>
            </div>
            <div className="segmented-actions">
              <span className="page-indicator">{pages.length ? `${previewPageIndex + 1}/${pages.length}` : "0/0"}</span>
              <button type="button" aria-label="Pagina precedente" title="Pagina precedente" onClick={() => setPreviewPageIndex((value) => Math.max(0, value - 1))} disabled={previewPageIndex === 0}>
                <ChevronLeft size={16} />
              </button>
              <button type="button" aria-label="Pagina successiva" title="Pagina successiva" onClick={() => setPreviewPageIndex((value) => Math.min(pages.length - 1, value + 1))} disabled={previewPageIndex >= pages.length - 1}>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
          <div className="sheet-preview">
            {pages.length > 0 && currentPage ? (
              <div
                className="sheet-preview-surface"
                style={{
                  width: previewSize ? `${previewSize.width}px` : undefined,
                  height: previewSize ? `${previewSize.height}px` : undefined,
                  aspectRatio: `${layout.sheetWidthPx} / ${layout.sheetHeightPx}`,
                }}
              >
                <canvas ref={previewCanvasRef} />
                <div className="sheet-slot-layer" aria-label="Foto sul foglio">
                  {currentPage.slots.map((slot) => {
                    const asset = assetsById.get(slot.assetId);
                    const isActive = activeAsset?.id === slot.assetId;
                    return (
                      <button
                        key={slot.assetId}
                        type="button"
                        className={isActive ? "sheet-slot sheet-slot--active" : "sheet-slot"}
                        style={{
                          left: `${(slot.x / layout.sheetWidthPx) * 100}%`,
                          top: `${(slot.y / layout.sheetHeightPx) * 100}%`,
                          width: `${(slot.width / layout.sheetWidthPx) * 100}%`,
                          height: `${(slot.height / layout.sheetHeightPx) * 100}%`,
                        }}
                        onClick={() => selectSheetAsset(slot.assetId)}
                        onPointerDown={(event) => startSheetSlotDrag(event, slot.assetId)}
                        onPointerMove={moveSheetSlotDrag}
                        onPointerUp={stopSheetSlotDrag}
                        onPointerCancel={stopSheetSlotDrag}
                        aria-label={`Modifica ${asset?.relativePath || asset?.fileName || "foto"}`}
                        aria-pressed={isActive}
                        title="Clicca o trascina per riposizionare"
                      />
                    );
                  })}
                </div>
              </div>
            ) : <div className="sheet-placeholder">Anteprima foglio</div>}
          </div>
          {activeAsset && activeCrop ? (
            <div className={isDraggingCrop ? "interaction-feedback interaction-feedback--active" : "interaction-feedback"}>
              <Info size={16} />
              <span>{interactionHint}</span>
            </div>
          ) : null}
          {activeAsset && activeCrop ? (
            <div className="crop-controls sheet-controls">
              <RangeField label="Orizzontale" value={Math.round((activeCrop.cropLeft + activeCrop.cropWidth / 2) * 100)} min={Math.round((activeCrop.cropWidth / 2) * 100)} max={Math.round((1 - activeCrop.cropWidth / 2) * 100)} step={1} suffix="%" onChange={(value) => updateActiveCrop({ cropLeft: value / 100 - activeCrop.cropWidth / 2 })} />
              <RangeField label="Verticale" value={Math.round((activeCrop.cropTop + activeCrop.cropHeight / 2) * 100)} min={Math.round((activeCrop.cropHeight / 2) * 100)} max={Math.round((1 - activeCrop.cropHeight / 2) * 100)} step={1} suffix="%" onChange={(value) => updateActiveCrop({ cropTop: value / 100 - activeCrop.cropHeight / 2 })} />
              <RangeField label="Zoom" value={Number(zoom.toFixed(2))} min={1} max={4} step={0.05} suffix="x" onChange={setActiveZoom} />
              <RangeField label="Rotazione" value={activeCrop.rotation} min={-180} max={180} step={1} suffix="deg" onChange={(rotation) => updateActiveCrop({ rotation })} />
              <div className="crop-button-row">
                <button type="button" className="secondary-button" onClick={openActiveInEditor} disabled={!activeAsset.absolutePath || !window.filexDesktop?.openWithEditor}>
                  <ExternalLink size={16} />
                  Apri in editor
                </button>
                <button type="button" className="secondary-button" onClick={() => refreshAssetFromDisk(activeAsset.id)} disabled={!activeAsset.absolutePath}>
                  <RefreshCw size={16} />
                  Aggiorna da file
                </button>
                <button type="button" className="secondary-button" onClick={relinkActiveAssetFromSavedFile} disabled={!window.filexDesktop?.chooseImageFile}>
                  <FolderOpen size={16} />
                  Usa file salvato
                </button>
                <button type="button" className="secondary-button" onClick={rotateActiveCrop}>
                  <RotateCcw size={16} />
                  Ruota 90
                </button>
                <button type="button" className="secondary-button" onClick={resetActiveCrop}>
                  <RotateCcw size={16} />
                  Reset
                </button>
                <button type="button" className="primary-button" onClick={() => markReviewedAndMove(1)}>
                  Conferma e avanti
                </button>
              </div>
            </div>
          ) : null}
          {activeAsset && activeCrop ? <div className="shortcut-panel">
            <div className="shortcut-panel__head">
              <Keyboard size={16} />
              <strong>Scorciatoie e drag sul foglio</strong>
            </div>
            <div className="shortcut-grid">
              <Shortcut label="Clic" value="Seleziona foto" icon={<MousePointer2 size={14} />} />
              <Shortcut label="Trascina foto" value="Centra sul foglio" />
              <Shortcut label="Frecce" value="Sposta fine" />
              <Shortcut label="Shift + frecce" value="Sposta veloce" />
              <Shortcut label="+ / -" value="Zoom" />
              <Shortcut label="R" value="Reset crop" />
              <Shortcut label="X" value="Ruota 90 deg" />
              <Shortcut label="Enter" value="Conferma avanti" />
              <Shortcut label="B" value="Bianco e nero" />
            </div>
          </div> : null}
          <div className="preview-stats">
            <div><span>Griglia</span><strong>{layout.cols} x {layout.rows}</strong></div>
            <div><span>Orientamento</span><strong>{layout.sheetLandscape ? "Orizzontale" : "Verticale"}</strong></div>
            <div><span>Foto ruotata</span><strong>{layout.photoRotated ? "Si" : "No"}</strong></div>
            <div><span>Pagina</span><strong>{pages.length ? `${previewPageIndex + 1}/${pages.length}` : "0/0"}</strong></div>
            <div><span>Formato stampa</span><strong>{layout.sheetWidthCm} × {layout.sheetHeightCm} cm</strong></div>
            <div><span>Risoluzione</span><strong>{printSpec.dpi} DPI</strong></div>
            <div><span>Controllate</span><strong>{reviewedCount}/{assets.length}</strong></div>
            <div><span>Output</span><strong>{format.toUpperCase()}</strong></div>
          </div>
          {layout.photosPerSheet === 0 ? <p className="warning">Il formato foto non entra nel foglio con questi margini.</p> : null}
          <p className="status-line" role="status" aria-live="polite">{status}</p>
        </section>
      </main>
    </div>
  );
}

function NumberField({ label, value, min, max, step, disabled, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : ""}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber;
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
        }}
      />
    </label>
  );
}

function RangeField({ label, value, min, max, step, suffix, disabled, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field range-field">
      <span>{label}<strong>{value}{suffix}</strong></span>
      <input type="range" value={value} min={min} max={max} step={step} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function SelectField({ label, value, options, disabled, onChange }: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function TextField({ label, value, onChange }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="text" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Shortcut({ label, value, icon }: {
  label: string;
  value: string;
  icon?: ReactNode;
}) {
  return (
    <div className="shortcut-item">
      <span>{icon}{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
