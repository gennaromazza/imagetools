import { Link, useNavigate } from "react-router";
import { ArrowLeft, AlertCircle, CheckCircle2, FileImage } from "lucide-react";
import { Button } from "../components/ui/button";
import { useProject } from "../contexts/ProjectContext";
import { getCustomTemplateVariant, getProjectTemplateGeometry } from "../lib/templateGeometry";

export default function TemplateValidation() {
  const navigate = useNavigate();
  const { project } = useProject();
  const previewOrientations: Array<"vertical" | "horizontal"> =
    project.template === "custom" ? ["vertical", "horizontal"] : [project.images[0]?.orientation ?? "horizontal"];

  return (
    <div className="h-screen bg-[var(--app-bg)] text-[var(--app-text)] flex flex-col">
      <div className="h-16 bg-[var(--app-topbar)] border-b border-[var(--app-border)] backdrop-blur-xl flex items-center px-6 justify-between">
        <div className="flex items-center gap-4">
          <Link to="/new-project">
            <Button variant="ghost" size="sm" className="text-[var(--app-text-muted)] hover:text-[var(--app-text)]">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Indietro
            </Button>
          </Link>
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

                return (
                  <div key={orientation} className="bg-[var(--app-surface)] border border-[var(--app-border)] rounded-2xl p-6 shadow-[0_18px_42px_rgba(0,0,0,0.16)]">
                    <div className="mb-3 text-sm text-[var(--app-text-muted)]">
                      Variante {orientation === "vertical" ? "Verticale" : "Orizzontale"}
                    </div>
                    <div
                      className="relative mx-auto w-full max-w-[420px] overflow-hidden rounded-[24px] border border-[var(--app-border)] bg-[var(--app-surface-strong)]"
                      style={{
                        aspectRatio: `${geometry.width} / ${geometry.height}`,
                        backgroundImage: variant?.backgroundPreviewUrl ? `url(${variant.backgroundPreviewUrl})` : undefined,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }}
                    >
                      {!variant?.backgroundPreviewUrl ? (
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
                            left: geometry.borderSizePx ?? 0,
                            top: geometry.borderSizePx ?? 0,
                            right: geometry.borderSizePx ?? 0,
                            bottom: geometry.borderSizePx ?? 0,
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
                <h3 className="text-sm mb-3">Lista Controlli</h3>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[var(--success)]">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-sm">Template assegnato al progetto</span>
                  </div>
                  <div className="flex items-center gap-2 text-[var(--success)]">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-sm">Area foto definita per l'impaginazione</span>
                  </div>
                  <div className={`flex items-center gap-2 ${project.template === "custom" ? "text-[var(--success)]" : "text-[var(--brand-accent)]"}`}>
                    {project.template === "custom" ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    <span className="text-sm">
                      {project.template === "custom"
                        ? "Varianti verticale/orizzontale presenti"
                        : "Il preset usera la propria logica interna di orientamento"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <Link to={project.template === "custom" ? "/custom-template" : "/new-project"} className="flex-1">
                  <Button variant="outline" className="w-full border-[var(--app-border-strong)] bg-[var(--app-surface)] text-[var(--app-text)] hover:bg-[var(--app-surface-strong)]">
                    {project.template === "custom" ? "Modifica Template" : "Cambia Modello"}
                  </Button>
                </Link>
                <Button onClick={() => navigate("/workspace")} className="flex-1 bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)] hover:bg-[var(--brand-primary-strong)]">
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
