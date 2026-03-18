import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { ArrowLeft, Check, Edit2, FileImage } from "lucide-react";
import { Button } from "../components/ui/button";
import { getImageFile, useProject } from "../contexts/ProjectContext";
import { createCompressedPreviewUrl } from "../utils/imagePreview";
import { getCustomTemplateVariant, getProjectTemplateGeometry } from "../lib/templateGeometry";

type ComparisonLocationState = {
  imageId?: string;
  processedImageUrl?: string | null;
};

export default function ImageComparison() {
  const location = useLocation();
  const { project } = useProject();
  const state = (location.state as ComparisonLocationState | null) ?? null;
  const [originalPreviewUrl, setOriginalPreviewUrl] = useState<string | null>(null);

  const selectedImage =
    project.images.find((image) => image.id === state?.imageId) ??
    project.images.find((image) => image.approval === "approved") ??
    project.images[0];

  useEffect(() => {
    let cancelled = false;

    const preparePreview = async () => {
      if (!selectedImage) {
        setOriginalPreviewUrl(null);
        return;
      }

      const file = getImageFile(selectedImage.id);
      if (!file) {
        setOriginalPreviewUrl(null);
        return;
      }

      const previewUrl = await createCompressedPreviewUrl(file, { maxDimension: 2200, quality: 0.84 });
      if (cancelled) {
        URL.revokeObjectURL(previewUrl);
        return;
      }

      setOriginalPreviewUrl((current) => {
        if (current?.startsWith("blob:")) {
          URL.revokeObjectURL(current);
        }
        return previewUrl;
      });
    };

    void preparePreview();

    return () => {
      cancelled = true;
    };
  }, [selectedImage]);

  useEffect(() => {
    return () => {
      if (originalPreviewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(originalPreviewUrl);
      }
    };
  }, [originalPreviewUrl]);

  const comparisonData = useMemo(() => {
    if (!selectedImage) {
      return null;
    }

    const geometry = getProjectTemplateGeometry(project.template, selectedImage.orientation, project.customTemplate);
    const variant = getCustomTemplateVariant(project.customTemplate, selectedImage.orientation);
    const outerBorderSize = geometry.borderSizePx ?? 0;
    const photoViewportStyle = {
      left: `${((geometry.photoAreaX + outerBorderSize) / geometry.width) * 100}%`,
      top: `${((geometry.photoAreaY + outerBorderSize) / geometry.height) * 100}%`,
      width: `${((geometry.photoAreaWidth - outerBorderSize * 2) / geometry.width) * 100}%`,
      height: `${((geometry.photoAreaHeight - outerBorderSize * 2) / geometry.height) * 100}%`,
    };

    return {
      geometry,
      variant,
      photoViewportStyle,
      crop: selectedImage.crop,
      processedImageUrl: state?.processedImageUrl ? `http://localhost:3001${state.processedImageUrl}` : null,
    };
  }, [project.customTemplate, project.template, selectedImage, state?.processedImageUrl]);

  if (!selectedImage || !comparisonData) {
    return (
      <div className="h-screen bg-[var(--app-bg)] text-[var(--app-text)] flex items-center justify-center">
        <div className="text-center">
          <FileImage className="w-12 h-12 text-[var(--app-text-subtle)] mx-auto mb-4" />
          <p className="text-[var(--app-text-muted)] mb-4">Nessuna immagine disponibile per il confronto.</p>
          <Link to="/workspace">
            <Button className="bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)] hover:bg-[var(--brand-primary-strong)]">
              Torna all&apos;Area di Lavoro
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[var(--app-bg)] text-[var(--app-text)] flex flex-col">
      <div className="h-16 bg-[var(--app-topbar)] border-b border-[var(--app-border)] flex items-center px-6 justify-between">
        <div className="flex items-center gap-4">
          <Link to="/workspace">
            <Button variant="ghost" size="sm" className="text-[var(--app-text-muted)] hover:text-[var(--app-text)]">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Torna all&apos;Area di Lavoro
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            <FileImage className="w-6 h-6 text-[var(--brand-accent)]" />
            <span className="font-semibold">Confronto Immagini</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 gap-8">
            <div>
              <h2 className="text-xl mb-4">Foto Originale</h2>
              <div className="bg-[var(--app-surface)] border border-[var(--app-border)] rounded-[28px] overflow-hidden shadow-[0_18px_34px_rgba(0,0,0,0.12)]">
                <div className="aspect-[3/4] bg-[var(--app-field)] flex items-center justify-center p-8">
                  {originalPreviewUrl ? (
                    <img src={originalPreviewUrl} alt={selectedImage.path} className="w-full h-full object-contain rounded-2xl" />
                  ) : (
                    <div className="text-sm text-[var(--app-text-muted)]">Anteprima originale non disponibile</div>
                  )}
                </div>
                <div className="p-4 border-t border-[var(--app-border)]">
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[var(--app-text-muted)]">Immagine:</span>
                      <span>{selectedImage.path}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--app-text-muted)]">Orientamento:</span>
                      <span>{selectedImage.orientation === "vertical" ? "Verticale" : "Orizzontale"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--app-text-muted)]">Stato:</span>
                      <span>{selectedImage.approval}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-xl mb-4">Risultato Incorniciato</h2>
              <div className="bg-[var(--app-surface)] border border-[var(--app-border)] rounded-[28px] overflow-hidden shadow-[0_18px_34px_rgba(0,0,0,0.12)]">
                <div className="aspect-[3/4] bg-[var(--app-field)] flex items-center justify-center p-8">
                  <div
                    className="relative w-full max-w-[420px] rounded-[24px] overflow-hidden shadow-[0_20px_40px_rgba(0,0,0,0.18)] bg-[var(--brand-accent)]"
                    style={{ aspectRatio: `${comparisonData.geometry.width} / ${comparisonData.geometry.height}` }}
                  >
                    {comparisonData.processedImageUrl ? (
                      <img
                        src={comparisonData.processedImageUrl}
                        alt="Risultato processato"
                        className="absolute inset-0 w-full h-full object-contain"
                      />
                    ) : (
                      <>
                        {project.template === "custom" && comparisonData.variant?.backgroundPreviewUrl ? (
                          <img
                            src={comparisonData.variant.backgroundPreviewUrl}
                            alt={project.customTemplate?.name || "Template background"}
                            className="absolute inset-0 h-full w-full object-cover"
                          />
                        ) : null}
                        {project.template === "custom" && !comparisonData.variant?.backgroundPreviewUrl ? (
                          <div className="absolute inset-0 bg-[linear-gradient(135deg,#4b5750,#66756b_42%,#2b312d)]" />
                        ) : null}
                        {project.template !== "custom" ? (
                          <>
                            <div className="absolute inset-[6px] rounded-[24px] border-[12px] border-[var(--brand-primary-strong)] pointer-events-none" />
                            <div className="absolute inset-[14px] rounded-[18px] border-[6px] border-[var(--brand-accent)] pointer-events-none" />
                          </>
                        ) : null}
                        <div
                          className={`absolute overflow-hidden ${project.template === "custom" ? "rounded-[18px]" : "rounded-[10px] bg-[var(--app-field)]"}`}
                          style={comparisonData.photoViewportStyle}
                        >
                          {originalPreviewUrl ? (
                            <img
                              src={originalPreviewUrl}
                              alt={selectedImage.path}
                              className="absolute inset-0 h-full w-full object-cover"
                              style={{
                                transform: `translate(${comparisonData.crop.x}px, ${comparisonData.crop.y}px) scale(${comparisonData.crop.zoom / 100})`,
                                transformOrigin: "center",
                              }}
                            />
                          ) : null}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className="p-4 border-t border-[var(--app-border)]">
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[var(--app-text-muted)]">Canvas output:</span>
                      <span>{comparisonData.geometry.width} x {comparisonData.geometry.height}px</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--app-text-muted)]">Area foto:</span>
                      <span>{comparisonData.geometry.photoAreaWidth} x {comparisonData.geometry.photoAreaHeight}px</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--app-text-muted)]">Tipo anteprima:</span>
                      <span>{comparisonData.processedImageUrl ? "Render reale" : "Preview live"}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 bg-[var(--app-surface)] border border-[var(--app-border)] rounded-[28px] p-6 shadow-[0_18px_34px_rgba(0,0,0,0.12)]">
            <h3 className="text-lg mb-4">Dettagli Ritaglio e Regolazioni</h3>
            <div className="grid grid-cols-3 gap-6 text-sm">
              <div>
                <span className="text-[var(--app-text-muted)] block mb-1">Posizione</span>
                <span className="text-lg">X: {comparisonData.crop.x}px, Y: {comparisonData.crop.y}px</span>
              </div>
              <div>
                <span className="text-[var(--app-text-muted)] block mb-1">Zoom</span>
                <span className="text-lg">{comparisonData.crop.zoom}%</span>
              </div>
              <div>
                <span className="text-[var(--app-text-muted)] block mb-1">Template</span>
                <span className="text-lg">{project.template === "custom" ? project.customTemplate?.name || "Template Custom" : project.template}</span>
              </div>
            </div>
          </div>

          <div className="flex gap-4 justify-center mt-8">
            <Link to="/workspace">
              <Button variant="outline" size="lg" className="border-[var(--app-border-strong)] bg-[var(--app-surface)] hover:bg-[var(--app-surface-strong)]">
                <Edit2 className="w-4 h-4 mr-2" />
                Modifica Ritaglio
              </Button>
            </Link>
            <Link to="/workspace">
              <Button size="lg" className="bg-[var(--success)] text-[#16311c] hover:brightness-105">
                <Check className="w-4 h-4 mr-2" />
                Mantieni e Continua
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
