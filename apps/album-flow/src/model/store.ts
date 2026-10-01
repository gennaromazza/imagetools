import type { DesktopPhotoToolHandoff } from "@photo-tools/desktop-contracts";
import type { AlbumAssetV2, AlbumChapterV2, AlbumProjectV2, AlbumStage } from "@photo-tools/shared-types";
import { removeAssets } from "./library";
import { projectProblem } from "./portability";
import { chapterColor, createChapter, applyChapterPreset, BUILTIN_CHAPTER_PRESETS, assignAssets } from "./chapters";
import { newId } from "./ids";
import { orientationOf } from "./import";
import { createEmptyProject, nowIso, type Project } from "./project";

const KEYS = {
  projects: "filex.albumFlow.v2.projects",
  pending: "filex.albumFlow.v2.projects.pending",
  active: "filex.albumFlow.v2.activeProjectId",
  quarantine: "filex.albumFlow.v2.quarantine",
  /** Salvataggio del formato 1: non viene mai toccato, solo contato. */
  legacy: "filex.albumFlow.projects",
} as const;

export interface LoadResult {
  projects: Project[];
  /** Progetti del salvataggio v2 che non superano i controlli: conservati a parte, mai cancellati. */
  skipped: number;
  /** Album del formato precedente, non compatibili. */
  legacy: number;
}

export function loadProjects(): LoadResult {
  const result: LoadResult = { projects: [], skipped: 0, legacy: 0 };
  try {
    const rawLegacy = localStorage.getItem(KEYS.legacy);
    const legacy = rawLegacy ? (JSON.parse(rawLegacy) as unknown) : [];
    result.legacy = Array.isArray(legacy) ? legacy.length : 0;
  } catch { /* nessun salvataggio precedente leggibile */ }
  try {
    const raw = localStorage.getItem(KEYS.pending) ?? localStorage.getItem(KEYS.projects);
    if (!raw) return result;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return result;
    const quarantined: unknown[] = [];
    for (const candidate of parsed) {
      if (projectProblem(candidate) === null) result.projects.push(candidate as Project);
      else { result.skipped += 1; quarantined.push(candidate); }
    }
    if (quarantined.length) {
      try {
        const previous = JSON.parse(localStorage.getItem(KEYS.quarantine) ?? "[]") as unknown[];
        localStorage.setItem(KEYS.quarantine, JSON.stringify([...previous, ...quarantined].slice(-5)));
      } catch { /* la quarantena è un di più */ }
    }
    // Un'istantanea pendente valida viene promossa dopo un arresto durante il commit finale.
    if (localStorage.getItem(KEYS.pending)) {
      try { localStorage.setItem(KEYS.projects, JSON.stringify(result.projects)); localStorage.removeItem(KEYS.pending); } catch { /* ritenterà al prossimo salvataggio */ }
    }
  } catch { /* salvataggio illeggibile: si riparte vuoti, l'originale resta dov'è */ }
  return result;
}

/** Salvataggio a due fasi; restituisce false se lo spazio è esaurito o il browser lo impedisce. */
export function saveProjects(projects: readonly Project[]): boolean {
  try {
    const serialized = JSON.stringify(projects);
    localStorage.setItem(KEYS.pending, serialized);
    localStorage.setItem(KEYS.projects, serialized);
    localStorage.removeItem(KEYS.pending);
    return true;
  } catch {
    return false;
  }
}

export function loadActiveProjectId(): string | null {
  try { return localStorage.getItem(KEYS.active); } catch { return null; }
}

export function saveActiveProjectId(id: string | null): void {
  try { if (id) localStorage.setItem(KEYS.active, id); else localStorage.removeItem(KEYS.active); } catch { /* preferenza non critica */ }
}

// ---------------------------------------------------------------------------
// Fasi del progetto (bacheca della Home)
// ---------------------------------------------------------------------------

export const STAGES: ReadonlyArray<{ id: AlbumStage; label: string; hint: string }> = [
  { id: "pending", label: "Da iniziare", hint: "Album creati, ancora da impaginare" },
  { id: "editing", label: "In lavorazione", hint: "Impaginazione in corso" },
  { id: "proofing", label: "In revisione", hint: "Inviato o mostrato al cliente" },
  { id: "complete", label: "Completati", hint: "Consegnati alla stampa" },
];

export const stageLabel = (stage: AlbumStage) => STAGES.find((item) => item.id === stage)?.label ?? stage;

// ---------------------------------------------------------------------------
// Arrivo dal Selector (handoff)
// ---------------------------------------------------------------------------

/** Crea un progetto dalle foto selezionate in Image Select Pro; le etichette personalizzate propongono i capitoli. */
export function projectFromHandoff(handoff: DesktopPhotoToolHandoff): Project {
  const manifest = handoff.albumFlow;
  if (!manifest) throw new Error("Il passaggio ricevuto non contiene dati Album Flow.");
  const base = createEmptyProject(manifest.projectName);
  const selected = manifest.assets.filter((asset) => asset.selected);
  const assets: AlbumAssetV2[] = selected.map((asset) => ({
    id: asset.assetId,
    fileName: asset.fileName,
    path: asset.relativePath,
    absolutePath: asset.absolutePath,
    sourceFileKey: asset.sourceFileKey,
    width: asset.width > 0 ? asset.width : 6000,
    height: asset.height > 0 ? asset.height : 4000,
    aspectRatio: asset.aspectRatio > 0 ? asset.aspectRatio : asset.width / Math.max(asset.height, 1),
    orientation: asset.orientation,
    rating: asset.rating,
    selectorRating: asset.rating,
    customLabels: [...asset.customLabels],
    labelIds: [...asset.labelIds],
    rotationDegrees: (asset.rotationDegrees ?? 0) as AlbumAssetV2["rotationDegrees"],
    size: asset.size,
    selectionOrder: asset.selectionOrder,
    importedAt: nowIso(),
  }));
  const labels = manifest.labels.map((label) => ({ ...label, source: label.source as "selector-custom" | "selector-color" | "album" }));
  // Ogni foto va nel capitolo della sua PRIMA etichetta personalizzata, così le foto con più etichette non spariscono da un capitolo.
  const customLabels = labels.filter((label) => label.source === "selector-custom");
  const customIds = new Set(customLabels.map((label) => label.id));
  const primaryLabel = (asset: AlbumAssetV2) => asset.labelIds?.find((id) => customIds.has(id));
  const chapters: AlbumChapterV2[] = [];
  customLabels.forEach((label, index) => {
    const members = assets.filter((asset) => primaryLabel(asset) === label.id).sort((a, b) => (a.selectionOrder ?? 0) - (b.selectionOrder ?? 0));
    if (members.length === 0) return;
    chapters.push({ id: newId("chap"), title: label.name, color: chapterColor(index), assetIds: members.map((asset) => asset.id) });
  });
  return { ...base, projectId: manifest.projectId, sourceFolderPath: manifest.sourceRoot, selectorRevision: manifest.selectorRevision, assets, labels, chapters };
}

/**
 * Un nuovo invio dallo stesso progetto del Selector aggiorna le foto ma conserva l'album già lavorato:
 * impaginazione, capitoli, stile, tag e foto importate a mano restano; le foto tolte dal Selector escono anche dall'album.
 */
export function mergeIncomingProject(previous: Project | undefined, incoming: Project): Project {
  if (!previous) return incoming;
  const incomingIds = new Set(incoming.assets.map((asset) => asset.id));
  const previousById = new Map(previous.assets.map((asset) => [asset.id, asset]));
  // Solo le foto che erano arrivate dal Selector possono uscire; quelle importate a mano restano.
  const gone = previous.assets.filter((asset) => asset.selectionOrder !== undefined && !incomingIds.has(asset.id)).map((asset) => asset.id);
  let merged: Project = gone.length ? removeAssets(previous, gone) : previous;
  const kept = new Map(merged.assets.map((asset) => [asset.id, asset]));
  const refreshed = incoming.assets.map((asset) => {
    const old = previousById.get(asset.id);
    if (!old) return asset;
    // Con «stelle solo di questo album» le tue stelle non vengono sovrascritte da quelle del Selector.
    const keepMine = previous.settings.ratingPolicy === "project" && old.rating !== undefined;
    return { ...old, ...asset, albumTags: old.albumTags, manualOrder: old.manualOrder, captureTimeMs: old.captureTimeMs, rating: keepMine ? old.rating : asset.rating ?? old.rating, selectorRating: asset.rating ?? old.selectorRating };
  });
  const added = refreshed.filter((asset) => !kept.has(asset.id));
  merged = {
    ...merged,
    assets: [...merged.assets.map((asset) => refreshed.find((candidate) => candidate.id === asset.id) ?? asset), ...added],
    labels: incoming.labels,
    sourceFolderPath: incoming.sourceFolderPath || merged.sourceFolderPath,
    selectorRevision: incoming.selectorRevision,
    updatedAt: nowIso(),
  };
  // Capitoli proposti dalle etichette: si aggiungono solo quelli nuovi, senza spostare foto già assegnate dall'utente.
  for (const chapter of incoming.chapters) {
    const existing = merged.chapters.find((candidate) => candidate.title.toLocaleLowerCase() === chapter.title.toLocaleLowerCase());
    const target = existing ? merged : createChapter(merged, chapter.title, chapter.color);
    const targetId = existing?.id ?? target.chapters[target.chapters.length - 1].id;
    const assigned = new Set(target.chapters.flatMap((candidate) => candidate.assetIds));
    const free = chapter.assetIds.filter((id) => !assigned.has(id));
    merged = free.length ? assignAssets(target, free, targetId) : target;
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Album di prova
// ---------------------------------------------------------------------------

const DEMO_PALETTES: Array<[string, string]> = [
  ["#c9a27a", "#6b4a35"], ["#8fb3a3", "#2f4f45"], ["#d7b9b0", "#7a5550"], ["#9fb0c9", "#3a4a66"],
  ["#d9c58f", "#7a6a35"], ["#b3a1c9", "#4f3f66"], ["#a8c48f", "#476635"], ["#cf9f9f", "#6b3535"],
];

function demoPhoto(index: number, width: number, height: number): string {
  const [light, dark] = DEMO_PALETTES[index % DEMO_PALETTES.length];
  const w = width / 20;
  const h = height / 20;
  const cx = w * (0.3 + ((index * 37) % 40) / 100);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>`
    + `<rect width="100%" height="100%" fill="url(#g)"/>`
    + `<circle cx="${cx}" cy="${h * 0.42}" r="${Math.min(w, h) * 0.2}" fill="#ffffff" fill-opacity="0.28"/>`
    + `<rect x="${w * 0.08}" y="${h * 0.74}" width="${w * 0.84}" height="${h * 0.012}" fill="#ffffff" fill-opacity="0.35"/>`
    + `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Album di prova con foto sintetiche, capitoli da matrimonio e qualche panorama: per provare l'editor senza importare nulla. */
export function createDemoProject(): Project {
  let project = createEmptyProject("Album di prova — Matrimonio");
  const shapes: Array<[number, number]> = [[6000, 4000], [4000, 6000], [6000, 4000], [6000, 4000], [4000, 6000], [6000, 6000], [6000, 4000], [4000, 5000]];
  const panoramas = new Set([6, 25]);
  const start = Date.UTC(2026, 5, 5, 9, 0, 0);
  const assets: AlbumAssetV2[] = Array.from({ length: 36 }, (_, index) => {
    const [width, height] = panoramas.has(index) ? [7000, 3000] : shapes[(index * 5 + Math.floor(index / 7)) % shapes.length];
    const url = demoPhoto(index, width, height);
    return {
      id: `demo-${index + 1}`,
      fileName: `DEMO_${String(index + 1).padStart(3, "0")}.jpg`,
      path: `DEMO_${String(index + 1).padStart(3, "0")}.jpg`,
      previewUrl: url,
      thumbnailUrl: url,
      width,
      height,
      aspectRatio: width / height,
      orientation: orientationOf(width, height),
      rating: index % 7 === 0 ? 5 : index % 3 === 0 ? 4 : 3,
      captureTimeMs: start + index * 4 * 60_000,
    } as AlbumAssetV2;
  });
  project = { ...project, assets };
  const wedding = BUILTIN_CHAPTER_PRESETS.find((preset) => preset.id === "wedding")!;
  project = applyChapterPreset(project, { ...wedding, titles: wedding.titles.slice(0, 4) });
  project.chapters.forEach((chapter, index) => {
    project = assignAssets(project, assets.slice(index * 9, index * 9 + 9).map((asset) => asset.id), chapter.id);
  });
  return project;
}

export type { AlbumProjectV2 };
