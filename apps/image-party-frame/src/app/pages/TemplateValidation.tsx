import { Link, useNavigate } from "react-router";
import { ArrowLeft, AlertCircle, CheckCircle2, FileImage } from "lucide-react";
import { Button } from "../components/ui/button";
import { getImageFile, useProject } from "../contexts/ProjectContext";
import { getCustomTemplateVariant, getPresetFrameDataUrl, getProjectTemplateGeometry } from "../lib/templateGeometry";
import { validateProjectForWorkspace } from "../lib/projectValidation";

export default function TemplateValidation() {
  const navigate = useNavigate();
  const { project } = useProject();
  const projectOrientations = Array.from(new Set(project.images.map((image) => image.orientation)));
  const previewOrientations: Array<"vertical" | "horizontal"> =
    project.template === "custom"
      ? ["vertical", "horizontal"]
      : projectOrientations.length > 0
        ? projectOrientations
        : ["horizontal"];
  const validation = validateProjectForWorkspace(
    project,
    (imageId) => Boolean(getImageFile(imageId, project.projectId))
  );

  return (
    <div className="h-screen bg-[var(--app-bg)] text-[var(--app-text)] flex flex-col">
      <div className="h-16 bg-[var(--app-topbar)] border-b border-[var(--app-border)] backdrop-blur-xl flex items-center px-6 justify-between">
        <div className="flex items-center gap-4">
          <Button asChild variant="ghost" size="sm" className="text-[var(--app-text-muted)] hover:text-[var(--app-text)]">
            <Link to="/new-project">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Indietro
            </Link>
          </Button>
          <div className="flex items-center gap-3">
            <FileImage className="w-6 h-6 text-[var(--brand-accent)]" />
            <span className="font-semibold text-lg">Validazione Modello</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-7xl mx-auto grid grid-cols-[1.2fr,0.9fr] gap-8">
          <div>
            <h2 className="text-xl mb-4">Anteprima Layout</h2>
            <div className={`grid gap-6 ${previewOrientations.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
              {previewOrientations.map((orientation) => {
                const geometry = getProjectTemplateGeometry(project.template, orientation, project.customTemplate);
                const variant = getCustomTemplateVariant(project.customTemplate, orientation);
                const framePreviewUrl = project.template === "custom"
                  ? variant?.backgroundPreviewUrl
                  : getPresetFrameDataUrl(project.template, orientation);

                return (
                  <div key={orientation} className="bg-[var(--app-surface)] border border-[var(--app-border)] rounded-2xl p-6 shadow-[0_18px_42px_rgba(0,0,0,0.16)]">
                    <div className="mb-3 text-sm text-[var(--app-text-muted)]">
                      Variante {orientation === "vertical" ? "Verticale" : "Orizzontale"}
                    </div>
                    <div
                      className="relative mx-auto w-full max-w-[420px] overflow-hidden rounded-[24px] border border-[var(--app-border)] bg-[var(--app-surface-strong)]"
                      style={{
                        aspectRatio: `${geometry.width} / ${geometry.height}`,
                        backgroundImage: framePreviewUrl ? `url(${framePreviewUrl})` : undefined,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }}
                    >
                      {!framePreviewUrl ? (
                        <div className="absolute inset-0 bg-[linear-gradient(135deg,#4b5750,#66756b_42%,#2b312d)] opacity-95" />
                      ) : null}
                      <div
                        className="absolute rounded-[16px] border-2 border-dashed border-[var(--brand-secondary)]"
                        style={{
                          left: `${(geometry.photoAreaX / geometry.width) * 100}%`,
                          top: `${(geometry.photoAreaY / geometry.height) * 100}%`,
                          width: `${(geometry.photoAreaWidth / geometry.width) * 100}%`,
                          height: `${(geometry.photoAreaHeight / geometry.height) * 100}%`,
                          backgroundColor: geometry.borderColor ?? "#ffffff",
                        }}
                      >
                        <div
                          className="absolute bg-[rgba(31,36,33,0.18)] rounded-[12px]"
                          style={{
                            left: `${((geometry.borderSizePx ?? 0) / geometry.photoAreaWidth) * 100}%`,
                            top: `${((geometry.borderSizePx ?? 0) / geometry.photoAreaHeight) * 100}%`,
                            right: `${((geometry.borderSizePx ?? 0) / geometry.photoAreaWidth) * 100}%`,
                            bottom: `${((geometry.borderSizePx ?? 0) / geometry.photoAreaHeight) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h2 className="text-xl mb-4">Informazioni Modello</h2>
            <div className="bg-[var(--app-surface)] border border-[var(--app-border)] rounded-2xl p-6 space-y-6 shadow-[0_18px_42px_rgba(0,0,0,0.16)]">
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-[var(--app-text-muted)]">Nome Modello:</span>
                  <span>{project.template === "custom" ? project.customTemplate?.name || "Template Custom" : project.template}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--app-text-muted)]">Tipo:</span>
                  <span>{project.template === "custom" ? "Template custom multi-layout" : "Template libreria"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--app-text-muted)]">Orientamenti gestiti:</span>
                  <span>{project.template === "custom" ? "Verticale + Orizzontale" : "Automatico da preset"}</span>
                </div>
              </div>

              {project.template === "custom" ? (
                <div className="border-t border-[var(--app-border)] pt-4 space-y-3 text-sm">
                  {(["vertical", "horizontal"] as const).map((orientation) => {
                    const variant = getCustomTemplateVariant(project.customTemplate, orientation);
                    if (!variant) {
                      return null;
                    }

                    return (
                      <div key={orientation} className="rounded-xl border border-[var(--app-border)] bg-[var(--app-field)] p-4">
                        <div className="font-medium mb-2">{orientation === "vertical" ? "Verticale" : "Orizzontale"}</div>
                        <div className="flex justify-between text-xs">
                          <span className="text-[var(--app-text-muted)]">Canvas:</span>
                          <span>{variant.widthPx} x {variant.heightPx}px</span>
                        </div>
                        <div className="flex justify-between text-xs mt-1">
                          <span className="text-[var(--app-text-muted)]">Area foto:</span>
                          <span>{variant.photoAreaWidth} x {variant.photoAreaHeight}px</span>
                        </div>
                        <div className="flex justify-between text-xs mt-1">
                          <span className="text-[var(--app-text-muted)]">Bordo foto:</span>
                          <span>{variant.borderSizePx}px {variant.borderColor}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <div className="border-t border-[var(--app-border)] pt-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm">Controlli reali</h3>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs ${
                      validation.canContinue
                        ? "bg-[rgba(142,178,142,0.12)] text-[var(--success)]"
                        : "bg-[var(--danger-soft)] text-[var(--danger)]"
                    }`}
                    aria-live="polite"
                  >
                    {validation.canContinue
                      ? validation.warningCount > 0
                        ? `Pronto con ${validation.warningCount} avvisi`
                        : "Pronto"
                      : `${validation.errorCount} errori bloccanti`}
                  </span>
                </div>
                <div className="space-y-2">
                  {validation.checks.map((check) => (
                    <div
                      key={check.code}
                      className={`flex items-start gap-2 rounded-xl px-3 py-2 ${
                        check.severity === "ok"
                          ? "bg-[rgba(142,178,142,0.07)] text-[var(--success)]"
                          : check.severity === "warning"
                            ? "bg-[rgba(184,154,99,0.08)] text-[var(--brand-accent)]"
                            : "bg-[var(--danger-soft)] text-[var(--danger)]"
                      }`}
                    >
                      {check.severity === "ok" ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      ) : (
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      )}
                      <div>
                        <div className="text-sm">{check.label}</div>
                        {check.detail ? <div className="mt-0.5 text-xs opacity-75">{check.detail}</div> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <Button asChild variant="outline" className="flex-1 border-[var(--app-border-strong)] bg-[var(--app-surface)] text-[var(--app-text)] hover:bg-[var(--app-surface-strong)]">
                  <Link to={project.template === "custom" ? "/custom-template" : "/new-project"}>
                    {project.template === "custom" ? "Modifica Template" : "Cambia Modello"}
                  </Link>
                </Button>
                <Button
                  onClick={() => navigate("/workspace")}
                  disabled={!validation.canContinue}
                  className="flex-1 bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)] hover:bg-[var(--brand-primary-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Vai all'Area di Lavoro
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
