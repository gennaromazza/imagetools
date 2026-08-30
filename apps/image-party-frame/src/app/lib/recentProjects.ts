import { normalizeProjectState, type ProjectState } from "../contexts/ProjectContext";
import { normalizePortableCustomTemplate } from "./savedTemplates";

export type RecentProject = {
  projectId: string;
  name: string;
  date: string;
  images: number;
  template: string;
  snapshot: ProjectState;
};

const STORAGE_KEY = "desktop-frame-composer.recent-projects";
const STORAGE_EVENT = "desktop-frame-composer:recent-projects-updated";
const MAX_RECENT_PROJECTS = 8;
const MAX_RECENT_STORAGE_CHARS = 5 * 1024 * 1024;
const MAX_PROJECT_IMAGES = 500;
const MAX_PROJECT_TEXT_LENGTH = 1_024;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeText(value: unknown, fallback: string, maximumLength: number): string {
  return typeof value === "string" && !value.includes("\0")
    ? (value.trim().slice(0, maximumLength) || fallback)
    : fallback;
}

function normalizeRecentProject(value: unknown): RecentProject | null {
  if (!isPlainRecord(value) || !isPlainRecord(value.snapshot)) {
    return null;
  }
  const source = value.snapshot;
  if (!Array.isArray(source.images) || source.images.length > MAX_PROJECT_IMAGES) {
    return null;
  }
  const images = source.images.filter((image) =>
    isPlainRecord(image)
    && typeof (image.relativePath ?? image.path) === "string"
    && String(image.relativePath ?? image.path).length <= MAX_PROJECT_TEXT_LENGTH);
  const templateId = safeText(source.template, "", 120);
  if (!templateId) {
    return null;
  }
  const customTemplate = source.customTemplate === null || source.customTemplate === undefined
    ? null
    : normalizePortableCustomTemplate(source.customTemplate);
  if (templateId === "custom" && !customTemplate) {
    return null;
  }

  const snapshot = normalizeProjectState({
    projectId: typeof value.projectId === "string"
      ? value.projectId
      : typeof source.projectId === "string"
        ? source.projectId
        : undefined,
    name: safeText(source.name, "Progetto", 120),
    template: templateId,
    sourcePath: safeText(source.sourcePath, "", MAX_PROJECT_TEXT_LENGTH),
    outputPath: safeText(source.outputPath, "", MAX_PROJECT_TEXT_LENGTH),
    customTemplate: templateId === "custom" ? customTemplate : null,
    images: images as ProjectState["images"],
    exportSettings: isPlainRecord(source.exportSettings)
      ? source.exportSettings as unknown as ProjectState["exportSettings"]
      : undefined,
  });
  snapshot.images = snapshot.images.map(({ url: _url, ...image }) => image);
  snapshot.imageCount = {
    total: snapshot.images.length,
    vertical: snapshot.images.filter((image) => image.orientation === "vertical").length,
    horizontal: snapshot.images.filter((image) => image.orientation === "horizontal").length,
  };
  return {
    projectId: snapshot.projectId,
    name: safeText(value.name, snapshot.name, 120),
    date: safeText(value.date, "", 64),
    images: snapshot.images.length,
    template: safeText(value.template, getTemplateLabel(snapshot), 120),
    snapshot,
  };
}

export function normalizeRecentProjectRecords(value: unknown): RecentProject[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seenIds = new Set<string>();
  const records: RecentProject[] = [];
  for (const candidate of value) {
    try {
      const record = normalizeRecentProject(candidate);
      if (!record || seenIds.has(record.projectId)) {
        continue;
      }
      seenIds.add(record.projectId);
      records.push(record);
      if (records.length >= MAX_RECENT_PROJECTS) {
        break;
      }
    } catch (error) {
      console.warn("Ignored corrupt recent project", error);
    }
  }
  return records;
}

function getTemplateLabel(project: ProjectState): string {
  if (project.template === "custom") {
    return project.customTemplate?.name || "Template Custom";
  }

  return project.template || "Template";
}

export function loadRecentProjects(): RecentProject[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    if (raw.length > MAX_RECENT_STORAGE_CHARS) {
      console.warn("Recent projects exceed the safe localStorage limit");
      return [];
    }
    return normalizeRecentProjectRecords(JSON.parse(raw) as unknown);
  } catch (error) {
    console.warn("Failed to load recent projects", error);
    return [];
  }
}

export function upsertRecentProjectList(
  current: RecentProject[],
  nextProject: RecentProject,
  limit = MAX_RECENT_PROJECTS
): RecentProject[] {
  return [
    nextProject,
    ...current.filter((item) => item.projectId !== nextProject.projectId),
  ].slice(0, Math.max(0, limit));
}

export function onRecentProjectsUpdated(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  window.addEventListener(STORAGE_EVENT, listener);
  return () => window.removeEventListener(STORAGE_EVENT, listener);
}

export function saveRecentProject(project: ProjectState, templateLabel?: string): void {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedProject = normalizeProjectState(project);
  const normalizedCustomTemplate = normalizedProject.customTemplate
    ? normalizePortableCustomTemplate(normalizedProject.customTemplate)
    : null;
  if (normalizedProject.template === "custom" && !normalizedCustomTemplate) {
    console.warn("Skipped recent project with an invalid custom template");
    return;
  }
  const snapshot: ProjectState = {
    ...normalizedProject,
    customTemplate: normalizedProject.template === "custom" ? normalizedCustomTemplate : null,
    images: normalizedProject.images.map(({ url: _url, ...image }) => image),
  };
  const nextProject: RecentProject = {
    projectId: snapshot.projectId,
    name: snapshot.name,
    date: new Date().toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    images: snapshot.images.length,
    template: templateLabel || getTemplateLabel(snapshot),
    snapshot,
  };

  const next = upsertRecentProjectList(loadRecentProjects(), nextProject);
  try {
    const serialized = JSON.stringify(next);
    if (serialized.length > MAX_RECENT_STORAGE_CHARS) {
      throw new Error("I progetti recenti superano il limite sicuro di archiviazione locale.");
    }
    window.localStorage.setItem(STORAGE_KEY, serialized);
    try {
      window.dispatchEvent(new Event(STORAGE_EVENT));
    } catch (error) {
      console.warn("Recent project update listener failed", error);
    }
  } catch (error) {
    console.warn("Failed to save recent project", error);
  }
}

export function removeRecentProjectAt(index: number): RecentProject[] {
  if (typeof window === "undefined") {
    return [];
  }

  const current = loadRecentProjects();
  if (index < 0 || index >= current.length) {
    return current;
  }

  const next = current.filter((_, itemIndex) => itemIndex !== index);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    try {
      window.dispatchEvent(new Event(STORAGE_EVENT));
    } catch (error) {
      console.warn("Recent project update listener failed", error);
    }
    return next;
  } catch (error) {
    console.warn("Failed to remove recent project", error);
    return current;
  }
}
