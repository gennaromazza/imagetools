import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { AlertTriangle, ArrowLeft, Check, Edit2, FileImage, Loader2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { getImageFile, type ImageItem, useProject } from "../contexts/ProjectContext";
import { createCompressedPreview } from "../utils/imagePreview";
import {
  getCustomTemplateVariant,
  getPresetFrameDataUrl,
  getProjectTemplateGeometry,
} from "../lib/templateGeometry";
import { getCoverCropMetrics, normalizeCropTransform } from "../lib/cropGeometry";
import { resolveApiAssetUrl } from "../lib/apiUrls";
import { getPartyFramePreset } from "../../../server/templateCatalog";

type ComparisonLocationState = {
  imageId?: string;
  processedImageUrl?: string | null;
};

type PreviewEntry = {
  url: string;
  width: number;
  height: number;
  source: "desktop" | "browser";
};

type ViewportSize = {
  width: number;
  height: number;
};

function ownedBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

async function createOriginalPreview(
  image: ImageItem,
  file: File | undefined
): Promise<PreviewEntry | null> {
  let desktopError: unknown;

  if (image.absolutePath && window.filexDesktop?.getThumbnail) {
    try {
      const thumbnail = await window.filexDesktop.getThumbnail(
        image.absolutePath,
        2200,
        0.84,
        `${image.size ?? 0}:${image.lastModified ?? 0}`,
        { profile: "balanced", preferEmbeddedPreview: true }
      );

      if (thumbnail) {
        const blob = new Blob([ownedBytes(thumbnail.bytes)], { type: thumbnail.mimeType });
        return {
          url: URL.createObjectURL(blob),
          width: thumbnail.width,
          height: thumbnail.height,
          source: "desktop",
        };
      }
    } catch (error) {
      desktopError = error;
    }
  }

  if (file && file.size > 0) {
    const preview = await createCompressedPreview(file, { maxDimension: 2200, quality: 0.84 });
    return { ...preview, source: "browser" };
  }

  if (desktopError) {
    throw desktopError;
  }

  return null;
}

function imageDisplayName(image: ImageItem): string {
  return (image.relativePath || image.path).replace(/\\/g, "/").split("/").pop() || image.path;
}

function approvalLabel(image: ImageItem): string {
  if (image.processingStatus === "processing") return "Elaborazione in corso";
  if (image.processingStatus === "error") return "Elaborazione non riuscita";
  if (image.approval === "approved") return "Approvata";
  if (image.approval === "needs-adjustment") return "Da correggere";
  return "Da approvare";
}

function horizontalPositionLabel(offset: number): string {
  const percentage = Math.round(Math.abs(offset) * 100);
  if (percentage === 0) return "Centrata";
  return `${offset < 0 ? "Sinistra" : "Destra"} ${percentage}%`;
}

function verticalPositionLabel(offset: number): string {
  const percentage = Math.round(Math.abs(offset) * 100);
  if (percentage === 0) return "Centrata";
  return `${offset < 0 ? "Alto" : "Basso"} ${percentage}%`;
}

export default function ImageComparison() {
  const location = useLocation();
  const { project } = useProject();
  const state = (location.state as ComparisonLocationState | null) ?? null;
  const [originalPreview, setOriginalPreview] = useState<PreviewEntry | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewUnavailable, setPreviewUnavailable] = useState(false);
  const [processedImageFailed, setProcessedImageFailed] = useState(false);
  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 0, height: 0 });
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const selectedImage =
    project.images.find((image) => image.id === state?.imageId) ??
    project.images.find((image) => image.approval === "approved") ??
    project.images[0];

  const previewSourceKey = selectedImage
    ? [
        project.projectId,
        selectedImage.id,
        selectedImage.absolutePath ?? "",
        selectedImage.size ?? 0,
        selectedImage.lastModified ?? 0,
      ].join(":")
    : "no-image";

  useEffect(() => {
    let cancelled = false;
    let ownedUrl: string | null = null;

    setOriginalPreview(null);
    setPreviewUnavailable(false);
    setPreviewLoading(Boolean(selectedImage));

    if (!selectedImage) {
      return;
    }

    const preparePreview = async () => {
      try {
        const file = getImageFile(selectedImage.id, project.projectId);
        const preview = await createOriginalPreview(selectedImage, file);

        if (!preview) {
          if (!cancelled) setPreviewUnavailable(true);
          return;
        }

        ownedUrl = preview.url;
        if (cancelled) {
          URL.revokeObjectURL(preview.url);
          ownedUrl = null;
          return;
        }

        setOriginalPreview(preview);
      } catch (error) {
        console.error(`Impossibile preparare l'anteprima di ${imageDisplayName(selectedImage)}:`, error);
        if (!cancelled) setPreviewUnavailable(true);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    };

    void preparePreview();

    return () => {
      cancelled = true;
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
    };
  }, [previewSourceKey, project.projectId]);

  const geometry = useMemo(
    () => selectedImage
      ? getProjectTemplateGeometry(project.template, selectedImage.orientation, project.customTemplate)
      : null,
    [project.customTemplate, project.template, selectedImage?.orientation]
  );
  const customVariant = useMemo(
    () => selectedImage
      ? getCustomTemplateVariant(project.customTemplate, selectedImage.orientation)
      : null,
    [project.customTemplate, selectedImage?.orientation]
  );
  const processedImageUrl = useMemo(
    () => resolveApiAssetUrl(state?.processedImageUrl),
    [state?.processedImageUrl]
  );

  useEffect(() => {
    setProcessedImageFailed(false);
  }, [processedImageUrl]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !selectedImage || !geometry) return;

    const updateSize = () => {
      const rect = viewport.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      setViewportSize((current) =>
        Math.abs(current.width - rect.width) < 0.5 && Math.abs(current.height - rect.height) < 0.5
          ? current
          : { width: rect.width, height: rect.height }
      );
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [geometry?.height, geometry?.width, project.template, selectedImage?.id]);

  const normalizedCrop = useMemo(
    () => normalizeCropTransform(selectedImage?.crop),
    [selectedImage?.crop]
  );
  const outerBorderSize = geometry?.borderSizePx ?? 0;
  const photoViewportStyle = useMemo(() => {
    if (!geometry) return undefined;

    return {
      left: `${((geometry.photoAreaX + outerBorderSize) / geometry.width) * 100}%`,
      top: `${((geometry.photoAreaY + outerBorderSize) / geometry.height) * 100}%`,
      width: `${(Math.max(1, geometry.photoAreaWidth - outerBorderSize * 2) / geometry.width) * 100}%`,
      height: `${(Math.max(1, geometry.photoAreaHeight - outerBorderSize * 2) / geometry.height) * 100}%`,
    };
  }, [geometry, outerBorderSize]);
  const customBorderStyle = useMemo(() => {
    if (!geometry || project.template !== "custom" || outerBorderSize <= 0) return undefined;

    return {
      left: `${(geometry.photoAreaX / geometry.width) * 100}%`,
      top: `${(geometry.photoAreaY / geometry.height) * 100}%`,
      width: `${(geometry.photoAreaWidth / geometry.width) * 100}%`,
      height: `${(geometry.photoAreaHeight / geometry.height) * 100}%`,
      backgroundColor: geometry.borderColor ?? "#ffffff",
    };
  }, [geometry, outerBorderSize, project.template]);
  const cropMetrics = useMemo(
    () => originalPreview
      ? getCoverCropMetrics(originalPreview, viewportSize, normalizedCrop)
      : null,
    [normalizedCrop, originalPreview, viewportSize]
  );
  const croppedImageStyle = cropMetrics
    ? {
        width: `${cropMetrics.renderedWidth}px`,
        height: `${cropMetrics.renderedHeight}px`,
        left: `calc(50% - ${cropMetrics.renderedWidth / 2}px + ${cropMetrics.translationX}px)`,
        top: `calc(50% - ${cropMetrics.renderedHeight / 2}px + ${cropMetrics.translationY}px)`,
      }
    : undefined;

  if (!selectedImage || !geometry || !photoViewportStyle) {
    return (
      <main className="h-screen bg-[var(--app-bg)] text-[var(--app-text)] flex items-center justify-center">
        <div className="text-center">
          <FileImage aria-hidden="true" className="w-12 h-12 text-[var(--app-text-subtle)] mx-auto mb-4" />
          <h1 className="text-lg font-semibold mb-2">Nessuna foto da confrontare</h1>
          <p className="text-[var(--app-text-muted)] mb-4">Torna al progetto e scegli una foto elaborata.</p>
          <Button asChild className="bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)] hover:bg-[var(--brand-primary-strong)]">
            <Link to="/workspace">Torna all&apos;area di lavoro</Link>
          </Button>
        </div>
      </main>
    );
  }

  const fileName = imageDisplayName(selectedImage);
  const presetFrameUrl = project.template === "custom"
    ? null
    : getPresetFrameDataUrl(project.template, selectedImage.orientation);
  const customBackgroundUrl = customVariant?.backgroundPreviewUrl ?? customVariant?.backgroundDataUrl ?? null;
  const templateName = project.template === "custom"
    ? project.customTemplate?.name || "Template personalizzato"
    : getPartyFramePreset(project.template).name;
  const hasRealResult = Boolean(processedImageUrl) && !processedImageFailed;
  const usefulPhotoWidth = Math.max(1, geometry.photoAreaWidth - outerBorderSize * 2);
  const usefulPhotoHeight = Math.max(1, geometry.photoAreaHeight - outerBorderSize * 2);

  return (
    <div className="h-screen bg-[var(--app-bg)] text-[var(--app-text)] flex flex-col">
      <header className="min-h-16 bg-[var(--app-topbar)] border-b border-[var(--app-border)] flex items-center px-4 sm:px-6 gap-4">
        <Button asChild variant="ghost" size="sm" className="text-[var(--app-text-muted)] hover:text-[var(--app-text)]">
          <Link to="/workspace" aria-label="Torna all'area di lavoro">
            <ArrowLeft aria-hidden="true" className="w-4 h-4 mr-2" />
            Torna all&apos;area di lavoro
          </Link>
        </Button>
        <div className="flex items-center gap-3 min-w-0">
          <FileImage aria-hidden="true" className="w-6 h-6 shrink-0 text-[var(--brand-accent)]" />
          <div className="min-w-0">
            <h1 className="font-semibold">Confronto foto</h1>
            <p className="text-xs text-[var(--app-text-muted)] truncate" title={fileName}>{fileName}</p>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 sm:p-8" aria-labelledby="comparison-title">
        <div className="max-w-7xl mx-auto">
          <h2 id="comparison-title" className="sr-only">Confronto tra foto di partenza e risultato</h2>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <section aria-labelledby="original-title">
              <h3 id="original-title" className="text-xl mb-4">Foto di partenza</h3>
              <div className="bg-[var(--app-surface)] border border-[var(--app-border)] rounded-[28px] overflow-hidden shadow-[0_18px_34px_rgba(0,0,0,0.12)]">
                <div className="min-h-[360px] bg-[var(--app-field)] flex items-center justify-center p-6 sm:p-8">
                  {originalPreview ? (
                    <img
                      src={originalPreview.url}
                      alt={`Foto di partenza: ${fileName}`}
                      className="max-h-[62vh] max-w-full object-contain rounded-2xl"
                      loading="eager"
                      decoding="async"
                    />
                  ) : previewLoading ? (
                    <div role="status" className="text-center text-sm text-[var(--app-text-muted)]">
                      <Loader2 aria-hidden="true" className="w-8 h-8 animate-spin text-[var(--brand-accent)] mx-auto mb-3" />
                      Preparazione della foto
                    </div>
                  ) : (
                    <div role="status" className="max-w-sm text-center text-sm text-[var(--app-text-muted)]">
                      <AlertTriangle aria-hidden="true" className="w-8 h-8 text-[var(--danger)] mx-auto mb-3" />
                      {previewUnavailable
                        ? "La foto di partenza non è più raggiungibile. Ricollega la cartella sorgente dal progetto."
                        : "Anteprima della foto non disponibile."}
                    </div>
                  )}
                </div>
                <dl className="p-4 border-t border-[var(--app-border)] grid gap-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-[var(--app-text-muted)]">File</dt>
                    <dd className="min-w-0 truncate text-right" title={selectedImage.relativePath || selectedImage.path}>{fileName}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-[var(--app-text-muted)]">Orientamento</dt>
                    <dd>{selectedImage.orientation === "vertical" ? "Verticale" : "Orizzontale"}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-[var(--app-text-muted)]">Stato</dt>
                    <dd>{approvalLabel(selectedImage)}</dd>
                  </div>
                  {originalPreview ? (
                    <div className="flex justify-between gap-4">
                      <dt className="text-[var(--app-text-muted)]">
                        {originalPreview.source === "desktop" ? "Anteprima desktop" : "Dimensioni foto"}
                      </dt>
                      <dd>{originalPreview.width} × {originalPreview.height} px</dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            </section>

            <section aria-labelledby="result-title">
              <h3 id="result-title" className="text-xl mb-4">Risultato con cornice</h3>
              <div className="bg-[var(--app-surface)] border border-[var(--app-border)] rounded-[28px] overflow-hidden shadow-[0_18px_34px_rgba(0,0,0,0.12)]">
                <div className="min-h-[360px] bg-[var(--app-field)] flex items-center justify-center p-6 sm:p-8">
                  <figure className="w-full max-w-[520px]">
                    <div
                      className="relative w-full overflow-hidden shadow-[0_20px_40px_rgba(0,0,0,0.18)] bg-[var(--app-surface-strong)]"
                      style={{ aspectRatio: `${geometry.width} / ${geometry.height}` }}
                      aria-label={`${hasRealResult ? "Risultato elaborato" : "Anteprima del ritaglio"} con ${templateName}`}
                    >
                      {presetFrameUrl ? (
                        <img src={presetFrameUrl} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full" />
                      ) : customBackgroundUrl ? (
                        <img src={customBackgroundUrl} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />
                      ) : null}

                      {customBorderStyle ? (
                        <div aria-hidden="true" className="absolute" style={customBorderStyle} />
                      ) : null}

                      <div
                        ref={viewportRef}
                        className="absolute overflow-hidden bg-[var(--app-field)]"
                        style={photoViewportStyle}
                        aria-hidden={hasRealResult}
                      >
                        {originalPreview && croppedImageStyle ? (
                          <img
                            src={originalPreview.url}
                            alt={hasRealResult ? "" : `Anteprima ritagliata di ${fileName}`}
                            draggable={false}
                            className="absolute max-w-none select-none pointer-events-none"
                            style={croppedImageStyle}
                            loading="eager"
                            decoding="async"
                          />
                        ) : !previewLoading ? (
                          <div className="h-full w-full flex items-center justify-center px-3 text-center text-xs text-[var(--app-text-muted)]">
                            Foto non disponibile
                          </div>
                        ) : null}
                      </div>

                      {hasRealResult && processedImageUrl ? (
                        <img
                          src={processedImageUrl}
                          alt={`Risultato elaborato di ${fileName} con ${templateName}`}
                          className="absolute inset-0 z-20 h-full w-full object-contain"
                          loading="eager"
                          decoding="async"
                          onError={() => setProcessedImageFailed(true)}
                        />
                      ) : null}
                    </div>
                    <figcaption className="sr-only">
                      {hasRealResult
                        ? "Risultato generato dal motore di elaborazione."
                        : "Anteprima locale costruita dal ritaglio salvato nel progetto."}
                    </figcaption>
                  </figure>
                </div>

                {processedImageFailed ? (
                  <div role="alert" className="mx-4 mt-4 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">
                    Il risultato elaborato non è più disponibile; viene mostrata l&apos;anteprima del ritaglio salvato.
                  </div>
                ) : null}

                <dl className="p-4 border-t border-[var(--app-border)] grid gap-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-[var(--app-text-muted)]">Dimensioni risultato</dt>
                    <dd>{geometry.width} × {geometry.height} px</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-[var(--app-text-muted)]">Area foto utile</dt>
                    <dd>{usefulPhotoWidth} × {usefulPhotoHeight} px</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-[var(--app-text-muted)]">Visualizzazione</dt>
                    <dd>{hasRealResult ? "Risultato elaborato" : "Anteprima del ritaglio"}</dd>
                  </div>
                </dl>
              </div>
            </section>
          </div>

          <section aria-labelledby="crop-details-title" className="mt-8 bg-[var(--app-surface)] border border-[var(--app-border)] rounded-[28px] p-6 shadow-[0_18px_34px_rgba(0,0,0,0.12)]">
            <h3 id="crop-details-title" className="text-lg mb-4">Ritaglio salvato</h3>
            <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 text-sm">
              <div>
                <dt className="text-[var(--app-text-muted)] mb-1">Posizione orizzontale</dt>
                <dd className="text-lg">{horizontalPositionLabel(normalizedCrop.offsetX)}</dd>
              </div>
              <div>
                <dt className="text-[var(--app-text-muted)] mb-1">Posizione verticale</dt>
                <dd className="text-lg">{verticalPositionLabel(normalizedCrop.offsetY)}</dd>
              </div>
              <div>
                <dt className="text-[var(--app-text-muted)] mb-1">Ingrandimento</dt>
                <dd className="text-lg">{Math.round(normalizedCrop.zoom)}%</dd>
              </div>
              <div>
                <dt className="text-[var(--app-text-muted)] mb-1">Template</dt>
                <dd className="text-lg">{templateName}</dd>
              </div>
            </dl>
          </section>

          <nav aria-label="Azioni del confronto" className="flex flex-wrap gap-4 justify-center mt-8">
            <Button asChild variant="outline" size="lg" className="border-[var(--app-border-strong)] bg-[var(--app-surface)] hover:bg-[var(--app-surface-strong)]">
              <Link to="/workspace">
                <Edit2 aria-hidden="true" className="w-4 h-4 mr-2" />
                Modifica ritaglio
              </Link>
            </Button>
            <Button asChild size="lg" className="bg-[var(--success)] text-[#16311c] hover:brightness-105">
              <Link to="/workspace">
                <Check aria-hidden="true" className="w-4 h-4 mr-2" />
                Continua nel progetto
              </Link>
            </Button>
          </nav>
        </div>
      </main>
    </div>
  );
}
