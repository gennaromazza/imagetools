import { useRef, useState } from "react";
import type { AutoLayoutRequest, AutoLayoutResult, ImageAsset } from "@photo-tools/shared-types";
import { downloadFile, exportProject, importProject } from "../project-export";
import { ConfirmModal } from "./ConfirmModal";
import { useToast } from "./ToastProvider";

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  request: AutoLayoutRequest;
  result?: AutoLayoutResult;
  catalogAssets?: ImageAsset[];
  assetCount: number;
  pageCount: number;
}

interface ProjectDashboardProps {
  projects: Project[];
  onCreateNew: () => void;
  onOpenProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onRenameProject: (projectId: string, newName: string) => void;
  onImportProject?: (project: Project) => void;
}

export function ProjectDashboard({
  projects,
  onCreateNew,
  onOpenProject,
  onDeleteProject,
  onRenameProject,
  onImportProject
}: ProjectDashboardProps) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [isExporting, setIsExporting] = useState<string | null>(null);
  const [projectPendingDeletion, setProjectPendingDeletion] = useState<Project | null>(null);

  const startEditing = (project: Project) => {
    setEditingProjectId(project.id);
    setEditingName(project.name);
  };

  const saveEdit = (projectId: string) => {
    if (editingName.trim()) {
      onRenameProject(projectId, editingName.trim());
    }
    setEditingProjectId(null);
    setEditingName("");
  };

  const handleExportProject = async (project: Project) => {
    setIsExporting(project.id);
    try {
      const blob = await exportProject(project);
      const fileName = `${project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}_${Date.now()}.imagetool`;
      downloadFile(blob, fileName);
      toast.addToast(`Progetto "${project.name}" esportato con successo.`, "success");
    } catch (error) {
      toast.addToast(
        `Errore nell'esportazione del progetto: ${error instanceof Error ? error.message : "Errore sconosciuto"}`,
        "error",
        7000
      );
    } finally {
      setIsExporting(null);
    }
  };

  const handleImportProject = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    input.value = "";

    try {
      const content = await file.arrayBuffer();
      const { project } = await importProject(content);

      if (onImportProject) {
        onImportProject(project);
      }

      toast.addToast(`Progetto "${project.name}" importato con successo.`, "success");
    } catch (error) {
      toast.addToast(
        `Errore nell'importazione: ${error instanceof Error ? error.message : "Errore sconosciuto"}`,
        "error",
        7000
      );
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <div>
          <span className="dashboard-eyebrow">ImageTools Auto Layout</span>
          <h1 className="dashboard-title">Progetti e fogli pronti per la revisione</h1>
          <p className="dashboard-subtitle">
            Crea, riapri o importa un progetto con lo stesso feeling operativo di Image Party Frame.
          </p>
        </div>
        <div className="dashboard-header-buttons">
          <button
            type="button"
            className="secondary-button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Importa un progetto salvato"
            title="Importa un file .imagetool"
          >
            Importa Progetto
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={onCreateNew}
            aria-label="Crea un nuovo progetto"
          >
            + Nuovo progetto
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".imagetool,application/json"
            onChange={handleImportProject}
            style={{ display: "none" }}
            aria-label="Seleziona file progetto da importare"
          />
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="dashboard-empty">
          <div className="empty-state">
            <span className="empty-state__icon">NEW</span>
            <h2 className="empty-state__title">Nessun progetto ancora</h2>
            <p className="empty-state__description">
              Crea il tuo primo progetto di impaginazione per iniziare. Potrai salvare progetti multipli e
              riprenderli in qualsiasi momento.
            </p>
            <button
              type="button"
              className="primary-button"
              onClick={onCreateNew}
              aria-label="Crea il tuo primo progetto"
            >
              Crea il primo progetto
            </button>
          </div>
        </div>
      ) : (
        <div className="projects-grid">
          {projects.map((project) => (
            <div key={project.id} className="project-card">
              <div className="project-card__header">
                {editingProjectId === project.id ? (
                  <input
                    type="text"
                    className="project-card__name-input"
                    value={editingName}
                    onChange={(event) => setEditingName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") saveEdit(project.id);
                      if (event.key === "Escape") setEditingProjectId(null);
                    }}
                    onBlur={() => saveEdit(project.id)}
                    autoFocus
                    aria-label="Nome progetto"
                  />
                ) : (
                  <h3 className="project-card__name">{project.name}</h3>
                )}
              </div>

              <div className="project-card__meta">
                <span className="project-meta">
                  <span className="project-meta__icon">IMG</span>
                  {project.assetCount} foto
                </span>
                <span className="project-meta">
                  <span className="project-meta__icon">PG</span>
                  {project.pageCount} fogli
                </span>
              </div>

              <div className="project-card__dates">
                <small>Aggiornato: {formatDate(project.updatedAt)}</small>
              </div>

              <div className="project-card__actions">
                <button
                  type="button"
                  className="primary-button project-card__button"
                  onClick={() => onOpenProject(project.id)}
                  aria-label={`Apri progetto ${project.name}`}
                >
                  Apri
                </button>

                <button
                  type="button"
                  className="secondary-button project-card__button"
                  onClick={() => handleExportProject(project)}
                  disabled={isExporting === project.id}
                  aria-label={`Esporta progetto ${project.name}`}
                  title="Scarica il progetto come file .imagetool"
                >
                  {isExporting === project.id ? "..." : "Export"}
                </button>

                <button
                  type="button"
                  className="ghost-button project-card__button"
                  onClick={() => startEditing(project)}
                  aria-label={`Modifica nome progetto ${project.name}`}
                  title="Rinomina progetto"
                >
                  Rinomina
                </button>

                <button
                  type="button"
                  className="ghost-button ghost-button--danger project-card__button"
                  onClick={() => setProjectPendingDeletion(project)}
                  aria-label={`Elimina progetto ${project.name}`}
                  title="Elimina progetto"
                >
                  Elimina
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {projectPendingDeletion ? (
        <ConfirmModal
          title="Elimina progetto"
          description={`Sei sicuro di voler eliminare "${projectPendingDeletion.name}"? Questa azione rimuoverà il progetto e le immagini salvate in locale.`}
          confirmText="Elimina progetto"
          onConfirm={() => {
            onDeleteProject(projectPendingDeletion.id);
            toast.addToast(`Progetto "${projectPendingDeletion.name}" eliminato.`, "info");
          }}
          onCancel={() => setProjectPendingDeletion(null)}
        />
      ) : null}
    </div>
  );
}
