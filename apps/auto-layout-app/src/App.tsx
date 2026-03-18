import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type MouseEvent } from "react";
import {
  addImageToPage,
  buildAutoLayoutResult,
  changePageTemplate,
  clearSlotAssignment,
  createAutoLayoutPlan,
  createPage,
  moveImageBetweenSlots,
  placeImageInSlot,
  rearrangePageImages,
  rebalancePagesForAssignedImages,
  removePage,
  updatePageSheetSpec,
  updateSlotAssignment
} from "@photo-tools/core";
import { DEFAULT_AUTO_LAYOUT_REQUEST, SHEET_PRESETS } from "@photo-tools/presets";
import type {
  AutoLayoutRequest,
  AutoLayoutResult,
  FitMode,
  GeneratedPageLayout,
  ImageAsset,
  LayoutAssignment,
  LayoutMove,
  PlanningMode,
  RenderJob
} from "@photo-tools/shared-types";
import { AUTO_LAYOUT_SECTIONS, TOOL_NAVIGATION } from "@photo-tools/ui-schema";
import { InputPanel } from "./components/InputPanel";
import { LayoutPreviewBoard } from "./components/LayoutPreviewBoard";
import { OutputPanel } from "./components/OutputPanel";
import { PanelSection } from "./components/PanelSection";
import { ProjectPhotoSelectorModal } from "./components/ProjectPhotoSelectorModal";
import { ResultPanel } from "./components/ResultPanel";
import { HistoryProvider, useHistory } from "./components/HistoryProvider";
import { ZoomControls } from "./components/ZoomControls";
import { ContextMenu } from "./components/ContextMenu";
import { WarningsPanel } from "./components/WarningsPanel";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts";
import { QuickStats } from "./components/QuickStats";
import { SettingsPanel } from "./components/SettingsPanel";
import { Sidebar } from "./components/Sidebar";
import { ConfirmModal } from "./components/ConfirmModal";
import { ExportProgressModal } from "./components/ExportProgressModal";
import { PhotoQuickPreviewModal } from "./components/PhotoQuickPreviewModal";
import { useToast } from "./components/ToastProvider";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Stepper } from "./components/Stepper";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { ProjectDashboard, type Project } from "./components/ProjectDashboard";
import { ImportProgressModal } from "./components/ImportProgressModal";
import {
  inferFolderLabelFromFiles,
  loadImageAssetsFromFiles,
  revokeImageAssetUrls,
  type ImageImportProgressUpdate
} from "./browser-image-assets";
import { mockWeddingAssets } from "./mock/wedding-selection";
import { exportSheets, type ExportProgressUpdate } from "./sheet-renderer";
import { saveImageAssets, loadImageAssets, deleteProjectImages, hasProjectImages } from "./image-storage";
import { createPersistentProjectSnapshot, loadStoredProjects, saveStoredProjects } from "./project-storage";

type AppScreen = "dashboard" | "setup" | "studio";
type StudioPanel = "page" | "slot" | "output" | "warnings" | "stats" | "activity";

interface DragState {
  kind: "asset" | "slot";
  imageId: string;
  sourcePageId?: string;
  sourceSlotId?: string;
}

interface ConfirmState {
  isOpen: boolean;
  pageId: string | null;
  pageNumber: number | null;
}

interface ExportProgressState {
  isOpen: boolean;
  status: "running" | "completed" | "error";
  total: number;
  completed: number;
  currentFile: string | null;
  currentPageNumber: number | null;
  exportedFiles: string[];
  destinationLabel: string;
  errorMessage: string | null;
}

interface ImportProgressState {
  phase: "reading" | "preparing";
  supported: number;
  ignored: number;
  total: number;
  processed: number;
  currentFile: string | null;
  folderLabel: string;
}

type BrowserFile = File & {
  webkitRelativePath: string;
};

function UndoIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M6.2 3.2 2.7 6.7l3.5 3.5.7-.7-2.3-2.3H9a3.5 3.5 0 1 1 0 7H6.5v-1H9a2.5 2.5 0 1 0 0-5H4.6l2.3-2.3-.7-.7Z" fill="currentColor" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="m9.8 3.2-.7.7 2.3 2.3H7a3.5 3.5 0 1 0 0 7h2.5v-1H7a2.5 2.5 0 1 1 0-5h4.4l-2.3 2.3.7.7 3.5-3.5-3.5-3.5Z" fill="currentColor" />
    </svg>
  );
}

function FullscreenIcon({ active }: { active: boolean }) {
  return active ? (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3 6V3h3v1H4v2H3Zm9 0V4h-2V3h3v3h-1Zm-9 4h1v2h2v1H3v-3Zm9 0h1v3h-3v-1h2v-2Z" fill="currentColor" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3 3h4v1H4v3H3V3Zm6 0h4v4h-1V4H9V3ZM3 9h1v3h3v1H3V9Zm9 0h1v4H9v-1h3V9Z" fill="currentColor" />
    </svg>
  );
}

function createInitialExportProgressState(): ExportProgressState {
  return {
    isOpen: false,
    status: "completed",
    total: 0,
    completed: 0,
    currentFile: null,
    currentPageNumber: null,
    exportedFiles: [],
    destinationLabel: "",
    errorMessage: null
  };
}

function createInitialImportProgressState(): ImportProgressState {
  return {
    phase: "reading",
    supported: 0,
    ignored: 0,
    total: 0,
    processed: 0,
    currentFile: null,
    folderLabel: ""
  };
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

function buildInitialRequest(): AutoLayoutRequest {
  return {
    ...DEFAULT_AUTO_LAYOUT_REQUEST,
    assets: mockWeddingAssets,
    output: { ...DEFAULT_AUTO_LAYOUT_REQUEST.output },
    sheet: { ...DEFAULT_AUTO_LAYOUT_REQUEST.sheet }
  };
}

function buildEmptyRequest(): AutoLayoutRequest {
  return {
    ...DEFAULT_AUTO_LAYOUT_REQUEST,
    assets: [],
    output: { ...DEFAULT_AUTO_LAYOUT_REQUEST.output },
    sheet: { ...DEFAULT_AUTO_LAYOUT_REQUEST.sheet }
  };
}

function buildRenderQueue(request: AutoLayoutRequest, result: AutoLayoutResult): RenderJob[] {
  return result.pages.map((page) => ({
    pageId: page.id,
    outputPath: `${request.output.folderPath}/${request.output.fileNamePattern.replace("{index}", String(page.pageNumber))}.${request.output.format}`,
    format: request.output.format
  }));
}

function syncResultRequest(current: AutoLayoutResult, nextRequest: AutoLayoutRequest): AutoLayoutResult {
  return {
    ...current,
    request: nextRequest,
    renderQueue: buildRenderQueue(nextRequest, current)
  };
}

function syncResultWithSelection(
  current: AutoLayoutResult,
  nextRequest: AutoLayoutRequest
): AutoLayoutResult {
  return buildAutoLayoutResult(nextRequest, current.pages, current.availableTemplates);
}

function getProjectActiveAssets(project: Project) {
  return project.result?.request.assets ?? project.request.assets;
}

function getProjectCatalogAssets(project: Project) {
  return project.catalogAssets ?? getProjectActiveAssets(project);
}

function filterAssetsByIds(assets: AutoLayoutRequest["assets"], selectedIds: string[]) {
  const selectedSet = new Set(selectedIds);
  return assets.filter((asset) => selectedSet.has(asset.id));
}

function updateAssetsById(
  assets: AutoLayoutRequest["assets"],
  changesById: Map<string, Partial<Pick<AutoLayoutRequest["assets"][number], "rating" | "pickStatus" | "colorLabel">>>
) {
  return assets.map((asset) => {
    const changes = changesById.get(asset.id);
    return changes ? { ...asset, ...changes } : asset;
  });
}

function mergeLoadedAssetUrls(
  assets: AutoLayoutRequest["assets"],
  loadedAssets: Map<string, AutoLayoutRequest["assets"][number]>
) {
  return assets.map((asset) => {
    const loadedAsset = loadedAssets.get(asset.id);
    if (!loadedAsset) {
      return asset;
    }

    return {
      ...asset,
      sourceUrl: loadedAsset.sourceUrl ?? asset.sourceUrl,
      thumbnailUrl: loadedAsset.thumbnailUrl ?? asset.thumbnailUrl,
      previewUrl: loadedAsset.previewUrl ?? asset.previewUrl
    };
  });
}

function findImagePlacement(
  result: AutoLayoutResult,
  imageId: string
): { pageId: string; slotId: string; pageNumber: number } | null {
  for (const page of result.pages) {
    const assignment = page.assignments.find((item) => item.imageId === imageId);
    if (assignment) {
      return { pageId: page.id, slotId: assignment.slotId, pageNumber: page.pageNumber };
    }
  }

  return null;
}

function AppContent() {
  const toast = useToast();
  const [currentScreen, setCurrentScreen] = useState<AppScreen>("dashboard");
  const [projects, setProjects] = useState<Project[]>(() => loadStoredProjects());
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [allAssets, setAllAssets] = useState(() => mockWeddingAssets);
  const [activeAssetIds, setActiveAssetIds] = useState<string[]>(() => mockWeddingAssets.map((asset) => asset.id));
  const [currentSessionFiles, setCurrentSessionFiles] = useState<Map<string, File>>(new Map());
  const [request, setRequest] = useState<AutoLayoutRequest>(() => buildInitialRequest());
  const [result, setResult] = useState<AutoLayoutResult>(() => createAutoLayoutPlan(buildInitialRequest()));
  const [selectedPageId, setSelectedPageId] = useState<string | null>("page-1");
  const [selectedSlotKey, setSelectedSlotKey] = useState<string | null>("page-1:hero");
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgressState, setImportProgressState] = useState<ImportProgressState>(
    createInitialImportProgressState()
  );
  const [usesMockData, setUsesMockData] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [outputDirectoryHandle, setOutputDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [studioPanel, setStudioPanel] = useState<StudioPanel>("page");
  const [isProjectSelectorOpen, setIsProjectSelectorOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState>({ isOpen: false, pageId: null, pageNumber: null });
  const [activityLog, setActivityLog] = useState<string[]>([
    "Campione reale matrimonio caricato.",
    "Studio pronto: prima imposta il progetto, poi rifinisci i layout."
  ]);
  const [isPlanningPending, startPlanningTransition] = useTransition();
  const [isEditingPending, startEditingTransition] = useTransition();
  const [showOnboardingWizard, setShowOnboardingWizard] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [exportProgressState, setExportProgressState] = useState<ExportProgressState>(() => createInitialExportProgressState());
  const [quickPreviewAssetId, setQuickPreviewAssetId] = useState<string | null>(null);
  const [recentlyRebalancedPageId, setRecentlyRebalancedPageId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    items: Array<{ label: string; action?: () => void; disabled?: boolean; separator?: boolean }>;
  }>({ isOpen: false, position: { x: 0, y: 0 }, items: [] });
  const latestAssetsRef = useRef<{ allAssets: typeof allAssets; projects: Project[] }>({
    allAssets: mockWeddingAssets,
    projects: []
  });
  const saveDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const rebalanceBadgeTimeoutRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);

  // History management
  const { canUndo, canRedo, push, undo, redo, reset } = useHistory();

  // New handlers for enhanced features
  const handleZoomChange = (newZoom: number) => {
    setZoom(newZoom);
  };

  const handleToggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const markPageRebalanced = useCallback((pageId: string) => {
    setRecentlyRebalancedPageId(pageId);
    if (rebalanceBadgeTimeoutRef.current !== null) {
      window.clearTimeout(rebalanceBadgeTimeoutRef.current);
    }
    rebalanceBadgeTimeoutRef.current = window.setTimeout(() => {
      setRecentlyRebalancedPageId((current) => (current === pageId ? null : current));
      rebalanceBadgeTimeoutRef.current = null;
    }, 1800);
  }, []);

  const handleContextMenu = (event: MouseEvent, page: GeneratedPageLayout) => {
    event.preventDefault();

    setContextMenu({
      isOpen: true,
      position: { x: event.clientX, y: event.clientY },
      items: [
        {
          label: "Duplica foglio",
          action: () => handleDuplicatePage(page.id)
        },
        {
          label: "Elimina foglio",
          action: () => handleRemovePage(page.id),
          disabled: result.pages.length <= 1
        },
        { separator: true, label: "" },
        {
          label: "Seleziona questo foglio",
          action: () => {
            setSelectedPageId(page.id);
            setSelectedSlotKey(page.slotDefinitions[0] ? `${page.id}:${page.slotDefinitions[0].id}` : null);
          }
        }
      ]
    });
  };

  const handleCloseContextMenu = () => {
    setContextMenu({ ...contextMenu, isOpen: false });
  };

  const handleDuplicatePage = (pageId?: string) => {
    const sourcePage = pageId ? result.pages.find((p) => p.id === pageId) : selectedPage;
    if (!sourcePage) return;

    startEditingTransition(() => {
      const nextResult = createPage(result, {
        imageIds: sourcePage.imageIds,
        templateId: sourcePage.templateId
      });

      const newPage = nextResult.pages[nextResult.pages.length - 1];
      if (!newPage) return;

      const updatedPages = [...nextResult.pages];
      const currentIndex = updatedPages.findIndex((p) => p.id === sourcePage.id);
      if (currentIndex === -1) return;

      const newPageIndex = updatedPages.findIndex((p) => p.id === newPage.id);
      if (newPageIndex === -1) return;

      const [movedPage] = updatedPages.splice(newPageIndex, 1);
      updatedPages.splice(currentIndex + 1, 0, movedPage);

      const reorderedPages = updatedPages.map((page, index) => ({
        ...page,
        pageNumber: index + 1
      }));

      const finalResult = { ...nextResult, pages: reorderedPages };

      push(finalResult);
      setResult(finalResult);
      setSelectedPageId(movedPage.id);
      pushActivity(`Foglio duplicato: Foglio ${movedPage.pageNumber}`);
    });
  };

  const handleReorderPages = (fromIndex: number, toIndex: number) => {
    startEditingTransition(() => {
      const newPages = [...result.pages];
      const [movedPage] = newPages.splice(fromIndex, 1);
      newPages.splice(toIndex, 0, movedPage);

      const reorderedPages = newPages.map((page, index) => ({
        ...page,
        pageNumber: index + 1
      }));

      const newResult = { ...result, pages: reorderedPages };
      push(newResult);
      setResult(newResult);
      pushActivity("Ordine pagine riorganizzato");
    });
  };

  const handleDeleteSelected = () => {
    if (selectedPage) {
      handleRemovePage(selectedPage.id);
    }
  };

  const cleanupTransientCurrentAssets = useCallback(() => {
    if (!usesMockData && !currentProjectId) {
      revokeImageAssetUrls(allAssets);
    }
  }, [allAssets, currentProjectId, usesMockData]);

  // Project Management
  const saveProject = (project: Project) => {
    const snapshot = createPersistentProjectSnapshot(project);

    setProjects((prev) => {
      const updated = prev.some((p) => p.id === snapshot.id)
        ? prev.map((p) => (p.id === snapshot.id ? snapshot : p))
        : [...prev, snapshot];

      try {
        saveStoredProjects(updated);
      } catch (error) {
        console.error("Errore nel salvataggio locale dei progetti:", error);
      }

      return updated;
    });
  };

  const createNewProject = () => {
    resetStudioHistory();
    const emptyRequest = buildEmptyRequest();
    setRequest(emptyRequest);
    setResult(createAutoLayoutPlan(emptyRequest));
    setActiveAssetIds([]);
    setAllAssets([]);
    setUsesMockData(false);
    setCurrentSessionFiles(new Map());
    setCurrentProjectId(null);
    setShowOnboardingWizard(true);
    setCurrentScreen("setup");
  };

  const openProject = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;

    const activeRequest = project.result?.request ?? project.request;
    const catalogAssets = getProjectCatalogAssets(project);

    if (!usesMockData && currentProjectId && currentProjectId !== projectId) {
      revokeImageAssetUrls(allAssets);
    }

    resetStudioHistory();
    setCurrentProjectId(projectId);
    setRequest(activeRequest);
    setResult(project.result ?? createAutoLayoutPlan(project.request));
    setActiveAssetIds(activeRequest.assets.map((asset) => asset.id));
    setAllAssets(catalogAssets);
    setUsesMockData(false);
    setCurrentSessionFiles(new Map()); // Clear session files
    setCurrentScreen("setup");
  };

  // Load images from IndexedDB when project is opened
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!currentProjectId || usesMockData) {
      return;
    }

    let isMounted = true;

    (async () => {
      try {
        const hasImages = await hasProjectImages(currentProjectId);
        if (!hasImages) {
          const message =
            "Le immagini salvate in locale non sono disponibili per questo progetto. Reimporta la cartella foto o il file progetto .imagetool.";
          toast.addToast(message, "warning", 7000);
          pushActivity(message);
          return;
        }

        const assetMap = await loadImageAssets(currentProjectId);
        if (!isMounted) return;

        const replacedAssets = allAssets.filter((asset) => assetMap.has(asset.id));
        if (replacedAssets.length > 0) {
          revokeImageAssetUrls(replacedAssets);
        }

        const updatedCatalogAssets = mergeLoadedAssetUrls(allAssets, assetMap);
        const updatedRequest = {
          ...request,
          assets: filterAssetsByIds(updatedCatalogAssets, request.assets.map((asset) => asset.id))
        };

        const missingAssetCount = Math.max(0, updatedCatalogAssets.length - assetMap.size);
        if (missingAssetCount > 0) {
          const partialMessage =
            missingAssetCount === 1
              ? "1 immagine del progetto non e stata ripristinata dal database locale."
              : `${missingAssetCount} immagini del progetto non sono state ripristinate dal database locale.`;
          toast.addToast(partialMessage, "warning", 7000);
          pushActivity(`${partialMessage} Reimporta la cartella se noti anteprime mancanti.`);
        }

        setAllAssets(updatedCatalogAssets);
        setRequest(updatedRequest);

        if (result) {
          const updatedResult = {
            ...result,
            request: updatedRequest
          };
          setResult(updatedResult);
        }
      } catch (error) {
        console.error("Errore nel caricamento delle immagini:", error);
        // If loading fails, user will be prompted to reload the folder
        pushActivity("Impossibile caricare le immagini salvate. Ricarica la cartella.");
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [currentProjectId, usesMockData]);

  // Auto-save project when result or request changes (with debounce)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!currentProjectId || usesMockData) {
      return;
    }

    // Clear existing timeout
    if (saveDebounceRef.current) {
      clearTimeout(saveDebounceRef.current);
    }

    // Show "saving" status
    setSaveStatus("saving");

    // Debounced save
    saveDebounceRef.current = setTimeout(async () => {
      if (!isMountedRef.current) return;

      try {
        persistCurrentProject();
        
        // Show "saved" for a moment
        if (isMountedRef.current) {
          setSaveStatus("saved");
          setTimeout(() => {
            if (isMountedRef.current) {
              setSaveStatus("idle");
            }
          }, 2000);
        }
      } catch (error) {
        console.error("Errore nel salvataggio del progetto:", error);
        if (isMountedRef.current) {
          setSaveStatus("error");
        }
      }
    }, 2000); // Debounce per 2 secondi

    return () => {
      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current);
      }
    };
  }, [currentProjectId, usesMockData, result, request]);

  const deleteProject = (projectId: string) => {
    const projectToDelete = projects.find((project) => project.id === projectId);

    setProjects((prev) => {
      const updated = prev.filter((p) => p.id !== projectId);

      try {
        saveStoredProjects(updated);
      } catch (error) {
        console.error("Errore nel salvataggio locale dei progetti:", error);
      }

      return updated;
    });

    if (projectToDelete) {
      revokeImageAssetUrls(getProjectCatalogAssets(projectToDelete));
      // Delete images from IndexedDB
      deleteProjectImages(projectId).catch((error) => {
        console.error("Errore nell'eliminazione delle immagini dal database:", error);
      });
    }

    if (currentProjectId === projectId) {
      setCurrentProjectId(null);
      setCurrentScreen("dashboard");
    }
  };

  const renameProject = (projectId: string, newName: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    saveProject({ ...project, name: newName, updatedAt: Date.now() });
  };

  const importImportedProject = (importedProject: Project) => {
    // Ensure the imported project has a unique ID
    const newProjectId = `project-${Date.now()}`;
    const catalogAssets = getProjectCatalogAssets(importedProject);
    const newProject: Project = {
      ...importedProject,
      id: newProjectId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      catalogAssets,
      assetCount: catalogAssets.length
    };

    // Save imported images to IndexedDB
    if (catalogAssets.length > 0) {
      saveImageAssets(newProjectId, [], catalogAssets).catch((error) => {
        console.error("Errore nel salvataggio delle immagini importate:", error);
      });
    }

    saveProject(newProject);
    pushActivity(`Progetto "${newProject.name}" importato con successo.`);
  };

  const handleCreateProjectFromWizard = async (wizardRequest: AutoLayoutRequest, wizardProjectName: string) => {
    const projectId = currentProjectId || `project-${Date.now()}`;
    const plannedResult = createAutoLayoutPlan(wizardRequest);
    const catalogAssets = allAssets;
    const project: Project = {
      id: projectId,
      name: wizardProjectName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      request: wizardRequest,
      result: plannedResult,
      catalogAssets,
      assetCount: catalogAssets.length,
      pageCount: plannedResult.pages.length
    };
    resetStudioHistory();
    
    // Save images to IndexedDB if available
    if (currentSessionFiles.size > 0 && !usesMockData) {
      try {
        const filesToSave = Array.from(currentSessionFiles.values());
        await saveImageAssets(projectId, filesToSave, catalogAssets);
      } catch (error) {
        console.error("Errore nel salvataggio delle immagini:", error);
        // Continue even if image storage fails - project can still be used
      }
    }
    
    saveProject(project);
    setCurrentProjectId(projectId);
    setAllAssets(catalogAssets);
    setActiveAssetIds(wizardRequest.assets.map((asset) => asset.id));
    setRequest(wizardRequest);
    setResult(plannedResult);
    setShowOnboardingWizard(false);
    setCurrentScreen("studio");
    pushActivity(`Progetto "${wizardProjectName}" creato con successo.`);
  };

  function buildRequestWithSelection(
    baseRequest: AutoLayoutRequest,
    sourceAssets: typeof allAssets,
    selectedIds: string[]
  ): AutoLayoutRequest {
    return {
      ...baseRequest,
      assets: filterAssetsByIds(sourceAssets, selectedIds)
    };
  }

  useEffect(() => {
    latestAssetsRef.current = { allAssets, projects };
  }, [allAssets, projects]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current);
      }
      const assetsToCleanup = [
        ...latestAssetsRef.current.allAssets,
        ...latestAssetsRef.current.projects.flatMap((project) => getProjectCatalogAssets(project))
      ];
      revokeImageAssetUrls(assetsToCleanup);
    };
  }, []);

  useEffect(() => {
    if (!result.pages.find((page) => page.id === selectedPageId)) {
      const nextPage = result.pages[0];
      setSelectedPageId(nextPage?.id ?? null);
      setSelectedSlotKey(nextPage?.slotDefinitions[0] ? `${nextPage.id}:${nextPage.slotDefinitions[0].id}` : null);
    }
  }, [result, selectedPageId]);

  useEffect(() => {
    if (!selectedSlotKey) {
      return;
    }

    const [pageId, slotId] = selectedSlotKey.split(":");
    const page = result.pages.find((item) => item.id === pageId);
    const slotExists = page?.slotDefinitions.some((slot) => slot.id === slotId);

    if (!slotExists) {
      setSelectedSlotKey(null);
    }
  }, [result, selectedSlotKey]);

  const sections = Object.fromEntries(AUTO_LAYOUT_SECTIONS.map((section) => [section.id, section]));
  const assetsById = useMemo(
    () => new Map(result.request.assets.map((asset) => [asset.id, asset] as const)),
    [result.request.assets]
  );
  const usageByAssetId = useMemo(
    () =>
      new Map(
        result.pages.flatMap((page) =>
          page.assignments.map((assignment) => [
            assignment.imageId,
            { pageId: page.id, pageNumber: page.pageNumber, slotId: assignment.slotId }
          ] as const)
        )
      ),
    [result.pages]
  );
  const selectedPage = result.pages.find((page) => page.id === selectedPageId) ?? null;
  const selectedSlotId = selectedSlotKey?.split(":")[1] ?? null;
  const selectedSlot = selectedPage?.slotDefinitions.find((slot) => slot.id === selectedSlotId);
  const selectedAssignment = selectedSlot
    ? selectedPage?.assignments.find((assignment) => assignment.slotId === selectedSlot.id)
    : undefined;
  const selectedAsset = selectedAssignment ? assetsById.get(selectedAssignment.imageId) ?? null : null;
  const allAssetsById = useMemo(
    () => new Map(allAssets.map((asset) => [asset.id, asset] as const)),
    [allAssets]
  );
  const quickPreviewAsset = quickPreviewAssetId
    ? allAssetsById.get(quickPreviewAssetId) ?? assetsById.get(quickPreviewAssetId) ?? null
    : null;
  const supportsDirectoryPicker = typeof window !== "undefined" && "showDirectoryPicker" in window;
  const canOpenSavedFolder = false;
  const usedImagesCount = result.summary.totalImages - result.unassignedAssets.length;
  const canOpenStudio = result.pages.length > 0 && request.assets.length > 0;
  const handleSelectPage = useCallback((pageId: string, slotId?: string) => {
    setSelectedPageId(pageId);
    setSelectedSlotKey(slotId ? `${pageId}:${slotId}` : null);
  }, []);
  const handleStartSlotDrag = useCallback((pageId: string, slotId: string, imageId: string) => {
    setDragState({
      kind: "slot",
      imageId,
      sourcePageId: pageId,
      sourceSlotId: slotId
    });
  }, []);
  const handleDragAssetStart = useCallback((imageId: string) => {
    setDragState({
      kind: "asset",
      imageId
    });
  }, []);
  const handleDragEnd = useCallback(() => {
    setDragState(null);
  }, []);
  const toggleQuickPreview = useCallback((assetId: string | null) => {
    if (!assetId) {
      return;
    }

    setQuickPreviewAssetId((current) => (current === assetId ? null : assetId));
  }, []);
  const handleUpdateSelectedSlotAssignment = useCallback(
    (
      pageId: string,
      slotId: string,
      changes: Partial<Pick<LayoutAssignment, "fitMode" | "zoom" | "offsetX" | "offsetY" | "rotation" | "locked">>
    ) => {
      const nextResult = updateSlotAssignment(result, {
        pageId,
        slotId,
        changes
      });

      commitStudioChange({ result: nextResult });
    },
    [result]
  );

  useEffect(() => {
    const quickPreviewEnabled =
      currentScreen === "studio" || showOnboardingWizard || isProjectSelectorOpen;

    if (!quickPreviewEnabled) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) {
        return;
      }

      const usesModifier = event.ctrlKey || event.metaKey;
      const normalizedKey = event.key.toLowerCase();

      if (event.key === "Escape" && quickPreviewAssetId) {
        event.preventDefault();
        setQuickPreviewAssetId(null);
        return;
      }

      if (currentScreen === "studio" && usesModifier && normalizedKey === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }

      if (
        currentScreen === "studio" &&
        usesModifier &&
        (normalizedKey === "y" || (normalizedKey === "z" && event.shiftKey))
      ) {
        event.preventDefault();
        redo();
        return;
      }

      if (event.code === "Space" || event.key === " ") {
        const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const focusedPreviewAssetId =
          activeElement?.dataset.previewAssetId ??
          activeElement?.closest<HTMLElement>("[data-preview-asset-id]")?.dataset.previewAssetId ??
          null;
        const candidateAssetId = focusedPreviewAssetId ?? selectedAsset?.id ?? null;

        if (quickPreviewAssetId || candidateAssetId) {
          event.preventDefault();
          toggleQuickPreview(candidateAssetId ?? quickPreviewAssetId);
        }
        return;
      }

      if (
        currentScreen === "studio" &&
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedPage &&
        selectedSlot
      ) {
        const nextResult = clearSlotAssignment(result, {
          pageId: selectedPage.id,
          slotId: selectedSlot.id
        });

        if (nextResult !== result) {
          event.preventDefault();
          commitStudioChange({
            result: nextResult,
            activity: `Slot ${selectedSlot.id} svuotato da tastiera.`
          });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    currentScreen,
    result,
    selectedPage,
    selectedSlot,
    selectedAsset?.id,
    quickPreviewAssetId,
    toggleQuickPreview,
    undo,
    redo,
    showOnboardingWizard,
    isProjectSelectorOpen
  ]);

  useEffect(() => {
    return () => {
      if (rebalanceBadgeTimeoutRef.current !== null) {
        window.clearTimeout(rebalanceBadgeTimeoutRef.current);
      }
    };
  }, []);

  function pushActivity(entry: string) {
    setActivityLog((current) => [entry, ...current].slice(0, 12));
  }

  function resetStudioHistory() {
    reset(result);
  }

  function commitStudioChange(nextState: {
    result: AutoLayoutResult;
    request?: AutoLayoutRequest;
    activeAssetIds?: string[];
    selectedPageId?: string | null;
    selectedSlotKey?: string | null;
    activity?: string;
  }) {
    const nextRequest = nextState.request ?? nextState.result.request;
    const nextActiveAssetIds = nextState.activeAssetIds ?? activeAssetIds;
    const hasSelectedPageId = Object.prototype.hasOwnProperty.call(nextState, "selectedPageId");
    const hasSelectedSlotKey = Object.prototype.hasOwnProperty.call(nextState, "selectedSlotKey");
    const nextSelectedPageId = hasSelectedPageId ? nextState.selectedPageId ?? null : selectedPageId;
    const nextSelectedSlotKey = hasSelectedSlotKey ? nextState.selectedSlotKey ?? null : selectedSlotKey;
    const nothingChanged =
      nextState.result === result &&
      nextRequest === request &&
      sameStringArray(nextActiveAssetIds, activeAssetIds) &&
      nextSelectedPageId === selectedPageId &&
      nextSelectedSlotKey === selectedSlotKey;

    if (nothingChanged) {
      return false;
    }

    // Push to history
    push(nextState.result);

    setDragState(null);

    startEditingTransition(() => {
      setRequest(nextRequest);
      setResult(nextState.result);
      if (!sameStringArray(nextActiveAssetIds, activeAssetIds)) {
        setActiveAssetIds(nextActiveAssetIds);
      }
      if (hasSelectedPageId) {
        setSelectedPageId(nextSelectedPageId);
      }
      if (hasSelectedSlotKey) {
        setSelectedSlotKey(nextSelectedSlotKey);
      }
      setExportMessage(null);
    });

    if (nextState.activity) {
      pushActivity(nextState.activity);
    }

    return true;
  }

  function applyPlanningRequest(nextRequest: AutoLayoutRequest) {
    const nextSelectedRequest = buildRequestWithSelection(nextRequest, allAssets, activeAssetIds);

    resetStudioHistory();
    startPlanningTransition(() => {
      setRequest(nextSelectedRequest);
      setResult(createAutoLayoutPlan(nextSelectedRequest));
      setExportMessage(null);
    });
  }

  function applyPlanningRequestWithAssets(
    nextRequest: AutoLayoutRequest,
    sourceAssets: typeof allAssets,
    selectedIds: string[]
  ) {
    const nextSelectedRequest = buildRequestWithSelection(nextRequest, sourceAssets, selectedIds);

    resetStudioHistory();
    startPlanningTransition(() => {
      setRequest(nextSelectedRequest);
      setResult(createAutoLayoutPlan(nextSelectedRequest));
      setExportMessage(null);
    });
  }

  function syncCatalogAssets(nextCatalogAssets: typeof allAssets, nextSelectedIds = activeAssetIds) {
    const nextSelectedRequest = buildRequestWithSelection({ ...request }, nextCatalogAssets, nextSelectedIds);
    setAllAssets(nextCatalogAssets);
    setActiveAssetIds(nextSelectedIds);
    setRequest(nextSelectedRequest);
    setResult((current) => syncResultWithSelection(current, nextSelectedRequest));
  }

  function handleAssetsMetadataChange(
    changesById: Map<string, Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel">>>
  ) {
    if (changesById.size === 0) {
      return;
    }

    const nextCatalogAssets = updateAssetsById(allAssets, changesById);
    syncCatalogAssets(nextCatalogAssets);
  }

  function updateOutput(field: "folderPath" | "fileNamePattern" | "quality" | "format", value: string | number) {
    const nextRequest = {
      ...request,
      output: {
        ...request.output,
        [field]: value
      }
    };

    setRequest(nextRequest);
    setResult((current) => syncResultRequest(current, nextRequest));
  }

  function handleSheetPresetChange(presetId: string) {
    const preset = SHEET_PRESETS.find((item) => item.id === presetId);

    if (!preset) {
      return;
    }

    applyPlanningRequest({
      ...request,
      sheet: {
        ...request.sheet,
        presetId: preset.id,
        label: preset.label,
        widthCm: preset.widthCm,
        heightCm: preset.heightCm
      }
    });
  }

  function handleSheetFieldChange(field: "widthCm" | "heightCm" | "marginCm" | "gapCm" | "dpi", value: number) {
    const isDimensionField = field === "widthCm" || field === "heightCm";

    applyPlanningRequest({
      ...request,
      sheet: {
        ...request.sheet,
        [field]: value,
        presetId: isDimensionField ? "custom" : request.sheet.presetId,
        label: isDimensionField ? "Personalizzato" : request.sheet.label
      }
    });
  }

  function handleFitModeChange(value: FitMode) {
    applyPlanningRequest({ ...request, fitMode: value });
  }

  function handlePlanningModeChange(value: PlanningMode) {
    applyPlanningRequest({ ...request, planningMode: value });
  }

  function handleDesiredSheetCountChange(value: number) {
    applyPlanningRequest({ ...request, desiredSheetCount: value });
  }

  function handleMaxPhotosPerSheetChange(value: number) {
    applyPlanningRequest({ ...request, maxPhotosPerSheet: value });
  }

  function handleAllowTemplateVariationChange(value: boolean) {
    applyPlanningRequest({ ...request, allowTemplateVariation: value });
  }

  function handleWizardComplete(wizardRequest: AutoLayoutRequest, wizardProjectName: string) {
    handleCreateProjectFromWizard(wizardRequest, wizardProjectName);
  }

  function handleDrop(move: LayoutMove) {
    const draggedImageId =
      result.pages.find((page) => page.id === move.sourcePageId)?.assignments.find((assignment) => assignment.slotId === move.sourceSlotId)?.imageId ??
      dragState?.imageId ??
      null;
    const targetPage = result.pages.find((page) => page.id === move.targetPageId);
    const targetAssignment = targetPage?.assignments.find((assignment) => assignment.slotId === move.targetSlotId);
    const isSamePageOccupiedDrop =
      move.sourcePageId === move.targetPageId &&
      move.sourceSlotId !== move.targetSlotId &&
      Boolean(targetAssignment) &&
      Boolean(draggedImageId);
    let nextResult = isSamePageOccupiedDrop && draggedImageId
      ? rearrangePageImages(result, {
          pageId: move.targetPageId,
          preferredImageId: draggedImageId
        })
      : moveImageBetweenSlots(result, move);

    if (move.sourcePageId !== move.targetPageId) {
      nextResult = rebalancePagesForAssignedImages(nextResult, [move.sourcePageId, move.targetPageId]);
    }

    if (move.sourcePageId === move.targetPageId && isSamePageOccupiedDrop) {
      markPageRebalanced(move.targetPageId);
    }

    const nextPlacement = draggedImageId ? findImagePlacement(nextResult, draggedImageId) : null;
    commitStudioChange({
      result: nextResult,
      selectedPageId: nextPlacement?.pageId ?? move.targetPageId,
      selectedSlotKey: nextPlacement ? `${nextPlacement.pageId}:${nextPlacement.slotId}` : null,
      activity:
        move.sourcePageId === move.targetPageId
          ? isSamePageOccupiedDrop
            ? `Foglio ${move.targetPageId} riorganizzato automaticamente attorno alla foto spostata.`
            : `Foto riposizionata nel foglio ${move.targetPageId}.`
          : `Foto spostata tra fogli con riadattamento automatico dei layout.`
    });
  }

  function handleAssetDropped(pageId: string, slotId: string, imageId: string) {
    const previousUsage = usageByAssetId.get(imageId);
    const imageAlreadyActive = activeAssetIds.includes(imageId);
    const nextActiveIds = imageAlreadyActive ? activeAssetIds : [...activeAssetIds, imageId];
    const nextRequest = imageAlreadyActive
      ? request
      : buildRequestWithSelection(request, allAssets, nextActiveIds);
    const baseResult = imageAlreadyActive ? result : syncResultWithSelection(result, nextRequest);
    let nextResult = placeImageInSlot(baseResult, { imageId, targetPageId: pageId, targetSlotId: slotId });
    nextResult = rebalancePagesForAssignedImages(nextResult, [pageId, previousUsage?.pageId ?? ""]);
    const nextPlacement = findImagePlacement(nextResult, imageId);

    commitStudioChange({
      result: nextResult,
      request: nextRequest,
      activeAssetIds: nextActiveIds,
      selectedPageId: nextPlacement?.pageId ?? pageId,
      selectedSlotKey: nextPlacement ? `${nextPlacement.pageId}:${nextPlacement.slotId}` : `${pageId}:${slotId}`,
      activity:
        previousUsage && previousUsage.pageId !== pageId
          ? `Foto spostata dal foglio ${previousUsage.pageNumber} al foglio ${nextPlacement?.pageNumber ?? pageId} con riassetto automatico.`
          : imageAlreadyActive
            ? `Foto assegnata manualmente al foglio ${pageId} con aggiornamento layout.`
            : `Foto attivata dal catalogo e assegnata al foglio ${pageId}.`
    });
  }

  function handleAddImageToPage(pageId: string, imageId: string) {
    const previousUsage = usageByAssetId.get(imageId);
    const imageAlreadyActive = activeAssetIds.includes(imageId);
    const nextActiveIds = imageAlreadyActive ? activeAssetIds : [...activeAssetIds, imageId];
    const nextRequest = imageAlreadyActive
      ? request
      : buildRequestWithSelection(request, allAssets, nextActiveIds);
    const baseResult = imageAlreadyActive ? result : syncResultWithSelection(result, nextRequest);
    let nextResult = addImageToPage(baseResult, { pageId, imageId });

    if (previousUsage?.pageId && previousUsage.pageId !== pageId) {
      nextResult = rebalancePagesForAssignedImages(nextResult, [previousUsage.pageId]);
    }

    if (previousUsage?.pageId === pageId) {
      markPageRebalanced(pageId);
    }

    const nextPlacement = findImagePlacement(nextResult, imageId);
    commitStudioChange({
      result: nextResult,
      request: nextRequest,
      activeAssetIds: nextActiveIds,
      selectedPageId: nextPlacement?.pageId ?? pageId,
      selectedSlotKey: nextPlacement ? `${nextPlacement.pageId}:${nextPlacement.slotId}` : selectedSlotKey,
      activity:
        previousUsage?.pageId === pageId
          ? `Foglio ${pageId} riorganizzato automaticamente attorno alla foto selezionata.`
          : previousUsage && previousUsage.pageId !== pageId
          ? `Foto aggiunta al foglio ${nextPlacement?.pageNumber ?? pageId} e layout riadattato automaticamente.`
          : imageAlreadyActive
            ? `Foglio ${pageId} espanso con una nuova foto e layout aggiornato.`
            : `Foto attivata dal catalogo e aggiunta al foglio ${pageId}.`
    });
  }

  function handleTemplateChange(pageId: string, templateId: string) {
    const nextResult = changePageTemplate(result, { pageId, templateId });
    commitStudioChange({
      result: nextResult,
      activity: `Template aggiornato sul foglio ${pageId}.`
    });
  }

  function handleApplyTemplateToPages(pageIds: string[], templateId: string) {
    const uniquePageIds = Array.from(new Set(pageIds));
    if (uniquePageIds.length === 0) {
      return;
    }

    const nextResult = uniquePageIds.reduce(
      (currentResult, pageId) => changePageTemplate(currentResult, { pageId, templateId }),
      result
    );

    commitStudioChange({
      result: nextResult,
      activity: `Template applicato a ${uniquePageIds.length} fogli visibili.`
    });
  }

  function handleRebalancePage(pageId: string) {
    const page = result.pages.find((item) => item.id === pageId);
    if (!page) {
      return;
    }

    const nextResult = rebalancePagesForAssignedImages(result, [pageId]);
    markPageRebalanced(pageId);
    commitStudioChange({
      result: nextResult,
      activity: `Foglio ${page.pageNumber} riadattato automaticamente.`
    });
  }

  function handleRemovePage(pageId: string) {
    const pageToDelete = result.pages.find((p) => p.id === pageId);
    if (!pageToDelete) return;
    
    setConfirmState({
      isOpen: true,
      pageId,
      pageNumber: pageToDelete.pageNumber
    });
  }

  function confirmRemovePage() {
    const pageId = confirmState.pageId;
    if (!pageId) return;

    const nextResult = removePage(result, { pageId });
    const changed = commitStudioChange({
      result: nextResult,
      activity: `Foglio ${confirmState.pageNumber} rimosso. Le sue foto sono tornate disponibili.`
    });

    if (changed) {
      toast.addToast(
        `Foglio ${confirmState.pageNumber} eliminato. Le foto sono tornate disponibili.`,
        "success"
      );
    }
    setConfirmState({ isOpen: false, pageId: null, pageNumber: null });
  }

  function handleCreatePageFromUnused() {
    const nextResult = createPage(result);
    commitStudioChange({
      result: nextResult,
      activity: "Nuovo foglio creato a partire dalle foto non usate."
    });
  }

  function handleCreatePageWithImage(imageId: string) {
    const previousUsage = usageByAssetId.get(imageId);
    const imageAlreadyActive = activeAssetIds.includes(imageId);
    const nextActiveIds = imageAlreadyActive ? activeAssetIds : [...activeAssetIds, imageId];
    const nextRequest = imageAlreadyActive
      ? request
      : buildRequestWithSelection(request, allAssets, nextActiveIds);
    let baseResult = imageAlreadyActive ? result : syncResultWithSelection(result, nextRequest);

    if (previousUsage) {
      baseResult = clearSlotAssignment(baseResult, {
        pageId: previousUsage.pageId,
        slotId: previousUsage.slotId
      });
      baseResult = rebalancePagesForAssignedImages(baseResult, [previousUsage.pageId]);
    }

    const nextResult = createPage(baseResult, { imageIds: [imageId] });
    const newPage = nextResult.pages[nextResult.pages.length - 1];

    commitStudioChange({
      result: nextResult,
      request: nextRequest,
      activeAssetIds: nextActiveIds,
      selectedPageId: newPage?.id ?? selectedPageId,
      selectedSlotKey: newPage?.slotDefinitions[0] ? `${newPage.id}:${newPage.slotDefinitions[0].id}` : selectedSlotKey,
      activity: previousUsage
        ? `Foto spostata in un nuovo foglio creato automaticamente.`
        : `Nuovo foglio creato con la foto trascinata.`
    });
  }

  function handleDropToUnused() {
    if (!dragState) {
      return;
    }

    const usage = usageByAssetId.get(dragState.imageId);
    if (!usage) {
      setDragState(null);
      return;
    }

    const clearedResult = clearSlotAssignment(result, {
      pageId: usage.pageId,
      slotId: usage.slotId
    });
    const nextResult = rebalancePagesForAssignedImages(clearedResult, [usage.pageId]);
    const nextPage = nextResult.pages.find((page) => page.id === usage.pageId);

    commitStudioChange({
      result: nextResult,
      selectedPageId: nextPage?.id ?? selectedPageId,
      selectedSlotKey: nextPage?.slotDefinitions[0] ? `${nextPage.id}:${nextPage.slotDefinitions[0].id}` : null,
      activity: `Foto rimossa dal foglio ${usage.pageNumber} e riportata tra le non usate.`
    });
  }

  function handleClearSlot(pageId: string, slotId: string) {
    const clearedResult = clearSlotAssignment(result, {
      pageId,
      slotId
    });
    const nextResult = rebalancePagesForAssignedImages(clearedResult, [pageId]);
    const nextPage = nextResult.pages.find((page) => page.id === pageId);

    commitStudioChange({
      result: nextResult,
      selectedPageId: nextPage?.id ?? pageId,
      selectedSlotKey: nextPage?.slotDefinitions[0] ? `${nextPage.id}:${nextPage.slotDefinitions[0].id}` : null,
      activity: `Foto rimossa manualmente dallo slot ${pageId}:${slotId}.`
    });
  }

  function handlePageSheetPresetChange(pageId: string, presetId: string) {
    const preset = SHEET_PRESETS.find((item) => item.id === presetId);
    const page = result.pages.find((item) => item.id === pageId);
    if (!preset) {
      return;
    }

    const nextResult = updatePageSheetSpec(result, {
      pageId,
      changes: {
        presetId: preset.id,
        label: preset.label,
        widthCm: preset.widthCm,
        heightCm: preset.heightCm
      }
    });

    commitStudioChange({
      result: nextResult,
      activity: `Formato del foglio ${page?.pageNumber ?? pageId} aggiornato a ${preset.label}.`
    });
  }

  function handlePageSheetFieldChange(
    pageId: string,
    field: "widthCm" | "heightCm" | "marginCm" | "gapCm" | "dpi" | "photoBorderWidthCm",
    value: number
  ) {
    if (!Number.isFinite(value) || (value <= 0 && field !== "marginCm" && field !== "gapCm" && field !== "photoBorderWidthCm")) {
      return;
    }

    const isDimensionField = field === "widthCm" || field === "heightCm";
    const currentPage = result.pages.find((page) => page.id === pageId);
    const pageLabel = currentPage?.pageNumber ?? pageId;
    const nextWidth = field === "widthCm" ? value : currentPage?.sheetSpec.widthCm;
    const nextHeight = field === "heightCm" ? value : currentPage?.sheetSpec.heightCm;
    const nextResult = updatePageSheetSpec(result, {
      pageId,
      changes: {
        [field]: value,
        ...(isDimensionField
          ? {
              presetId: "custom",
              label: "Personalizzato"
            }
          : {})
      }
    });

    commitStudioChange({
      result: nextResult,
      activity:
        isDimensionField
          ? `Aspect ratio del foglio ${pageLabel} aggiornato a ${nextWidth}x${nextHeight} cm.`
          : `Impostazioni tecniche del foglio ${pageLabel} aggiornate.`
    });
  }

  function handlePageSheetStyleChange(
    pageId: string,
    changes: {
      backgroundColor?: string;
      backgroundImageUrl?: string;
      photoBorderColor?: string;
      photoBorderWidthCm?: number;
    },
    activity = "Aspetto del foglio aggiornato."
  ) {
    const nextResult = updatePageSheetSpec(result, {
      pageId,
      changes
    });

    commitStudioChange({
      result: nextResult,
      activity
    });
  }

  async function handlePickOutputFolder() {
    if (!supportsDirectoryPicker) {
      return;
    }

    const picker = window as Window & {
      showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
    };

    try {
      const directoryHandle = await picker.showDirectoryPicker?.();
      if (!directoryHandle) {
        return;
      }

      setOutputDirectoryHandle(directoryHandle);
      updateOutput("folderPath", directoryHandle.name);
      pushActivity(`Cartella reale di output selezionata: ${directoryHandle.name}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Selezione cartella annullata.";
      setExportMessage(message);
    }
  }

  async function handleGenerate() {
    if (result.pages.length === 0) {
      setExportMessage("Non ci sono fogli da esportare.");
      return;
    }

    const destinationLabel = outputDirectoryHandle
      ? `Salvataggio diretto nella cartella ${request.output.folderPath}`
      : "Download multiplo gestito dal browser";

    setIsExporting(true);
    setExportMessage(null);
    setExportProgressState({
      isOpen: true,
      status: "running",
      total: result.pages.length,
      completed: 0,
      currentFile: null,
      currentPageNumber: null,
      exportedFiles: [],
      destinationLabel,
      errorMessage: null
    });

    try {
      const exportResult = await exportSheets(result, {
        directoryHandle: outputDirectoryHandle,
        onProgress: (update: ExportProgressUpdate) => {
          setExportProgressState((current) => ({
            ...current,
            isOpen: true,
            status: "running",
            total: update.total,
            completed: update.stage === "completed" ? update.completed : current.completed,
            currentFile: update.fileName,
            currentPageNumber: update.pageNumber,
            exportedFiles:
              update.stage === "completed" && !current.exportedFiles.includes(update.fileName)
                ? [...current.exportedFiles, update.fileName]
                : current.exportedFiles
          }));
        }
      });
      const formatNote =
        request.output.format === "tif"
          ? " Il browser non genera TIFF nativi, quindi i fogli sono stati salvati in JPG."
          : "";
      const destination = exportResult.savedToDirectory
        ? `nella cartella ${request.output.folderPath}`
        : "tramite download del browser";
      const message = `${exportResult.exportedFiles.length} fogli esportati ${destination}.${formatNote}`;
      setExportMessage(message);
      setExportProgressState((current) => ({
        ...current,
        isOpen: true,
        status: "completed",
        total: exportResult.exportedFiles.length,
        completed: exportResult.exportedFiles.length,
        currentFile: exportResult.exportedFiles[exportResult.exportedFiles.length - 1] ?? current.currentFile,
        currentPageNumber: null,
        exportedFiles: exportResult.exportedFiles,
        errorMessage: null
      }));
      pushActivity(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Errore durante l'esportazione dei fogli.";
      setExportMessage(message);
      setExportProgressState((current) => ({
        ...current,
        isOpen: true,
        status: "error",
        errorMessage: message
      }));
      pushActivity(message);
    } finally {
      setIsExporting(false);
    }
  }

  async function handleFolderSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }

    const files = Array.from(fileList);
    const folderLabel = inferFolderLabelFromFiles(files);
    setIsImporting(true);
    setImportProgressState({
      phase: "reading",
      supported: files.filter((file) => /\.(jpe?g|png)$/i.test(file.name)).length,
      ignored: files.filter((file) => !/\.(jpe?g|png)$/i.test(file.name)).length,
      total: files.filter((file) => /\.(jpe?g|png)$/i.test(file.name)).length,
      processed: 0,
      currentFile: files[0]?.name ?? null,
      folderLabel: folderLabel || "Cartella selezionata"
    });

    try {
      const assets = await loadImageAssetsFromFiles(files, {
        onProgress: (update: ImageImportProgressUpdate) => {
          setImportProgressState({
            phase: "preparing",
            supported: update.supported,
            ignored: update.ignored,
            total: update.total,
            processed: update.processed,
            currentFile: update.currentFile,
            folderLabel: folderLabel || "Cartella selezionata"
          });
        }
      });

      if (assets.length === 0) {
        pushActivity("Nessuna immagine supportata trovata. Seleziona file JPG o PNG.");
        return;
      }

      const nextRequest = {
        ...request,
        sourceFolderPath: folderLabel || request.sourceFolderPath
      };
      const nextIds = assets.map((asset) => asset.id);

      // Track files for saving to IndexedDB later
      const fileMap = new Map<string, File>();
      files.forEach((file) => {
        const browserFile = file as BrowserFile;
        fileMap.set(browserFile.webkitRelativePath || file.name, file);
      });
      setCurrentSessionFiles(fileMap);

      cleanupTransientCurrentAssets();
      setAllAssets(assets);
      setActiveAssetIds(nextIds);
      setUsesMockData(false);
      setOutputDirectoryHandle(null);
      applyPlanningRequestWithAssets(nextRequest, assets, nextIds);
      pushActivity(`Caricate ${assets.length} immagini da ${folderLabel || "file selezionati"}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Impossibile importare i file selezionati.";
      pushActivity(message);
    } finally {
      setIsImporting(false);
      setImportProgressState(createInitialImportProgressState());
    }
  }

  function handleLoadMockData() {
    const nextRequest = {
      ...request,
      sourceFolderPath: DEFAULT_AUTO_LAYOUT_REQUEST.sourceFolderPath
    };
    const nextIds = mockWeddingAssets.map((asset) => asset.id);

    cleanupTransientCurrentAssets();
    setAllAssets(mockWeddingAssets);
    setActiveAssetIds(nextIds);
    setUsesMockData(true);
    setOutputDirectoryHandle(null);
    applyPlanningRequestWithAssets(nextRequest, mockWeddingAssets, nextIds);
    pushActivity("Campione reale matrimonio ripristinato.");
  }

  function persistCurrentProject() {
    if (!currentProjectId) {
      return;
    }

    const project = projects.find((item) => item.id === currentProjectId);
    if (!project) {
      return;
    }

    saveProject({
      ...project,
      request,
      result,
      catalogAssets: allAssets,
      assetCount: allAssets.length,
      pageCount: result.pages.length,
      updatedAt: Date.now()
    });
  }

  function renderStepSwitcher() {
    return <Stepper currentStep={currentScreen === "studio" ? "studio" : "setup"} canProceed={canOpenStudio} />;
  }

  function renderSetupScreen() {
    return (
      <>
        <header className="workspace__header">
          <div>
            <span className="workspace__eyebrow">Impaginazione Automatica</span>
            <h2>Il tuo progetto è pronto</h2>
            <p>
              Rivisa le impostazioni. Se tutto è ok, entra nello studio per modificare i layout a pieno schermo.
            </p>
          </div>
          <div className="workspace__header-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                persistCurrentProject();
                setCurrentScreen("dashboard");
              }}
              aria-label="Torna alla lista dei progetti"
            >
              Torna ai progetti
            </button>
          </div>
        </header>

        {renderStepSwitcher()}

        <div className="setup-cards-grid">
          {/* Card 1: Foto caricate */}
          <div className="setup-card">
            <div className="setup-card__header">
              <h3 className="setup-card__title">📁 Foto caricate</h3>
            </div>
            <div className="setup-card__content">
              <div className="setup-card__stat">
                <span className="setup-card__stat-value">{allAssets.length}</span>
                <span className="setup-card__stat-label">file</span>
              </div>
              <p className="setup-card__description">
                {activeAssetIds.length} di {allAssets.length} foto attive nel layout
              </p>
            </div>
            <div className="setup-card__actions">
              <button
                type="button"
                className="ghost-button ghost-button--small"
                onClick={() => setIsProjectSelectorOpen(true)}
                aria-label="Cambia selezione foto"
              >
                Cambia selezione
              </button>
            </div>
          </div>

          {/* Card 2: Formato foglio */}
          <div className="setup-card">
            <div className="setup-card__header">
              <h3 className="setup-card__title">📄 Formato foglio</h3>
            </div>
            <div className="setup-card__content">
              <div className="setup-card__stat">
                <span className="setup-card__stat-value">{request.sheet.label}</span>
              </div>
              <p className="setup-card__description">
                {request.sheet.widthCm} × {request.sheet.heightCm} cm
              </p>
            </div>
            <div className="setup-card__actions">
              <button
                type="button"
                className="ghost-button ghost-button--small"
                onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                aria-label="Cambia formato foglio"
              >
                Cambia formato
              </button>
            </div>
          </div>

          {/* Card 3: Modalità layout */}
          <div className="setup-card">
            <div className="setup-card__header">
              <h3 className="setup-card__title">⚙️ Distribuzione foto</h3>
            </div>
            <div className="setup-card__content">
              <div className="setup-card__stat">
                <span className="setup-card__stat-value">{result.pages.length}</span>
                <span className="setup-card__stat-label">fogli previsti</span>
              </div>
              <p className="setup-card__description">
                {request.planningMode === "desiredSheetCount"
                  ? `${request.desiredSheetCount} fogli desiderati`
                  : `${request.maxPhotosPerSheet} foto per foglio`}
              </p>
            </div>
            <div className="setup-card__actions">
              <button
                type="button"
                className="ghost-button ghost-button--small"
                onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                aria-label="Cambia modalità distribuzione"
              >
                Cambia modalità
              </button>
            </div>
          </div>
        </div>

        {/* Advanced Settings - collapsible */}
        {showAdvancedSettings && (
          <details className="collapsible-section" open>
            <summary className="collapsible-section__header">
              <span>⚙️ Impostazioni avanzate</span>
              <span className="collapsible-section__toggle" />
            </summary>
            <div className="setup-advanced-panel">
              <div className="workspace-grid">
                <div className="workspace-grid__main">
                  <PanelSection title="Sorgente foto" description="Gestisci cartelle e asset">
                    <InputPanel
                      sourceFolderPath={request.sourceFolderPath}
                      loadedImages={allAssets.length}
                      activeImages={activeAssetIds.length}
                      totalImages={result.summary.totalImages}
                      verticalCount={result.summary.verticalCount}
                      horizontalCount={result.summary.horizontalCount}
                      squareCount={result.summary.squareCount}
                      isImporting={isImporting}
                      usesMockData={usesMockData}
                      onSourceFolderChange={(value) =>
                        applyPlanningRequest({ ...request, sourceFolderPath: value })
                      }
                      onFolderSelected={handleFolderSelected}
                      onLoadMockData={handleLoadMockData}
                      onOpenSelector={() => setIsProjectSelectorOpen(true)}
                    />
                  </PanelSection>

                  <PanelSection title="Configurazione foglio" description="Personalizzazioni avanzate">
                    <SettingsPanel
                      request={request}
                      onSheetPresetChange={handleSheetPresetChange}
                      onSheetFieldChange={handleSheetFieldChange}
                      onFitModeChange={handleFitModeChange}
                      onPlanningModeChange={handlePlanningModeChange}
                      onDesiredSheetCountChange={handleDesiredSheetCountChange}
                      onMaxPhotosPerSheetChange={handleMaxPhotosPerSheetChange}
                      onAllowTemplateVariationChange={handleAllowTemplateVariationChange}
                    />
                  </PanelSection>
                </div>

                <div className="workspace-grid__side">
                  <PanelSection title={sections.result.title} description={sections.result.description}>
                    <ResultPanel result={result} />
                  </PanelSection>
                </div>
              </div>
            </div>
          </details>
        )}

        {/* Action footer */}
        <div className="setup-footer">
          <div className="setup-footer__left">
            <button
              type="button"
              className="secondary-button"
              onClick={createNewProject}
              aria-label="Crea un nuovo progetto da zero"
            >
              + Nuovo progetto
            </button>
          </div>
          <button
            type="button"
            className="primary-button setup-footer__action"
            disabled={!canOpenStudio}
            onClick={() => {
              persistCurrentProject();
              setCurrentScreen("studio");
            }}
            aria-label="Accedi allo studio layout per la modifica a schermo intero"
          >
            → Accedi allo Studio Layout
          </button>
          {!canOpenStudio && (
            <p className="setup-footer__help">Carica almeno una foto per continuare</p>
          )}
        </div>
      </>
    );
  }

  function renderStudioScreen() {
    return (
      <>
        <header className="studio-shell__header studio-shell__header--compact">
          <div className="studio-shell__summary">
            <p>
              {result.pages.length} fogli | {usedImagesCount} foto usate | {result.unassignedAssets.length} libere
            </p>
          </div>

          <div className="studio-shell__actions">
            <div className="studio-shell__toolbar">
              <button
                type="button"
                className="toolbar-button"
                disabled={!canUndo}
                onClick={undo}
                title="Annulla (Ctrl+Z)"
                aria-label="Annulla ultima modifica"
              >
                <UndoIcon />
              </button>
              <button
                type="button"
                className="toolbar-button"
                disabled={!canRedo}
                onClick={redo}
                title="Ripristina (Ctrl+Y)"
                aria-label="Ripristina modifica annullata"
              >
                <RedoIcon />
              </button>
              <div className="toolbar-separator" />
              <ZoomControls
                zoom={zoom}
                onZoomChange={handleZoomChange}
              />
              <div className="toolbar-separator" />
              <button
                type="button"
                className="toolbar-button"
                onClick={handleToggleFullscreen}
                title={isFullscreen ? "Esci da schermo intero" : "Schermo intero (F11)"}
                aria-label={isFullscreen ? "Esci da schermo intero" : "Attiva schermo intero"}
              >
                <FullscreenIcon active={isFullscreen} />
              </button>
            </div>

            <div className="studio-shell__main-actions">
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  persistCurrentProject();
                  setCurrentScreen("setup");
                }}
                aria-label="Torna al setup progetto"
              >
                Indietro a impostazioni
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setCurrentScreen("dashboard")}
                aria-label="Torna alla lista dei progetti"
              >
                Torna ai progetti
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={result.unassignedAssets.length === 0}
                onClick={handleCreatePageFromUnused}
                aria-label="Crea un nuovo foglio dalle foto non ancora usate"
              >
                Nuovo foglio dalle non usate
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={handleGenerate}
                disabled={isExporting || result.pages.length === 0}
                aria-label="Esporta i fogli di stampa generati"
              >
                {isExporting ? "Esportazione in corso..." : "Esporta"}
              </button>
            </div>
          </div>
        </header>

        <div className={`studio-shell__content ${isFullscreen ? 'studio-shell__content--fullscreen' : ''}`}>
          <div className="studio-shell__board">
            <LayoutPreviewBoard
              result={result}
              assets={result.request.assets}
              availableAssetsForPicker={allAssets}
              activeAssetIds={activeAssetIds}
              assetsById={assetsById}
              usageByAssetId={usageByAssetId}
              selectedPageId={selectedPageId}
              selectedSlotKey={selectedSlotKey}
              dragState={dragState}
              onSelectPage={handleSelectPage}
              onStartSlotDrag={handleStartSlotDrag}
              onDragAssetStart={handleDragAssetStart}
              onDragEnd={handleDragEnd}
              onDrop={handleDrop}
              onAssetDropped={handleAssetDropped}
              onAddToPage={handleAddImageToPage}
              onDropToUnused={handleDropToUnused}
              onClearSlot={handleClearSlot}
              onTemplateChange={handleTemplateChange}
              onApplyTemplateToPages={handleApplyTemplateToPages}
              onCreatePageFromUnused={handleCreatePageFromUnused}
              onCreatePageWithImage={handleCreatePageWithImage}
              onRemovePage={handleRemovePage}
              onRebalancePage={handleRebalancePage}
              onPageSheetPresetChange={handlePageSheetPresetChange}
              onPageSheetFieldChange={handlePageSheetFieldChange}
              onPageSheetStyleChange={handlePageSheetStyleChange}
              recentlyRebalancedPageId={recentlyRebalancedPageId}
              onAssetsMetadataChange={handleAssetsMetadataChange}
              onUpdateSlotAssignment={handleUpdateSelectedSlotAssignment}
              onContextMenu={handleContextMenu}
              zoom={zoom}
            />
          </div>
        </div>

        <section className="studio-dock">
          <div className="studio-dock__tabs">
            {([
              ["page", "Foglio"],
              ["output", "Output"],
              ["warnings", "Avvisi"],
              ["stats", "Statistiche"],
              ["activity", "Attivita"]
            ] as [StudioPanel, string][]).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={studioPanel === value ? "studio-dock__tab studio-dock__tab--active" : "studio-dock__tab"}
                onClick={() => setStudioPanel(value)}
                aria-label={`${label} ${studioPanel === value ? "tab attivo" : "tab"}`}
                aria-selected={studioPanel === value}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="studio-dock__panel">
            {studioPanel === "page" ? (
              <div className="studio-dock__grid">
                <div className="studio-summary-grid">
                  <div className="stat-card stat-card--highlight">
                    <span>Fogli</span>
                    <strong>{result.pages.length}</strong>
                  </div>
                  <div className="stat-card">
                    <span>Usate</span>
                    <strong>{usedImagesCount}</strong>
                  </div>
                  <div className="stat-card">
                    <span>Libere</span>
                    <strong>{result.unassignedAssets.length}</strong>
                  </div>
                  <div className="stat-card">
                    <span>DPI</span>
                    <strong>{request.sheet.dpi}</strong>
                  </div>
                </div>

                <div className="studio-dock__actions">
                  <button
                    type="button"
                    className="secondary-button studio-side__button"
                    disabled={result.unassignedAssets.length === 0}
                    onClick={handleCreatePageFromUnused}
                    aria-label="Aggiungi un nuovo foglio dalle foto non usate"
                  >
                    Aggiungi nuovo foglio
                  </button>
                  <button
                    type="button"
                    className="ghost-button studio-side__button"
                    disabled={!selectedPage}
                    onClick={() => {
                      if (selectedPage) {
                        handleRemovePage(selectedPage.id);
                      }
                    }}
                    aria-label={`Elimina il foglio ${selectedPage?.pageNumber || "selezionato"}`}
                  >
                    Elimina foglio attivo
                  </button>
                  <button
                    type="button"
                    className="ghost-button studio-side__button"
                    onClick={() => setCurrentScreen("setup")}
                    aria-label="Torna alla preparazione del progetto"
                  >
                    Torna alla preparazione
                  </button>
                </div>
              </div>
            ) : null}

            {studioPanel === "output" ? (
              <OutputPanel
                request={request}
                isExporting={isExporting}
                exportMessage={exportMessage}
                supportsDirectoryPicker={supportsDirectoryPicker}
                onOutputChange={updateOutput}
                onPickOutputFolder={handlePickOutputFolder}
                onGenerate={handleGenerate}
              />
            ) : null}

            {studioPanel === "activity" ? (
              <ul className="activity-log">
                {activityLog.map((entry, index) => (
                  <li key={`${entry}-${index}`}>{entry}</li>
                ))}
              </ul>
            ) : null}

            {studioPanel === "warnings" ? (
              <WarningsPanel
                pages={result.pages}
                onSelectPage={setSelectedPageId}
              />
            ) : null}

            {studioPanel === "stats" ? (
              <QuickStats
                result={result}
                allAssets={allAssets}
                usedImagesCount={usedImagesCount}
              />
            ) : null}
          </div>
        </section>

        {isProjectSelectorOpen ? (
          <ProjectPhotoSelectorModal
            assets={allAssets}
            activeAssetIds={activeAssetIds}
            usageByAssetId={usageByAssetId}
            onClose={() => setIsProjectSelectorOpen(false)}
            onApply={(nextIds, nextAssets) => {
              setAllAssets(nextAssets);
              if (sameStringArray(nextIds, activeAssetIds)) {
                syncCatalogAssets(nextAssets, nextIds);
              } else {
                setActiveAssetIds(nextIds);
                applyPlanningRequestWithAssets({ ...request }, nextAssets, nextIds);
              }
              setIsProjectSelectorOpen(false);
              pushActivity(`${nextIds.length} foto attivate per il progetto su ${nextAssets.length} caricate.`);
            }}
          />
        ) : null}

        {confirmState.isOpen ? (
          <ConfirmModal
            title="Elimina foglio"
            description={`Sei sicuro di voler eliminare il foglio ${confirmState.pageNumber}? Le foto al suo interno torneranno disponibili.`}
            confirmText="Elimina"
            isDangerous={true}
            onConfirm={confirmRemovePage}
            onCancel={() => setConfirmState({ isOpen: false, pageId: null, pageNumber: null })}
          />
        ) : null}

        <ExportProgressModal
          isOpen={exportProgressState.isOpen}
          status={exportProgressState.status}
          total={exportProgressState.total}
          completed={exportProgressState.completed}
          currentFile={exportProgressState.currentFile}
          currentPageNumber={exportProgressState.currentPageNumber}
          destinationLabel={exportProgressState.destinationLabel}
          exportedFiles={exportProgressState.exportedFiles}
          errorMessage={exportProgressState.errorMessage}
          canOpenFolder={canOpenSavedFolder}
          onClose={() =>
            setExportProgressState((current) =>
              current.status === "running" ? current : { ...current, isOpen: false }
            )
          }
          onOpenFolder={() => {
            setExportMessage(
              "Apri cartella sarà disponibile nella versione desktop exe. Nel browser i file vengono salvati ma non si può aprire Esplora file automaticamente."
            );
          }}
        />

        <PhotoQuickPreviewModal
          asset={quickPreviewAsset}
          assets={allAssets}
          usageByAssetId={usageByAssetId}
          pages={result.pages.map((page) => ({
            id: page.id,
            pageNumber: page.pageNumber,
            templateLabel: page.templateLabel
          }))}
          activePageId={selectedPageId}
          onClose={() => setQuickPreviewAssetId(null)}
          onSelectAsset={setQuickPreviewAssetId}
          onAddToPage={handleAddImageToPage}
          onJumpToPage={(pageId) => {
            const page = result.pages.find((item) => item.id === pageId);
            if (!page) {
              return;
            }
            setSelectedPageId(pageId);
            setSelectedSlotKey(page.slotDefinitions[0] ? `${page.id}:${page.slotDefinitions[0].id}` : null);
          }}
          onUpdateAsset={(assetId, changes) => {
            handleAssetsMetadataChange(new Map([[assetId, changes]]));
          }}
        />

        {contextMenu.isOpen ? (
          <ContextMenu
            position={contextMenu.position}
            items={contextMenu.items}
            onClose={() => setContextMenu({ isOpen: false, position: { x: 0, y: 0 }, items: [] })}
          />
        ) : null}

        <KeyboardShortcuts
          onUndo={undo}
          onRedo={redo}
          onDelete={handleDeleteSelected}
          onDuplicate={selectedPageId ? () => handleDuplicatePage(selectedPageId) : undefined}
          onFullscreen={handleToggleFullscreen}
          onEscape={() => {
            setQuickPreviewAssetId(null);
            setContextMenu({ isOpen: false, position: { x: 0, y: 0 }, items: [] });
          }}
        />
      </>
    );
  }

  return (
    <div
      className={
        currentScreen === "studio"
          ? "app-shell app-shell--studio"
          : currentScreen === "setup"
            ? "app-shell app-shell--with-sidebar"
            : "app-shell"
      }
    >
      {currentScreen === "setup" && (
        <Sidebar tools={TOOL_NAVIGATION} activeToolId="auto-layout" />
      )}

      <main className={currentScreen === "studio" ? "workspace workspace--studio" : "workspace"}>
        {currentScreen === "dashboard" ? (
          <ProjectDashboard
            projects={projects}
            onCreateNew={createNewProject}
            onOpenProject={openProject}
            onDeleteProject={deleteProject}
            onRenameProject={renameProject}
            onImportProject={importImportedProject}
          />
        ) : currentScreen === "setup" ? (
          renderSetupScreen()
        ) : (
          renderStudioScreen()
        )}
      </main>

      <OnboardingWizard
        isOpen={showOnboardingWizard}
        isLoading={isPlanningPending}
        onClose={() => setShowOnboardingWizard(false)}
        onComplete={handleWizardComplete}
        currentRequest={request}
        onAssetsChange={(nextAssets) => {
          setAllAssets(nextAssets);
          setRequest((current) => ({ ...current, assets: nextAssets }));
        }}
        onFolderSelected={handleFolderSelected}
        onLoadMockData={handleLoadMockData}
      />

      <ImportProgressModal
        isOpen={isImporting}
        phase={importProgressState.phase}
        supported={importProgressState.supported}
        ignored={importProgressState.ignored}
        total={importProgressState.total}
        processed={importProgressState.processed}
        currentFile={importProgressState.currentFile}
        folderLabel={importProgressState.folderLabel}
      />
    </div>
  );
}

export function App() {
  const initialResult = createAutoLayoutPlan(buildInitialRequest());

  return (
    <ErrorBoundary>
      <HistoryProvider initialResult={initialResult}>
        <AppContent />
      </HistoryProvider>
    </ErrorBoundary>
  );
}

