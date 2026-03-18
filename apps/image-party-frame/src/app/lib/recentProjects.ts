import { normalizeProjectState, type ProjectState } from "../contexts/ProjectContext";

export type RecentProject = {
  name: string;
  date: string;
  images: number;
  template: string;
  snapshot: ProjectState;
};

const STORAGE_KEY = "desktop-frame-composer.recent-projects";
const STORAGE_EVENT = "desktop-frame-composer:recent-projects-updated";

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

    const parsed = JSON.parse(raw) as Array<Partial<RecentProject>>;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => ({
        name: typeof item?.name === "string" ? item.name : "Progetto",
        date: typeof item?.date === "string" ? item.date : "",
        images: typeof item?.images === "number" ? item.images : 0,
        template: typeof item?.template === "string" ? item.template : "Template",
        snapshot: normalizeProjectState(item?.snapshot),
      }))
      .filter((item) => item.name.trim().length > 0);
  } catch (error) {
    console.warn("Failed to load recent projects", error);
    return [];
  }
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

  const nextProject: RecentProject = {
    name: project.name,
    date: new Date().toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    images: project.images.length,
    template: templateLabel || getTemplateLabel(project),
    snapshot: project,
  };

  const current = loadRecentProjects().filter((item) => item.name !== nextProject.name);
  const next = [nextProject, ...current].slice(0, 8);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(STORAGE_EVENT));
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
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(STORAGE_EVENT));
  return next;
}
