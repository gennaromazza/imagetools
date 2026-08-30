import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useLayoutEffect } from "react";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  Scissors,
  Download,
  RotateCcw,
  CheckCircle,
  Save,
  ZoomIn,
  ZoomOut,
  Move,
  FileImage,
  Loader,
  AlertTriangle,
  PanelLeft,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { Slider } from "../components/ui/slider";
import { type ImageItem, useProject } from "../contexts/ProjectContext";
import { getCustomTemplateBackgroundFiles, getImageFile } from "../contexts/ProjectContext";
import { useProcessImage } from "../hooks/useApi";
import { createCompressedPreview } from "../utils/imagePreview";
import { getCustomTemplateVariant, getPresetFrameDataUrl, getProjectTemplateGeometry } from "../lib/templateGeometry";
import { exportCurrentProjectPackage } from "../lib/portablePackages";
import { resolveApiAssetUrl } from "../lib/apiUrls";
import { getPartyFramePreset } from "../../../server/templateCatalog";
import {
  getCoverCropMetrics,
  MAX_CROP_ZOOM,
  MIN_CROP_ZOOM,
  normalizeCropTransform,
  pixelsToNormalizedOffset,
  type CropTransform,
} from "../lib/cropGeometry";
import { fitPreviewSurface } from "../lib/workspaceLayout";

type PreviewEntry = {
  url: string;
  width: number;
  height: number;
};

type ViewportSize = {
  width: number;
  height: number;
};

type DragState = {
  pointerId: number;
  imageId: string;
  startX: number;
  startY: number;
  originCrop: CropTransform;
};

type CropDraft = {
  imageId: string;
  crop: CropTransform;
};

function cropsAreEqual(first: CropTransform, second: CropTransform): boolean {
  return (
    Math.abs(first.offsetX - second.offsetX) < 0.000_001 &&
    Math.abs(first.offsetY - second.offsetY) < 0.000_001 &&
    Math.abs(first.zoom - second.zoom) < 0.000_001
  );
}

function ownedBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function FitPreviewSurface({
  aspectRatio,
  children,
}: {
  aspectRatio: number;
  children: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [surfaceSize, setSurfaceSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const updateSize = () => {
      const rect = host.getBoundingClientRect();
      const next = fitPreviewSurface(rect.width, rect.height, aspectRatio);
      setSurfaceSize((current) =>
        Math.abs(current.width - next.width) < 0.5 && Math.abs(current.height - next.height) < 0.5
          ? current
          : next
      );
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(host);
    return () => observer.disconnect();
  }, [aspectRatio]);

  return (
    <div ref={hostRef} className="relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden">
      <div
        data-partyframe-preview-surface
        className="relative shrink-0 overflow-hidden rounded-[24px] bg-[var(--brand-accent)] shadow-[0_28px_72px_rgba(0,0,0,0.24)]"
        style={{
          width: `${surfaceSize.width}px`,
          height: `${surfaceSize.height}px`,
          aspectRatio,
          visibility: surfaceSize.width > 0 && surfaceSize.height > 0 ? "visible" : "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}

async function createPreviewEntry(
  image: ImageItem,
  file: File | undefined,
  maxDimension: number,
  quality: number
): Promise<PreviewEntry | null> {
  if (image.absolutePath && window.filexDesktop?.getThumbnail) {
    const thumbnail = await window.filexDesktop.getThumbnail(
      image.absolutePath,
      maxDimension,
      quality,
      `${image.size ?? 0}:${image.lastModified ?? 0}`,
      { profile: maxDimension <= 480 ? "fast" : "balanced", preferEmbeddedPreview: true }
    );
    if (thumbnail) {
      const blob = new Blob([ownedBytes(thumbnail.bytes)], { type: thumbnail.mimeType });
      return { url: URL.createObjectURL(blob), width: thumbnail.width, height: thumbnail.height };
    }
  }

  if (!file) {
    return null;
  }

  return createCompressedPreview(file, { maxDimension, quality });
}

function imageDisplayName(image: ImageItem): string {
  return (image.relativePath || image.path).replace(/\\/g, "/").split("/").pop() || image.path;
}

export default function Workspace() {
  const navigate = useNavigate();
  const {
    project,
    updateImageCrop,
    migrateImageCrop,
    updateImagesCrop,
    updateImageApproval,
    updateImageProcessing,
  } = useProject();
  const { processImage, loading: processingLoading } = useProcessImage();
  const safeImages = Array.isArray(project.images) ? project.images : [];
  const [selectedImage, setSelectedImage] = useState(0);
  const [filterMode, setFilterMode] = useState<"all" | "pending" | "approved">("all");
  const [processingImageId, setProcessingImageId] = useState<string | null>(null);
  const [processedImages, setProcessedImages] = useState<Map<string, string>>(new Map());
  const [imagePreviews, setImagePreviews] = useState<Map<string, PreviewEntry>>(new Map());
  const [activePreview, setActivePreview] = useState<PreviewEntry | null>(null);
  const [preparingActivePreview, setPreparingActivePreview] = useState(false);
  const [preparedPreviewCount, setPreparedPreviewCount] = useState(0);
  const [preparingPreviews, setPreparingPreviews] = useState(false);
  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 460, height: 613 });
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [bulkApproveState, setBulkApproveState] = useState<{ total: number; completed: number } | null>(null);
  const [cropDraft, setCropDraft] = useState<CropDraft | null>(null);
  const [showImagesPanel, setShowImagesPanel] = useState(false);
  const [showAdjustmentsPanel, setShowAdjustmentsPanel] = useState(false);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const thumbRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const dragStateRef = useRef<DragState | null>(null);
  const cropDraftRef = useRef<CropDraft | null>(null);
  const wheelCommitTimerRef = useRef<number | null>(null);
  const viewportWheelHandlerRef = useRef<(event: WheelEvent) => void>(() => undefined);
  const currentImageRef = useRef(safeImages[selectedImage]);
  const projectRef = useRef(project);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    currentImageRef.current = safeImages[selectedImage];
  }, [safeImages, selectedImage]);

  useEffect(() => {
    const draft = cropDraftRef.current;
    if (!draft) {
      return;
    }

    const image = safeImages.find((candidate) => candidate.id === draft.imageId);
    if (!image || cropsAreEqual(normalizeCropTransform(image.crop), draft.crop)) {
      cropDraftRef.current = null;
      setCropDraft(null);
    }
  }, [safeImages]);

  useEffect(() => {
    return () => {
      if (wheelCommitTimerRef.current !== null) {
        window.clearTimeout(wheelCommitTimerRef.current);
      }
      const pending = cropDraftRef.current;
      const persistedImage = pending
        ? projectRef.current.images.find((image) => image.id === pending.imageId)
        : undefined;
      if (pending && persistedImage && !cropsAreEqual(normalizeCropTransform(persistedImage.crop), pending.crop)) {
        updateImageCrop(pending.imageId, pending.crop);
      }
    };
  }, []);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setViewportSize((current) =>
          Math.abs(current.width - rect.width) < 0.5 && Math.abs(current.height - rect.height) < 0.5
            ? current
            : { width: rect.width, height: rect.height }
        );
      }
    };

    updateSize();

    const observer = new ResizeObserver(() => updateSize());
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const previewSourceKey = `${project.projectId}:${project.sourcePath}:${safeImages
    .map((img) => `${img.id}:${img.absolutePath ?? ""}:${img.size ?? 0}:${img.lastModified ?? 0}`)
    .join("|")}`;
  const previewImages = useMemo(
    () => safeImages,
    [previewSourceKey]
  );

  useEffect(() => {
    const generatedPreviews = new Map<string, PreviewEntry>();
    const pendingPreviews = new Map<string, PreviewEntry>();
    let cancelled = false;
    let pendingCompleted = 0;
    let flushTimer: number | null = null;

    setImagePreviews(new Map());
    setPreparedPreviewCount(0);
    setPreparingPreviews(previewImages.length > 0);

    const flushPreviewUpdates = () => {
      flushTimer = null;
      if (cancelled) return;
      const additions = [...pendingPreviews.entries()];
      const completed = pendingCompleted;
      pendingPreviews.clear();
      pendingCompleted = 0;
      if (additions.length > 0) {
        setImagePreviews((previous) => {
          const next = new Map(previous);
          additions.forEach(([id, preview]) => next.set(id, preview));
          return next;
        });
      }
      if (completed > 0) setPreparedPreviewCount((count) => count + completed);
    };

    const schedulePreviewFlush = () => {
      if (flushTimer === null) flushTimer = window.setTimeout(flushPreviewUpdates, 48);
    };

    let cursor = 0;
    const prepareWorker = async () => {
      while (!cancelled) {
        const index = cursor;
        cursor += 1;
        const image = previewImages[index];
        if (!image) return;

        try {
          const file = getImageFile(image.id, project.projectId);
          const preview = await createPreviewEntry(image, file, 420, 0.72);
          if (cancelled) {
            if (preview) URL.revokeObjectURL(preview.url);
            return;
          }
          if (preview) {
            generatedPreviews.set(image.id, preview);
            pendingPreviews.set(image.id, preview);
          }
        } catch (error) {
          console.error(`Failed to prepare thumbnail for ${imageDisplayName(image)}:`, error);
        } finally {
          if (!cancelled) {
            pendingCompleted += 1;
            schedulePreviewFlush();
          }
        }
      }
    };

    const prepare = async () => {
      const workerCount = Math.min(4, Math.max(1, previewImages.length));
      await Promise.all(Array.from({ length: workerCount }, () => prepareWorker()));

      if (!cancelled) {
        if (flushTimer !== null) window.clearTimeout(flushTimer);
        flushPreviewUpdates();
        setPreparingPreviews(false);
      }
    };

    void prepare();

    return () => {
      cancelled = true;
      if (flushTimer !== null) window.clearTimeout(flushTimer);
      generatedPreviews.forEach((preview) => URL.revokeObjectURL(preview.url));
    };
  }, [previewImages, project.projectId]);

  const images = safeImages;
  const currentImage = images[selectedImage];

  useEffect(() => {
    let cancelled = false;
    let generatedUrl: string | null = null;
    setActivePreview(null);
    setPreparingActivePreview(Boolean(currentImage));

    if (!currentImage) {
      return;
    }

    const prepareActive = async () => {
      try {
        const file = getImageFile(currentImage.id, project.projectId);
        const preview = await createPreviewEntry(currentImage, file, 1800, 0.84);
        if (!preview) return;
        generatedUrl = preview.url;
        if (cancelled) {
          URL.revokeObjectURL(preview.url);
          return;
        }
        setActivePreview(preview);
      } catch (error) {
        console.error(`Failed to prepare active preview for ${imageDisplayName(currentImage)}:`, error);
      } finally {
        if (!cancelled) {
          setPreparingActivePreview(false);
        }
      }
    };

    void prepareActive();
    return () => {
      cancelled = true;
      if (generatedUrl) URL.revokeObjectURL(generatedUrl);
    };
  }, [currentImage?.id, previewSourceKey, project.projectId]);

  useEffect(() => {
    if (
      !currentImage ||
      !activePreview ||
      (currentImage.crop.legacyX === undefined && currentImage.crop.legacyY === undefined)
    ) {
      return;
    }

    const baseCrop = normalizeCropTransform(currentImage.crop);
    const metrics = getCoverCropMetrics(activePreview, viewportSize, baseCrop);
    if (!metrics) return;

    migrateImageCrop(currentImage.id, {
      ...baseCrop,
      offsetX: pixelsToNormalizedOffset(currentImage.crop.legacyX ?? 0, metrics.maxOffsetX),
      offsetY: pixelsToNormalizedOffset(currentImage.crop.legacyY ?? 0, metrics.maxOffsetY),
    });
  }, [
    activePreview,
    currentImage?.id,
    currentImage?.crop.legacyX,
    currentImage?.crop.legacyY,
    migrateImageCrop,
    viewportSize.height,
    viewportSize.width,
  ]);

  const filteredImages = useMemo(() => {
    return images.filter((img) => {
      if (filterMode === "all") return true;
      if (filterMode === "pending") return img.approval === "pending" || img.approval === "needs-adjustment";
      return img.approval === "approved";
    });
  }, [filterMode, images]);
  const imageIndexById = useMemo(
    () => new Map(images.map((image, index) => [image.id, index])),
    [images]
  );

  useEffect(() => {
    if (!currentImage) {
      return;
    }

    const existsInFilter = filteredImages.some((img) => img.id === currentImage.id);
    if (existsInFilter) {
      return;
    }

    if (filteredImages.length === 0) {
      setSelectedImage(0);
      return;
    }

    const nextId = filteredImages[0].id;
    const nextIndex = images.findIndex((img) => img.id === nextId);
    if (nextIndex >= 0) {
      setSelectedImage(nextIndex);
    }
  }, [currentImage, filteredImages, images]);

  useEffect(() => {
    if (!currentImage) {
      return;
    }

    const thumb = thumbRefs.current.get(currentImage.id);
    thumb?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentImage]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }

    const handleWheel = (event: WheelEvent) => viewportWheelHandlerRef.current(event);
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [currentImage?.id]);

  if (!currentImage) {
    return (
      <div className="h-screen bg-[var(--app-bg)] text-[var(--app-text)] flex items-center justify-center">
        <div className="text-center">
          <FileImage className="w-12 h-12 text-[var(--app-text-subtle)] mx-auto mb-4" />
          <p className="text-[var(--app-text-muted)] mb-4">Nessuna immagine caricata</p>
          <Button
            type="button"
            onClick={() => navigate("/new-project")}
            className="bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)] hover:bg-[var(--brand-primary-strong)]"
          >
            Carica Immagini
          </Button>
        </div>
      </div>
    );
  }

  const currentPreview = activePreview;
  const visibleIndex = filteredImages.findIndex((img) => img.id === currentImage.id);
  const templateGeometry = getProjectTemplateGeometry(project.template, currentImage.orientation, project.customTemplate);
  const customTemplateVariant = getCustomTemplateVariant(project.customTemplate, currentImage.orientation);
  const frameAspectRatio = templateGeometry.width / templateGeometry.height;
  const outerBorderSize = templateGeometry.borderSizePx ?? 0;
  const photoViewportStyle = {
    left: `${((templateGeometry.photoAreaX + outerBorderSize) / templateGeometry.width) * 100}%`,
    top: `${((templateGeometry.photoAreaY + outerBorderSize) / templateGeometry.height) * 100}%`,
    width: `${((templateGeometry.photoAreaWidth - outerBorderSize * 2) / templateGeometry.width) * 100}%`,
    height: `${((templateGeometry.photoAreaHeight - outerBorderSize * 2) / templateGeometry.height) * 100}%`,
  };
  const customBackgroundPreviewUrl =
    project.template === "custom" ? customTemplateVariant?.backgroundPreviewUrl : undefined;
  const presetBackgroundPreviewUrl = project.template === "custom"
    ? undefined
    : getPresetFrameDataUrl(project.template, currentImage.orientation);

  const normalizedCurrentCrop = normalizeCropTransform(currentImage.crop);
  const legacyMetrics = currentPreview
    ? getCoverCropMetrics(currentPreview, viewportSize, normalizedCurrentCrop)
    : null;
  const effectiveCurrentCrop = currentImage.crop.legacyX !== undefined || currentImage.crop.legacyY !== undefined
    ? normalizeCropTransform({
        ...normalizedCurrentCrop,
        offsetX: pixelsToNormalizedOffset(currentImage.crop.legacyX ?? 0, legacyMetrics?.maxOffsetX ?? 0),
        offsetY: pixelsToNormalizedOffset(currentImage.crop.legacyY ?? 0, legacyMetrics?.maxOffsetY ?? 0),
      })
    : normalizedCurrentCrop;
  const currentCropDraft = cropDraft?.imageId === currentImage.id ? cropDraft.crop : null;
  const displayedCurrentCrop = currentCropDraft ?? effectiveCurrentCrop;
  const hasUncommittedCrop = currentCropDraft !== null && !cropsAreEqual(currentCropDraft, effectiveCurrentCrop);
  const processedImageUrl = hasUncommittedCrop
    ? undefined
    : resolveApiAssetUrl(processedImages.get(currentImage.id));
  const canCompareCurrentImage = Boolean(processedImages.get(currentImage.id)) && !hasUncommittedCrop;
  const currentMetrics = currentPreview
    ? getCoverCropMetrics(currentPreview, viewportSize, displayedCurrentCrop)
    : null;
  const imageStyle = currentMetrics
    ? {
        width: `${currentMetrics.renderedWidth}px`,
        height: `${currentMetrics.renderedHeight}px`,
        left: `calc(50% - ${currentMetrics.renderedWidth / 2}px + ${currentMetrics.translationX}px)`,
        top: `calc(50% - ${currentMetrics.renderedHeight / 2}px + ${currentMetrics.translationY}px)`,
      }
    : undefined;

  const setCropDraftForImage = (imageId: string, nextCrop: CropTransform) => {
    const nextDraft = { imageId, crop: normalizeCropTransform(nextCrop) };
    cropDraftRef.current = nextDraft;
    setCropDraft(nextDraft);
    return nextDraft.crop;
  };

  const commitCropForImage = (imageId: string, nextCrop: CropTransform): ImageItem | null => {
    const latestImage = projectRef.current.images.find((image) => image.id === imageId);
    if (!latestImage) {
      return null;
    }

    const normalizedCrop = normalizeCropTransform(nextCrop);
    if (cropsAreEqual(normalizeCropTransform(latestImage.crop), normalizedCrop)) {
      if (cropDraftRef.current?.imageId === imageId) {
        cropDraftRef.current = null;
        setCropDraft(null);
      }
      return latestImage;
    }

    const committedImage: ImageItem = {
      ...latestImage,
      crop: normalizedCrop,
      cropRevision: latestImage.cropRevision + 1,
      approval: "pending",
      approvedRevision: undefined,
      processingStatus: "idle",
      processingError: undefined,
    };

    projectRef.current = {
      ...projectRef.current,
      images: projectRef.current.images.map((image) => image.id === imageId ? committedImage : image),
    };
    if (currentImageRef.current?.id === imageId) {
      currentImageRef.current = committedImage;
    }

    setProcessedImages((previous) => {
      if (!previous.has(imageId)) {
        return previous;
      }
      const next = new Map(previous);
      next.delete(imageId);
      return next;
    });
    updateImageCrop(imageId, normalizedCrop);
    return committedImage;
  };

  const commitPendingCrop = (imageId: string = currentImage.id): ImageItem | null => {
    const pending = cropDraftRef.current;
    const latestImage = projectRef.current.images.find((image) => image.id === imageId) ?? null;
    if (!pending || pending.imageId !== imageId) {
      return latestImage;
    }
    return commitCropForImage(imageId, pending.crop);
  };

  const applyCurrentCrop = (nextCrop: CropTransform): ImageItem | null => {
    const normalizedCrop = setCropDraftForImage(currentImage.id, nextCrop);
    return commitCropForImage(currentImage.id, normalizedCrop);
  };

  const getInteractiveCrop = (): CropTransform => {
    const pending = cropDraftRef.current;
    return pending?.imageId === currentImage.id ? pending.crop : displayedCurrentCrop;
  };

  const moveCurrentCropByPixels = (deltaX: number, deltaY: number) => {
    if (!currentPreview) return;
    const crop = displayedCurrentCrop;
    const metrics = getCoverCropMetrics(currentPreview, viewportSize, crop);
    if (!metrics) return;
    applyCurrentCrop({
      ...crop,
      offsetX: pixelsToNormalizedOffset(metrics.translationX + deltaX, metrics.maxOffsetX),
      offsetY: pixelsToNormalizedOffset(metrics.translationY + deltaY, metrics.maxOffsetY),
    });
  };

  const runKeyboardAction = ({
    key,
    altKey,
    ctrlOrMetaKey,
    shiftKey,
  }: {
    key: string;
    altKey: boolean;
    ctrlOrMetaKey: boolean;
    shiftKey: boolean;
  }): boolean => {
    const moveStep = shiftKey ? 4 : 18;

    switch (key) {
      case "ArrowLeft":
        if (altKey) {
          selectRelativeImage(-1);
        } else {
          moveCurrentCropByPixels(-moveStep, 0);
        }
        return true;
      case "ArrowRight":
        if (altKey) {
          selectRelativeImage(1);
        } else {
          moveCurrentCropByPixels(moveStep, 0);
        }
        return true;
      case "ArrowUp":
        if (altKey) {
          selectRelativeImage(-1);
        } else {
          moveCurrentCropByPixels(0, -moveStep);
        }
        return true;
      case "ArrowDown":
        if (altKey) {
          selectRelativeImage(1);
        } else {
          moveCurrentCropByPixels(0, moveStep);
        }
        return true;
      case "+":
      case "=":
        if (ctrlOrMetaKey) {
          const crop = getInteractiveCrop();
          applyCurrentCrop({ ...crop, zoom: Math.min(MAX_CROP_ZOOM, crop.zoom + 5) });
          return true;
        }
        return false;
      case "-":
        if (ctrlOrMetaKey) {
          const crop = getInteractiveCrop();
          applyCurrentCrop({ ...crop, zoom: Math.max(MIN_CROP_ZOOM, crop.zoom - 5) });
          return true;
        }
        return false;
      case "PageDown":
        selectRelativeImage(1);
        return true;
      case "PageUp":
        selectRelativeImage(-1);
        return true;
      default:
        return false;
    }
  };

  const handlePositionChange = (axis: "offsetX" | "offsetY", value: number[]) => {
    setCropDraftForImage(currentImage.id, { ...getInteractiveCrop(), [axis]: value[0] });
  };

  const handlePositionCommit = (axis: "offsetX" | "offsetY", value: number[]) => {
    applyCurrentCrop({ ...getInteractiveCrop(), [axis]: value[0] });
  };

  const handleZoomChange = (value: number[]) => {
    setCropDraftForImage(currentImage.id, { ...getInteractiveCrop(), zoom: value[0] });
  };

  const handleZoomCommit = (value: number[]) => {
    applyCurrentCrop({ ...getInteractiveCrop(), zoom: value[0] });
  };

  const handleReset = () => {
    applyCurrentCrop({ offsetX: 0, offsetY: 0, zoom: MIN_CROP_ZOOM });
  };

  const handleCenterAll = () => {
    if (wheelCommitTimerRef.current !== null) {
      window.clearTimeout(wheelCommitTimerRef.current);
      wheelCommitTimerRef.current = null;
    }
    cropDraftRef.current = null;
    setCropDraft(null);
    const centeredCrop = { offsetX: 0, offsetY: 0, zoom: MIN_CROP_ZOOM };
    const changedIds = images
      .filter((image) => !cropsAreEqual(normalizeCropTransform(image.crop), centeredCrop))
      .map((image) => image.id);
    if (changedIds.length === 0) {
      toast.info("Le foto sono già centrate");
      return;
    }
    updateImagesCrop(changedIds, centeredCrop);
    setProcessedImages((current) => {
      const next = new Map(current);
      changedIds.forEach((id) => next.delete(id));
      return next;
    });
    toast.success("Ritagli centrati", { description: `${changedIds.length} immagini riportate al ritaglio iniziale.` });
  };

  const handleApplyToSimilar = () => {
    const committedCurrentImage = commitPendingCrop(currentImage.id);
    const cropToApply = committedCurrentImage
      ? normalizeCropTransform(committedCurrentImage.crop)
      : displayedCurrentCrop;
    const similarIds = images
      .filter((image) =>
        image.orientation === currentImage.orientation &&
        image.id !== currentImage.id &&
        !cropsAreEqual(normalizeCropTransform(image.crop), cropToApply)
      )
      .map((image) => image.id);
    if (similarIds.length === 0) {
      toast.info("Nessuna modifica da applicare", {
        description: "Non ci sono altre foto dello stesso orientamento da aggiornare.",
      });
      return;
    }
    updateImagesCrop(similarIds, cropToApply);
    setProcessedImages((current) => {
      const next = new Map(current);
      similarIds.forEach((id) => next.delete(id));
      return next;
    });
    toast.success("Regolazioni applicate", {
      description: `Crop applicato a ${similarIds.length} foto ${currentImage.orientation === "vertical" ? "verticali" : "orizzontali"}.`,
    });
  };

  const selectRelativeImage = (direction: 1 | -1) => {
    if (filteredImages.length === 0 || visibleIndex < 0) {
      return;
    }

    const nextVisibleIndex = Math.max(0, Math.min(filteredImages.length - 1, visibleIndex + direction));
    const nextId = filteredImages[nextVisibleIndex]?.id;
    if (!nextId) {
      return;
    }

    const nextIndex = images.findIndex((img) => img.id === nextId);
    if (nextIndex >= 0) {
      commitPendingCrop(currentImage.id);
      setSelectedImage(nextIndex);
    }
  };

  const processSingleImage = async (imageToProcess: ImageItem) => {
    const imageFile = getImageFile(imageToProcess.id, project.projectId);

    if (!imageFile && !imageToProcess.absolutePath) {
      updateImageProcessing(imageToProcess.id, "error", "File originale non disponibile: ricollega la cartella sorgente.");
      return false;
    }

    const requestedProjectId = project.projectId;
    const requestedRevision = imageToProcess.cropRevision;
    const requestedCrop = normalizeCropTransform(imageToProcess.crop);
    setProcessingImageId(imageToProcess.id);
    updateImageProcessing(imageToProcess.id, "processing");
    const result = await processImage(
      imageFile ?? null,
      project.template,
      requestedCrop,
      imageToProcess.orientation,
      project.customTemplate,
      getCustomTemplateBackgroundFiles(),
      { absolutePath: imageToProcess.absolutePath }
    );

    const latestImage = projectRef.current.images.find((image) => image.id === imageToProcess.id);
    if (
      projectRef.current.projectId !== requestedProjectId ||
      !latestImage ||
      latestImage.cropRevision !== requestedRevision
    ) {
      return false;
    }

    if (result) {
      setProcessedImages((prev) => new Map(prev).set(imageToProcess.id, result.imageUrl));
      updateImageApproval(imageToProcess.id, "approved");
      return true;
    }

    updateImageProcessing(imageToProcess.id, "error", "Il servizio non ha completato l'elaborazione. Riprova.");
    return false;
  };

  const handleApprove = async () => {
    try {
      const imageToProcess = commitPendingCrop(currentImage.id) ?? currentImageRef.current;
      if (!imageToProcess) {
        return;
      }
      const success = await processSingleImage(imageToProcess);

      if (success && visibleIndex < filteredImages.length - 1) {
        selectRelativeImage(1);
      }
    } catch (error) {
      console.error("Error in handleApprove:", error);
      const failedImage = currentImageRef.current;
      if (failedImage) {
        updateImageProcessing(
          failedImage.id,
          "error",
          error instanceof Error ? error.message : "Elaborazione non riuscita."
        );
      }
    } finally {
      setProcessingImageId(null);
    }
  };

  const handleApproveAll = async () => {
    commitPendingCrop(currentImage.id);
    const imagesToProcess = projectRef.current.images.filter(
      (image) => image.approval === "pending" || image.approval === "needs-adjustment"
    );

    if (imagesToProcess.length === 0) {
      return;
    }

    setBulkApproveState({ total: imagesToProcess.length, completed: 0 });
    const bulkProjectId = project.projectId;

    try {
      for (const [index, image] of imagesToProcess.entries()) {
        if (projectRef.current.projectId !== bulkProjectId) break;
        await processSingleImage(image);
        setBulkApproveState({ total: imagesToProcess.length, completed: index + 1 });
      }
    } catch (error) {
      console.error("Error in handleApproveAll:", error);
    } finally {
      setProcessingImageId(null);
      setBulkApproveState(null);
    }
  };

  const handleExport = () => {
    commitPendingCrop(currentImage.id);
    navigate("/export-settings");
  };

  const handleSaveProjectPackage = async () => {
    try {
      commitPendingCrop(currentImage.id);
      await exportCurrentProjectPackage(projectRef.current);
      toast.success("Copia del progetto salvata", {
        description: "Puoi importare questo file JSON su un altro PC Windows o macOS per ripartire dal progetto.",
      });
    } catch (error) {
      toast.error("Export progetto non riuscito", {
        description: error instanceof Error ? error.message : "Impossibile esportare il progetto.",
      });
    }
  };

  const handleComparison = () => {
    const pending = cropDraftRef.current;
    const cropChanged = pending?.imageId === currentImage.id &&
      !cropsAreEqual(pending.crop, effectiveCurrentCrop);
    commitPendingCrop(currentImage.id);
    const comparisonUrl = cropChanged ? null : processedImages.get(currentImage.id) ?? null;
    if (!comparisonUrl) {
      toast.info("Elabora prima la foto", {
        description: "Il confronto sara disponibile dopo aver elaborato questa versione del ritaglio.",
      });
      return;
    }
    navigate("/image-comparison", {
      state: {
        imageId: currentImage.id,
        processedImageUrl: comparisonUrl,
      },
    });
  };

  const handleGoHome = () => {
    commitPendingCrop(currentImage.id);
    navigate("/");
  };

  const handleImagePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!currentPreview || !event.isPrimary || event.button !== 0) {
      return;
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      imageId: currentImage.id,
      startX: event.clientX,
      startY: event.clientY,
      originCrop: displayedCurrentCrop,
    };

    setIsDraggingImage(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
  };

  const handleImagePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.imageId !== currentImage.id) {
      return;
    }

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!currentPreview) return;
    const metrics = getCoverCropMetrics(currentPreview, viewportSize, drag.originCrop);
    if (!metrics) return;

    setCropDraftForImage(drag.imageId, {
      ...drag.originCrop,
      offsetX: pixelsToNormalizedOffset(drag.originCrop.offsetX * metrics.maxOffsetX + deltaX, metrics.maxOffsetX),
      offsetY: pixelsToNormalizedOffset(drag.originCrop.offsetY * metrics.maxOffsetY + deltaY, metrics.maxOffsetY),
    });
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (drag?.pointerId === event.pointerId) {
      dragStateRef.current = null;
      setIsDraggingImage(false);
      commitPendingCrop(drag.imageId);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  };

  const cancelDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (drag?.pointerId === event.pointerId) {
      dragStateRef.current = null;
      setIsDraggingImage(false);
      if (cropDraftRef.current?.imageId === drag.imageId) {
        cropDraftRef.current = null;
        setCropDraft(null);
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  };

  const handleViewportKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const handled = runKeyboardAction({
      key: event.key,
      altKey: event.altKey,
      ctrlOrMetaKey: event.ctrlKey || event.metaKey,
      shiftKey: event.shiftKey,
    });

    if (handled) {
      event.preventDefault();
    }
  };

  const handleViewportWheel = (event: WheelEvent) => {
    if (!event.ctrlKey) {
      return;
    }

    event.preventDefault();
    const delta = event.deltaY < 0 ? 5 : -5;
    const image = currentImage;
    const pending = cropDraftRef.current;
    const currentCrop = pending?.imageId === image.id
      ? pending.crop
      : normalizeCropTransform(image.crop);
    const nextZoom = Math.max(MIN_CROP_ZOOM, Math.min(MAX_CROP_ZOOM, currentCrop.zoom + delta));
    setCropDraftForImage(image.id, { ...currentCrop, zoom: nextZoom });

    if (wheelCommitTimerRef.current !== null) {
      window.clearTimeout(wheelCommitTimerRef.current);
    }
    wheelCommitTimerRef.current = window.setTimeout(() => {
      wheelCommitTimerRef.current = null;
      commitPendingCrop(image.id);
    }, 180);
  };
  viewportWheelHandlerRef.current = handleViewportWheel;

  const approvedCount = images.filter((img) => img.approval === "approved").length;
  const pendingCount = images.filter((img) => img.approval === "pending" || img.approval === "needs-adjustment").length;
  const currentOrientationLabel = currentImage.orientation === "vertical" ? "Verticale" : "Orizzontale";
  const currentStatusLabel = hasUncommittedCrop
    ? "Modifica in corso"
    : currentImage.processingStatus === "processing"
    ? "Elaborazione in corso"
    : currentImage.processingStatus === "error"
      ? "Elaborazione non riuscita"
      : currentImage.approval === "approved"
        ? "Approvata"
        : currentImage.approval === "needs-adjustment"
          ? "Da correggere"
          : "Da controllare";
  const currentStatusIsApproved = !hasUncommittedCrop &&
    currentImage.processingStatus === "idle" &&
    currentImage.approval === "approved";
  const currentFileName = imageDisplayName(currentImage);
  const templateDisplayName = project.template === "custom"
    ? project.customTemplate?.name || "Template personalizzato"
    : getPartyFramePreset(project.template).name;
  const handleFilterChange = (nextFilter: "all" | "pending" | "approved") => {
    commitPendingCrop(currentImage.id);
    const hasMatches = nextFilter === "all" || projectRef.current.images.some((image) =>
      nextFilter === "approved"
        ? image.approval === "approved"
        : image.approval === "pending" || image.approval === "needs-adjustment"
    );
    if (!hasMatches) {
      toast.info("Filtro senza risultati");
      return;
    }
    setFilterMode(nextFilter);
  };

  return (
    <div className="h-screen bg-[radial-gradient(circle_at_top,rgba(103,117,107,0.16),transparent_28%),linear-gradient(180deg,#1f2421_0%,#232925_100%)] text-[var(--app-text)] flex flex-col overflow-hidden">
      <header className="h-16 bg-[var(--app-topbar)] border-b border-[var(--app-border)] backdrop-blur-xl flex items-center gap-4 px-4 xl:px-5 justify-between shrink-0">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-10 px-3 text-sm text-[var(--app-text-muted)] hover:text-[var(--app-text)]"
            onClick={handleGoHome}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Home
          </Button>
          <div className="flex min-w-0 items-center gap-3">
            <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--brand-primary-soft)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:flex">
              <FileImage className="w-5 h-5 text-[var(--brand-accent)]" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold tracking-[-0.02em]">{project.name || "Area di Lavoro"}</div>
              <div className="truncate text-xs text-[var(--app-text-subtle)]">{templateDisplayName} • {project.imageCount.total} immagini</div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-10 border-[var(--app-border-strong)] bg-[var(--app-surface)] px-3 text-sm text-[var(--app-text)] hover:bg-[var(--app-surface-strong)]"
            onClick={() => void handleSaveProjectPackage()}
          >
            <Save className="w-4 h-4 mr-2" />
            <span className="hidden sm:inline">Salva progetto</span>
            <span className="sm:hidden">Salva</span>
          </Button>
          <Button onClick={handleExport} className="h-11 bg-[var(--brand-primary)] px-5 text-[15px] text-[var(--brand-primary-foreground)] hover:bg-[var(--brand-primary-strong)]">
            <Download className="w-4 h-4 mr-2" />
            Esporta
          </Button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {showImagesPanel || showAdjustmentsPanel ? (
          <button
            type="button"
            aria-label="Chiudi pannelli laterali"
            className="absolute inset-0 z-10 bg-black/45 backdrop-blur-[1px] lg:hidden"
            onClick={() => {
              setShowImagesPanel(false);
              setShowAdjustmentsPanel(false);
            }}
          />
        ) : null}
        <aside className={`absolute inset-y-0 left-0 z-20 flex w-64 min-h-0 shrink-0 flex-col border-r border-[var(--app-border)] bg-[var(--app-topbar)] shadow-2xl transition-transform lg:relative lg:z-auto lg:w-56 lg:translate-x-0 lg:shadow-none 2xl:w-64 ${showImagesPanel ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="border-b border-[var(--app-border)] px-3.5 py-3 shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-semibold text-[var(--app-text)]">Immagini</span>
              <span className="rounded-full border border-[var(--app-border)] bg-[var(--app-surface)] px-2.5 py-1 text-[11px] text-[var(--app-text-muted)]">
                {filteredImages.length}
              </span>
            </div>
            <div className="mt-3 flex gap-2">
              <select
                value={filterMode}
                onChange={(event) => handleFilterChange(event.target.value as "all" | "pending" | "approved")}
                aria-label="Filtra immagini per stato"
                className="h-10 min-w-0 flex-1 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] px-3 text-[13px] text-[var(--app-text)] outline-none hover:border-[var(--app-border-strong)] focus:border-[var(--brand-accent)]"
              >
                <option value="all">Tutte</option>
                <option value="pending">Da controllare</option>
                <option value="approved">Approvate</option>
              </select>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-10 rounded-xl border-[var(--app-border-strong)] bg-[var(--app-surface)] text-[var(--app-text-muted)]"
                onClick={handleCenterAll}
                aria-label="Centra il ritaglio di tutte le immagini"
                title="Centra tutte"
              >
                <Scissors className="size-[18px]" />
              </Button>
            </div>
            <p className="mt-2 text-xs text-[var(--app-text-subtle)]">
              {preparingPreviews ? `Miniature ${preparedPreviewCount}/${images.length}` : `${approvedCount} approvate • ${pendingCount} da controllare`}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 px-2.5 py-2.5 space-y-2.5">
            {filteredImages.map((image) => {
              const imageIndex = imageIndexById.get(image.id) ?? -1;
              const preview = imagePreviews.get(image.id);
              const isSelected = selectedImage === imageIndex;

              return (
                <button
                  key={image.id}
                  ref={(node) => {
                    thumbRefs.current.set(image.id, node);
                  }}
                  type="button"
                  onClick={() => {
                    commitPendingCrop(currentImage.id);
                    setSelectedImage(imageIndex);
                    setShowImagesPanel(false);
                  }}
                  style={{ contentVisibility: "auto", containIntrinsicSize: "168px" }}
                  className={`group relative block w-full rounded-2xl overflow-hidden border transition-all text-left ${
                    isSelected
                      ? "border-[var(--brand-accent)] bg-[var(--app-surface)] shadow-[0_18px_44px_rgba(0,0,0,0.24)]"
                      : "border-[var(--app-border)] bg-[var(--app-surface)]/55 hover:border-[var(--app-border-strong)] hover:bg-[var(--app-surface)]"
                  }`}
                >
                  <div className="flex h-40 w-full items-center justify-center overflow-hidden bg-gradient-to-br from-[var(--app-surface-strong)] to-[var(--app-field)] 2xl:h-44">
                    {preview ? (
                      <img
                        src={preview.url}
                        alt={imageDisplayName(image)}
                        className="w-full h-full object-cover pointer-events-none"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span className="text-[var(--app-text-muted)] text-xs">{imageDisplayName(image)}</span>
                    )}
                  </div>
                  {image.approval === "approved" && image.processingStatus === "idle" ? (
                    <div className="absolute top-3 right-3 bg-[var(--success)] rounded-full p-1.5 shadow-[0_10px_24px_rgba(0,0,0,0.2)]" title="Approvata">
                      <CheckCircle className="w-4 h-4 text-white" aria-hidden="true" />
                      <span className="sr-only">Approvata</span>
                    </div>
                  ) : null}
                  {image.processingStatus === "processing" ? (
                    <div className="absolute top-3 right-3 rounded-full bg-[var(--brand-primary)] p-1.5" title="Elaborazione in corso">
                      <Loader className="h-4 w-4 animate-spin text-white" aria-hidden="true" />
                      <span className="sr-only">Elaborazione in corso</span>
                    </div>
                  ) : null}
                  {image.processingStatus === "error" ? (
                    <div className="absolute top-3 left-3 rounded-full bg-[var(--danger)] p-1.5" title={image.processingError}>
                      <AlertTriangle className="h-4 w-4 text-white" aria-hidden="true" />
                      <span className="sr-only">Elaborazione non riuscita</span>
                    </div>
                  ) : null}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/88 via-black/40 to-transparent p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-white" title={image.relativePath || image.path}>{imageDisplayName(image)}</span>
                      <span className="rounded-full border border-white/15 bg-black/25 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-white/80">
                        {image.orientation === "vertical" ? "V" : "H"}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col bg-transparent">
          <div className="shrink-0 border-b border-[var(--app-border)]/80 px-4 py-3 xl:px-5">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--app-text-subtle)]">Anteprima composizione</div>
                <div className="mt-1 flex min-w-0 items-center gap-2.5">
                  <h2 className="max-w-[min(46vw,440px)] truncate text-xl font-semibold tracking-[-0.025em]" title={currentImage.relativePath || currentImage.path}>{currentFileName}</h2>
                  <span className="rounded-full border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-1 text-xs text-[var(--app-text-muted)]">
                    {currentOrientationLabel}
                  </span>
                  <span aria-live="polite" className={`rounded-full px-3 py-1 text-xs ${currentStatusIsApproved ? "border border-[rgba(142,178,142,0.28)] bg-[rgba(142,178,142,0.12)] text-[var(--success)]" : "border border-[rgba(184,154,99,0.22)] bg-[rgba(184,154,99,0.12)] text-[var(--brand-accent)]"}`}>
                    {currentStatusLabel}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 lg:hidden">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-10 rounded-xl border-[var(--app-border-strong)] bg-[var(--app-surface)]"
                  onClick={() => {
                    setShowAdjustmentsPanel(false);
                    setShowImagesPanel((current) => !current);
                  }}
                  aria-label="Mostra elenco immagini"
                >
                  <PanelLeft className="size-[18px]" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-10 rounded-xl border-[var(--app-border-strong)] bg-[var(--app-surface)]"
                  onClick={() => {
                    setShowImagesPanel(false);
                    setShowAdjustmentsPanel((current) => !current);
                  }}
                  aria-label="Mostra regolazioni"
                >
                  <SlidersHorizontal className="size-[18px]" />
                </Button>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 xl:p-5">
            <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[28px] border border-[var(--app-border)]/55 bg-[rgba(43,49,45,0.38)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] xl:p-5">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(184,154,99,0.09),transparent_38%)] pointer-events-none" />
              <FitPreviewSurface aspectRatio={frameAspectRatio}>
                {presetBackgroundPreviewUrl ? (
                  <div
                    className="absolute inset-0 bg-cover bg-center"
                    style={{ backgroundImage: `url(${presetBackgroundPreviewUrl})` }}
                  />
                ) : null}
                {processedImageUrl ? (
                  <img
                    src={processedImageUrl}
                    alt={`Anteprima elaborata di ${currentFileName}`}
                    className="absolute inset-0 h-full w-full rounded-[24px] object-contain pointer-events-none"
                    loading="eager"
                  />
                ) : null}

                {project.template === "custom" && !processedImageUrl ? (
                  customBackgroundPreviewUrl ? (
                    <img
                      src={customBackgroundPreviewUrl}
                      alt={project.customTemplate?.name || "Template background"}
                      className="absolute inset-0 h-full w-full rounded-[24px] object-cover pointer-events-none"
                    />
                  ) : (
                    <div className="absolute inset-0 rounded-[24px] bg-[linear-gradient(135deg,#4b5750,#66756b_42%,#2b312d)]" />
                  )
                ) : null}

                {project.template === "custom" ? (
                  <>
                    <div className="absolute inset-0 rounded-[24px] border border-[rgba(237,230,221,0.12)] pointer-events-none" />
                    {(templateGeometry.borderSizePx ?? 0) > 0 ? (
                      <div
                        className="absolute pointer-events-none"
                        style={{
                          left: `${(templateGeometry.photoAreaX / templateGeometry.width) * 100}%`,
                          top: `${(templateGeometry.photoAreaY / templateGeometry.height) * 100}%`,
                          width: `${(templateGeometry.photoAreaWidth / templateGeometry.width) * 100}%`,
                          height: `${(templateGeometry.photoAreaHeight / templateGeometry.height) * 100}%`,
                          backgroundColor: templateGeometry.borderColor ?? "#ffffff",
                          borderRadius: "18px",
                        }}
                      />
                    ) : null}
                  </>
                  ) : null}

                <div
                  ref={viewportRef}
                  tabIndex={0}
                  onPointerDown={handleImagePointerDown}
                  onPointerMove={handleImagePointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={cancelDrag}
                  onKeyDown={handleViewportKeyDown}
                  aria-label={`Regola il ritaglio di ${currentFileName}. Trascina o usa le frecce.`}
                  className={`absolute touch-none overflow-hidden ${project.template === "custom" ? "rounded-[18px] ring-2 ring-[rgba(212,193,170,0.85)] shadow-[0_0_0_9999px_rgba(0,0,0,0.18)]" : "rounded-[10px] bg-[var(--app-field)]"} outline-none ${
                    isDraggingImage ? "cursor-grabbing" : "cursor-grab"
                  } ${processedImageUrl ? "opacity-0" : "opacity-100"}`}
                  style={photoViewportStyle}
                >
                  {currentPreview && imageStyle ? (
                    <img
                      src={currentPreview.url}
                      alt={currentFileName}
                      draggable={false}
                      className="absolute max-w-none select-none pointer-events-none"
                      style={imageStyle}
                      loading="eager"
                      decoding="async"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-[var(--app-surface-strong)] to-[var(--app-field)] flex items-center justify-center">
                      <div className="text-center">
                        {preparingActivePreview ? (
                          <>
                            <Loader className="w-8 h-8 animate-spin text-[var(--brand-accent)] mx-auto mb-3" />
                            <p className="text-sm text-[var(--app-text-muted)]">Preparazione della foto</p>
                            <p className="text-xs text-[var(--app-text-subtle)] mt-1">Attendi qualche istante</p>
                          </>
                        ) : (
                          <>
                            <FileImage className="w-8 h-8 text-[var(--app-text-subtle)] mx-auto mb-3" />
                            <p className="text-sm text-[var(--app-text-muted)]">Anteprima non disponibile</p>
                            <p className="text-xs text-[var(--app-text-subtle)] mt-1">Reimporta il progetto per recuperare il file</p>
                          </>
                        )}
                      </div>
                    </div>
                    )}
                  </div>
              </FitPreviewSurface>
            </div>
          </div>

          <div className="h-12 bg-[var(--app-topbar)] border-t border-[var(--app-border)] flex items-center justify-center gap-2 px-4 shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
            <Button
              variant="ghost"
              size="sm"
              className="size-9 rounded-full p-0 text-[var(--app-text-muted)] hover:bg-[var(--app-surface)]"
              onClick={() => handleZoomCommit([Math.max(MIN_CROP_ZOOM, displayedCurrentCrop.zoom - 10)])}
              aria-label="Riduci zoom"
            >
              <ZoomOut className="w-4 h-4" />
            </Button>
            <span className="w-16 rounded-full border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-1 text-center text-[13px] text-[var(--app-text-muted)]">
              {Math.round(displayedCurrentCrop.zoom)}%
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="size-9 rounded-full p-0 text-[var(--app-text-muted)] hover:bg-[var(--app-surface)]"
              onClick={() => handleZoomCommit([Math.min(MAX_CROP_ZOOM, displayedCurrentCrop.zoom + 10)])}
              aria-label="Aumenta zoom"
            >
              <ZoomIn className="w-4 h-4" />
            </Button>
            <div className="mx-1 h-5 w-px bg-[var(--app-border)]"></div>
            <div className="hidden items-center rounded-full px-2 py-1.5 text-[13px] text-[var(--app-text-muted)] sm:inline-flex">
              <Move className="mr-1.5 size-4" />
              Trascina
            </div>
            <Button
              onClick={handleComparison}
              variant="ghost"
              size="sm"
              disabled={!canCompareCurrentImage}
              title={canCompareCurrentImage ? "Confronta originale e risultato" : "Elabora la foto per attivare il confronto"}
              className="h-9 rounded-full px-3 text-[13px] text-[var(--app-text-muted)] hover:bg-[var(--app-surface)] disabled:opacity-50"
            >
              Confronta
            </Button>
            {currentImage.processingStatus === "error" && currentImage.processingError ? (
              <div className="ml-1 max-w-[280px] truncate rounded-full border border-[rgba(212,163,156,0.18)] bg-[var(--danger-soft)] px-3 py-1 text-xs text-[var(--danger)]" title={currentImage.processingError}>
                {currentImage.processingError}
              </div>
            ) : null}
          </div>
        </main>

        <aside className={`absolute inset-y-0 right-0 z-20 flex w-72 min-h-0 shrink-0 flex-col border-l border-[var(--app-border)] bg-[var(--app-topbar)] shadow-2xl transition-transform lg:relative lg:z-auto lg:w-[272px] lg:translate-x-0 lg:shadow-none 2xl:w-72 ${showAdjustmentsPanel ? "translate-x-0" : "translate-x-full"}`}>
          <div className="border-b border-[var(--app-border)] px-4 py-3 shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-semibold text-[var(--app-text)]">Regolazioni</span>
              <span className="rounded-full border border-[rgba(142,178,142,0.24)] bg-[rgba(142,178,142,0.10)] px-2.5 py-1 text-[11px] text-[var(--success)]">
                Live
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-[var(--app-text-subtle)]">Trascina la foto o rifinisci il ritaglio.</p>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="space-y-4 p-4">
              <div className="space-y-4 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 shadow-[0_14px_32px_rgba(0,0,0,0.10)]">
                <h3 className="text-[14px] font-semibold">Posizione</h3>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between mb-2">
                      <label htmlFor="partyframe-crop-x" className="text-[13px] text-[var(--app-text-muted)]">Orizzontale</label>
                      <span className="text-[13px] tabular-nums text-[var(--app-text-muted)]">{Math.round(displayedCurrentCrop.offsetX * 100)}%</span>
                    </div>
                    <Slider
                      id="partyframe-crop-x"
                      value={[displayedCurrentCrop.offsetX]}
                      onValueChange={(val) => handlePositionChange("offsetX", val)}
                      onValueCommit={(val) => handlePositionCommit("offsetX", val)}
                      min={-1}
                      max={1}
                      step={0.01}
                      className="w-full [&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-thumb]]:size-5"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between mb-2">
                      <label htmlFor="partyframe-crop-y" className="text-[13px] text-[var(--app-text-muted)]">Verticale</label>
                      <span className="text-[13px] tabular-nums text-[var(--app-text-muted)]">{Math.round(displayedCurrentCrop.offsetY * 100)}%</span>
                    </div>
                    <Slider
                      id="partyframe-crop-y"
                      value={[displayedCurrentCrop.offsetY]}
                      onValueChange={(val) => handlePositionChange("offsetY", val)}
                      onValueCommit={(val) => handlePositionCommit("offsetY", val)}
                      min={-1}
                      max={1}
                      step={0.01}
                      className="w-full [&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-thumb]]:size-5"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 shadow-[0_14px_32px_rgba(0,0,0,0.10)]">
                <h3 className="text-[14px] font-semibold">Zoom</h3>
                <div>
                  <div className="flex justify-between mb-2">
                    <label htmlFor="partyframe-crop-zoom" className="text-[13px] text-[var(--app-text-muted)]">Ingrandimento</label>
                    <span className="text-[13px] tabular-nums text-[var(--app-text-muted)]">{Math.round(displayedCurrentCrop.zoom)}%</span>
                  </div>
                  <Slider
                    value={[displayedCurrentCrop.zoom]}
                    onValueChange={handleZoomChange}
                    onValueCommit={handleZoomCommit}
                    id="partyframe-crop-zoom"
                    min={MIN_CROP_ZOOM}
                    max={MAX_CROP_ZOOM}
                    step={1}
                    className="w-full [&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-thumb]]:size-5"
                  />
                  <p className="mt-2 text-xs leading-5 text-[var(--app-text-subtle)]">Ctrl + rotellina direttamente sulla foto.</p>
                </div>
              </div>

              <div className="space-y-2 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 shadow-[0_14px_32px_rgba(0,0,0,0.10)]">
                <h3 className="pb-1 text-[14px] font-semibold">Foto corrente</h3>
                <Button
                  className="min-h-11 w-full justify-start bg-[var(--success)] px-4 text-[14px] text-[#16311c] hover:brightness-105 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleApprove}
                  disabled={processingLoading || bulkApproveState !== null || processingImageId === currentImage.id}
                >
                  {processingLoading && processingImageId === currentImage.id ? (
                    <>
                      <Loader className="w-4 h-4 mr-2 animate-spin" />
                      Elaborazione...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Elabora e approva
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  className="min-h-10 w-full justify-start border-[var(--app-border-strong)] bg-[var(--app-surface)] px-4 text-[14px] text-[var(--app-text)] hover:bg-[var(--app-surface-strong)]"
                  onClick={handleReset}
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Ripristina ritaglio
                </Button>
              </div>

              <div className="space-y-2 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 shadow-[0_14px_32px_rgba(0,0,0,0.10)]">
                <div>
                  <h3 className="text-[14px] font-semibold">Azioni multiple</h3>
                  <p className="mt-1 text-xs leading-5 text-[var(--app-text-subtle)]">Questi comandi modificano più fotografie.</p>
                </div>
                <Button onClick={handleApplyToSimilar} variant="outline" className="min-h-10 w-full justify-start whitespace-normal border-[var(--app-border-strong)] bg-[var(--app-surface)] px-4 text-left text-[13px] leading-4 text-[var(--app-text)] hover:bg-[var(--app-surface-strong)]">
                  <Scissors className="w-4 h-4 mr-2" />
                  Applica allo stesso orientamento
                </Button>
                <Button
                  variant="outline"
                  className="min-h-10 w-full justify-start whitespace-normal border-[var(--app-border-strong)] bg-[var(--app-surface)] px-4 text-left text-[13px] leading-4 text-[var(--app-text)] hover:bg-[var(--app-surface-strong)] disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleApproveAll}
                  disabled={processingLoading || bulkApproveState !== null || images.every((image) => image.approval === "approved")}
                >
                  {bulkApproveState ? (
                    <>
                      <Loader className="w-4 h-4 mr-2 animate-spin" />
                      Elabora {bulkApproveState.completed}/{bulkApproveState.total}
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Elabora tutte da controllare
                    </>
                  )}
                </Button>
              </div>

              <details className="group rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 text-sm shadow-[0_14px_32px_rgba(0,0,0,0.10)]">
                <summary className="cursor-pointer list-none text-[14px] font-semibold text-[var(--app-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)]">
                  Dettagli e scorciatoie
                </summary>
                <div className="mt-4 space-y-2 border-t border-[var(--app-border)] pt-4">
                  <div className="flex justify-between gap-3 text-xs">
                    <span className="text-[var(--app-text-muted)]">File</span>
                    <span className="min-w-0 max-w-[160px] truncate" title={currentImage.relativePath || currentImage.path}>{currentFileName}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--app-text-muted)]">Orientamento</span>
                    <span>{currentOrientationLabel}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--app-text-muted)]">Stato</span>
                    <span className={currentStatusIsApproved ? "text-[var(--success)]" : "text-[var(--brand-accent)]"}>{currentStatusLabel}</span>
                  </div>
                  <div className="space-y-1 pt-2 text-xs leading-5 text-[var(--app-text-subtle)]">
                    <div>Trascina: sposta la foto</div>
                    <div>Ctrl + rotellina: zoom</div>
                    <div>Frecce: micro-spostamento</div>
                    <div>Alt + frecce: cambia immagine</div>
                  </div>
                </div>
              </details>
            </div>
          </div>
        </aside>
      </div>

      <div className="h-8 bg-[var(--app-topbar)] border-t border-[var(--app-border)] flex items-center px-4 justify-between text-xs shrink-0">
        <div className="flex items-center gap-4 text-[var(--app-text-muted)]">
          <span>{Math.max(visibleIndex + 1, 1)} di {Math.max(filteredImages.length, 1)}</span>
          <span className="text-[var(--success)]">{approvedCount} approvate</span>
          <span className="text-[var(--brand-accent)]">
            {pendingCount} da controllare
          </span>
        </div>
        <span className="hidden text-[var(--app-text-subtle)] sm:inline">Ctrl + rotellina per zoom • Alt + frecce per cambiare foto</span>
      </div>
    </div>
  );
}


