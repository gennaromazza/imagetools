import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from "react";
import type { DesktopPhotoToolHandoff } from "@photo-tools/desktop-contracts";
import {
  calculateGridLayout,
  createDefaultCrop,
  normalizeCrop,
  paginateAssets,
  type BatchCropState,
  type ExportFormat,
  type ImageAdjustmentSpec,
  type LogoOverlaySpec,
  type PhotoAsset,
  type PhotoFitMode,
  type PhotoPrintSpec,
  type PrintFinishingSpec,
  type SheetOrientation,
} from "../print-engine";
import {
  adviseOrientation,
  CUSTOM_PAPER_ID,
  DEFAULT_PAPER_CHOICE,
  evaluatePapers,
  getPerPage,
  getPhotoPreset,
  isGoalValid,
  MAX_PHOTO_EDGE_CM,
  MAX_PHOTOS_PER_PAGE,
  MIN_PHOTO_EDGE_CM,
  resolvePaperOption,
  resolvePhotoSpec,
  shrinkGoalToSheet,
  toSheetSpec,
  type PaperChoice,
  type PrintGoal,
} from "../print-planner";
import { exportBatch } from "../render-export";
import {
  bytesToObjectUrl,
  DESKTOP_PREVIEW_MAX_DIMENSION,
  fileNameFromPath,
  fileToAsset,
  importDesktopFolder,
  importDesktopHandoffFiles,
  revokeAssetUrls,
  revokeBlobUrl,
} from "../lib/assets";
import { applyZoomToCrop, cropGeometryKey, getZoomFromCrop, normalizeRotationDegrees } from "../lib/crop-math";

export type GoalKind = PrintGoal["kind"];

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
/** Misura di riserva usata solo finché l'obiettivo non è valido (non viene mai stampata). */
const PLACEHOLDER_PHOTO: PhotoPrintSpec = { widthCm: 6, heightCm: 7, dpi: 300 };
const KEYBOARD_STEP = 0.01;
const KEYBOARD_FAST_STEP = 0.04;

interface EditingWatchState {
  assetId: string;
  absolutePath: string;
  lastModified: number;
  size: number;
}

interface StoredCrop {
  crop: BatchCropState;
  /** Geometria per cui il ritaglio è stato fatto: se cambia, si riparte dal taglio automatico. */
  key: string;
}

interface DragState {
  assetId: string;
  pointerId: number;
  startX: number;
  startY: number;
  initialCrop: BatchCropState;
  imageWidth: number;
  imageHeight: number;
}

export function useWorkbench() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const assetsRef = useRef<PhotoAsset[]>([]);
  const logoUrlRef = useRef<string | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const handleAssetsImportedRef = useRef<(nextAssets: PhotoAsset[]) => void>(() => undefined);

  // ---- foto ----
  const [assets, setAssets] = useState<PhotoAsset[]>([]);
  const [copies, setCopies] = useState(1);
  const [storedCrops, setStoredCrops] = useState<Record<string, StoredCrop>>({});
  const [activeIndex, setActiveIndex] = useState(0);
  const [previewPageIndex, setPreviewPageIndex] = useState(0);

  // ---- cosa stampare ----
  const [goalKind, setGoalKind] = useState<GoalKind>("count");
  const [photosPerPage, setPhotosPerPage] = useState(4);
  const [countAspectId, setCountAspectId] = useState("free");
  const [formatPresetId, setFormatPresetId] = useState("");
  const [customSize, setCustomSize] = useState({ widthCm: 6, heightCm: 9 });

  // ---- carta e qualità ----
  const [paperChoice, setPaperChoice] = useState<PaperChoice>(DEFAULT_PAPER_CHOICE);
  const [dpi, setDpi] = useState(300);

  // ---- ritocchi ed export ----
  const [logo, setLogo] = useState<LogoOverlaySpec>(DEFAULT_LOGO);
  const [adjustments, setAdjustments] = useState<ImageAdjustmentSpec>(DEFAULT_ADJUSTMENTS);
  const [finishing, setFinishing] = useState<PrintFinishingSpec>(DEFAULT_FINISHING);
  const [format, setFormat] = useState<ExportFormat>("jpg");
  const [quality, setQuality] = useState(1);
  const [fileNamePrefix, setFileNamePrefix] = useState("batch-print");
  const [outputDirectoryPath, setOutputDirectoryPath] = useState<string | null>(null);

  // ---- stato dell'interfaccia ----
  const [status, setStatus] = useState("");
  const [interactionHint, setInteractionHint] = useState("Clicca una foto sul foglio per sceglierla, trascinala per riposizionarla.");
  const [editorPath, setEditorPath] = useState<string | null>(null);
  const [editingWatch, setEditingWatch] = useState<EditingWatchState | null>(null);
  const [isDraggingCrop, setIsDraggingCrop] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // =========================================================================
  // Valori derivati: tutto discende da (foto, obiettivo, carta, qualità).
  // =========================================================================
  const goal = useMemo<PrintGoal>(() => {
    if (goalKind === "count") return { kind: "count", count: photosPerPage, aspectId: countAspectId };
    if (goalKind === "format") return { kind: "format", presetId: formatPresetId };
    return { kind: "custom", widthCm: customSize.widthCm, heightCm: customSize.heightCm };
  }, [countAspectId, customSize.heightCm, customSize.widthCm, formatPresetId, goalKind, photosPerPage]);
  const goalValid = isGoalValid(goal);
  const printCount = assets.length * copies;

  const evaluations = useMemo(
    () => evaluatePapers(goal, paperChoice, { dpi, printCount }),
    [dpi, goal, paperChoice, printCount],
  );
  const recommendedPaperId = evaluations.find((evaluation) => evaluation.recommended)?.paper.id ?? "a4";
  const paper = useMemo(
    () => resolvePaperOption(goal, paperChoice, recommendedPaperId),
    [goal, paperChoice, recommendedPaperId],
  );
  const sheet = useMemo(() => toSheetSpec(paper, paperChoice), [paper, paperChoice]);
  const resolvedPhoto = useMemo(() => resolvePhotoSpec(goal, sheet, dpi), [dpi, goal, sheet]);
  const printSpec = resolvedPhoto.spec ?? { ...PLACEHOLDER_PHOTO, dpi };
  const layout = useMemo(() => calculateGridLayout(printSpec, sheet), [printSpec, sheet]);
  const ready = goalValid && resolvedPhoto.fits && layout.photosPerSheet > 0;
  const perPage = ready ? getPerPage(goal, layout) : 0;
  const printAssets = useMemo(
    () => (copies > 1 ? assets.flatMap((asset) => Array.from({ length: copies }, () => asset)) : assets),
    [assets, copies],
  );
  const pages = useMemo(
    () => (ready && assets.length > 0 ? paginateAssets(printAssets, layout, perPage) : []),
    [assets.length, layout, perPage, printAssets, ready],
  );
  const orientationAdvice = useMemo(
    () => (goalValid ? adviseOrientation(goal, paper, paperChoice, dpi) : null),
    [dpi, goal, goalValid, paper, paperChoice],
  );

  const assetsById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const geometryKey = cropGeometryKey(printSpec, adjustments.fitMode, adjustments.autoRotateBySourceOrientation);
  const cropsById = useMemo(() => {
    const map = new Map<string, BatchCropState>();
    for (const asset of assets) {
      const stored = storedCrops[asset.id];
      map.set(
        asset.id,
        stored && stored.key === geometryKey
          ? stored.crop
          : createDefaultCrop(asset, printSpec, adjustments.fitMode, adjustments.autoRotateBySourceOrientation),
      );
    }
    return map;
  }, [adjustments.autoRotateBySourceOrientation, adjustments.fitMode, assets, geometryKey, printSpec, storedCrops]);

  const activeAsset = assets[activeIndex] ?? null;
  const activeCrop = activeAsset ? cropsById.get(activeAsset.id) ?? null : null;
  const safePageIndex = Math.min(previewPageIndex, Math.max(0, pages.length - 1));
  const currentPage = pages[safePageIndex] ?? null;
  const zoom = activeAsset && activeCrop
    ? getZoomFromCrop(activeCrop, activeAsset, printSpec, adjustments.fitMode, adjustments.autoRotateBySourceOrientation)
    : 1;
  const reviewedCount = assets.filter((asset) => {
    const stored = storedCrops[asset.id];
    return Boolean(stored && stored.key === geometryKey && stored.crop.reviewed);
  }).length;

  // Valori correnti per i callback che non devono ricrearsi a ogni render.
  const latest = useRef({ assetsById, printSpec, adjustments, geometryKey, pages });
  latest.current = { assetsById, printSpec, adjustments, geometryKey, pages };

  // =========================================================================
  // Ritagli
  // =========================================================================
  const writeCrop = useCallback((assetId: string, update: (crop: BatchCropState) => BatchCropState) => {
    setStoredCrops((current) => {
      const { assetsById: byId, printSpec: spec, adjustments: adj, geometryKey: key } = latest.current;
      const asset = byId.get(assetId);
      if (!asset) return current;
      const stored = current[assetId];
      const base = stored && stored.key === key
        ? stored.crop
        : createDefaultCrop(asset, spec, adj.fitMode, adj.autoRotateBySourceOrientation);
      return { ...current, [assetId]: { crop: update(base), key } };
    });
  }, []);

  const updateActiveCrop = useCallback((changes: Partial<BatchCropState>) => {
    if (!activeAsset) return;
    writeCrop(activeAsset.id, (crop) => normalizeCrop({ ...crop, ...changes }));
  }, [activeAsset, writeCrop]);

  const moveActiveCrop = useCallback((deltaX: number, deltaY: number) => {
    if (!activeAsset) return;
    writeCrop(activeAsset.id, (crop) => normalizeCrop({
      ...crop,
      cropLeft: crop.cropLeft + deltaX,
      cropTop: crop.cropTop + deltaY,
    }));
  }, [activeAsset, writeCrop]);

  const setActiveZoom = useCallback((nextZoom: number) => {
    if (!activeAsset) return;
    writeCrop(activeAsset.id, (crop) => applyZoomToCrop(
      crop,
      activeAsset,
      latest.current.printSpec,
      latest.current.adjustments.fitMode,
      latest.current.adjustments.autoRotateBySourceOrientation,
      nextZoom,
    ));
  }, [activeAsset, writeCrop]);

  const resetActiveCrop = useCallback(() => {
    if (!activeAsset) return;
    setStoredCrops((current) => {
      const next = { ...current };
      delete next[activeAsset.id];
      return next;
    });
    setInteractionHint("Ritaglio riportato al taglio automatico.");
  }, [activeAsset]);

  const rotateActiveCrop = useCallback(() => {
    if (!activeAsset) return;
    writeCrop(activeAsset.id, (crop) => normalizeCrop({ ...crop, rotation: normalizeRotationDegrees(crop.rotation + 90) }));
    setInteractionHint("Ritaglio ruotato di 90 gradi.");
  }, [activeAsset, writeCrop]);

  const pageIndexOfAsset = useCallback((assetId: string, preferredPage: number): number => {
    const list = latest.current.pages;
    if (list[preferredPage]?.slots.some((slot) => slot.assetId === assetId)) return preferredPage;
    return list.findIndex((page) => page.slots.some((slot) => slot.assetId === assetId));
  }, []);

  const selectAssetById = useCallback((assetId: string) => {
    const nextIndex = assetsRef.current.findIndex((asset) => asset.id === assetId);
    if (nextIndex < 0) return;
    setActiveIndex(nextIndex);
    setPreviewPageIndex((page) => {
      const target = pageIndexOfAsset(assetId, page);
      return target >= 0 ? target : page;
    });
    setInteractionHint("Foto selezionata: trascinala sul foglio, usa le frecce o premi X per ruotarla.");
  }, [pageIndexOfAsset]);

  const markReviewedAndMove = useCallback((delta: number) => {
    if (activeAsset) {
      writeCrop(activeAsset.id, (crop) => ({ ...crop, reviewed: true }));
    }
    const nextIndex = Math.max(0, Math.min(assets.length - 1, activeIndex + delta));
    setActiveIndex(nextIndex);
    const nextAsset = assets[nextIndex];
    if (nextAsset) {
      setPreviewPageIndex((page) => {
        const target = pageIndexOfAsset(nextAsset.id, page);
        return target >= 0 ? target : page;
      });
    }
    const isLastPhoto = activeIndex >= assets.length - 1;
    setInteractionHint(
      delta >= 0
        ? (isLastPhoto ? "Ultima foto confermata: puoi passare all'esportazione." : "Foto confermata, passo alla successiva.")
        : "Torno alla foto precedente.",
    );
  }, [activeAsset, activeIndex, assets, pageIndexOfAsset, writeCrop]);

  const startSheetSlotDrag = (event: ReactPointerEvent<HTMLButtonElement>, assetId: string) => {
    const crop = cropsById.get(assetId);
    if (!crop) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    selectAssetById(assetId);
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
    setInteractionHint("Trascinamento attivo: rilascia quando la foto è centrata come vuoi.");
  };

  const moveSheetSlotDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = ((event.clientX - drag.startX) / drag.imageWidth) * drag.initialCrop.cropWidth;
    const deltaY = ((event.clientY - drag.startY) / drag.imageHeight) * drag.initialCrop.cropHeight;
    writeCrop(drag.assetId, () => normalizeCrop({
      ...drag.initialCrop,
      cropLeft: drag.initialCrop.cropLeft - deltaX,
      cropTop: drag.initialCrop.cropTop - deltaY,
    }));
  };

  const stopSheetSlotDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    writeCrop(drag.assetId, (crop) => ({ ...crop, reviewed: true }));
    dragStateRef.current = null;
    setIsDraggingCrop(false);
    setInteractionHint("Foto riposizionata. Premi Invio per confermare e passare alla prossima.");
  };

  // =========================================================================
  // Foto: import, rimozione, Archivio Flow
  // =========================================================================
  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  useEffect(() => {
    logoUrlRef.current = logo.imageUrl;
  }, [logo.imageUrl]);

  useEffect(() => {
    setPreviewPageIndex((current) => Math.max(0, Math.min(current, Math.max(0, pages.length - 1))));
  }, [pages.length]);

  useEffect(() => {
    if (!fileInputRef.current) return;
    fileInputRef.current.setAttribute("webkitdirectory", "");
    fileInputRef.current.setAttribute("directory", "");
  }, []);

  useEffect(() => () => {
    for (const asset of assetsRef.current) revokeAssetUrls(asset);
    revokeBlobUrl(logoUrlRef.current);
  }, []);

  useEffect(() => {
    if (typeof window.filexDesktop?.getInstalledEditorCandidates !== "function") return;
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

  const handleAssetsImported = useCallback((nextAssets: PhotoAsset[]) => {
    for (const asset of assetsRef.current) revokeAssetUrls(asset);
    setAssets(nextAssets);
    setStoredCrops({});
    setActiveIndex(0);
    setPreviewPageIndex(0);
    setStatus(nextAssets.length ? `${nextAssets.length} foto pronte.` : "Nessuna foto importata.");
  }, []);
  handleAssetsImportedRef.current = handleAssetsImported;

  const removeAsset = useCallback((assetId: string) => {
    const target = assetsRef.current.find((asset) => asset.id === assetId);
    if (!target) return;
    revokeAssetUrls(target);
    setAssets((current) => current.filter((asset) => asset.id !== assetId));
    setStoredCrops((current) => {
      const next = { ...current };
      delete next[assetId];
      return next;
    });
    setActiveIndex((index) => Math.max(0, Math.min(index, assetsRef.current.length - 2)));
  }, []);

  // Selezione ricevuta da Archivio Flow.
  useEffect(() => {
    const api = window.filexDesktop;
    if (!api?.consumePendingOpenProjectPath
      || !api.consumePhotoSelectionHandoff
      || !api.acknowledgeOpenProjectRequest
      || !api.markOpenProjectRequestReady
      || !api.onOpenProjectRequest) return;
    let active = true;
    let draining = false;
    let drainAgain = false;

    const acceptHandoff = async (handoff: DesktopPhotoToolHandoff) => {
      try {
        if (assetsRef.current.length > 0 && !window.confirm(
          "Sostituire le foto già presenti con la selezione ricevuta da Archivio Flow?",
        )) {
          setStatus("Selezione da Archivio Flow non importata: il lavoro corrente è rimasto invariato.");
          return;
        }
        setIsBusy(true);
        setStatus(`Importazione da Archivio Flow 0/${handoff.files.length}…`);
        const result = await importDesktopHandoffFiles(handoff.files, (completed, total) => {
          if (active) setStatus(`Importazione da Archivio Flow ${completed}/${total}…`);
        });
        if (!active) {
          result.assets.forEach(revokeAssetUrls);
          return;
        }
        handleAssetsImportedRef.current(result.assets);
        setStatus(result.assets.length > 0
          ? `${result.assets.length} foto ricevute da Archivio Flow.${result.failedPreviewCount ? ` ${result.failedPreviewCount} non leggibili ignorate.` : ""} Non rimuovere la scheda finché non hai esportato.`
          : "La selezione di Archivio Flow non contiene foto ancora leggibili.");
      } catch (error) {
        if (active) setStatus(error instanceof Error ? error.message : "Importazione da Archivio Flow non riuscita.");
      } finally {
        if (active) setIsBusy(false);
      }
    };

    const drainHandoffs = async () => {
      if (draining) {
        drainAgain = true;
        return;
      }
      draining = true;
      try {
        do {
          drainAgain = false;
          while (active) {
            const projectPath = await api.consumePendingOpenProjectPath();
            if (!active || !projectPath) break;
            try {
              const handoff = await api.consumePhotoSelectionHandoff(projectPath);
              if (active && handoff) await acceptHandoff(handoff);
            } catch (error) {
              if (active) setStatus(error instanceof Error ? error.message : "Handoff Archivio Flow non valido.");
            } finally {
              await api.acknowledgeOpenProjectRequest(projectPath).catch(() => undefined);
            }
          }
        } while (active && drainAgain);
      } finally {
        draining = false;
      }
    };

    const removeListener = api.onOpenProjectRequest(() => {
      void drainHandoffs();
    });
    // Il rinvio al task successivo evita che il primo setup di React
    // StrictMode reclami il manifest prima del cleanup simulato.
    const startTimer = window.setTimeout(() => {
      void api.markOpenProjectRequestReady()
        .then(() => drainHandoffs())
        .catch((error: unknown) => {
          if (active) setStatus(error instanceof Error ? error.message : "Collegamento Archivio Flow non disponibile.");
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(startTimer);
      removeListener();
    };
  }, []);

  const handleBrowseFolder = async () => {
    setIsBusy(true);
    setStatus("Importazione foto...");
    try {
      if (window.filexDesktop?.openFolder) {
        const result = await importDesktopFolder((completed, total) => {
          setStatus(`Preparo le anteprime ${completed}/${total}...`);
        });
        if (result.cancelled) {
          setStatus("Importazione annullata: le foto già caricate sono rimaste invariate.");
          return;
        }
        handleAssetsImported(result.assets);
        const extendedHint = result.failedExtendedPreviewCount > 0
          ? " Per HEIC/HEIF/TIFF verifica i codec immagini di Windows."
          : "";
        if (result.assets.length > 0) {
          const failure = result.failedPreviewCount > 0 ? ` ${result.failedPreviewCount} file non leggibili ignorati.` : "";
          setStatus(`${result.assets.length} foto da ${result.folderName}.${failure}${extendedHint}`);
        } else if (result.failedPreviewCount > 0) {
          setStatus(`Nessuna foto leggibile: ${result.failedPreviewCount} file non decodificati.${extendedHint}`);
        }
      } else {
        fileInputRef.current?.click();
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Errore durante l'importazione.");
    } finally {
      setIsBusy(false);
    }
  };

  const handleFilesSelected = async (event: ChangeEvent<HTMLInputElement>) => {
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
      const skipped = files.length - nextAssets.length;
      handleAssetsImported(nextAssets);
      if (skipped > 0) {
        setStatus(`${nextAssets.length} foto pronte; ${skipped} file non supportati o non leggibili ignorati.`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Errore durante la lettura delle immagini.");
    } finally {
      setIsBusy(false);
    }
  };

  // =========================================================================
  // Obiettivo e carta
  // =========================================================================
  const setCount = useCallback((count: number) => {
    setPhotosPerPage(Math.max(1, Math.min(MAX_PHOTOS_PER_PAGE, Math.round(count))));
    setPreviewPageIndex(0);
  }, []);

  const selectFormatPreset = useCallback((presetId: string) => {
    setFormatPresetId(presetId);
    setPreviewPageIndex(0);
    if (getPhotoPreset(presetId)?.frameStyle === "polaroid-go") {
      // La cornice bianca su foglio bianco non si vede: servono i segni di taglio.
      setAdjustments((current) => ({ ...current, fitMode: "cover", autoRotateBySourceOrientation: false }));
      setFinishing((current) => ({ ...current, cutGuidesEnabled: true }));
    }
  }, []);

  const setCustomPhotoSize = useCallback((changes: Partial<{ widthCm: number; heightCm: number }>) => {
    setCustomSize((current) => ({
      widthCm: Math.max(MIN_PHOTO_EDGE_CM, Math.min(MAX_PHOTO_EDGE_CM, changes.widthCm ?? current.widthCm)),
      heightCm: Math.max(MIN_PHOTO_EDGE_CM, Math.min(MAX_PHOTO_EDGE_CM, changes.heightCm ?? current.heightCm)),
    }));
    setPreviewPageIndex(0);
  }, []);

  const choosePaper = useCallback((paperId: string) => {
    setPaperChoice((current) => ({ ...current, paperId }));
    setPreviewPageIndex(0);
  }, []);

  const setCustomPaperSize = useCallback((changes: Partial<{ widthCm: number; heightCm: number }>) => {
    setPaperChoice((current) => ({
      ...current,
      paperId: CUSTOM_PAPER_ID,
      customWidthCm: changes.widthCm ?? current.customWidthCm,
      customHeightCm: changes.heightCm ?? current.customHeightCm,
    }));
    setPreviewPageIndex(0);
  }, []);

  const setOrientation = useCallback((orientation: SheetOrientation) => {
    setPaperChoice((current) => ({ ...current, orientation }));
    setPreviewPageIndex(0);
  }, []);

  const setMarginMm = useCallback((marginMm: number) => setPaperChoice((current) => ({ ...current, marginMm })), []);
  const setGapMm = useCallback((gapMm: number) => setPaperChoice((current) => ({ ...current, gapMm })), []);

  /** Riduce la misura personalizzata finché entra nella carta scelta. */
  const shrinkCustomGoalToPaper = useCallback(() => {
    if (goal.kind !== "custom") return;
    const shrunk = shrinkGoalToSheet(goal, sheet);
    if (shrunk.kind === "custom") {
      setCustomPhotoSize({ widthCm: shrunk.widthCm, heightCm: shrunk.heightCm });
      setStatus(`Foto ridotta a ${shrunk.widthCm} × ${shrunk.heightCm} cm per farla entrare nel foglio.`);
    }
  }, [goal, setCustomPhotoSize, sheet]);

  const handleFitModeChange = (fitMode: PhotoFitMode) => {
    setAdjustments((current) => ({ ...current, fitMode }));
    setInteractionHint(fitMode === "contain"
      ? "Adatta: la foto resta intera, con bordo bianco dove serve."
      : "Riempi: la foto riempie tutto lo spazio ritagliando l'eccedenza.");
  };

  const handleAutoRotateChange = (autoRotateBySourceOrientation: boolean) => {
    setAdjustments((current) => ({ ...current, autoRotateBySourceOrientation }));
    setInteractionHint(autoRotateBySourceOrientation
      ? "Rotazione automatica attiva: le foto seguono l'orientamento del formato."
      : "Rotazione automatica disattivata.");
  };

  const handleLogoSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const imageUrl = URL.createObjectURL(file);
    revokeBlobUrl(logoUrlRef.current);
    setLogo((current) => ({ ...current, enabled: true, imageUrl }));
  };

  const chooseOutputFolder = async () => {
    const folder = await window.filexDesktop?.chooseOutputFolder?.();
    if (folder) setOutputDirectoryPath(folder);
  };

  // =========================================================================
  // Editor esterno
  // =========================================================================
  const refreshAssetFromDisk = useCallback(async (assetId: string) => {
    const asset = assetsRef.current.find((item) => item.id === assetId);
    if (!asset?.absolutePath || typeof window.filexDesktop?.getPreview !== "function") {
      setStatus("Questa foto non ha un percorso file aggiornabile.");
      return false;
    }
    const stat = typeof window.filexDesktop.statFiles === "function"
      ? (await window.filexDesktop.statFiles([asset.absolutePath]))[0]
      : null;
    const sourceFileKey = stat ? `${stat.size}:${stat.lastModified}` : String(Date.now());
    const preview = await window.filexDesktop.getPreview(asset.absolutePath, { maxDimension: DESKTOP_PREVIEW_MAX_DIMENSION, sourceFileKey });
    if (!preview) {
      setStatus("Impossibile aggiornare l'anteprima della foto.");
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
  }, []);

  const openActiveInEditor = async () => {
    if (!activeAsset?.absolutePath) {
      setStatus("Per aprire l'editor serve una foto importata da una cartella del desktop.");
      return;
    }
    if (typeof window.filexDesktop?.openWithEditor !== "function") {
      setStatus("Il collegamento al desktop per aprire un editor esterno non è disponibile.");
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
    setStatus(`Aperta nell'editor: ${activeAsset.absolutePath}. Se salvi una copia, usa «Usa file salvato».`);
  };

  const relinkActiveAssetFromSavedFile = async () => {
    if (!activeAsset) return;
    if (typeof window.filexDesktop?.chooseImageFile !== "function" || typeof window.filexDesktop?.getPreview !== "function") {
      setStatus("La selezione del file non è disponibile in questa sessione desktop.");
      return;
    }
    const selectedPath = await window.filexDesktop.chooseImageFile(activeAsset.absolutePath);
    if (!selectedPath) return;
    const stat = typeof window.filexDesktop.statFiles === "function"
      ? (await window.filexDesktop.statFiles([selectedPath]))[0]
      : null;
    const sourceFileKey = stat ? `${stat.size}:${stat.lastModified}` : String(Date.now());
    const preview = await window.filexDesktop.getPreview(selectedPath, { maxDimension: DESKTOP_PREVIEW_MAX_DIMENSION, sourceFileKey });
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
    setStoredCrops((current) => {
      const next = { ...current };
      delete next[activeAsset.id];
      return next;
    });
    setEditingWatch({
      assetId: activeAsset.id,
      absolutePath: selectedPath,
      size: stat?.size ?? updatedAsset.size ?? 0,
      lastModified: stat?.lastModified ?? updatedAsset.lastModified ?? 0,
    });
    setStatus(`Foto collegata al file salvato: ${selectedPath}`);
    setInteractionHint("File salvato dall'editor collegato alla foto selezionata.");
  };

  useEffect(() => {
    if (!editingWatch || typeof window.filexDesktop?.statFiles !== "function") return;
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

  // =========================================================================
  // Scorciatoie da tastiera (attive solo nel passo «Impagina»)
  // =========================================================================
  const keyboardRef = useRef({ enabled: false });
  const setKeyboardEnabled = useCallback((enabled: boolean) => {
    keyboardRef.current.enabled = enabled;
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!keyboardRef.current.enabled) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (!activeAsset || !activeCrop) return;
      const step = event.shiftKey ? KEYBOARD_FAST_STEP : KEYBOARD_STEP;
      const key = event.key.toLowerCase();
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveActiveCrop(-step, 0);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        moveActiveCrop(step, 0);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveActiveCrop(0, -step);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        moveActiveCrop(0, step);
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setActiveZoom(Math.min(4, zoom + 0.1));
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        setActiveZoom(Math.max(1, zoom - 0.1));
      } else if (key === "r") {
        event.preventDefault();
        resetActiveCrop();
      } else if (event.key === "Enter") {
        event.preventDefault();
        markReviewedAndMove(1);
      } else if (key === "b") {
        event.preventDefault();
        setAdjustments((current) => ({ ...current, blackAndWhiteEnabled: !current.blackAndWhiteEnabled }));
      } else if (key === "x") {
        event.preventDefault();
        rotateActiveCrop();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeAsset, activeCrop, markReviewedAndMove, moveActiveCrop, resetActiveCrop, rotateActiveCrop, setActiveZoom, zoom]);

  // =========================================================================
  // Export
  // =========================================================================
  const handleExport = async () => {
    if (!ready || pages.length === 0) {
      setStatus("Nessun foglio esportabile: controlla foto, formato e carta.");
      return;
    }
    const unreviewed = Math.max(0, assets.length - reviewedCount);
    if (unreviewed > 0 && !window.confirm(
      `${unreviewed} foto non sono state controllate nel passo «Impagina». Vuoi esportare comunque?`,
    )) {
      setStatus("Esportazione annullata: puoi tornare a «Impagina» e controllare le foto.");
      return;
    }
    setIsBusy(true);
    setIsExporting(true);
    setStatus("Esportazione in corso...");
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
          const preview = await window.filexDesktop.getPreview(asset.absolutePath, {
            maxDimension: requiredMaxDimension,
            sourceFileKey: `${asset.size ?? 0}:${asset.lastModified ?? 0}`,
          });
          if (!preview) {
            throw new Error(`Impossibile preparare la sorgente ad alta risoluzione: ${asset.fileName}`);
          }
          const sourceUrl = bytesToObjectUrl(preview.bytes, preview.mimeType);
          return {
            asset: { ...asset, sourceUrl, width: preview.width, height: preview.height },
            release: () => revokeBlobUrl(sourceUrl),
          };
        },
        onProgress: (completed, total, label) => setStatus(`${completed}/${total} ${label}`),
      });
      setStatus(`Esportazione completata: ${exported.length} ${"file"}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Errore durante l'esportazione.");
    } finally {
      setIsBusy(false);
      setIsExporting(false);
    }
  };

  return {
    // refs
    fileInputRef,
    logoInputRef,
    // foto
    assets,
    copies,
    setCopies,
    printCount,
    activeIndex,
    setActiveIndex,
    activeAsset,
    activeCrop,
    assetsById,
    cropsById,
    reviewedCount,
    zoom,
    // obiettivo
    goal,
    goalKind,
    setGoalKind,
    goalValid,
    photosPerPage,
    setCount,
    countAspectId,
    setCountAspectId,
    formatPresetId,
    selectFormatPreset,
    customSize,
    setCustomPhotoSize,
    // carta
    paperChoice,
    paper,
    sheet,
    evaluations,
    recommendedPaperId,
    choosePaper,
    setCustomPaperSize,
    setOrientation,
    setMarginMm,
    setGapMm,
    orientationAdvice,
    shrinkCustomGoalToPaper,
    // risultato
    printSpec,
    layout,
    ready,
    perPage,
    pages,
    currentPage,
    previewPageIndex: safePageIndex,
    setPreviewPageIndex,
    dpi,
    setDpi,
    // ritocchi
    logo,
    setLogo,
    adjustments,
    setAdjustments,
    finishing,
    setFinishing,
    handleFitModeChange,
    handleAutoRotateChange,
    handleLogoSelected,
    // export
    format,
    setFormat,
    quality,
    setQuality,
    fileNamePrefix,
    setFileNamePrefix,
    outputDirectoryPath,
    chooseOutputFolder,
    handleExport,
    // interfaccia
    status,
    setStatus,
    interactionHint,
    isBusy,
    isExporting,
    isDraggingCrop,
    handleBrowseFolder,
    handleFilesSelected,
    removeAsset,
    // ritaglio
    updateActiveCrop,
    setActiveZoom,
    resetActiveCrop,
    rotateActiveCrop,
    markReviewedAndMove,
    selectAssetById,
    startSheetSlotDrag,
    moveSheetSlotDrag,
    stopSheetSlotDrag,
    setKeyboardEnabled,
    // editor
    openActiveInEditor,
    refreshAssetFromDisk,
    relinkActiveAssetFromSavedFile,
  };
}

export type Workbench = ReturnType<typeof useWorkbench>;
