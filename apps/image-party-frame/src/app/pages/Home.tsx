import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Clock, Copy, Download, Folder, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { ServerStatus } from "../components/ServerStatus";
import { ConfirmActionDialog, TextInputDialog } from "../components/ActionDialogs";
import {
  clearCustomTemplateBackgroundFiles,
  getImageFile,
  normalizeProjectState,
  setImageFiles,
  useProject,
} from "../contexts/ProjectContext";
import { loadRecentProjects, onRecentProjectsUpdated, removeRecentProjectAt } from "../lib/recentProjects";
import {
  commitPreparedProjectPackageImport,
  disposePreparedProjectPackageImport,
  exportTemplateLibraryPackage,
  importTemplateLibraryPackage,
  prepareProjectPackageImport,
} from "../lib/portablePackages";
import appLogo from "../../../logo.png";
import {
  clearSavedTemplatesLibrary,
  deleteSavedTemplate,
  duplicateSavedTemplate,
  commitPreparedSavedTemplateHydration,
  disposePreparedSavedTemplateHydration,
  loadSavedTemplates,
  onSavedTemplatesUpdated,
  prepareSavedTemplateHydration,
  renameSavedTemplate,
  templateRecordDateLabel,
} from "../lib/savedTemplates";
import { restoreVerifiedNativeSessionFiles } from "../lib/sourceImport";

type HomeTextAction = {
  kind: "rename-template" | "duplicate-template";
  templateId: string;
  currentName: string;
};

type HomeConfirmAction =
  | { kind: "delete-project"; projectId: string; name: string }
  | { kind: "delete-template"; templateId: string; name: string }
  | { kind: "clear-template-library" };

export default function Home() {
  const navigate = useNavigate();
  const { resetProject, setProject } = useProject();
  const [recentProjects, setRecentProjects] = useState(loadRecentProjects());
  const [recentTemplates, setRecentTemplates] = useState(loadSavedTemplates());
  const projectImportInputRef = useRef<HTMLInputElement | null>(null);
  const templateImportInputRef = useRef<HTMLInputElement | null>(null);
  const projectLoadGenerationRef = useRef(0);
  const [projectOperation, setProjectOperation] = useState<string | null>(null);
  const [textAction, setTextAction] = useState<HomeTextAction | null>(null);
  const [confirmAction, setConfirmAction] = useState<HomeConfirmAction | null>(null);

  useEffect(() => onSavedTemplatesUpdated(() => setRecentTemplates(loadSavedTemplates())), []);
  useEffect(() => onRecentProjectsUpdated(() => setRecentProjects(loadRecentProjects())), []);
  useEffect(
    () => () => {
      projectLoadGenerationRef.current += 1;
    },
    []
  );

  const handleNewProject = () => {
    projectLoadGenerationRef.current += 1;
    resetProject();
    navigate("/new-project");
  };

  const handleOpenRecentProject = async (projectIndex: number) => {
    const selectedProject = recentProjects[projectIndex];
    if (!selectedProject) {
      return;
    }

    const requestId = ++projectLoadGenerationRef.current;
    setProjectOperation(selectedProject.projectId);

    try {
      const snapshot = normalizeProjectState(selectedProject.snapshot);
      let hasAllSourceFiles = snapshot.images.length > 0
        && snapshot.images.every((image) => Boolean(getImageFile(image.id, snapshot.projectId)));
      let restoredNativeFiles: File[] | null = null;

      if (!hasAllSourceFiles && snapshot.images.length > 0 && window.filexDesktop) {
        const absolutePaths = snapshot.images
          .map((image) => image.absolutePath)
          .filter((value): value is string => Boolean(value));
        if (absolutePaths.length === snapshot.images.length) {
          const fileStats = await window.filexDesktop.statFiles(absolutePaths);
          if (requestId !== projectLoadGenerationRef.current) {
            return;
          }
          restoredNativeFiles = restoreVerifiedNativeSessionFiles(snapshot.images, fileStats);
          hasAllSourceFiles = restoredNativeFiles !== null;
        }
      }

      if (snapshot.template === "custom" && snapshot.customTemplate?.libraryTemplateId) {
        const savedRecord = loadSavedTemplates().find((record) => record.id === snapshot.customTemplate?.libraryTemplateId);
        if (savedRecord) {
          const preparedTemplate = await prepareSavedTemplateHydration(savedRecord);
          if (requestId !== projectLoadGenerationRef.current) {
            disposePreparedSavedTemplateHydration(preparedTemplate);
            return;
          }
          snapshot.customTemplate = commitPreparedSavedTemplateHydration(preparedTemplate);
        } else {
          clearCustomTemplateBackgroundFiles();
        }
      } else {
        clearCustomTemplateBackgroundFiles();
      }

      if (requestId !== projectLoadGenerationRef.current) {
        return;
      }
      if (restoredNativeFiles) {
        setImageFiles(
          restoredNativeFiles,
          snapshot.images.map((image) => image.id),
          snapshot.projectId
        );
      }
      setProject(snapshot);

      if (hasAllSourceFiles) {
        navigate("/workspace");
        return;
      }

      toast.warning("File sorgente da ricollegare", {
        description: "Impostazioni e regolazioni sono state conservate. Seleziona di nuovo la cartella sorgente per ricollegare le immagini mancanti.",
      });
      navigate("/new-project");
    } catch (error) {
      if (requestId === projectLoadGenerationRef.current) {
        toast.error("Apertura progetto non riuscita", {
          description: error instanceof Error ? error.message : "Impossibile aprire il progetto recente.",
        });
      }
    } finally {
      if (requestId === projectLoadGenerationRef.current) {
        setProjectOperation(null);
      }
    }
  };

  const handleDeleteRecentProject = (projectIndex: number) => {
    const selectedProject = recentProjects[projectIndex];
    if (!selectedProject) {
      return;
    }

    setConfirmAction({ kind: "delete-project", projectId: selectedProject.projectId, name: selectedProject.name });
  };

  const handleRenameTemplate = (templateId: string, currentName: string) => {
    setTextAction({ kind: "rename-template", templateId, currentName });
  };

  const handleDuplicateTemplate = (templateId: string, currentName: string) => {
    setTextAction({ kind: "duplicate-template", templateId, currentName });
  };

  const handleDeleteTemplate = (templateId: string, currentName: string) => {
    setConfirmAction({ kind: "delete-template", templateId, name: currentName });
  };

  const handleClearTemplateLibrary = () => {
    if (recentTemplates.length === 0) {
      return;
    }
    setConfirmAction({ kind: "clear-template-library" });
  };

  const commitTextAction = (value: string) => {
    if (!textAction) return;
    if (textAction.kind === "rename-template") {
      if (value !== textAction.currentName.trim()) {
        setRecentTemplates(renameSavedTemplate(textAction.templateId, value));
      }
      return;
    }
    setRecentTemplates(duplicateSavedTemplate(textAction.templateId, value));
  };

  const commitConfirmAction = async () => {
    if (!confirmAction) return;
    if (confirmAction.kind === "delete-project") {
      const currentIndex = recentProjects.findIndex((project) => project.projectId === confirmAction.projectId);
      if (currentIndex >= 0) setRecentProjects(removeRecentProjectAt(currentIndex));
      return;
    }
    if (confirmAction.kind === "delete-template") {
      setRecentTemplates(deleteSavedTemplate(confirmAction.templateId));
      return;
    }
    try {
      setRecentTemplates(await clearSavedTemplatesLibrary());
    } catch (error) {
      toast.error("Pulizia libreria non riuscita", {
        description: error instanceof Error ? error.message : "Impossibile eliminare tutti i template.",
      });
    }
  };

  const handleImportProject = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    const requestId = ++projectLoadGenerationRef.current;
    setProjectOperation("import");

    try {
      const preparedImport = await prepareProjectPackageImport(file);
      if (requestId !== projectLoadGenerationRef.current) {
        disposePreparedProjectPackageImport(preparedImport);
        return;
      }
      const importedProject = commitPreparedProjectPackageImport(preparedImport);
      setProject(importedProject);
      toast.success("Progetto importato", {
        description: "Template e impostazioni sono stati caricati. Ora puoi rilinkare la cartella immagini se stai lavorando su un altro PC.",
      });
      navigate("/new-project");
    } catch (error) {
      if (requestId === projectLoadGenerationRef.current) {
        toast.error("Import progetto non riuscito", {
          description: error instanceof Error ? error.message : "File progetto non valido.",
        });
      }
    } finally {
      input.value = "";
      if (requestId === projectLoadGenerationRef.current) {
        setProjectOperation(null);
      }
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
            src={appLogo}
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
              Impagina le foto del party in una cornice perfetta, senza sforzo.
            </div>
            <h1 className="mt-6 text-5xl font-semibold tracking-[-0.05em] text-[var(--app-text)]">
              Benvenuto in Image Party Frame
            </h1>
            <p className="text-[var(--app-text-muted)] text-lg mt-4 max-w-2xl mx-auto">
              Crea cornici con foto per i tuoi eventi in modo semplice e veloce.
            </p>
            <Button
              size="lg"
              className="mt-8 bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-strong)] text-[var(--brand-primary-foreground)] h-14 px-8 text-lg shadow-[0_22px_45px_rgba(103,117,107,0.28)]"
              onClick={handleNewProject}
            >
              <Plus className="w-5 h-5 mr-2" />
              Nuovo Progetto
            </Button>
            <div className="mt-4">
              <Button
                variant="outline"
                className="border-[var(--app-border-strong)] bg-[var(--app-surface)] text-[var(--app-text)] hover:bg-[var(--app-surface-strong)]"
                onClick={() => projectImportInputRef.current?.click()}
                disabled={projectOperation !== null}
              >
                <Upload className="w-4 h-4 mr-2" />
                {projectOperation === "import" ? "Importazione..." : "Importa Progetto"}
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
                      key={project.projectId}
                      className="bg-[var(--app-surface)] border border-[var(--app-border)] hover:border-[var(--brand-primary)] rounded-3xl p-5 transition-all shadow-[0_18px_34px_rgba(0,0,0,0.12)]"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <button
                          type="button"
                          onClick={() => void handleOpenRecentProject(index)}
                          disabled={projectOperation !== null}
                          className="min-w-0 flex-1 text-left hover:text-[var(--app-text)] disabled:opacity-60"
                        >
                          <h3 className="font-medium text-lg truncate">{project.name}</h3>
                          <div className="mt-2 flex items-center gap-4 text-sm text-[var(--app-text-muted)]">
                            <span>{project.images} immagini</span>
                            <span>&bull;</span>
                            <span>{project.template}</span>
                          </div>
                        </button>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-xs text-[var(--app-text-subtle)]">{project.date}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Elimina il progetto recente ${project.name}`}
                            className="h-9 w-9 rounded-2xl text-[var(--danger)] hover:bg-[rgba(207,175,163,0.18)] hover:text-[var(--danger)]"
                            onClick={() => handleDeleteRecentProject(index)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
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
                    aria-label="Importa una libreria template"
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
                    aria-label="Esporta la libreria template"
                    className="h-10 w-10 rounded-2xl border-[var(--app-border-strong)] bg-[var(--app-surface)] text-[var(--app-text)] hover:bg-[var(--app-surface-strong)]"
                    onClick={() => void handleExportTemplateLibrary()}
                    disabled={recentTemplates.length === 0}
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="icon"
                    aria-label="Crea un nuovo template"
                    className="h-10 w-10 rounded-2xl border-[var(--brand-accent)] bg-[rgba(184,154,99,0.12)] text-[var(--brand-accent)] hover:bg-[rgba(184,154,99,0.24)] hover:text-[var(--app-text)]"
                  >
                    <Link to="/custom-template"><Plus className="w-4 h-4" /></Link>
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Elimina tutti i template salvati"
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
                    <div>Nessun template salvato. Puoi creare un template personalizzato e aggiungerlo alla libreria.</div>
                    <Button
                      asChild
                        variant="outline"
                        className="mt-4 border-[var(--brand-accent)] bg-[rgba(184,154,99,0.12)] text-[var(--brand-accent)] hover:bg-[rgba(184,154,99,0.24)] hover:text-[var(--app-text)]"
                      >
                      <Link to="/custom-template"><Plus className="w-4 h-4 mr-2" />Crea Template</Link>
                    </Button>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>

      <TextInputDialog
        open={textAction !== null}
        title={textAction?.kind === "duplicate-template" ? "Duplica template" : "Rinomina template"}
        description={textAction?.kind === "duplicate-template"
          ? "Scegli un nome riconoscibile per la nuova copia."
          : "Aggiorna il nome visualizzato nella libreria template."}
        initialValue={textAction?.kind === "duplicate-template" ? `${textAction.currentName} Copia` : textAction?.currentName ?? ""}
        label="Nome template"
        confirmLabel={textAction?.kind === "duplicate-template" ? "Crea copia" : "Salva nome"}
        onOpenChange={(open) => { if (!open) setTextAction(null); }}
        onConfirm={commitTextAction}
      />
      <ConfirmActionDialog
        open={confirmAction !== null}
        title={confirmAction?.kind === "clear-template-library"
          ? "Svuotare la libreria template?"
          : confirmAction?.kind === "delete-project"
            ? "Rimuovere il progetto recente?"
            : "Eliminare il template?"}
        description={confirmAction?.kind === "clear-template-library"
          ? "Verranno eliminati tutti i template custom salvati e i relativi sfondi non più utilizzati."
          : confirmAction?.kind === "delete-project"
            ? `“${confirmAction.name}” verrà rimosso dall'elenco. Le fotografie originali non saranno eliminate.`
            : confirmAction
              ? `“${confirmAction.name}” verrà eliminato dalla libreria locale.`
              : ""}
        confirmLabel="Elimina"
        destructive
        onOpenChange={(open) => { if (!open) setConfirmAction(null); }}
        onConfirm={() => void commitConfirmAction()}
      />
    </div>
  );
}
