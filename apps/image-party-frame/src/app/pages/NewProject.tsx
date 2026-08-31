import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { AlertCircle, ArrowDown, ArrowLeft, ArrowUp, Check, Copy, FileImage, FolderOpen, GripVertical, HelpCircle, Pencil, Trash2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { ConfirmActionDialog, TextInputDialog } from "../components/ActionDialogs";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import {
  clearImageFiles,
  createEmptyProjectState,
  getImageFile,
  normalizeImageRelativePath,
  normalizeProjectState,
  planProjectImageRelink,
  setImageFiles as storeImageFiles,
  type ProjectState,
  useProject,
} from "../contexts/ProjectContext";
import { useGetTemplates } from "../hooks/useApi";
import { saveRecentProject } from "../lib/recentProjects";
import { toast } from "sonner";
import {
  commitPreparedSavedTemplateHydration,
  deleteSavedTemplate,
  disposePreparedSavedTemplateHydration,
  duplicateSavedTemplate,
  loadSavedTemplates,
  onSavedTemplatesUpdated,
  prepareSavedTemplateHydration,
  renameSavedTemplate,
  templateRecordDateLabel,
} from "../lib/savedTemplates";
import {
  buildTemplateLibrary,
  hidePresetTemplate,
  loadHiddenPresetTemplateIds,
  resolveCustomTemplateSelectionValue,
  restoreHiddenPresetTemplates,
  saveTemplateLibraryOrder,
} from "../lib/templateLibrary";
import {
  createNativeFilePlaceholder,
  isPartyFrameSourceName,
  mapWithConcurrency,
} from "../lib/sourceImport";
import type { DesktopPhotoToolHandoff } from "@photo-tools/desktop-contracts";
import {
  onPhotoSelectionHandoff,
} from "../lib/photoSelectionHandoff";

const SOURCE_SCAN_CONCURRENCY = 6;

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

function isSupportedBrowserImageFile(file: File): boolean {
  return /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name);
}

type SelectedSourceImage = {
  file: File;
  relativePath: string;
  absolutePath?: string;
  size: number;
  lastModified: number;
  orientation?: "vertical" | "horizontal";
};

type TemplateTextAction = {
  kind: "rename" | "duplicate";
  templateId: string;
  currentName: string;
};

type TemplateDeleteAction = {
  value: string;
  label: string;
};

function restoreSessionSourceImages(project: ProjectState): SelectedSourceImage[] {
  if (project.images.length === 0) {
    return [];
  }

  const restored: Array<SelectedSourceImage | null> = project.images.map((image) => {
    const file = getImageFile(image.id, project.projectId);
    if (!file) {
      return null;
    }

    return {
      file,
      relativePath: normalizeImageRelativePath(image.relativePath || image.path || file.name),
      absolutePath: image.absolutePath,
      size: image.size ?? file.size,
      lastModified: image.lastModified ?? file.lastModified,
    };
  });

  if (restored.some((item) => item === null)) {
    return [];
  }
  return restored as SelectedSourceImage[];
}

export default function NewProject() {
  const navigate = useNavigate();
  const { project, setCustomTemplate, setProject } = useProject();
  const {
    templates: presetTemplates,
    fetchTemplates,
    loading: templatesLoading,
    error: templatesError,
  } = useGetTemplates();
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const sourceLoadGenerationRef = useRef(0);
  const templateLoadGenerationRef = useRef(0);
  const initialSourceImagesRef = useRef<SelectedSourceImage[] | null>(null);
  if (initialSourceImagesRef.current === null) {
    initialSourceImagesRef.current = restoreSessionSourceImages(project);
  }
  const initialSourceImages = initialSourceImagesRef.current;

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
  const [sourceLoaded, setSourceLoaded] = useState(initialSourceImages.length > 0);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [sourceImages, setSourceImages] = useState<SelectedSourceImage[]>(initialSourceImages);
  const [imageOrientations, setImageOrientations] = useState<Array<"vertical" | "horizontal">>(
    initialSourceImages.length > 0 ? project.images.map((image) => image.orientation) : []
  );
  const [savedTemplates, setSavedTemplates] = useState(loadSavedTemplates());
  const [showGuide, setShowGuide] = useState(false);
  const [libraryRefreshKey, setLibraryRefreshKey] = useState(0);
  const [draggedTemplateId, setDraggedTemplateId] = useState<string | null>(null);
  const [loadingSourceFolder, setLoadingSourceFolder] = useState(false);
  const [sourceLoadProgress, setSourceLoadProgress] = useState<{
    requestId: number;
    completed: number;
    total: number;
  } | null>(null);
  const [loadingTemplateSelection, setLoadingTemplateSelection] = useState(false);
  const [presetTemplatesReady, setPresetTemplatesReady] = useState(false);
  const [templateTextAction, setTemplateTextAction] = useState<TemplateTextAction | null>(null);
  const [templateDeleteAction, setTemplateDeleteAction] = useState<TemplateDeleteAction | null>(null);

  useEffect(() => {
    let active = true;
    void fetchTemplates().finally(() => {
      if (active) {
        setPresetTemplatesReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, [fetchTemplates]);

  useEffect(
    () =>
      onSavedTemplatesUpdated(() => {
        setSavedTemplates(loadSavedTemplates());
        setLibraryRefreshKey((current) => current + 1);
      }),
    []
  );

  useEffect(
    () => () => {
      sourceLoadGenerationRef.current += 1;
      templateLoadGenerationRef.current += 1;
    },
    []
  );

  const templateLibrary = useMemo(
    () => buildTemplateLibrary(presetTemplates, savedTemplates, project.customTemplate),
    [presetTemplates, savedTemplates, project.customTemplate, libraryRefreshKey]
  );

  const selectedTemplate = templateLibrary.find((template) => template.value === selectedTemplateValue)
    ?? (presetTemplatesReady ? templateLibrary[0] : undefined);
  const hiddenPresetCount = useMemo(() => loadHiddenPresetTemplateIds().length, [libraryRefreshKey]);
  const reorderableTemplates = templateLibrary.filter((template) => !template.locked);

  useEffect(() => {
    if (
      project.template !== "custom"
      || !project.customTemplate
      || (selectedTemplateValue !== "custom-draft" && !selectedTemplateValue.startsWith("custom:"))
    ) {
      return;
    }

    const expectedValue = resolveCustomTemplateSelectionValue(project.customTemplate, savedTemplates);
    if (selectedTemplateValue !== expectedValue) {
      setSelectedTemplateValue(expectedValue);
    }
  }, [project.customTemplate, project.template, savedTemplates, selectedTemplateValue]);

  useEffect(() => {
    if (
      presetTemplatesReady
      && !templateLibrary.some((template) => template.value === selectedTemplateValue)
      && templateLibrary[0]
    ) {
      setSelectedTemplateValue(templateLibrary[0].value);
    }
  }, [presetTemplatesReady, selectedTemplateValue, templateLibrary]);

  const selectTemplateValue = async (value: string) => {
    const requestId = ++templateLoadGenerationRef.current;
    const nextTemplate = templateLibrary.find((template) => template.value === value);
    if (!nextTemplate) {
      setLoadingTemplateSelection(false);
      return;
    }

    if (nextTemplate.kind === "custom" && nextTemplate.record) {
      setLoadingTemplateSelection(true);
      try {
        const preparedTemplate = await prepareSavedTemplateHydration(nextTemplate.record);
        if (requestId !== templateLoadGenerationRef.current) {
          disposePreparedSavedTemplateHydration(preparedTemplate);
          return;
        }
        setCustomTemplate(commitPreparedSavedTemplateHydration(preparedTemplate));
        setSelectedTemplateValue(value);
      } catch (error) {
        if (requestId === templateLoadGenerationRef.current) {
          toast.error("Template non disponibile", {
            description: error instanceof Error ? error.message : "Impossibile caricare il template selezionato.",
          });
        }
      } finally {
        if (requestId === templateLoadGenerationRef.current) {
          setLoadingTemplateSelection(false);
        }
      }
      return;
    }

    setSelectedTemplateValue(value);
    if (nextTemplate.kind === "custom-draft") {
      setLoadingTemplateSelection(false);
      return;
    }

    setLoadingTemplateSelection(false);
    setCustomTemplate(null);
  };

  const applySelectedFiles = async (
    selectedImages: SelectedSourceImage[],
    selectedSourcePath: string,
    requestId: number
  ) => {
    if (selectedImages.length === 0) {
      if (requestId === sourceLoadGenerationRef.current) {
        setValidationErrors(["Nessuna immagine trovata nella cartella selezionata"]);
      }
      return;
    }

    setSourceLoadProgress({ requestId, completed: 0, total: selectedImages.length });
    const orientations = await mapWithConcurrency(
      selectedImages,
      SOURCE_SCAN_CONCURRENCY,
      async ({ file, orientation }) => {
        try {
          if (orientation) {
            return orientation;
          }
          return await readImageOrientation(file);
        } catch (error) {
          console.warn(`Falling back to vertical orientation for ${file.name}`, error);
          return "vertical" as const;
        } finally {
          setSourceLoadProgress((current) => current?.requestId === requestId
            ? { ...current, completed: Math.min(current.total, current.completed + 1) }
            : current);
        }
      }
    );

    if (requestId !== sourceLoadGenerationRef.current) {
      return;
    }

    const vertical = orientations.filter((orientation) => orientation === "vertical").length;
    setSourceImages(selectedImages);
    setSourcePath(selectedSourcePath);
    setSourceLoaded(true);
    setImageCount({
      total: selectedImages.length,
      vertical,
      horizontal: orientations.length - vertical,
    });
    setImageOrientations(orientations);
    setValidationErrors([]);
  };

  const handoffHandlerRef = useRef<((handoff: DesktopPhotoToolHandoff) => Promise<void>) | null>(null);
  handoffHandlerRef.current = async (handoff) => {
    const supportedEntries = handoff.files.filter((entry) => isPartyFrameSourceName(entry.fileName));
    if (supportedEntries.length === 0) {
      setValidationErrors(["La selezione di Archivio Flow non contiene immagini compatibili con Party Frame."]);
      return;
    }
    if ((sourceImages.length > 0 || project.images.length > 0) && !window.confirm(
      "Creare un nuovo progetto con la selezione ricevuta da Archivio Flow? Il progetto corrente verrà conservato nei progetti recenti.",
    )) {
      toast.info("Selezione non importata", { description: "Il progetto corrente è rimasto invariato." });
      return;
    }

    const requestId = ++sourceLoadGenerationRef.current;
    setLoadingSourceFolder(true);
    setSourceLoadProgress({ requestId, completed: 0, total: supportedEntries.length });
    try {
      const loadedImages = await mapWithConcurrency(
        supportedEntries,
        SOURCE_SCAN_CONCURRENCY,
        async (entry): Promise<SelectedSourceImage | null> => {
          if (requestId !== sourceLoadGenerationRef.current) {
            throw new DOMException("Importazione sostituita", "AbortError");
          }
          try {
            const preview = await window.filexDesktop!.getThumbnail(
              entry.absolutePath,
              96,
              0.62,
              `${entry.size}:${entry.lastModified}`,
            );
            if (!preview) return null;
            return {
              file: createNativeFilePlaceholder(entry.fileName, entry.lastModified),
              relativePath: normalizeImageRelativePath(entry.relativePath || entry.fileName),
              absolutePath: entry.absolutePath,
              size: entry.size,
              lastModified: entry.lastModified,
              orientation: preview.height >= preview.width ? "vertical" : "horizontal",
            };
          } catch {
            return null;
          } finally {
            setSourceLoadProgress((current) => current?.requestId === requestId
              ? { ...current, completed: Math.min(current.total, current.completed + 1) }
              : current);
          }
        },
      );
      const selectedImages = loadedImages.filter((image): image is SelectedSourceImage => Boolean(image));
      const unreadableCount = supportedEntries.length - selectedImages.length;
      if (selectedImages.length === 0) {
        throw new Error("Le foto ricevute da Archivio Flow non sono decodificabili da Party Frame.");
      }

      if (sourceImages.length > 0 || project.images.length > 0) {
        const currentTemplateId = selectedTemplate
          ? selectedTemplate.kind === "preset"
            ? selectedTemplate.presetId || "classic-gold"
            : "custom"
          : project.template || "classic-gold";
        const currentImages = sourceImages.length > 0
          ? planProjectImageRelink(
            project,
            sourceImages.map((sourceImage, index) => ({
              path: sourceImage.relativePath,
              relativePath: sourceImage.relativePath,
              absolutePath: sourceImage.absolutePath,
              size: sourceImage.size,
              lastModified: sourceImage.lastModified,
              orientation: imageOrientations[index] ?? ("vertical" as const),
            })),
          ).images
          : project.images;
        const currentDraft = normalizeProjectState({
          ...project,
          name: projectName.trim() || project.name,
          template: currentTemplateId,
          sourcePath: sourcePath || project.sourcePath,
          customTemplate: currentTemplateId === "custom" ? project.customTemplate : null,
          images: currentImages,
        });
        if (sourceImages.length > 0) {
          storeImageFiles(
            sourceImages.map((sourceImage) => sourceImage.file),
            currentDraft.images.map((image) => image.id),
            project.projectId,
          );
        }
        const savedDraft = saveRecentProject(currentDraft, selectedTemplate?.label);
        if (!savedDraft.ok) {
          throw new Error(`Il progetto corrente non è stato sostituito: ${savedDraft.message}`);
        }
        savedDraft.evictedProjectIds.forEach((evictedProjectId) => clearImageFiles(evictedProjectId));
      }
      setProject(createEmptyProjectState());
      setProjectName("Progetto da Archivio Flow");
      setSelectedTemplateValue("preset:classic-gold");
      setCustomTemplate(null);
      await applySelectedFiles(selectedImages, handoff.sourceRoot, requestId);
      toast.success("Foto ricevute da Archivio Flow", {
        description: `${selectedImages.length} immagini pronte.${unreadableCount ? ` ${unreadableCount} non leggibili ignorate.` : ""} Non rimuovere la scheda fino all’esportazione.`,
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setValidationErrors([error instanceof Error ? error.message : "Importazione da Archivio Flow non riuscita."]);
      }
    } finally {
      if (requestId === sourceLoadGenerationRef.current) {
        setLoadingSourceFolder(false);
        setSourceLoadProgress(null);
      }
    }
  };

  useEffect(() => {
    const accept = async (handoff: DesktopPhotoToolHandoff) => {
      await handoffHandlerRef.current?.(handoff);
    };
    const unsubscribe = onPhotoSelectionHandoff(accept);
    return unsubscribe;
  }, []);

  const handleSourceFolderClick = async () => {
    if (window.filexDesktop) {
      const requestId = ++sourceLoadGenerationRef.current;
      setLoadingSourceFolder(true);

      try {
        const result = await window.filexDesktop.openFolder({
          relativePathMode: "project-relative",
          recursive: true,
          includeExtendedImages: true,
        });
        if (!result) {
          return;
        }

        const supportedEntries = result.entries.filter((entry) => isPartyFrameSourceName(entry.name));
        const skippedCount = result.entries.length - supportedEntries.length;
        setSourceLoadProgress({ requestId, completed: 0, total: supportedEntries.length });
        const selectedImages = await mapWithConcurrency(
          supportedEntries,
          SOURCE_SCAN_CONCURRENCY,
          async (entry): Promise<SelectedSourceImage> => {
            if (requestId !== sourceLoadGenerationRef.current) {
              throw new DOMException("Importazione sostituita", "AbortError");
            }
            const preview = await window.filexDesktop!.getThumbnail(
              entry.absolutePath,
              96,
              0.62,
              `${entry.size}:${entry.lastModified}`
            );
            setSourceLoadProgress((current) => current?.requestId === requestId
              ? { ...current, completed: Math.min(current.total, current.completed + 1) }
              : current);
            return {
              file: createNativeFilePlaceholder(entry.name, entry.lastModified),
              relativePath: normalizeImageRelativePath(entry.relativePath || entry.name),
              absolutePath: entry.absolutePath,
              size: entry.size,
              lastModified: entry.lastModified,
              orientation: preview ? (preview.height >= preview.width ? "vertical" : "horizontal") : "vertical",
            };
          }
        );

        if (skippedCount > 0) {
          toast.info("File incompatibili ignorati", {
            description: `${skippedCount} file RAW o non immagine non sono stati caricati in PartyFrame.`,
          });
        }

        await applySelectedFiles(selectedImages, result.rootPath || result.name, requestId);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        console.error("Failed to load desktop folder", error);
        setValidationErrors([
          error instanceof Error
            ? error.message
            : "Impossibile leggere la cartella selezionata dal desktop.",
        ]);
        return;
      } finally {
        if (requestId === sourceLoadGenerationRef.current) {
          setLoadingSourceFolder(false);
          setSourceLoadProgress(null);
        }
      }
    }

    sourceInputRef.current?.click();
  };

  const handleSourceFilesSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = input.files;
    if (!files || files.length === 0) {
      return;
    }

    const requestId = ++sourceLoadGenerationRef.current;
    setLoadingSourceFolder(true);
    const imageFilesArray = Array.from(files).filter(isSupportedBrowserImageFile);
    const folderPath = files[0].webkitRelativePath?.split("/")[0] || "Cartella Selezionata";
    const selectedImages = imageFilesArray.map((file) => {
      const parts = file.webkitRelativePath?.split("/").filter(Boolean) ?? [];
      const relativePath = parts.length > 1 ? parts.slice(1).join("/") : file.name;
      return {
        file,
        relativePath: normalizeImageRelativePath(relativePath),
        size: file.size,
        lastModified: file.lastModified,
      };
    });
    input.value = "";

    try {
      await applySelectedFiles(selectedImages, folderPath, requestId);
    } finally {
      if (requestId === sourceLoadGenerationRef.current) {
        setLoadingSourceFolder(false);
        setSourceLoadProgress(null);
      }
    }
  };

  const handleContinue = () => {
    const errors: string[] = [];

    if (!projectName.trim()) errors.push("Nome progetto richiesto");
    if (!sourcePath) errors.push("Seleziona una cartella sorgente");
    if (loadingSourceFolder) errors.push("Attendi il completamento della lettura delle immagini");
    if (loadingTemplateSelection) errors.push("Attendi il caricamento del template");
    if (sourcePath && (!sourceLoaded || sourceImages.length === 0)) {
      errors.push(project.images.length > 0
        ? "Le immagini del progetto non sono disponibili: ricollega la cartella sorgente completa"
        : "La cartella selezionata non contiene immagini supportate");
    }
    if (sourceImages.length !== imageOrientations.length) errors.push("La lettura delle immagini non è completa");
    if (!selectedTemplate) errors.push("Seleziona un template");
    if (selectedTemplate && selectedTemplate.kind !== "preset" && !project.customTemplate) {
      errors.push("Configura prima il Template Custom");
    }

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    const relinkPlan = planProjectImageRelink(
      project,
      sourceImages.map((sourceImage, index) => ({
        path: sourceImage.relativePath,
        relativePath: sourceImage.relativePath,
        absolutePath: sourceImage.absolutePath,
        size: sourceImage.size,
        lastModified: sourceImage.lastModified,
        orientation: imageOrientations[index] ?? ("vertical" as const),
      }))
    );

    if (project.images.length > 0 && relinkPlan.missingImageIds.length > 0) {
      setValidationErrors([
        `La cartella selezionata non contiene ${relinkPlan.missingImageIds.length} immagini del progetto. Nessuna regolazione è stata modificata.`,
      ]);
      return;
    }

    const resolvedTemplateId = selectedTemplate?.kind === "preset" ? selectedTemplate.presetId || "classic-gold" : "custom";
    const nextImages = relinkPlan.images;

    const nextProjectSnapshot = normalizeProjectState({
      ...project,
      name: projectName,
      template: resolvedTemplateId,
      sourcePath,
      outputPath: project.outputPath,
      customTemplate: resolvedTemplateId === "custom" ? project.customTemplate : null,
      images: nextImages,
      imageCount: {
        total: nextImages.length,
        vertical: nextImages.filter((image) => image.orientation === "vertical").length,
        horizontal: nextImages.filter((image) => image.orientation === "horizontal").length,
      },
    });

    storeImageFiles(
      sourceImages.map((sourceImage) => sourceImage.file),
      nextImages.map((image) => image.id),
      project.projectId
    );
    setProject(nextProjectSnapshot);
    setValidationErrors([]);
    const savedProject = saveRecentProject(nextProjectSnapshot, selectedTemplate?.label);
    if (savedProject.ok) {
      savedProject.evictedProjectIds.forEach((evictedProjectId) => clearImageFiles(evictedProjectId));
    } else {
      toast.error("Progetto non aggiunto ai recenti", { description: savedProject.message });
    }

    navigate("/template-validation");
  };

  const handleRenameTemplate = (templateId: string, currentName: string) => {
    setTemplateTextAction({ kind: "rename", templateId, currentName });
  };

  const handleDuplicateTemplate = (templateId: string, currentName: string) => {
    setTemplateTextAction({ kind: "duplicate", templateId, currentName });
  };

  const handleDeleteLibraryItem = (value: string) => {
    const item = templateLibrary.find((template) => template.value === value);
    if (!item) {
      return;
    }
    setTemplateDeleteAction({ value, label: item.label });
  };

  const commitTemplateTextAction = (value: string) => {
    if (!templateTextAction) return;
    if (templateTextAction.kind === "duplicate") {
      setSavedTemplates(duplicateSavedTemplate(templateTextAction.templateId, value));
      return;
    }
    if (value === templateTextAction.currentName.trim()) return;
    setSavedTemplates(renameSavedTemplate(templateTextAction.templateId, value));
    if (project.customTemplate?.libraryTemplateId === templateTextAction.templateId) {
      setCustomTemplate({ ...project.customTemplate, name: value });
    }
  };

  const commitTemplateDeleteAction = () => {
    if (!templateDeleteAction) return;
    const item = templateLibrary.find((template) => template.value === templateDeleteAction.value);
    if (!item) return;

    const fallback = templateLibrary.find((template) => template.value !== item.value);
    if (item.kind === "preset" && item.presetId) {
      hidePresetTemplate(item.presetId);
      setLibraryRefreshKey((current) => current + 1);
    } else if (item.kind === "custom" && item.record) {
      setSavedTemplates(deleteSavedTemplate(item.record.id));
    }

    if (selectedTemplateValue === item.value && fallback) {
      void selectTemplateValue(fallback.value);
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

  const moveTemplateByOffset = (templateId: string, offset: -1 | 1) => {
    const orderedIds = reorderableTemplates.map((template) => template.id);
    const fromIndex = orderedIds.indexOf(templateId);
    const toIndex = fromIndex + offset;
    if (fromIndex < 0 || toIndex < 0 || toIndex >= orderedIds.length) return;
    const nextIds = [...orderedIds];
    const [movedId] = nextIds.splice(fromIndex, 1);
    nextIds.splice(toIndex, 0, movedId);
    saveTemplateLibraryOrder(nextIds);
    setLibraryRefreshKey((current) => current + 1);
  };

  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-[var(--app-text)] flex flex-col">
      <div className="h-16 bg-[var(--app-topbar)] border-b border-[var(--app-border)] flex items-center px-8 justify-between">
        <div className="flex items-center gap-4">
          <Button asChild variant="ghost" size="sm" className="text-[var(--app-text-muted)] hover:text-[var(--app-text)]">
            <Link to="/">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Indietro
            </Link>
          </Button>
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
              aria-label={showGuide ? "Nascondi guida rapida" : "Mostra guida rapida"}
              aria-pressed={showGuide}
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] text-[var(--brand-accent)] transition-all duration-200 hover:border-[var(--brand-accent)] hover:bg-[var(--brand-primary-soft)] hover:text-[var(--app-text)]"
            >
              <HelpCircle aria-hidden="true" className="w-5 h-5" />
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
                <Label htmlFor="template">Template cornice</Label>
                <Select
                  value={selectedTemplate?.value}
                  onValueChange={(value) => void selectTemplateValue(value)}
                  disabled={loadingTemplateSelection}
                >
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
                  <span>
                    {loadingTemplateSelection
                      ? "Caricamento del template selezionato..."
                      : templatesLoading || !presetTemplatesReady
                        ? "Caricamento template..."
                        : "Trascina i template per ordinarli come preferisci."}
                  </span>
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
                {templatesError ? (
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--danger-soft)] bg-[rgba(207,175,163,0.12)] p-3 text-sm text-[var(--danger)]">
                    <span>Il motore template non è disponibile: {templatesError}</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => void fetchTemplates()} disabled={templatesLoading}>
                      Riprova
                    </Button>
                  </div>
                ) : null}

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
                            <div className="flex flex-1 items-start gap-3 text-left">
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
                            </div>
                            <div className="flex flex-wrap justify-end gap-2">
                              {!template.locked ? (
                                <>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    aria-label={`Sposta ${template.label} verso l'alto`}
                                    title="Sposta verso l'alto"
                                    disabled={reorderableTemplates[0]?.id === template.id}
                                    onClick={() => moveTemplateByOffset(template.id, -1)}
                                  >
                                    <ArrowUp className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    aria-label={`Sposta ${template.label} verso il basso`}
                                    title="Sposta verso il basso"
                                    disabled={reorderableTemplates.at(-1)?.id === template.id}
                                    onClick={() => moveTemplateByOffset(template.id, 1)}
                                  >
                                    <ArrowDown className="h-4 w-4" />
                                  </Button>
                                </>
                              ) : null}
                              <Button
                                variant="outline"
                                size="sm"
                                aria-label={`Usa il template ${template.label}`}
                                className="border-[var(--brand-accent)] bg-[rgba(184,154,99,0.12)] text-[var(--brand-accent)] hover:bg-[rgba(184,154,99,0.24)] hover:text-[var(--app-text)]"
                                onClick={() => void selectTemplateValue(template.value)}
                                disabled={loadingTemplateSelection}
                              >
                                Usa
                              </Button>
                              {template.kind === "custom" && template.record ? (
                                <>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    aria-label={`Rinomina il template ${template.label}`}
                                    className="border-[var(--brand-accent)] bg-[rgba(184,154,99,0.12)] text-[var(--brand-accent)] hover:bg-[rgba(184,154,99,0.24)] hover:text-[var(--app-text)]"
                                    onClick={() => handleRenameTemplate(template.record!.id, template.record!.name)}
                                  >
                                    <Pencil className="w-4 h-4" />
                                    Rinomina
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    aria-label={`Duplica il template ${template.label}`}
                                    className="border-[var(--brand-accent)] bg-[rgba(184,154,99,0.12)] text-[var(--brand-accent)] hover:bg-[rgba(184,154,99,0.24)] hover:text-[var(--app-text)]"
                                    onClick={() => handleDuplicateTemplate(template.record!.id, template.record!.name)}
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
                                  aria-label={`Rimuovi ${template.label} dall'elenco`}
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
                        Definisci dimensioni, DPI, sfondo e area foto direttamente nel software oppure carica un template già salvato.
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
                    onClick={() => void handleSourceFolderClick()}
                    disabled={loadingSourceFolder}
                  >
                    <FolderOpen className="w-4 h-4" />
                    {loadingSourceFolder && sourceLoadProgress
                      ? `Analisi ${sourceLoadProgress.completed}/${sourceLoadProgress.total}`
                      : loadingSourceFolder
                        ? "Analisi cartella..."
                        : "Sfoglia"}
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
                {!sourceLoaded && project.images.length > 0 ? (
                  <div className="flex items-start gap-2 rounded-2xl border border-[var(--danger-soft)] bg-[rgba(207,175,163,0.12)] p-3 text-sm text-[var(--app-text-muted)]">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger)]" />
                    <span>
                      Le {project.images.length} immagini originali non sono disponibili in questa sessione. Ricollega la cartella completa: crop e approvazioni verranno conservati.
                    </span>
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
              <Button asChild variant="outline" className="border-[var(--brand-accent)] bg-[rgba(103,117,107,0.08)] text-[var(--brand-accent)] hover:bg-[rgba(103,117,107,0.15)] hover:border-[var(--brand-primary)] hover:text-[var(--app-text)]">
                <Link to="/">
                  Annulla
                </Link>
              </Button>
              <Button
                onClick={handleContinue}
                disabled={loadingSourceFolder || loadingTemplateSelection || templatesLoading || !presetTemplatesReady}
                className="bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-strong)] text-[var(--brand-primary-foreground)] shadow-[0_18px_36px_rgba(103,117,107,0.24)]"
              >
                {loadingSourceFolder
                  ? "Lettura immagini..."
                  : loadingTemplateSelection || templatesLoading || !presetTemplatesReady
                    ? "Caricamento template..."
                    : "Continua alla Validazione"}
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
                  Importa una cartella e lascia che il software legga orientamento e quantità.
                </div>
                <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-field)] p-4">
                  <div className="font-medium text-[var(--app-text)] mb-1">2. Scegli il template</div>
                  Usa un preset classico o un template personalizzato già salvato nella libreria.
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

      <TextInputDialog
        open={templateTextAction !== null}
        title={templateTextAction?.kind === "duplicate" ? "Duplica template" : "Rinomina template"}
        description={templateTextAction?.kind === "duplicate"
          ? "La copia manterrà dimensioni, aree foto e sfondi del template originale."
          : "Il nuovo nome verrà usato nella libreria e nel progetto corrente."}
        initialValue={templateTextAction?.kind === "duplicate"
          ? `${templateTextAction.currentName} Copia`
          : templateTextAction?.currentName ?? ""}
        label="Nome template"
        confirmLabel={templateTextAction?.kind === "duplicate" ? "Crea copia" : "Salva nome"}
        onOpenChange={(open) => { if (!open) setTemplateTextAction(null); }}
        onConfirm={commitTemplateTextAction}
      />
      <ConfirmActionDialog
        open={templateDeleteAction !== null}
        title="Rimuovere il template?"
        description={templateDeleteAction
          ? `“${templateDeleteAction.label}” non sarà più disponibile in questo elenco. I preset potranno essere ripristinati.`
          : ""}
        confirmLabel="Rimuovi"
        destructive
        onOpenChange={(open) => { if (!open) setTemplateDeleteAction(null); }}
        onConfirm={commitTemplateDeleteAction}
      />
    </div>
  );
}
