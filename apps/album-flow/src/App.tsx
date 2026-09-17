import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { DesktopPhotoToolHandoff } from "@photo-tools/desktop-contracts";
import type { AlbumAsset, AlbumChapter, AlbumProject, SheetSpec } from "@photo-tools/shared-types";
import { createAutoLayoutPlan } from "@photo-tools/core";
import { addChapter, setChapterMembership } from "./chapters";
import { validateAlbumPreflight } from "./preflight";
import { serializeAlbumProject } from "./project-portability";
import { parseAlbumProject } from "./project-portability";
import { renderSpreadSvg } from "./spread-renderer";
import { resolveAlbumAssetPath } from "./relink";

const SHEET: SheetSpec = {
  presetId: "album-default",
  label: "Album 30 × 30",
  widthCm: 30,
  heightCm: 30,
  dpi: 300,
  marginCm: 1.5,
  gapCm: 0.35,
  bleedCm: 0.3,
  backgroundColor: "#f7f3ed",
};

const SHEET_FORMAT_OPTIONS = [
  { value: "album-default", label: "Album 30 × 30", sheet: SHEET },
  {
    value: "square-25",
    label: "Quadrato 25 × 25",
    sheet: { ...SHEET, presetId: "square-25", label: "Quadrato 25 × 25", widthCm: 25, heightCm: 25 },
  },
  {
    value: "landscape-30",
    label: "Orizzontale 30 × 20",
    sheet: { ...SHEET, presetId: "landscape-30", label: "Orizzontale 30 × 20", widthCm: 30, heightCm: 20 },
  },
] as const;

const CUSTOM_SHEET_PRESET_ID = "__custom__";

type FlowMode = "auto" | "manual";

type ProjectSetupMap = Record<string, boolean>;

const PROJECTS_STORAGE_KEY = "filex.albumFlow.projects";
const PROJECTS_STORAGE_TEMP_KEY = "filex.albumFlow.projects.pending";
const ACTIVE_PROJECT_KEY = "filex.albumFlow.activeProjectId";
const PROJECT_SETUP_KEY = "filex.albumFlow.projectSetupCompleted";

function loadProjects(): AlbumProject[] {
  try {
    const raw = localStorage.getItem(PROJECTS_STORAGE_TEMP_KEY) ?? localStorage.getItem(PROJECTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // A valid pending snapshot is promoted after a crash during the final commit.
    if (localStorage.getItem(PROJECTS_STORAGE_TEMP_KEY)) localStorage.setItem(PROJECTS_STORAGE_KEY, raw);
    localStorage.removeItem(PROJECTS_STORAGE_TEMP_KEY);
    return parsed as AlbumProject[];
  } catch {
    return [];
  }
}

function loadActiveProjectId(): string | null {
  return localStorage.getItem(ACTIVE_PROJECT_KEY);
}

function loadSetupMap(): ProjectSetupMap {
  try {
    const raw = localStorage.getItem(PROJECT_SETUP_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as ProjectSetupMap;
  } catch {
    return {};
  }
}

function saveProjects(projects: AlbumProject[]) {
  const serialized = JSON.stringify(projects);
  localStorage.setItem(PROJECTS_STORAGE_TEMP_KEY, serialized);
  localStorage.setItem(PROJECTS_STORAGE_KEY, serialized);
  localStorage.removeItem(PROJECTS_STORAGE_TEMP_KEY);
}

function saveSetupMap(setupMap: ProjectSetupMap) {
  localStorage.setItem(PROJECT_SETUP_KEY, JSON.stringify(setupMap));
}

function createEmptyProject(projectName = "Nuovo album"): AlbumProject {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    projectId: `album-${Date.now()}`,
    projectName,
    sourceFolderPath: "",
    createdAt: now,
    updatedAt: now,
    assets: [],
    labels: [],
    chapters: [],
    pages: [],
    settings: {
      sheet: SHEET,
      defaultFitMode: "fill",
      cropStrategy: "balanced",
      outputFormat: "jpg",
    },
  };
}

function setupProjectFromHandoff(handoff: DesktopPhotoToolHandoff): AlbumProject {
  const manifest = handoff.albumFlow;
  if (!manifest) throw new Error("Il passaggio ricevuto non contiene dati Album Flow.");

  const now = new Date().toISOString();
  const labels = manifest.labels.map((label) => ({
    ...label,
    source: label.source as "selector-custom" | "selector-color" | "album",
  }));

  const assets: AlbumAsset[] = manifest.assets.map((asset) => ({
    ...asset,
    id: asset.assetId,
    path: asset.relativePath,
    selected: asset.selected,
    selectionOrder: asset.selectionOrder,
    labelIds: [...asset.labelIds],
    rotationDegrees: asset.rotationDegrees as AlbumAsset["rotationDegrees"],
  }));

  const chapters: AlbumChapter[] = labels
    .filter((label) => label.source === "selector-custom")
    .map((label) => ({
      id: `chapter-${label.id}`,
      title: label.name,
      labelIds: [label.id],
      orderedAssetIds: assets
        .filter((asset) => asset.labelIds.includes(label.id) && asset.selected)
        .sort((a, b) => a.selectionOrder - b.selectionOrder)
        .map((asset) => asset.id),
      source: "selector-label",
    }));

  return {
    schemaVersion: 1,
    projectId: manifest.projectId,
    projectName: manifest.projectName,
    sourceFolderPath: manifest.sourceRoot,
    createdAt: now,
    updatedAt: now,
    selectorRevision: manifest.selectorRevision,
    assets,
    labels,
    chapters,
    pages: [],
    settings: {
      sheet: SHEET,
      defaultFitMode: "fill",
      cropStrategy: "balanced",
      outputFormat: "jpg",
    },
  };
}

function formatMeta(value: number | undefined, suffix: string, digits = 1) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)} ${suffix}`;
}

function previewFromAssetPath(asset: AlbumAsset): string | undefined {
  // La libreria deve mostrare l'intero fotogramma: la preview ha priorità sulla thumbnail.
  return asset.previewUrl ?? asset.thumbnailUrl ?? asset.path;
}

function projectSelectedCount(project: AlbumProject) {
  return project.assets.filter((asset) => asset.selected).length;
}

function AssetThumbnail({ asset }: { asset: AlbumAsset }) {
  const [src, setSrc] = useState<string>(previewFromAssetPath(asset) ?? "");

  useEffect(() => {
    let previewObjectUrl: string | null = null;
    const absolutePath = (asset as AlbumAsset & { absolutePath?: string }).absolutePath;
    if (!absolutePath || !window.filexDesktop?.getPreview) return;

    void window.filexDesktop
      .getPreview(absolutePath, { maxDimension: 420 })
      .then((image) => {
        if (!image) return;
        previewObjectUrl = URL.createObjectURL(new Blob([new Uint8Array(image.bytes)], { type: image.mimeType }));
        setSrc(previewObjectUrl);
      })
      .catch(() => undefined);

    return () => {
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    };
  }, [asset]);

  const shapeIcon = asset.orientation === "vertical" ? "▯" : "▭";
  return src ? <img src={src} alt={asset.fileName} loading="lazy" onError={() => setSrc("")} /> : <span>{shapeIcon}</span>;
}

function ProjectMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="meta-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function App() {
  const [projects, setProjects] = useState<AlbumProject[]>(() => loadProjects());
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => loadActiveProjectId());
  const [projectSetupCompleted, setProjectSetupCompleted] = useState<ProjectSetupMap>(() => loadSetupMap());
  const [mode, setMode] = useState<FlowMode>("auto");
  const [chapterTitle, setChapterTitle] = useState("");
  const [previewPageIndex, setPreviewPageIndex] = useState(0);
  const [status, setStatus] = useState("In attesa di una selezione dal Photo Selector o di un nuovo progetto.");
  const [sheetPreset, setSheetPreset] = useState<string>(SHEET_FORMAT_OPTIONS[0].value);
  const [margins, setMargins] = useState("1.5");
  const [gaps, setGaps] = useState("0.35");
  const [customWidth, setCustomWidth] = useState(SHEET.widthCm.toString());
  const [customHeight, setCustomHeight] = useState(SHEET.heightCm.toString());
  const [importTargetProjectId, setImportTargetProjectId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);

  const activeProject = useMemo(
    () => projects.find((project) => project.projectId === activeProjectId) ?? null,
    [activeProjectId, projects],
  );

  const selectedAssets = useMemo(
    () =>
      activeProject ?
      activeProject.assets.filter((asset) => asset.selected).sort((a, b) => a.selectionOrder - b.selectionOrder)
      : [],
    [activeProject],
  );

  const activeIsSetup = useMemo(
    () => (activeProject ? Boolean(projectSetupCompleted[activeProject.projectId]) : false),
    [activeProject, projectSetupCompleted],
  );

  useEffect(() => {
    saveProjects(projects);
  }, [projects]);

  useEffect(() => {
    if (activeProjectId) {
      localStorage.setItem(ACTIVE_PROJECT_KEY, activeProjectId);
    } else {
      localStorage.removeItem(ACTIVE_PROJECT_KEY);
    }
  }, [activeProjectId]);

  useEffect(() => {
    saveSetupMap(projectSetupCompleted);
  }, [projectSetupCompleted]);

  useEffect(() => {
    if (!activeProject) return;
    const sheet = activeProject.settings.sheet;
    const matchingPreset = SHEET_FORMAT_OPTIONS.find((option) => option.value === sheet.presetId);
    setSheetPreset(matchingPreset ? sheet.presetId : CUSTOM_SHEET_PRESET_ID);
    setCustomWidth(sheet.widthCm.toString());
    setCustomHeight(sheet.heightCm.toString());
    setMargins(sheet.marginCm.toString());
    setGaps(sheet.gapCm.toString());
  }, [activeProject?.projectId]);

  useEffect(() => {
    const api = window.filexDesktop;
    if (!api?.consumePendingOpenProjectPath || !api.consumePhotoSelectionHandoff || !api.markOpenProjectRequestReady || !api.onOpenProjectRequest) {
      return;
    }

    let active = true;

    const applyIncomingProject = (incoming: AlbumProject) => {
      setProjects((current) => {
        const existingIndex = current.findIndex((project) => project.projectId === incoming.projectId);
        if (existingIndex >= 0) {
          const next = [...current];
          next[existingIndex] = incoming;
          return next;
        }
        return [incoming, ...current];
      });
      setActiveProjectId(incoming.projectId);
      setProjectSetupCompleted((current) => ({ ...current, [incoming.projectId]: true }));
      setStatus(`${incoming.assets.filter((asset) => asset.selected).length} foto ricevute dal Photo Selector e allineate al progetto.`);
    };

    const consume = async (path: string) => {
      try {
        const handoff = await api.consumePhotoSelectionHandoff!(path);
        if (active && handoff) {
          const next = setupProjectFromHandoff(handoff);
          applyIncomingProject(next);
        }
      } catch (error) {
        if (active) setStatus(error instanceof Error ? error.message : "Importazione da Photo Selector non riuscita.");
      } finally {
        await api.acknowledgeOpenProjectRequest?.(path).catch(() => undefined);
      }
    };

    const drain = async () => {
      const path = await api.consumePendingOpenProjectPath!();
      if (path) await consume(path);
    };

    const remove = api.onOpenProjectRequest(() => {
      void drain();
    });

    void api.markOpenProjectRequestReady().then(drain);
    return () => {
      active = false;
      remove();
    };
  }, []);

  useEffect(() => {
    if (!activeProject) return;
    const marginValue = Number.parseFloat(margins);
    const gapValue = Number.parseFloat(gaps);
    if (Number.isNaN(marginValue) || Number.isNaN(gapValue)) return;

    const currentSheet = activeProject.settings.sheet;
    if (currentSheet.marginCm === marginValue && currentSheet.gapCm === gapValue) return;

    const updated: AlbumProject = {
      ...activeProject,
      updatedAt: new Date().toISOString(),
      settings: {
        ...activeProject.settings,
        sheet: {
          ...currentSheet,
          marginCm: marginValue,
          gapCm: gapValue,
        },
      },
    };

    setProjects((current) => {
      return current.map((project) => (project.projectId === activeProject.projectId ? updated : project));
    });
  }, [activeProject?.projectId, gaps, margins]);

  function createProject(projectName?: string) {
    const project = createEmptyProject(projectName);
    setProjects((current) => [project, ...current]);
    setActiveProjectId(project.projectId);
    setProjectSetupCompleted((current) => ({ ...current, [project.projectId]: false }));
    return project;
  }

  function createChapter() {
    if (!activeProject) return;
    if (!chapterTitle.trim()) return;
    setProjects(current => current.map(project => project.projectId === activeProject.projectId
      ? addChapter(project, chapterTitle, crypto.randomUUID()) : project));
    setChapterTitle("");
  }

  function deleteProject(projectId: string) {
    setProjects((current) => current.filter((project) => project.projectId !== projectId));
    setProjectSetupCompleted((current) => {
      const next = { ...current };
      delete next[projectId];
      return next;
    });
    if (activeProjectId === projectId) {
      setActiveProjectId(null);
      setStatus("Progetto eliminato. Scegli un altro progetto o creane uno nuovo.");
    }
  }

  function openProject(projectId: string) {
    setActiveProjectId(projectId);
    setStatus("Progetto caricato.");
  }

  function prepareImport(targetProjectId: string) {
    setImportTargetProjectId(targetProjectId);
    fileInputRef.current?.click();
  }

  function onLocalFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    if (!event.target.files?.length) {
      setImportTargetProjectId(null);
      event.target.value = "";
      return;
    }

    const files = event.target.files;
    const targetProjectId = importTargetProjectId ?? activeProjectId;
    let resolvedProjectId = targetProjectId;

    if (!resolvedProjectId) {
      const newProject = createProject("Album importato manuale");
      resolvedProjectId = newProject.projectId;
    }

    const imported: AlbumAsset[] = Array.from(files).map((file, index) => {
      const id = `local-${Date.now()}-${index}-${file.name}`;
      return {
        id,
        assetId: id,
        fileName: file.name,
        path: URL.createObjectURL(file),
        relativePath: file.name,
        absolutePath: file.name,
        selected: true,
        selectionOrder: index,
        labelIds: [],
        rating: 0,
        pickStatus: "none",
        colorLabel: "none",
        customLabels: [],
        rotationDegrees: 0,
        orientation: "unknown",
        width: 0,
        height: 0,
        aspectRatio: 1,
        fileSizeBytes: file.size,
      } as unknown as AlbumAsset;
    });

    setProjects((current) =>
      current.map((project) => {
        if (project.projectId !== resolvedProjectId) return project;
        const startingOrder = project.assets.filter((asset) => asset.selected).length;
        return {
          ...project,
          updatedAt: new Date().toISOString(),
          assets: [...project.assets, ...imported.map((asset, index) => ({ ...asset, selectionOrder: startingOrder + index }))],
        };
      }),
    );
    setActiveProjectId(resolvedProjectId);
    setProjectSetupCompleted((current) => ({ ...current, [resolvedProjectId]: true }));
    setStatus(`${imported.length} foto importate nel progetto.`);
    setImportTargetProjectId(null);
    event.target.value = "";
  }

  function confirmSetup(event: FormEvent<HTMLFormElement>) {
    if (!activeProject) return;
    event.preventDefault();

    const marginValue = Number.parseFloat(margins);
    const gapValue = Number.parseFloat(gaps);
    const selectedFormat = SHEET_FORMAT_OPTIONS.find((option) => option.value === sheetPreset);
    const widthValue = Number.parseFloat(customWidth);
    const heightValue = Number.parseFloat(customHeight);
    const hasCustomSize = Number.isFinite(widthValue) && Number.isFinite(heightValue) && widthValue > 0 && heightValue > 0;

    const nextSheet = selectedFormat?.sheet ?? {
      ...(sheetPreset === CUSTOM_SHEET_PRESET_ID ? SHEET : SHEET_FORMAT_OPTIONS[0].sheet),
      presetId: CUSTOM_SHEET_PRESET_ID,
      label: `Personalizzato ${hasCustomSize ? `${widthValue} × ${heightValue} cm` : "—"}`,
      widthCm: hasCustomSize ? widthValue : SHEET.widthCm,
      heightCm: hasCustomSize ? heightValue : SHEET.heightCm,
    };

    const next: AlbumProject = {
      ...activeProject,
      updatedAt: new Date().toISOString(),
      settings: {
        ...activeProject.settings,
        sheet: {
          ...nextSheet,
          marginCm: Number.isNaN(marginValue) ? activeProject.settings.sheet.marginCm : marginValue,
          gapCm: Number.isNaN(gapValue) ? activeProject.settings.sheet.gapCm : gapValue,
        },
      },
    };

    setProjects((current) => current.map((project) => (project.projectId === activeProject.projectId ? next : project)));
    setProjectSetupCompleted((current) => ({ ...current, [activeProject.projectId]: true }));
    setStatus(mode === "auto" ? "Configurazione completata. Genera la bozza automatica." : "Configurazione completata. Apri l’editor manuale.");
  }

  function generateDraft() {
    if (!activeProject) return;

    if (mode === "manual") {
      setStatus("Modalità manuale selezionata: entra in editor pagina per pagina.");
      return;
    }

    if (!selectedAssets.length) return;
    const preflightErrors = validateAlbumPreflight(activeProject);
    if (preflightErrors.some(error => error !== "Nessuna pagina generata.")) {
      setStatus(`Preflight non superato: ${preflightErrors.join(" ")}`);
      return;
    }

    const result = createAutoLayoutPlan({
      jobName: activeProject.projectName,
      sourceFolderPath: activeProject.sourceFolderPath,
      assets: selectedAssets,
      workflowMode: "auto",
      sheet: activeProject.settings.sheet,
      fitMode: activeProject.settings.defaultFitMode,
      cropStrategy: activeProject.settings.cropStrategy,
      planningMode: "maxPhotosPerSheet",
      maxPhotosPerSheet: 4,
      output: {
        folderPath: activeProject.sourceFolderPath,
        format: activeProject.settings.outputFormat,
        fileNamePattern: "album-{page}",
        quality: 92,
      },
      allowTemplateVariation: true,
    });

    const next: AlbumProject = {
      ...activeProject,
      updatedAt: new Date().toISOString(),
      pages: result.pages,
      availableTemplates: result.availableTemplates,
    };

    setProjects((current) => current.map((project) => (project.projectId === activeProject.projectId ? next : project)));
    setPreviewPageIndex(0);
    setStatus(`${result.pages.length} pagine generate. Ogni pagina resta modificabile.`);
  }

  function exportProject() {
    if (!activeProject) return;
    const blob = new Blob([serializeAlbumProject(activeProject)], { type: "application/json" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob);
    link.download = `${activeProject.projectName.replace(/[^\w-]+/g, "-")}.filex-album.json`; link.click(); URL.revokeObjectURL(link.href);
    setStatus("Progetto esportato in formato FileX Album.");
  }

  function exportFirstSpread() {
    if (!activeProject?.pages.length) { setStatus("Genera prima una bozza."); return; }
    try {
    const page = activeProject.pages[Math.min(previewPageIndex, activeProject.pages.length - 1)];
    const blob = new Blob([renderSpreadSvg(page, activeProject.assets)], { type: "image/svg+xml" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob);
    link.download = `${activeProject.projectName.replace(/[^\w-]+/g, "-")}-pagina-${page.pageNumber}.svg`; link.click(); URL.revokeObjectURL(link.href);
    setStatus(`Pagina ${page.pageNumber} esportata in SVG.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Esportazione SVG non riuscita.");
    }
  }

  function exportAllSpreads() {
    if (!activeProject?.pages.length) { setStatus("Genera prima una bozza."); return; }
    const prefix = activeProject.projectName.replace(/[^\w-]+/g, "-");
    for (const page of activeProject.pages) {
      const blob = new Blob([renderSpreadSvg(page, activeProject.assets)], { type: "image/svg+xml" });
      const link = document.createElement("a"); link.href = URL.createObjectURL(blob);
      link.download = `${prefix}-pagina-${page.pageNumber}.svg`; link.click(); URL.revokeObjectURL(link.href);
    }
    setStatus(`${activeProject.pages.length} pagine esportate in SVG.`);
  }

  function checkAssetLinks() {
    if (!activeProject) return;
    let missing = 0;
    for (const asset of activeProject.assets) {
      try { resolveAlbumAssetPath(activeProject.sourceFolderPath, asset.path); } catch { missing += 1; }
    }
    setStatus(missing ? `${missing} percorsi foto da ricollegare.` : "Tutti i percorsi delle foto sono validi.");
  }

  async function importProjectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const project = parseAlbumProject(await file.text());
      setProjects(current => [project, ...current.filter(item => item.projectId !== project.projectId)]);
      setProjectSetupCompleted(current => ({ ...current, [project.projectId]: project.pages.length > 0 }));
      setActiveProjectId(project.projectId);
      setStatus("Progetto importato correttamente.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Impossibile importare il progetto.");
    }
  }

  if (!activeProject) {
    const projectColumns = [
      { key: "pending", label: "In attesa", projects: projects.filter((project) => !projectSetupCompleted[project.projectId]) },
      { key: "editing", label: "In modifica", projects: projects.filter((project) => projectSetupCompleted[project.projectId] && project.pages.length === 0) },
      { key: "proofing", label: "In revisione", projects: projects.filter((project) => project.pages.length > 0 && project.pages.length < 3) },
      { key: "complete", label: "Completati", projects: projects.filter((project) => project.pages.length >= 3) },
    ];
    return (
      <main className="album-app home">
        <header className="topbar">
          <div>
            <p className="eyebrow">FILEX · ALBUM FLOW</p>
            <h1>I miei progetti</h1>
            <p>Inizia da zero, da Photo Selector o da un import rapido.</p>
          </div>
          <div className="status-chip">{projects.length} progetti attivi</div>
        </header>

        <section className="home-banner panel">
          <div className="home-banner-copy">
            <h2>Flusso consigliato</h2>
            <p>Foto dal Photo Selector: import automatico e allineato al progetto. Manuale: importa da disco e costruisci quando vuoi.</p>
          </div>
          <div className="home-stats">
            <ProjectMeta label="Totale progetti" value={projects.length.toString()} />
            <ProjectMeta
              label="Totale foto"
              value={projects.reduce((count, project) => count + project.assets.length, 0).toString()}
            />
            <ProjectMeta label="Progetti con bozza" value={projects.filter((project) => project.pages.length > 0).length.toString()} />
          </div>
          <div className="home-actions">
            <button type="button" onClick={() => createProject("Nuovo album")}>
              Nuovo progetto
            </button>
            <button type="button" className="secondary" onClick={() => projectInputRef.current?.click()}>Importa progetto</button>
            <button
              type="button"
              onClick={() => {
                const project = createProject("Nuovo album (import manuale)");
                prepareImport(project.projectId);
              }}
            >
              Importa foto e crea progetto
            </button>
          </div>
        </section>

        <section className="project-columns">
          {projects.length ? projectColumns.map((column) => (
            <div className="project-column" key={column.key}>
              <div className="column-heading"><h2>{column.label}</h2><span>{column.projects.length}</span></div>
              <div className="project-grid">
            {column.projects.map((project) => {
              const cover = project.assets.find((asset) => asset.selected) || project.assets[0];
              const selectedCount = projectSelectedCount(project);
              const isConfigured = Boolean(projectSetupCompleted[project.projectId]);
              return (
                <article className="project-card" key={project.projectId}>
                  <div className="project-cover">{cover ? <AssetThumbnail asset={cover} /> : <div className="thumb-placeholder">Senza immagini</div>}</div>
                  <div className="project-head">
                    <h3>{project.projectName}</h3>
                    <span className={`project-badge ${isConfigured ? "ready" : "draft"}`}>{isConfigured ? "Config. completata" : "Da impostare"}</span>
                  </div>
                  <p>
                    {selectedCount} foto
                    <br />
                    {project.chapters.length} capitoli • {project.pages.length} pagine
                  </p>
                  <div className="project-meta">
                    <span>Ultimo aggiornamento</span>
                    <strong>{new Date(project.updatedAt).toLocaleDateString("it-IT")}</strong>
                  </div>
                  <div className="project-actions">
                    <button type="button" onClick={() => openProject(project.projectId)}>
                      Apri progetto
                    </button>
                    <button type="button" onClick={() => prepareImport(project.projectId)}>
                      Importa foto
                    </button>
                    <button type="button" onClick={() => deleteProject(project.projectId)}>
                      Elimina
                    </button>
                  </div>
                </article>
              );
            })}
              </div>
            </div>
          )) : (
            <article className="project-card project-empty-card">
              <h2>Nessun progetto</h2>
              <p>Puoi creare subito un album o attendere un invio dal Photo Selector.</p>
              <button type="button" onClick={() => createProject("Nuovo album")}>
                Crea progetto vuoto
              </button>
            </article>
          )}
        </section>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={onLocalFilesSelected}
          style={{ display: "none" }}
        />
        <input ref={projectInputRef} type="file" accept=".json,application/json" onChange={importProjectFile} style={{ display: "none" }} />
      </main>
    );
  }

  if (!activeIsSetup) {
    return (
      <main className="album-app setup-flow">
        <div className="surface panel">
          <p className="eyebrow">FILEX · ALBUM FLOW</p>
          <h1>Configura il fotolibro</h1>
          <p>Prima di impaginare, scegli formato, margine, abbondanza e modalità.</p>
          <form className="setup-card" onSubmit={confirmSetup}>
            <label>
              <span>Formato pagina</span>
              <select
                value={sheetPreset}
                onChange={(event) => {
                  const nextPreset = event.target.value;
                  setSheetPreset(nextPreset);
                  if (nextPreset !== CUSTOM_SHEET_PRESET_ID) {
                    const nextFormat = SHEET_FORMAT_OPTIONS.find((option) => option.value === nextPreset);
                    if (nextFormat) {
                      setCustomWidth(nextFormat.sheet.widthCm.toString());
                      setCustomHeight(nextFormat.sheet.heightCm.toString());
                    }
                  }
                }}
              >
                {SHEET_FORMAT_OPTIONS.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
                <option value={CUSTOM_SHEET_PRESET_ID}>Formato personalizzato</option>
              </select>
            </label>
            {sheetPreset === CUSTOM_SHEET_PRESET_ID ? (
              <>
                <label>
                  <span>Larghezza (cm)</span>
                  <div className="inline-field">
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={customWidth}
                      onChange={(event) => setCustomWidth(event.target.value)}
                    />
                    <small>cm</small>
                  </div>
                </label>
                <label>
                  <span>Altezza (cm)</span>
                  <div className="inline-field">
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={customHeight}
                      onChange={(event) => setCustomHeight(event.target.value)}
                    />
                    <small>cm</small>
                  </div>
                </label>
              </>
            ) : null}
            <label>
              <span>Margine interno</span>
              <div className="inline-field">
                <input type="number" min="0" step="0.1" value={margins} onChange={(event) => setMargins(event.target.value)} />
                <small>cm</small>
              </div>
            </label>
            <label>
              <span>Abbondanza</span>
              <div className="inline-field">
                <input type="number" min="0" step="0.1" value={gaps} onChange={(event) => setGaps(event.target.value)} />
                <small>cm</small>
              </div>
            </label>
            <fieldset>
              <legend>Modalità di lavoro</legend>
              <label>
                <input type="radio" checked={mode === "auto"} onChange={() => setMode("auto")} />
                Auto — genera una bozza iniziale, con editing manuale disponibile
              </label>
              <label>
                <input type="radio" checked={mode === "manual"} onChange={() => setMode("manual")} />
                Manuale — parte libera con impaginazione pagina per pagina
              </label>
            </fieldset>
            <button type="submit">Salva impostazioni e continua</button>
          </form>
        </div>
      </main>
    );
  }

  const selectedCount = selectedAssets.length;
  const chapterCount = activeProject.chapters.length;
  const pageCount = activeProject.pages.length;
  const sheet = activeProject.settings.sheet;
  const currentSheetLabel = SHEET_FORMAT_OPTIONS.find((option) => option.value === sheet.presetId)?.label || "Formato personalizzato";

  return (
    <main className="album-app">
      <header className="topbar">
        <div>
          <p className="eyebrow">FILEX · ALBUM FLOW</p>
          <h1>{activeProject.projectName}</h1>
          <p>{status}</p>
        </div>
        <div className="status-chip">Aggiornato {new Date(activeProject.updatedAt).toLocaleDateString("it-IT")}</div>
      </header>

      <section className="control-band">
        <button type="button" onClick={() => setActiveProjectId(null)}>
          Torna ai progetti
        </button>
        <button type="button" onClick={() => prepareImport(activeProject.projectId)}>
          Importa foto
        </button>
        <button type="button" className="secondary" onClick={exportProject}>Esporta progetto</button>
        <button type="button" className="secondary" onClick={exportFirstSpread} disabled={!activeProject.pages.length}>Esporta pagina SVG</button>
        <button type="button" className="secondary" onClick={exportAllSpreads} disabled={!activeProject.pages.length}>Esporta tutte le pagine</button>
        <button type="button" className="secondary" onClick={checkAssetLinks} disabled={!activeProject.assets.length}>Verifica percorsi foto</button>
        <button type="button" onClick={generateDraft} disabled={!selectedCount || mode !== "auto"}>
          Genera bozza
        </button>

        {mode === "manual" ? (
          <button type="button" onClick={() => setStatus("Modalità manuale attiva: editor pronto per la modifica pagina per pagina.")}>
            Apri editor manuale
          </button>
        ) : null}

        <div className="selection-mode">
          <span>Modalità</span>
          <label>
            <input type="radio" checked={mode === "auto"} onChange={() => setMode("auto")} />
            Auto
          </label>
          <label>
            <input type="radio" checked={mode === "manual"} onChange={() => setMode("manual")} />
            Manuale
          </label>
        </div>
      </section>

      <section className="workspace">
        <aside className="panel side-panel">
          <h2>Impostazioni fotolibro</h2>
          <div className="kv">Formato</div>
          <div>{currentSheetLabel}</div>
          <div className="kv">Dimensioni</div>
          <div>
            {formatMeta(sheet.widthCm, "cm")} × {formatMeta(sheet.heightCm, "cm")}
          </div>
          <div className="kv">Margini</div>
          <div>{formatMeta(sheet.marginCm, "cm")}</div>
          <div className="kv">Abbondanza</div>
          <div>{formatMeta(sheet.gapCm, "cm")}</div>
          <hr />
          <h2>Riepilogo progetto</h2>
          <ul>
            <li>
              <strong>{selectedCount}</strong>
              <span>foto selezionate</span>
            </li>
            <li>
              <strong>{chapterCount}</strong>
              <span>capitoli</span>
            </li>
            <li>
              <strong>{pageCount}</strong>
              <span>pagine in bozza</span>
            </li>
          </ul>
          <hr />
          <h2>Capitoli</h2>
          <form onSubmit={event => { event.preventDefault(); createChapter(); }}>
            <label>Nome del capitolo<input value={chapterTitle} onChange={event => setChapterTitle(event.target.value)} /></label>
            <button type="submit" className="secondary chapter-add" disabled={!chapterTitle.trim()}>+ Nuovo capitolo</button>
          </form>
          <div className="chapter-list">
            {activeProject.chapters.length ? (
              activeProject.chapters.map((chapter) => (
                <article className="chapter" key={chapter.id}>
                  <b>{chapter.title}</b>
                  <span>{chapter.orderedAssetIds.length} foto</span>
                </article>
              ))
            ) : (
              <p className="muted">Le etichette personalizzate di Image Select Pro diventano capitoli quando presenti.</p>
            )}
          </div>
        </aside>

        <section className="panel gallery-panel">
          <div className="panel-head">
            <h2>Libreria progetto</h2>
            <span>
              {selectedCount} / {activeProject.assets.length} immagini selezionate
            </span>
          </div>
          {activeProject.pages.length > 0 && <section className="draft-preview">
            <div className="panel-head"><h2>Anteprima bozza</h2><span>{activeProject.pages.length} pagine</span></div>
            <div className="spread-list">
              {activeProject.pages.map((page, index) => <article className={`spread ${index === previewPageIndex ? "active" : ""}`} key={page.id} onClick={() => setPreviewPageIndex(index)}>
                <header><b>Pagina {page.pageNumber}</b><small>{page.templateLabel}</small></header>
                <div className="spread-canvas">
                  {page.assignments.map(assignment => {
                    const asset = activeProject.assets.find(item => item.id === assignment.imageId);
                    return asset ? <div className="spread-photo" key={assignment.slotId}><AssetThumbnail asset={asset} /></div> : null;
                  })}
                </div>
              </article>)}
            </div>
          </section>}
          <div className="grid">
            {selectedAssets.slice(0, 120).map((asset) => (
              <article className="thumb-card" key={asset.id}>
                <div className="thumb">
                  <AssetThumbnail asset={asset} />
                </div>
                <b>{asset.fileName}</b>
                <small>
                  {asset.rating ? `★ ${asset.rating}` : "senza valutazione"}
                  {asset.customLabels?.length ? ` · ${asset.customLabels.join(", ")}` : ""}
                </small>
                {activeProject.chapters.length > 0 && <details>
                  <summary>Assegna ai capitoli</summary>
                  {activeProject.chapters.map(chapter => <label key={chapter.id}>
                    <input type="checkbox" checked={chapter.orderedAssetIds.includes(asset.id)}
                      onChange={event => {
                        const included = event.target.checked;
                        setProjects(current => current.map(project => project.projectId === activeProject.projectId
                          ? setChapterMembership(project, chapter.id, asset.id, included) : project));
                      }} />{chapter.title}
                  </label>)}
                </details>}
              </article>
            ))}
            {selectedCount === 0 ? <p className="muted">Inizia importando foto nel progetto.</p> : null}
          </div>
        </section>
      </section>

      <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={onLocalFilesSelected} style={{ display: "none" }} />
    </main>
  );
}
