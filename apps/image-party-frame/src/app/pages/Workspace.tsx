import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
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
} from "lucide-react";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { Slider } from "../components/ui/slider";
import { useProject } from "../contexts/ProjectContext";
import { getCustomTemplateBackgroundFiles, getImageFile } from "../contexts/ProjectContext";
import { useProcessImage } from "../hooks/useApi";
import { createCompressedPreviewUrl } from "../utils/imagePreview";
import { getCustomTemplateVariant, getProjectTemplateGeometry } from "../lib/templateGeometry";
import { exportCurrentProjectPackage } from "../lib/portablePackages";

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
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

async function loadImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const objectUrl = URL.createObjectURL(file);

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Unable to read image dimensions for ${file.name}`));
    };

    image.src = objectUrl;
  });
}

export default function Workspace() {
  const navigate = useNavigate();
  const { project, updateImageCrop, updateImageApproval } = useProject();
  const { processImage, loading: processingLoading, error: processingError } = useProcessImage();
  const safeImages = Array.isArray(project.images) ? project.images : [];
  const [selectedImage, setSelectedImage] = useState(0);
  const [filterMode, setFilterMode] = useState<"all" | "pending" | "approved">("all");
  const [processingImageId, setProcessingImageId] = useState<string | null>(null);
  const [processedImages, setProcessedImages] = useState<Map<string, string>>(new Map());
  const [imagePreviews, setImagePreviews] = useState<Map<string, PreviewEntry>>(new Map());
  const [preparedPreviewCount, setPreparedPreviewCount] = useState(0);
  const [preparingPreviews, setPreparingPreviews] = useState(false);
  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 460, height: 613 });
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [bulkApproveState, setBulkApproveState] = useState<{ total: number; completed: number } | null>(null);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const thumbRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const dragStateRef = useRef<DragState | null>(null);
  const currentImageRef = useRef(safeImages[selectedImage]);

  useEffect(() => {
    currentImageRef.current = safeImages[selectedImage];
  }, [safeImages, selectedImage]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setViewportSize({ width: rect.width, height: rect.height });
      }
    };

    updateSize();

    const observer = new ResizeObserver(() => updateSize());
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const previewSourceKey = `${project.sourcePath}:${safeImages.map((img) => img.id).join("|")}`;
  const previewImages = useMemo(
    () => safeImages.map((image) => ({ id: image.id })),
    [previewSourceKey]
  );

  useEffect(() => {
    const generatedPreviews = new Map<string, PreviewEntry>();
    let cancelled = false;

    setImagePreviews(new Map());
    setPreparedPreviewCount(0);
    setPreparingPreviews(previewImages.length > 0);

    const prepare = async () => {
      for (const image of previewImages) {
        const file = getImageFile(image.id);

        if (!file) {
          if (!cancelled) {
            setPreparedPreviewCount((count) => count + 1);
          }
          continue;
        }

        try {
          const [url, dimensions] = await Promise.all([
            createCompressedPreviewUrl(file),
            loadImageDimensions(file),
          ]);

          if (cancelled) {
            URL.revokeObjectURL(url);
            break;
          }

          const preview = { url, ...dimensions };
          generatedPreviews.set(image.id, preview);
          setImagePreviews((prev) => new Map(prev).set(image.id, preview));
        } catch (error) {
          console.error(`Failed to prepare preview for ${image.id}:`, error);
        } finally {
          if (!cancelled) {
            setPreparedPreviewCount((count) => count + 1);
          }
        }
      }

      if (!cancelled) {
        setPreparingPreviews(false);
      }
    };

    void prepare();

    return () => {
      cancelled = true;
      generatedPreviews.forEach((preview) => URL.revokeObjectURL(preview.url));
    };
  }, [previewImages]);

  const images = safeImages;
  const currentImage = images[selectedImage];

  const filteredImages = useMemo(() => {
    return images.filter((img) => {
      if (filterMode === "all") return true;
      if (filterMode === "pending") return img.approval === "pending" || img.approval === "needs-adjustment";
      return img.approval === "approved";
    });
  }, [filterMode, images]);

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

  if (!currentImage) {
    return (
      <div className="h-screen bg-[var(--app-bg)] text-[var(--app-text)] flex items-center justify-center">
        <div className="text-center">
          <FileImage className="w-12 h-12 text-[var(--app-text-subtle)] mx-auto mb-4" />
          <p className="text-[var(--app-text-muted)] mb-4">Nessuna immagine caricata</p>
          <Link to="/new-project">
            <Button className="bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)] hover:bg-[var(--brand-primary-strong)]">Carica Immagini</Button>
          </Link>
        </div>
      </div>
    );
  }

  const currentPreview = imagePreviews.get(currentImage.id);
  const visibleIndex = filteredImages.findIndex((img) => img.id === currentImage.id);
  const templateGeometry = getProjectTemplateGeometry(project.template, currentImage.orientation, project.customTemplate);
  const customTemplateVariant = getCustomTemplateVariant(project.customTemplate, currentImage.orientation);
  const frameAspectRatio = `${templateGeometry.width} / ${templateGeometry.height}`;
  const outerBorderSize = templateGeometry.borderSizePx ?? 0;
  const photoViewportStyle = {
    left: `${((templateGeometry.photoAreaX + outerBorderSize) / templateGeometry.width) * 100}%`,
    top: `${((templateGeometry.photoAreaY + outerBorderSize) / templateGeometry.height) * 100}%`,
    width: `${((templateGeometry.photoAreaWidth - outerBorderSize * 2) / templateGeometry.width) * 100}%`,
    height: `${((templateGeometry.photoAreaHeight - outerBorderSize * 2) / templateGeometry.height) * 100}%`,
  };
  const customBackgroundPreviewUrl =
    project.template === "custom" ? customTemplateVariant?.backgroundPreviewUrl : undefined;

  const getMetrics = (preview: PreviewEntry | undefined, zoom: number) => {
    if (!preview) {
      return null;
    }

    const fitScale = Math.max(viewportSize.width / preview.width, viewportSize.height / preview.height);
    const scale = fitScale * (zoom / 100);
    const renderedWidth = preview.width * scale;
    const renderedHeight = preview.height * scale;
    const maxOffsetX = Math.max(0, (renderedWidth - viewportSize.width) / 2);
    const maxOffsetY = Math.max(0, (renderedHeight - viewportSize.height) / 2);

    return {
      renderedWidth,
      renderedHeight,
      maxOffsetX,
      maxOffsetY,
    };
  };

  const clampCrop = (
    crop: { x: number; y: number; zoom: number },
    preview: PreviewEntry | undefined = currentPreview
  ) => {
    const metrics = getMetrics(preview, crop.zoom);
    if (!metrics) {
      return crop;
    }

    return {
      ...crop,
      x: Math.max(-metrics.maxOffsetX, Math.min(metrics.maxOffsetX, crop.x)),
      y: Math.max(-metrics.maxOffsetY, Math.min(metrics.maxOffsetY, crop.y)),
    };
  };

  const currentMetrics = getMetrics(currentPreview, currentImage.crop.zoom);
  const imageStyle = currentMetrics
    ? {
        width: `${currentMetrics.renderedWidth}px`,
        height: `${currentMetrics.renderedHeight}px`,
        left: `calc(50% - ${currentMetrics.renderedWidth / 2}px + ${currentImage.crop.x}px)`,
        top: `calc(50% - ${currentMetrics.renderedHeight / 2}px + ${currentImage.crop.y}px)`,
      }
    : undefined;

  const updateCurrentCrop = (nextCrop: { x: number; y: number; zoom: number }) => {
    const nextClampedCrop = clampCrop(nextCrop);

    setProcessedImages((prev) => {
      if (!prev.has(currentImage.id)) {
        return prev;
      }

      const next = new Map(prev);
      next.delete(currentImage.id);
      return next;
    });

    currentImageRef.current = {
      ...currentImageRef.current,
      crop: nextClampedCrop,
    };

    updateImageCrop(currentImage.id, nextClampedCrop);
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
          updateCurrentCrop({ ...currentImageRef.current.crop, x: currentImageRef.current.crop.x - moveStep });
        }
        return true;
      case "ArrowRight":
        if (altKey) {
          selectRelativeImage(1);
        } else {
          updateCurrentCrop({ ...currentImageRef.current.crop, x: currentImageRef.current.crop.x + moveStep });
        }
        return true;
      case "ArrowUp":
        if (altKey) {
          selectRelativeImage(-1);
        } else {
          updateCurrentCrop({ ...currentImageRef.current.crop, y: currentImageRef.current.crop.y - moveStep });
        }
        return true;
      case "ArrowDown":
        if (altKey) {
          selectRelativeImage(1);
        } else {
          updateCurrentCrop({ ...currentImageRef.current.crop, y: currentImageRef.current.crop.y + moveStep });
        }
        return true;
      case "+":
      case "=":
        if (ctrlOrMetaKey) {
          updateCurrentCrop({
            ...currentImageRef.current.crop,
            zoom: Math.min(200, currentImageRef.current.crop.zoom + 5),
          });
          return true;
        }
        return false;
      case "-":
        if (ctrlOrMetaKey) {
          updateCurrentCrop({
            ...currentImageRef.current.crop,
            zoom: Math.max(50, currentImageRef.current.crop.zoom - 5),
          });
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

  const handlePositionChange = (axis: "x" | "y", value: number[]) => {
    const nextCrop = { ...currentImage.crop, [axis]: value[0] };
    updateCurrentCrop(nextCrop);
  };

  const handleZoomChange = (value: number[]) => {
    const nextCrop = { ...currentImage.crop, zoom: value[0] };
    updateCurrentCrop(nextCrop);
  };

  const handleReset = () => {
    updateImageCrop(currentImage.id, { x: 0, y: 0, zoom: 100 });
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
      setSelectedImage(nextIndex);
    }
  };

  const processSingleImage = async (imageToProcess: typeof currentImageRef.current) => {
    const imageFile = getImageFile(imageToProcess.id);

    if (!imageFile) {
      updateImageApproval(imageToProcess.id, "needs-adjustment");
      return false;
    }

    setProcessingImageId(imageToProcess.id);
    const result = await processImage(
      imageFile,
      project.template,
      imageToProcess.crop.x,
      imageToProcess.crop.y,
      imageToProcess.crop.zoom,
      imageToProcess.orientation,
      project.customTemplate,
      getCustomTemplateBackgroundFiles()
    );

    if (result) {
      setProcessedImages((prev) => new Map(prev).set(imageToProcess.id, result.imageUrl));
      updateImageApproval(imageToProcess.id, "approved");
      return true;
    }

    updateImageApproval(imageToProcess.id, "needs-adjustment");
    return false;
  };

  const handleApprove = async () => {
    try {
      const imageToProcess = currentImageRef.current;
      const success = await processSingleImage(imageToProcess);

      if (success && visibleIndex < filteredImages.length - 1) {
        selectRelativeImage(1);
      }
    } catch (error) {
      console.error("Error in handleApprove:", error);
      updateImageApproval(currentImageRef.current.id, "needs-adjustment");
    } finally {
      setProcessingImageId(null);
    }
  };

  const handleApproveAll = async () => {
    const imagesToProcess = images.filter(
      (image) => image.approval === "pending" || image.approval === "needs-adjustment"
    );

    if (imagesToProcess.length === 0) {
      return;
    }

    setBulkApproveState({ total: imagesToProcess.length, completed: 0 });

    try {
      for (const [index, image] of imagesToProcess.entries()) {
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
    navigate("/export-settings");
  };

  const handleSaveProjectPackage = async () => {
    try {
      await exportCurrentProjectPackage(project);
      toast.success("Progetto esportato", {
        description: "Puoi importare questo file JSON su un altro PC Windows o macOS per ripartire dal progetto.",
      });
    } catch (error) {
      toast.error("Export progetto non riuscito", {
        description: error instanceof Error ? error.message : "Impossibile esportare il progetto.",
      });
    }
  };

  const handleComparison = () => {
    navigate("/image-comparison", {
      state: {
        imageId: currentImage.id,
        processedImageUrl: processedImages.get(currentImage.id) ?? null,
      },
    });
  };

  const handleImagePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!currentPreview) {
      return;
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: currentImageRef.current.crop.x,
      originY: currentImageRef.current.crop.y,
    };

    setIsDraggingImage(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
  };

  const handleImagePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;

    updateCurrentCrop({
      ...currentImageRef.current.crop,
      x: drag.originX + deltaX,
      y: drag.originY + deltaY,
      zoom: currentImageRef.current.crop.zoom,
    });
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null;
      setIsDraggingImage(false);
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleViewportWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey) {
      return;
    }

    event.preventDefault();
    const delta = event.deltaY < 0 ? 5 : -5;
    const nextZoom = Math.max(50, Math.min(200, currentImageRef.current.crop.zoom + delta));
    updateCurrentCrop({ ...currentImageRef.current.crop, zoom: nextZoom });
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

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }

    const handleNativeWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) {
        return;
      }

      if (!(event.target instanceof Node) || !element.contains(event.target)) {
        return;
      }

      event.preventDefault();
      const delta = event.deltaY < 0 ? 5 : -5;
      const nextZoom = Math.max(50, Math.min(200, currentImageRef.current.crop.zoom + delta));
      updateCurrentCrop({ ...currentImageRef.current.crop, zoom: nextZoom });
    };

    element.addEventListener("wheel", handleNativeWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleNativeWheel);
  }, [currentImage.id, currentPreview, viewportSize.width, viewportSize.height]);

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (!viewportRef.current) {
        return;
      }

      const viewportIsActive =
        document.activeElement === viewportRef.current || viewportRef.current.contains(document.activeElement);

      if (!viewportIsActive) {
        return;
      }

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

    window.addEventListener("keydown", handleWindowKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleWindowKeyDown, { capture: true });
  }, [filteredImages, visibleIndex, currentImage.id]);

  const maxOffsetX = Math.max(1, Math.ceil(currentMetrics?.maxOffsetX ?? 0));
  const maxOffsetY = Math.max(1, Math.ceil(currentMetrics?.maxOffsetY ?? 0));
  const approvedCount = images.filter((img) => img.approval === "approved").length;
  const pendingCount = images.filter((img) => img.approval === "pending" || img.approval === "needs-adjustment").length;
  const currentOrientationLabel = currentImage.orientation === "vertical" ? "Verticale" : "Orizzontale";
  const currentStatusLabel = currentImage.approval === "approved" ? "Approvata" : "In attesa";
  const activeFilterLabel =
    filterMode === "all" ? "Tutte le immagini" : filterMode === "approved" ? "Solo approvate" : "Da controllare";

  return (
    <div className="h-screen bg-[radial-gradient(circle_at_top,rgba(103,117,107,0.16),transparent_28%),linear-gradient(180deg,#1f2421_0%,#232925_100%)] text-[var(--app-text)] flex flex-col overflow-hidden">
      <div className="h-16 bg-[var(--app-topbar)] border-b border-[var(--app-border)] backdrop-blur-xl flex items-center px-6 justify-between shrink-0">
        <div className="flex items-center gap-4">
          <Link to="/">
            <Button variant="ghost" size="sm" className="text-[var(--app-text-muted)] hover:text-[var(--app-text)]">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Home
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--app-border)] bg-[var(--brand-primary-soft)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
              <FileImage className="w-5 h-5 text-[var(--brand-accent)]" />
            </div>
            <div>
              <div className="font-semibold tracking-[-0.02em]">{project.name || "Area di Lavoro"}</div>
              <div className="text-xs text-[var(--app-text-subtle)]">Modello {project.template} • {project.imageCount.total} immagini</div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden 2xl:flex items-center gap-2 mr-2">
            <div className="rounded-full border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-1 text-xs text-[var(--app-text-muted)]">
              {activeFilterLabel}
            </div>
            <div className="rounded-full border border-[rgba(142,178,142,0.25)] bg-[rgba(142,178,142,0.12)] px-3 py-1 text-xs text-[var(--success)]">
              {approvedCount} approvate
            </div>
            <div className="rounded-full border border-[rgba(184,154,99,0.22)] bg-[rgba(184,154,99,0.12)] px-3 py-1 text-xs text-[var(--brand-accent)]">
              {pendingCount} da controllare
            </div>
          </div>
          <div className="text-xs text-[var(--app-text-subtle)] mr-4 hidden xl:block">
            {preparingPreviews
              ? `Preparazione anteprime leggere ${preparedPreviewCount}/${images.length}`
              : bulkApproveState
                ? `Elaborazione batch ${bulkApproveState.completed}/${bulkApproveState.total}`
              : "Drag sulla foto, Ctrl + rotellina per zoom, Alt + frecce per cambiare immagine"}
          </div>
          <select
            value={filterMode}
            onChange={(e) => setFilterMode(e.target.value as "all" | "pending" | "approved")}
            className="px-3 py-2 bg-[var(--app-surface)] border border-[var(--app-border)] rounded-xl text-sm text-[var(--app-text)] cursor-pointer hover:border-[var(--app-border-strong)]"
          >
            <option value="all">Tutte le immagini</option>
            <option value="pending">Da controllare</option>
            <option value="approved">Approvate</option>
          </select>
          <Button variant="ghost" size="sm" className="text-[var(--app-text-muted)] hover:text-[var(--app-text)]">
            <Scissors className="w-4 h-4 mr-2" />
            Ritaglia Tutto
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-[var(--app-border-strong)] bg-[var(--app-surface)] text-[var(--app-text)] hover:bg-[var(--app-surface-strong)]"
            onClick={() => void handleSaveProjectPackage()}
          >
            <Save className="w-4 h-4 mr-2" />
            Salva Progetto
          </Button>
          <Button onClick={handleExport} className="bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)] hover:bg-[var(--brand-primary-strong)] ml-4">
            <Download className="w-4 h-4 mr-2" />
            Esporta
          </Button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden min-h-0">
        <aside className="w-72 bg-[var(--app-topbar)] border-r border-[var(--app-border)] flex flex-col min-h-0 shrink-0">
          <div className="border-b border-[var(--app-border)] px-4 py-4 shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--app-text)]">Immagini</span>
              <span className="rounded-full border border-[var(--app-border)] bg-[var(--app-surface)] px-2.5 py-1 text-[11px] text-[var(--app-text-muted)]">
                {filteredImages.length}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--app-text-subtle)]">Filmstrip con selezione rapida e stato di approvazione.</p>
          </div>
          <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 px-3 py-3 space-y-3">
            {filteredImages.map((image) => {
              const imageIndex = images.findIndex((img) => img.id === image.id);
              const preview = imagePreviews.get(image.id);
              const isSelected = selectedImage === imageIndex;

              return (
                <button
                  key={image.id}
                  ref={(node) => {
                    thumbRefs.current.set(image.id, node);
                  }}
                  type="button"
                  onClick={() => setSelectedImage(imageIndex)}
                  className={`group relative block w-full rounded-[22px] overflow-hidden border transition-all text-left ${
                    isSelected
                      ? "border-[var(--brand-accent)] bg-[var(--app-surface)] shadow-[0_18px_44px_rgba(0,0,0,0.24)]"
                      : "border-[var(--app-border)] bg-[var(--app-surface)]/55 hover:border-[var(--app-border-strong)] hover:bg-[var(--app-surface)]"
                  }`}
                >
                  <div
                    className="w-full bg-gradient-to-br from-[var(--app-surface-strong)] to-[var(--app-field)] flex items-center justify-center overflow-hidden"
                    style={{ aspectRatio: image.orientation === "vertical" ? "3 / 4" : "4 / 3" }}
                  >
                    {preview ? (
                      <img
                        src={preview.url}
                        alt={image.id}
                        className="w-full h-full object-cover pointer-events-none"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span className="text-[var(--app-text-muted)] text-xs">{image.id}</span>
                    )}
                  </div>
                  {image.approval === "approved" && (
                    <div className="absolute top-3 right-3 bg-[var(--success)] rounded-full p-1.5 shadow-[0_10px_24px_rgba(0,0,0,0.2)]">
                      <CheckCircle className="w-4 h-4 text-white" />
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/88 via-black/40 to-transparent p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-white">{image.id}</span>
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

        <main className="flex-1 bg-transparent flex flex-col min-w-0">
          <div className="border-b border-[var(--app-border)]/80 px-8 py-4">
            <div className="flex items-center justify-between gap-6">
              <div>
                <div className="text-xs uppercase tracking-[0.22em] text-[var(--app-text-subtle)]">Preview Canvas</div>
                <div className="mt-1 flex items-center gap-3">
                  <h2 className="text-2xl font-semibold tracking-[-0.03em]">{currentImage.id}</h2>
                  <span className="rounded-full border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-1 text-xs text-[var(--app-text-muted)]">
                    {currentOrientationLabel}
                  </span>
                  <span className={`rounded-full px-3 py-1 text-xs ${currentImage.approval === "approved" ? "border border-[rgba(142,178,142,0.28)] bg-[rgba(142,178,142,0.12)] text-[var(--success)]" : "border border-[rgba(184,154,99,0.22)] bg-[rgba(184,154,99,0.12)] text-[var(--brand-accent)]"}`}>
                    {currentStatusLabel}
                  </span>
                </div>
              </div>
              <div className="hidden xl:flex items-center gap-2">
                <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] px-4 py-2 text-sm text-[var(--app-text-muted)] shadow-[0_12px_32px_rgba(0,0,0,0.12)]">
                  Drag diretto attivo
                </div>
                <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] px-4 py-2 text-sm text-[var(--app-text-muted)] shadow-[0_12px_32px_rgba(0,0,0,0.12)]">
                  Zoom {currentImage.crop.zoom}%
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center p-8 overflow-hidden min-h-0">
            <div className="relative h-full w-full flex items-center justify-center">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(184,154,99,0.09),transparent_34%)] pointer-events-none" />
              <div className="w-full max-w-[720px] rounded-[36px] border border-[var(--app-border)]/70 bg-[rgba(43,49,45,0.58)] p-8 shadow-[0_32px_90px_rgba(0,0,0,0.24)] backdrop-blur-sm">
                <div className="mb-5 flex items-center justify-between">
                  <div className="text-sm text-[var(--app-text-muted)]">Anteprima fedele al template con crop live.</div>
                  <div className="rounded-full border border-[var(--app-border)] bg-[var(--app-field)] px-3 py-1 text-xs text-[var(--app-text-subtle)]">
                    {preparedPreviewCount}/{images.length} anteprime
                  </div>
                </div>

                <div
                  className="w-full max-w-[560px] mx-auto relative shadow-[0_28px_72px_rgba(0,0,0,0.22)] rounded-[28px] bg-[var(--brand-accent)]"
                  style={{ aspectRatio: frameAspectRatio }}
                >
                {processedImages.has(currentImage.id) ? (
                  <img
                    src={`http://localhost:3001${processedImages.get(currentImage.id)}`}
                    alt="Processed"
                    className="absolute inset-0 h-full w-full rounded-[28px] object-contain pointer-events-none"
                    loading="eager"
                  />
                ) : null}

                {project.template === "custom" && !processedImages.has(currentImage.id) ? (
                  customBackgroundPreviewUrl ? (
                    <img
                      src={customBackgroundPreviewUrl}
                      alt={project.customTemplate?.name || "Template background"}
                      className="absolute inset-0 h-full w-full rounded-[28px] object-cover pointer-events-none"
                    />
                  ) : (
                    <div className="absolute inset-0 rounded-[28px] bg-[linear-gradient(135deg,#4b5750,#66756b_42%,#2b312d)]" />
                  )
                ) : null}

                {project.template === "custom" ? (
                  <>
                    <div className="absolute inset-0 rounded-[28px] border border-[rgba(237,230,221,0.12)] pointer-events-none" />
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
                  ) : (
                  <>
                    <div className="absolute inset-[6px] rounded-[24px] border-[12px] border-[var(--brand-primary-strong)] pointer-events-none" />
                    <div className="absolute inset-[14px] rounded-[18px] border-[6px] border-[var(--brand-accent)] pointer-events-none" />
                  </>
                )}

                <div
                  ref={viewportRef}
                  tabIndex={0}
                  onPointerDown={handleImagePointerDown}
                  onPointerMove={handleImagePointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onMouseEnter={() => viewportRef.current?.focus()}
                  onKeyDown={handleViewportKeyDown}
                  className={`absolute overflow-hidden ${project.template === "custom" ? "rounded-[18px] ring-2 ring-[rgba(212,193,170,0.85)] shadow-[0_0_0_9999px_rgba(0,0,0,0.18)]" : "rounded-[10px] bg-[var(--app-field)]"} outline-none ${
                    isDraggingImage ? "cursor-grabbing" : "cursor-grab"
                  } ${processedImages.has(currentImage.id) ? "opacity-0" : "opacity-100"}`}
                  style={photoViewportStyle}
                >
                  {currentPreview && imageStyle ? (
                    <img
                      src={currentPreview.url}
                      alt={currentImage.id}
                      draggable={false}
                      className="absolute max-w-none select-none pointer-events-none"
                      style={imageStyle}
                      loading="eager"
                      decoding="async"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-[var(--app-surface-strong)] to-[var(--app-field)] flex items-center justify-center">
                      <div className="text-center">
                        {preparingPreviews ? (
                          <>
                            <Loader className="w-8 h-8 animate-spin text-[var(--brand-accent)] mx-auto mb-3" />
                            <p className="text-sm text-[var(--app-text-muted)]">Preparazione anteprima</p>
                            <p className="text-xs text-[var(--app-text-subtle)] mt-1">
                              {preparedPreviewCount}/{images.length} immagini pronte
                            </p>
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
                </div>
              </div>
            </div>
          </div>

          <div className="h-16 bg-[var(--app-topbar)] border-t border-[var(--app-border)] flex items-center justify-center gap-4 px-6 shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
            <Button
              variant="ghost"
              size="sm"
              className="text-[var(--app-text-muted)] rounded-full hover:bg-[var(--app-surface)]"
              onClick={() => handleZoomChange([Math.max(50, currentImage.crop.zoom - 10)])}
            >
              <ZoomOut className="w-4 h-4" />
            </Button>
            <span className="rounded-full border border-[var(--app-border)] bg-[var(--app-surface)] px-4 py-1.5 text-sm text-[var(--app-text-muted)] w-20 text-center">
              {currentImage.crop.zoom}%
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="text-[var(--app-text-muted)] rounded-full hover:bg-[var(--app-surface)]"
              onClick={() => handleZoomChange([Math.min(200, currentImage.crop.zoom + 10)])}
            >
              <ZoomIn className="w-4 h-4" />
            </Button>
            <div className="h-6 w-px bg-[var(--app-border)] mx-2"></div>
            <Button variant="ghost" size="sm" className="text-[var(--app-text-muted)] rounded-full hover:bg-[var(--app-surface)]">
              <Move className="w-4 h-4 mr-2" />
              Drag diretto
            </Button>
            <Button onClick={handleComparison} variant="ghost" size="sm" className="text-[var(--app-text-muted)] rounded-full hover:bg-[var(--app-surface)]">
              Confronta
            </Button>
            <div className="ml-2 rounded-full border border-[rgba(184,154,99,0.18)] bg-[rgba(184,154,99,0.1)] px-3 py-1 text-xs text-[var(--brand-accent)]">
              Anteprime: {preparedPreviewCount}/{images.length}
            </div>
            {processingError && (
              <div className="ml-2 rounded-full border border-[rgba(212,163,156,0.18)] bg-[var(--danger-soft)] px-3 py-1 text-xs text-[var(--danger)]">
                Errore: {processingError}
              </div>
            )}
          </div>
        </main>

        <aside className="w-80 bg-[var(--app-topbar)] border-l border-[var(--app-border)] flex flex-col min-h-0 shrink-0">
          <div className="border-b border-[var(--app-border)] px-5 py-4 shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--app-text)]">Regolazioni</span>
              <span className="rounded-full border border-[var(--app-border)] bg-[var(--app-surface)] px-2.5 py-1 text-[11px] text-[var(--app-text-muted)]">
                live
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--app-text-subtle)]">Usa drag diretto o pannello fine-tuning per rifinire il crop.</p>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="p-6 space-y-6">
              <div className="space-y-4 rounded-[24px] border border-[var(--app-border)] bg-[var(--app-surface)] p-5 shadow-[0_18px_42px_rgba(0,0,0,0.12)]">
                <h3 className="text-sm font-medium">Posizione</h3>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between mb-2">
                      <label className="text-xs text-[var(--app-text-muted)]">Posizione X</label>
                      <span className="text-xs text-[var(--app-text-muted)]">{currentImage.crop.x}px</span>
                    </div>
                    <Slider
                      value={[currentImage.crop.x]}
                      onValueChange={(val) => handlePositionChange("x", val)}
                      min={-maxOffsetX}
                      max={maxOffsetX}
                      step={1}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between mb-2">
                      <label className="text-xs text-[var(--app-text-muted)]">Posizione Y</label>
                      <span className="text-xs text-[var(--app-text-muted)]">{currentImage.crop.y}px</span>
                    </div>
                    <Slider
                      value={[currentImage.crop.y]}
                      onValueChange={(val) => handlePositionChange("y", val)}
                      min={-maxOffsetY}
                      max={maxOffsetY}
                      step={1}
                      className="w-full"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3 rounded-[24px] border border-[var(--app-border)] bg-[var(--app-surface)] p-5 shadow-[0_18px_42px_rgba(0,0,0,0.12)]">
                <h3 className="text-sm font-medium">Zoom</h3>
                <div>
                  <div className="flex justify-between mb-2">
                    <label className="text-xs text-[var(--app-text-muted)]">Scala</label>
                    <span className="text-xs text-[var(--app-text-muted)]">{currentImage.crop.zoom}%</span>
                  </div>
                  <Slider
                    value={[currentImage.crop.zoom]}
                    onValueChange={handleZoomChange}
                    min={50}
                    max={200}
                    step={1}
                    className="w-full"
                  />
                  <p className="text-xs text-[var(--app-text-subtle)] mt-2">Usa anche Ctrl + rotellina direttamente sulla foto.</p>
                </div>
              </div>

              <div className="space-y-2 rounded-[24px] border border-[var(--app-border)] bg-[var(--app-surface)] p-5 shadow-[0_18px_42px_rgba(0,0,0,0.12)]">
                <Button
                  variant="outline"
                  className="w-full border-[var(--app-border-strong)] bg-[var(--app-surface)] text-[var(--app-text)] hover:bg-[var(--app-surface-strong)] justify-start"
                  onClick={handleReset}
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Ripristina Regolazioni
                </Button>
                <Button variant="outline" className="w-full border-[var(--app-border-strong)] bg-[var(--app-surface)] text-[var(--app-text)] hover:bg-[var(--app-surface-strong)] justify-start">
                  <Scissors className="w-4 h-4 mr-2" />
                  Applica a Simili
                </Button>
                <Button
                  variant="outline"
                  className="w-full border-[var(--app-border-strong)] bg-[var(--app-surface)] text-[var(--app-text)] hover:bg-[var(--app-surface-strong)] justify-start disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleApproveAll}
                  disabled={processingLoading || bulkApproveState !== null || images.every((image) => image.approval === "approved")}
                >
                  {bulkApproveState ? (
                    <>
                      <Loader className="w-4 h-4 mr-2 animate-spin" />
                      Elabora tutte {bulkApproveState.completed}/{bulkApproveState.total}
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Elabora tutte da controllare
                    </>
                  )}
                </Button>
                <Button
                  className="w-full bg-[var(--success)] text-[#16311c] hover:brightness-105 justify-start disabled:opacity-50 disabled:cursor-not-allowed"
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
              </div>

              <div className="rounded-[24px] border border-[var(--app-border)] bg-[var(--app-surface)] p-5 space-y-2 text-sm shadow-[0_18px_42px_rgba(0,0,0,0.12)]">
                <h3 className="text-sm font-medium mb-3">Info Immagine</h3>
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--app-text-muted)]">Nome file:</span>
                  <span>{currentImage.id}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--app-text-muted)]">Orientamento:</span>
                  <span>{currentOrientationLabel}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--app-text-muted)]">Stato:</span>
                  <span className={currentImage.approval === "approved" ? "text-[var(--success)]" : "text-[var(--brand-accent)]"}>
                    {currentStatusLabel}
                  </span>
                </div>
                <div className="pt-2 text-xs text-[var(--app-text-subtle)] space-y-1">
                  <div>Drag: sposta la foto dentro la cornice</div>
                  <div>Ctrl + rotellina: zoom</div>
                  <div>Frecce: micro-spostamento</div>
                  <div>Alt + frecce o PagSu/PagGiu: cambia immagine</div>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>

      <div className="h-10 bg-[var(--app-topbar)] border-t border-[var(--app-border)] flex items-center px-6 justify-between text-sm shrink-0">
        <div className="flex items-center gap-6 text-[var(--app-text-muted)]">
          <span>Immagine {Math.max(visibleIndex + 1, 1)} di {Math.max(filteredImages.length, 1)}</span>
          <span className="text-[var(--success)]">{approvedCount} approvate</span>
          <span className="text-[var(--brand-accent)]">
            {pendingCount} da controllare
          </span>
        </div>
        <div className="text-[var(--app-text-muted)]">
          <span>Modello: {project.template} • {project.imageCount.total} immagini</span>
        </div>
      </div>
    </div>
  );
}


