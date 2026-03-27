import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Clock, Copy, Download, Folder, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { ServerStatus } from "../components/ServerStatus";
import { useProject } from "../contexts/ProjectContext";
import { loadRecentProjects, onRecentProjectsUpdated, removeRecentProjectAt } from "../lib/recentProjects";
import { importProjectPackage, importTemplateLibraryPackage, exportTemplateLibraryPackage } from "../lib/portablePackages";
import partyFrameLogo from "../../assets/party_frame_logo.png";
import {
  clearSavedTemplatesLibrary,
  deleteSavedTemplate,
  duplicateSavedTemplate,
  hydrateSavedTemplate,
  loadSavedTemplates,
  onSavedTemplatesUpdated,
  renameSavedTemplate,
  templateRecordDateLabel,
} from "../lib/savedTemplates";

export default function Home() {
  const navigate = useNavigate();
  const { setProject } = useProject();
  const [recentProjects, setRecentProjects] = useState(loadRecentProjects());
  const [recentTemplates, setRecentTemplates] = useState(loadSavedTemplates());
  const projectImportInputRef = useRef<HTMLInputElement | null>(null);
  const templateImportInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => onSavedTemplatesUpdated(() => setRecentTemplates(loadSavedTemplates())), []);
  useEffect(() => onRecentProjectsUpdated(() => setRecentProjects(loadRecentProjects())), []);

  const handleOpenRecentProject = async (projectIndex: number) => {
    const selectedProject = recentProjects[projectIndex];
    if (!selectedProject) {
      return;
    }

    const snapshot = { ...selectedProject.snapshot };
    if (snapshot.template === "custom" && snapshot.customTemplate?.libraryTemplateId) {
      const savedRecord = loadSavedTemplates().find((record) => record.id === snapshot.customTemplate?.libraryTemplateId);
      if (savedRecord) {
        snapshot.customTemplate = await hydrateSavedTemplate(savedRecord);
      }
    }

    setProject(snapshot);
    navigate("/workspace");
  };

  const handleDeleteRecentProject = (projectIndex: number) => {
    const selectedProject = recentProjects[projectIndex];
    if (!selectedProject) {
      return;
    }

    const confirmed = window.confirm(`Eliminare "${selectedProject.name}" dai progetti recenti?`);
    if (!confirmed) {
      return;
    }

    setRecentProjects(removeRecentProjectAt(projectIndex));
  };

  const handleRenameTemplate = (templateId: string, currentName: string) => {
    const nextName = window.prompt("Nuovo nome template", currentName);
    if (!nextName || nextName.trim() === currentName.trim()) {
      return;
    }

    setRecentTemplates(renameSavedTemplate(templateId, nextName));
  };

  const handleDuplicateTemplate = (templateId: string, currentName: string) => {
    const nextName = window.prompt("Nome della copia", `${currentName} Copy`);
    if (!nextName) {
      return;
    }

    setRecentTemplates(duplicateSavedTemplate(templateId, nextName));
  };

  const handleDeleteTemplate = (templateId: string, currentName: string) => {
    const confirmed = window.confirm(`Eliminare il template "${currentName}" dalla libreria?`);
    if (!confirmed) {
      return;
    }

    setRecentTemplates(deleteSavedTemplate(templateId));
  };

  const handleClearTemplateLibrary = async () => {
    if (recentTemplates.length === 0) {
      return;
    }

    const confirmed = window.confirm("Eliminare tutti i template salvati dalla libreria?");
    if (!confirmed) {
      return;
    }

    setRecentTemplates(await clearSavedTemplatesLibrary());
  };

  const handleImportProject = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) {
      return;
    }

    try {
      const importedProject = await importProjectPackage(file);
      setProject(importedProject);
      toast.success("Progetto importato", {
        description: "Template e impostazioni sono stati caricati. Ora puoi rilinkare la cartella immagini se stai lavorando su un altro PC.",
      });
      navigate("/new-project");
    } catch (error) {
      toast.error("Import progetto non riuscito", {
        description: error instanceof Error ? error.message : "File progetto non valido.",
      });
    } finally {
      event.currentTarget.value = "";
    }
  };

  const handleImportTemplateLibrary = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) {
      return;
    }

    try {
      await importTemplateLibraryPackage(file);
      setRecentTemplates(loadSavedTemplates());
      toast.success("Libreria template importata", {
        description: "I template importati sono ora disponibili anche su questo computer.",
      });
    } catch (error) {
      toast.error("Import template non riuscito", {
        description: error instanceof Error ? error.message : "File libreria non valido.",
      });
    } finally {
      event.currentTarget.value = "";
    }
  };

  const handleExportTemplateLibrary = async () => {
    try {
      await exportTemplateLibraryPackage();
      toast.success("Libreria template esportata", {
        description: "Puoi copiare il file JSON su un altro PC e importarlo da questa stessa schermata.",
      });
    } catch (error) {
      toast.error("Export template non riuscito", {
        description: error instanceof Error ? error.message : "Impossibile esportare la libreria template.",
      });
    }
  };

  return (
    <div className="h-screen bg-[var(--app-bg)] text-[var(--app-text)] flex flex-col">
      <div className="h-16 bg-[var(--app-topbar)] border-b border-[var(--app-border)] flex items-center px-8 justify-between shadow-[0_10px_30px_rgba(0,0,0,0.12)]">
        <div className="flex items-center gap-3">
          <img
            src={partyFrameLogo}
            alt="Image Party Frame"
            className="h-11 w-11 rounded-2xl object-cover shadow-[0_14px_24px_rgba(0,0,0,0.16)]"
          />
          <div>
            <div className="font-semibold text-xl tracking-[-0.03em]">Image Party Frame</div>
            <div className="text-xs text-[var(--app-text-muted)]">Un tool by Image Studio</div>
          </div>
        </div>
        <ServerStatus />
      </div>

      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14 mt-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--app-border)] bg-[var(--app-surface)] px-4 py-1.5 text-sm text-[var(--app-text-muted)] shadow-[0_10px_24px_rgba(0,0,0,0.08)]">
              Impagine le foto del party in una cornice perfetta, senza sforzo.
            </div>
            <h1 className="mt-6 text-5xl font-semibold tracking-[-0.05em] text-[var(--app-text)]">
              Benvenuto in Image Party Frame
            </h1>
            <p className="text-[var(--app-text-muted)] text-lg mt-4 max-w-2xl mx-auto">
              Crea cornici con foto per i tuoi eventi in modo semplice e veloce.
            </p>
            <Link to="/new-project">
              <Button
                size="lg"
                className="mt-8 bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-strong)] text-[var(--brand-primary-foreground)] h-14 px-8 text-lg shadow-[0_22px_45px_rgba(103,117,107,0.28)]"
              >
                <Plus className="w-5 h-5 mr-2" />
                Nuovo Progetto
              </Button>
            </Link>
            <div className="mt-4">
              <Button
                variant="outline"
                className="border-[var(--app-border-strong)] bg-[var(--app-surface)] text-[var(--app-text)] hover:bg-[var(--app-surface-strong)]"
                onClick={() => projectImportInputRef.current?.click()}
              >
                <Upload className="w-4 h-4 mr-2" />
                Importa Progetto
              </Button>
              <input
                ref={projectImportInputRef}
                type="file"
                accept=".json"
                hidden
                onChange={(event) => void handleImportProject(event)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8">
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Clock className="w-5 h-5 text-[var(--app-text-muted)]" />
                <h2 className="text-xl font-semibold tracking-[-0.02em]">Progetti Recenti</h2>
              </div>
              <div className="space-y-4">
                {recentProjects.length > 0 ? (
                  recentProjects.map((project, index) => (
                    <div
                      key={`${project.name}-${index}`}
                      className="bg-[var(--app-surface)] border border-[var(--app-border)] hover:border-[var(--brand-primary)] rounded-3xl p-5 transition-all shadow-[0_18px_34px_rgba(0,0,0,0.12)]"
                    >
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <button
                          type="button"
                          onClick={() => void handleOpenRecentProject(index)}
                          className="min-w-0 flex-1 text-left hover:text-[var(--app-text)]"
                        >
                          <h3 className="font-medium text-lg truncate">{project.name}</h3>
                        </button>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-xs text-[var(--app-text-subtle)]">{project.date}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 rounded-2xl text-[var(--danger)] hover:bg-[rgba(207,175,163,0.18)] hover:text-[var(--danger)]"
                            onClick={() => handleDeleteRecentProject(index)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleOpenRecentProject(index)}
                        className="w-full text-left"
                      >
                        <div className="flex items-center gap-4 text-sm text-[var(--app-text-muted)]">
                        <span>{project.images} immagini</span>
                        <span>&bull;</span>
                        <span>{project.template}</span>
                        </div>
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="bg-[var(--app-surface)] border border-dashed border-[var(--app-border)] rounded-3xl p-6 text-sm text-[var(--app-text-muted)]">
                    Nessun progetto recente ancora salvato. Crea il primo progetto e lo troverai qui anche dopo il riavvio.
                  </div>
                )}
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <Folder className="w-5 h-5 text-[var(--app-text-muted)]" />
                  <h2 className="text-xl font-semibold tracking-[-0.02em]">Libreria Template</h2>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 rounded-2xl border-[var(--app-border-strong)] bg-[var(--app-surface)] text-[var(--app-text)] hover:bg-[var(--app-surface-strong)]"
                    onClick={() => templateImportInputRef.current?.click()}
                  >
                    <Upload className="w-4 h-4" />
                  </Button>
                  <input
                    ref={templateImportInputRef}
                    type="file"
                    accept=".json"
                    hidden
                    onChange={(event) => void handleImportTemplateLibrary(event)}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 rounded-2xl border-[var(--app-border-strong)] bg-[var(--app-surface)] text-[var(--app-text)] hover:bg-[var(--app-surface-strong)]"
                    onClick={() => void handleExportTemplateLibrary()}
                    disabled={recentTemplates.length === 0}
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                  <Link to="/custom-template">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-10 w-10 rounded-2xl border-[var(--brand-accent)] bg-[rgba(184,154,99,0.12)] text-[var(--brand-accent)] hover:bg-[rgba(184,154,99,0.24)] hover:text-[var(--app-text)]"
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </Link>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 rounded-2xl border-[var(--danger)] bg-[rgba(207,175,163,0.12)] text-[var(--danger)] hover:bg-[rgba(207,175,163,0.24)]"
                    onClick={handleClearTemplateLibrary}
                    disabled={recentTemplates.length === 0}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-4">
                {recentTemplates.length > 0 ? (
                  recentTemplates.map((template) => (
                    <div
                      key={template.id}
                      className="bg-[var(--app-surface)] border border-[var(--app-border)] rounded-3xl p-5 shadow-[0_18px_34px_rgba(0,0,0,0.12)]"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="font-medium text-lg">{template.name}</h3>
                          <p className="text-sm text-[var(--app-text-muted)] mt-1">{template.summary}</p>
                        </div>
                        <span className="text-xs text-[var(--app-text-subtle)] whitespace-nowrap">{templateRecordDateLabel(template)}</span>
                      </div>

                      <div className="mt-4 flex items-center gap-2 flex-wrap">
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-[var(--brand-accent)] bg-[rgba(184,154,99,0.12)] text-[var(--brand-accent)] hover:bg-[rgba(184,154,99,0.24)] hover:text-[var(--app-text)]"
                          onClick={() => handleRenameTemplate(template.id, template.name)}
                        >
                          <Pencil className="w-4 h-4" />
                          Rinomina
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-[var(--brand-accent)] bg-[rgba(184,154,99,0.12)] text-[var(--brand-accent)] hover:bg-[rgba(184,154,99,0.24)] hover:text-[var(--app-text)]"
                          onClick={() => handleDuplicateTemplate(template.id, template.name)}
                        >
                          <Copy className="w-4 h-4" />
                          Duplica
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-[var(--danger)] bg-[rgba(207,175,163,0.12)] text-[var(--danger)] hover:bg-[rgba(207,175,163,0.24)]"
                          onClick={() => handleDeleteTemplate(template.id, template.name)}
                        >
                          <Trash2 className="w-4 h-4" />
                          Elimina
                        </Button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="bg-[var(--app-surface)] border border-dashed border-[var(--app-border)] rounded-3xl p-6 text-sm text-[var(--app-text-muted)]">
                    <div>Nessun template salvato ancora. Puoi creare un `Template Custom` e salvarlo nella libreria.</div>
                    <Link to="/custom-template">
                      <Button
                        variant="outline"
                        className="mt-4 border-[var(--brand-accent)] bg-[rgba(184,154,99,0.12)] text-[var(--brand-accent)] hover:bg-[rgba(184,154,99,0.24)] hover:text-[var(--app-text)]"
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Crea Template
                      </Button>
                    </Link>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
