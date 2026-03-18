import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { AlertCircle, ArrowLeft, Check, Copy, FileImage, FolderOpen, GripVertical, HelpCircle, Pencil, Trash2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { setImageFiles as storeImageFiles, useProject } from "../contexts/ProjectContext";
import { useGetTemplates } from "../hooks/useApi";
import { saveRecentProject } from "../lib/recentProjects";
import {
  deleteSavedTemplate,
  duplicateSavedTemplate,
  hydrateSavedTemplate,
  loadSavedTemplates,
  onSavedTemplatesUpdated,
  renameSavedTemplate,
  templateRecordDateLabel,
} from "../lib/savedTemplates";
import {
  buildTemplateLibrary,
  hidePresetTemplate,
  loadHiddenPresetTemplateIds,
  restoreHiddenPresetTemplates,
  saveTemplateLibraryOrder,
} from "../lib/templateLibrary";

async function readImageOrientation(file: File): Promise<"vertical" | "horizontal"> {
  const objectUrl = URL.createObjectURL(file);

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image.naturalHeight >= image.naturalWidth ? "vertical" : "horizontal");
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Unable to detect orientation for ${file.name}`));
    };

    image.src = objectUrl;
  });
}

export default function NewProject() {
  const navigate = useNavigate();
  const { project, updateProjectBasics, setCustomTemplate, setImages } = useProject();
  const { templates: presetTemplates, fetchTemplates, loading: templatesLoading } = useGetTemplates();
  const sourceInputRef = useRef<HTMLInputElement>(null);

  const [projectName, setProjectName] = useState(project.name || "Il Mio Nuovo Progetto");
  const [selectedTemplateValue, setSelectedTemplateValue] = useState(() => {
    if (project.template !== "custom") {
      return `preset:${project.template || "classic-gold"}`;
    }

    if (project.customTemplate?.libraryTemplateId) {
      return `custom:${project.customTemplate.libraryTemplateId}`;
    }

    return "custom-draft";
  });
  const [sourcePath, setSourcePath] = useState(project.sourcePath || "");
  const [imageCount, setImageCount] = useState(project.imageCount || { total: 0, vertical: 0, horizontal: 0 });
  const [sourceLoaded, setSourceLoaded] = useState(Boolean(project.sourcePath));
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [imageFiles, setLocalImageFiles] = useState<File[]>([]);
  const [imageOrientations, setImageOrientations] = useState<Array<"vertical" | "horizontal">>([]);
  const [savedTemplates, setSavedTemplates] = useState(loadSavedTemplates());
  const [showGuide, setShowGuide] = useState(false);
  const [libraryRefreshKey, setLibraryRefreshKey] = useState(0);
  const [draggedTemplateId, setDraggedTemplateId] = useState<string | null>(null);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  useEffect(
    () =>
      onSavedTemplatesUpdated(() => {
        setSavedTemplates(loadSavedTemplates());
        setLibraryRefreshKey((current) => current + 1);
      }),
    []
  );

  const templateLibrary = useMemo(
    () => buildTemplateLibrary(presetTemplates, savedTemplates, project.customTemplate),
    [presetTemplates, savedTemplates, project.customTemplate, libraryRefreshKey]
  );

  const selectedTemplate = templateLibrary.find((template) => template.value === selectedTemplateValue) ?? templateLibrary[0];
  const hiddenPresetCount = useMemo(() => loadHiddenPresetTemplateIds().length, [libraryRefreshKey]);
  const reorderableTemplates = templateLibrary.filter((template) => !template.locked);

  useEffect(() => {
    if (!selectedTemplate && templateLibrary[0]) {
      setSelectedTemplateValue(templateLibrary[0].value);
    }
  }, [selectedTemplate, templateLibrary]);

  const selectTemplateValue = async (value: string) => {
    setSelectedTemplateValue(value);
    const nextTemplate = templateLibrary.find((template) => template.value === value);

    if (nextTemplate?.kind === "custom" && nextTemplate.record) {
      setCustomTemplate(await hydrateSavedTemplate(nextTemplate.record));
      return;
    }

    if (nextTemplate?.kind === "custom-draft") {
      return;
    }

    setCustomTemplate(null);
  };

  const handleSourceFolderClick = () => {
    sourceInputRef.current?.click();
  };

  const handleSourceFilesSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files;
    if (!files || files.length === 0) {
      return;
    }

    const imageFilesArray = Array.from(files).filter((file) => /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name));

    if (imageFilesArray.length === 0) {
      setValidationErrors(["Nessuna immagine trovata nella cartella selezionata"]);
      return;
    }

    setLocalImageFiles(imageFilesArray);
    const folderPath = files[0].webkitRelativePath?.split("/")[0] || "Cartella Selezionata";
    setSourcePath(folderPath);
    setSourceLoaded(true);

    const orientations = await Promise.all(
      imageFilesArray.map(async (file) => {
        try {
          return await readImageOrientation(file);
        } catch (error) {
          console.warn(`Falling back to vertical orientation for ${file.name}`, error);
          return "vertical" as const;
        }
      })
    );

    const vertical = orientations.filter((orientation) => orientation === "vertical").length;
    setImageCount({
      total: imageFilesArray.length,
      vertical,
      horizontal: orientations.length - vertical,
    });
    setImageOrientations(orientations);
    setValidationErrors([]);
  };

  const handleContinue = () => {
    const errors: string[] = [];

    if (!projectName.trim()) errors.push("Nome progetto richiesto");
    if (!sourcePath) errors.push("Seleziona una cartella sorgente");
    if (imageCount.total === 0) errors.push("Nessuna immagine trovata nella cartella");
    if (!selectedTemplate) errors.push("Seleziona un template");
    if (selectedTemplate && selectedTemplate.kind !== "preset" && !project.customTemplate) {
      errors.push("Configura prima il Template Custom");
    }

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    const resolvedTemplateId = selectedTemplate?.kind === "preset" ? selectedTemplate.presetId || "classic-gold" : "custom";
    updateProjectBasics(projectName, resolvedTemplateId, sourcePath, project.outputPath);

    const imageIds: string[] = [];
    const nextImages = imageFiles.map((file, index) => {
      const id = `img_${String(index + 1).padStart(3, "0")}`;
      imageIds.push(id);
      return {
        id,
        path: file.name || `${sourcePath}/img_${String(index + 1).padStart(3, "0")}.jpg`,
        orientation: imageOrientations[index] ?? ("vertical" as const),
        approval: "pending" as const,
        crop: { x: 0, y: 0, zoom: 100 },
      };
    });

    storeImageFiles(imageFiles, imageIds);
    setImages(nextImages);
    setValidationErrors([]);

    saveRecentProject(
      {
        ...project,
        name: projectName,
        template: resolvedTemplateId,
        sourcePath,
        outputPath: project.outputPath,
        images: nextImages,
        imageCount: {
          total: nextImages.length,
          vertical: nextImages.filter((image) => image.orientation === "vertical").length,
          horizontal: nextImages.filter((image) => image.orientation === "horizontal").length,
        },
      },
      selectedTemplate?.label
    );

    navigate("/template-validation");
  };

  const handleRenameTemplate = (templateId: string, currentName: string) => {
    const nextName = window.prompt("Nuovo nome template", currentName);
    if (!nextName || nextName.trim() === currentName.trim()) {
      return;
    }

    setSavedTemplates(renameSavedTemplate(templateId, nextName));
  };

  const handleDuplicateTemplate = (templateId: string, currentName: string) => {
    const nextName = window.prompt("Nome della copia", `${currentName} Copy`);
    if (!nextName) {
      return;
    }

    setSavedTemplates(duplicateSavedTemplate(templateId, nextName));
  };

  const handleDeleteSavedTemplate = (templateId: string, currentName: string) => {
    const confirmed = window.confirm(`Eliminare il template "${currentName}" dalla libreria?`);
    if (!confirmed) {
      return;
    }

    setSavedTemplates(deleteSavedTemplate(templateId));
  };

  const handleDeleteLibraryItem = (value: string) => {
    const item = templateLibrary.find((template) => template.value === value);
    if (!item) {
      return;
    }

    if (item.kind === "preset" && item.presetId) {
      const confirmed = window.confirm(`Eliminare "${item.label}" dall'elenco template disponibili?`);
      if (!confirmed) {
        return;
      }

      hidePresetTemplate(item.presetId);
      setLibraryRefreshKey((current) => current + 1);
      if (selectedTemplateValue === item.value) {
        const fallback = templateLibrary.find((template) => template.value !== item.value);
        if (fallback) {
          void selectTemplateValue(fallback.value);
        }
      }
      return;
    }

    if (item.kind === "custom" && item.record) {
      handleDeleteSavedTemplate(item.record.id, item.record.name);
    }
  };

  const handleTemplateDrop = (targetId: string) => {
    if (!draggedTemplateId || draggedTemplateId === targetId) {
      setDraggedTemplateId(null);
      return;
    }

    const orderedIds = reorderableTemplates.map((template) => template.id);
    const fromIndex = orderedIds.indexOf(draggedTemplateId);
    const toIndex = orderedIds.indexOf(targetId);
    if (fromIndex === -1 || toIndex === -1) {
      setDraggedTemplateId(null);
      return;
    }

    const nextIds = [...orderedIds];
    const [movedId] = nextIds.splice(fromIndex, 1);
    nextIds.splice(toIndex, 0, movedId);
    saveTemplateLibraryOrder(nextIds);
    setLibraryRefreshKey((current) => current + 1);
    setDraggedTemplateId(null);
  };

  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-[var(--app-text)] flex flex-col">
      <div className="h-16 bg-[var(--app-topbar)] border-b border-[var(--app-border)] flex items-center px-8 justify-between">
        <div className="flex items-center gap-4">
          <Link to="/">
            <Button variant="ghost" size="sm" className="text-[var(--app-text-muted)] hover:text-[var(--app-text)]">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Indietro
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--brand-primary-soft)] text-[var(--brand-accent)]">
              <FileImage className="w-6 h-6" />
            </div>
            <span className="font-semibold text-2xl tracking-[-0.03em]">Nuovo Progetto</span>
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setShowGuide((current) => !current)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] text-[var(--brand-accent)] transition-all duration-200 hover:border-[var(--brand-accent)] hover:bg-[var(--brand-primary-soft)] hover:text-[var(--app-text)]"
            >
              <HelpCircle className="w-5 h-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">{showGuide ? "Nascondi guida rapida" : "Mostra guida rapida"}</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex-1 overflow-auto p-8">
        <div className="mx-auto max-w-6xl">
          <section className="rounded-[32px] border border-[var(--app-border)] bg-[var(--app-surface)] p-8 shadow-[0_20px_40px_rgba(0,0,0,0.12)] mb-8">
            <div className="mb-8">
              <h2 className="text-4xl font-semibold tracking-[-0.04em]">Configura Progetto</h2>
              <p className="mt-3 text-[var(--app-text-muted)]">
                Imposta il progetto, scegli il template e carica la cartella immagini. L'output lo deciderai in fase di esportazione.
              </p>
            </div>

            {validationErrors.length > 0 ? (
              <div className="mb-6 rounded-2xl border border-[var(--danger-soft)] bg-[rgba(207,175,163,0.16)] p-4">
                <div className="flex gap-2 mb-2">
                  <AlertCircle className="w-4 h-4 text-[var(--danger)] shrink-0 mt-0.5" />
                  <span className="font-medium text-[var(--danger)]">Correggere i seguenti errori:</span>
                </div>
                <ul className="space-y-1 text-sm text-[var(--app-text-muted)] ml-6">
                  {validationErrors.map((error, index) => (
                    <li key={index}>• {error}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="project-name">Nome Progetto</Label>
                <Input
                  id="project-name"
                  placeholder="es. Maternity - Ottobre"
                  className="bg-[var(--app-field)] border-[var(--app-border-strong)] text-[var(--app-text)]"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="template">Modello Cornice</Label>
                <Select value={selectedTemplate?.value} onValueChange={(value) => void selectTemplateValue(value)}>
                  <SelectTrigger className="bg-[var(--app-field)] border-[var(--app-border-strong)] text-[var(--app-text)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[var(--app-surface)] border-[var(--app-border)] text-[var(--app-text)]">
                    {templateLibrary.map((template) => (
                      <SelectItem key={template.id} value={template.value}>
                        {template.label} ({template.meta})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="flex items-center justify-between gap-3 text-xs text-[var(--app-text-subtle)]">
                  <span>{templatesLoading ? "Caricamento template..." : "Drag and drop per ordinare i template come preferisci."}</span>
                  {hiddenPresetCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        restoreHiddenPresetTemplates();
                        setLibraryRefreshKey((current) => current + 1);
                      }}
                      className="text-[var(--brand-accent)] transition-colors hover:text-[var(--app-text)]"
                    >
                      Ripristina preset nascosti
                    </button>
                  ) : null}
                </div>

                <div className="rounded-[24px] border border-[var(--app-border)] bg-[rgba(0,0,0,0.06)] p-3">
                  <div className="space-y-2 max-h-80 overflow-auto pr-1">
                    {templateLibrary.length > 0 ? (
                      templateLibrary.map((template) => (
                        <div
                          key={template.id}
                          draggable={!template.locked}
                          onDragStart={() => {
                            if (!template.locked) {
                              setDraggedTemplateId(template.id);
                            }
                          }}
                          onDragOver={(event) => {
                            if (!template.locked) {
                              event.preventDefault();
                            }
                          }}
                          onDrop={() => handleTemplateDrop(template.id)}
                          onDragEnd={() => setDraggedTemplateId(null)}
                          className={`rounded-2xl border p-4 transition-all ${
                            selectedTemplate?.id === template.id
                              ? "border-[var(--brand-accent)] bg-[rgba(184,154,99,0.12)]"
                              : "border-[var(--app-border)] bg-[var(--app-surface)]"
                          } ${draggedTemplateId === template.id ? "opacity-60" : "opacity-100"}`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <button type="button" onClick={() => void selectTemplateValue(template.value)} className="flex flex-1 items-start gap-3 text-left">
                              <span className={`mt-0.5 ${template.locked ? "opacity-40" : "cursor-grab text-[var(--app-text-subtle)]"}`}>
                                <GripVertical className="h-4 w-4" />
                              </span>
                              <span className="flex-1">
                                <span className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-[var(--app-text)]">{template.label}</span>
                                  <span className="rounded-full border border-[var(--app-border)] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-[var(--app-text-subtle)]">
                                    {template.kind === "preset" ? "Preset" : "Custom"}
                                  </span>
                                </span>
                                <span className="mt-1 block text-xs text-[var(--app-text-muted)]">{template.meta}</span>
                              </span>
                            </button>
                            <div className="flex flex-wrap justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="border-[var(--brand-accent)] bg-[rgba(184,154,99,0.12)] text-[var(--brand-accent)] hover:bg-[rgba(184,154,99,0.24)] hover:text-[var(--app-text)]"
                                onClick={() => void selectTemplateValue(template.value)}
                              >
                                Usa
                              </Button>
                              {template.kind === "custom" && template.record ? (
                                <>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="border-[var(--brand-accent)] bg-[rgba(184,154,99,0.12)] text-[var(--brand-accent)] hover:bg-[rgba(184,154,99,0.24)] hover:text-[var(--app-text)]"
                                    onClick={() => handleRenameTemplate(template.record.id, template.record.name)}
                                  >
                                    <Pencil className="w-4 h-4" />
                                    Rinomina
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="border-[var(--brand-accent)] bg-[rgba(184,154,99,0.12)] text-[var(--brand-accent)] hover:bg-[rgba(184,154,99,0.24)] hover:text-[var(--app-text)]"
                                    onClick={() => handleDuplicateTemplate(template.record.id, template.record.name)}
                                  >
                                    <Copy className="w-4 h-4" />
                                    Duplica
                                  </Button>
                                </>
                              ) : null}
                              {!template.locked ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="border-[var(--danger)] bg-[rgba(207,175,163,0.12)] text-[var(--danger)] hover:bg-[rgba(207,175,163,0.24)]"
                                  onClick={() => handleDeleteLibraryItem(template.value)}
                                >
                                  <Trash2 className="w-4 h-4" />
                                  Elimina
                                </Button>
                              ) : null}
                            </div>
                          </div>
                          {template.kind === "custom" && template.record ? (
                            <div className="mt-3 text-[11px] text-[var(--app-text-subtle)]">{templateRecordDateLabel(template.record)}</div>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-[var(--app-border)] px-4 py-6 text-sm text-[var(--app-text-muted)]">
                        Nessun template disponibile. Crea un template custom oppure ripristina i preset nascosti.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {selectedTemplate?.kind !== "preset" ? (
                <div className="space-y-4 rounded-[28px] border border-[rgba(184,154,99,0.25)] bg-[rgba(103,117,107,0.12)] p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-base font-medium text-[var(--brand-secondary)]">
                        {project.customTemplate ? project.customTemplate.name : "Template Custom non ancora creato"}
                      </p>
                      <p className="text-sm text-[var(--app-text-muted)] mt-1">
                        Definisci dimensioni, DPI, sfondo e area foto direttamente nel software oppure carica un template gia salvato.
                      </p>
                      {project.customTemplate ? (
                        <p className="mt-2 text-xs uppercase tracking-[0.18em] text-[var(--app-text-subtle)]">
                          Verticale {project.customTemplate.variants.vertical.widthCm}x{project.customTemplate.variants.vertical.heightCm} cm | Orizzontale{" "}
                          {project.customTemplate.variants.horizontal.widthCm}x{project.customTemplate.variants.horizontal.heightCm} cm
                        </p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="border-[var(--brand-accent)] bg-[rgba(184,154,99,0.12)] text-[var(--brand-accent)] hover:bg-[rgba(184,154,99,0.24)] hover:border-[var(--brand-primary)] hover:text-[var(--app-text)]"
                      onClick={() => navigate("/custom-template")}
                    >
                      <Pencil className="w-4 h-4" />
                      {project.customTemplate ? "Modifica Template" : "Crea Template"}
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                <Label>Cartella Sorgente</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Seleziona cartella contenente le foto..."
                    className="bg-[var(--app-field)] border-[var(--app-border-strong)] text-[var(--app-text)]"
                    value={sourcePath}
                    readOnly
                  />
                  <Button
                    variant="outline"
                    className="border-[var(--brand-accent)] bg-[rgba(103,117,107,0.08)] text-[var(--brand-accent)] hover:bg-[rgba(103,117,107,0.15)] hover:border-[var(--brand-primary)] hover:text-[var(--app-text)] shrink-0"
                    onClick={handleSourceFolderClick}
                  >
                    <FolderOpen className="w-4 h-4" />
                    Sfoglia
                  </Button>
                </div>
                {sourceLoaded && imageCount.total > 0 ? (
                  <div className="flex items-center gap-4 text-sm mt-2">
                    <div className="flex items-center gap-2 text-[var(--success)]">
                      <Check className="w-4 h-4" />
                      <span>{imageCount.total} immagini rilevate</span>
                    </div>
                    <div className="text-[var(--app-text-muted)]">
                      Orientamento: {imageCount.vertical} verticali, {imageCount.horizontal} orizzontali
                    </div>
                  </div>
                ) : null}
                <input
                  ref={sourceInputRef}
                  type="file"
                  webkitdirectory="true"
                  multiple
                  hidden
                  onChange={handleSourceFilesSelected}
                />
              </div>
            </div>

            <div className="flex gap-4 mt-10 justify-end">
              <Link to="/">
                <Button variant="outline" className="border-[var(--brand-accent)] bg-[rgba(103,117,107,0.08)] text-[var(--brand-accent)] hover:bg-[rgba(103,117,107,0.15)] hover:border-[var(--brand-primary)] hover:text-[var(--app-text)]">
                  Annulla
                </Button>
              </Link>
              <Button onClick={handleContinue} className="bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-strong)] text-[var(--brand-primary-foreground)] shadow-[0_18px_36px_rgba(103,117,107,0.24)]">
                Continua alla Validazione
              </Button>
            </div>
          </section>

          {showGuide ? (
            <aside className="rounded-[32px] border border-[var(--app-border)] bg-[var(--app-surface)] p-6 shadow-[0_20px_40px_rgba(0,0,0,0.12)] min-h-[250px] animate-in fade-in-0 slide-in-from-top-2 duration-200">
              <div className="mb-5">
                <div className="text-xs uppercase tracking-[0.22em] text-[var(--app-text-subtle)]">Guida Rapida</div>
                <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">Flusso consigliato</h3>
              </div>
              <div className="space-y-4 text-sm text-[var(--app-text-muted)] w-full">
                <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-field)] p-4">
                  <div className="font-medium text-[var(--app-text)] mb-1">1. Carica le immagini</div>
                  Importa una cartella e lascia che il software legga orientamento e quantita.
                </div>
                <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-field)] p-4">
                  <div className="font-medium text-[var(--app-text)] mb-1">2. Scegli il template</div>
                  Usa un preset classico o un Template Custom gia salvato nella libreria.
                </div>
                <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-field)] p-4">
                  <div className="font-medium text-[var(--app-text)] mb-1">3. Rifinisci ed esporta</div>
                  In workspace regoli le foto e scegli il percorso di output solo quando serve davvero.
                </div>
              </div>
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}
