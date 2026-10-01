import type { AlbumChapterV2 } from "@photo-tools/shared-types";
import { newId } from "./ids";
import { touch, type Project } from "./project";

/** Colori delle schede dei capitoli: riconoscibili sul tema scuro e distinti tra loro. */
export const CHAPTER_COLORS = ["#e07a6c", "#e3a64b", "#9bbf7a", "#5fb3a1", "#6fa8d6", "#9d8bd6", "#d98bb0", "#c9b48f"] as const;

export interface ChapterPreset {
  id: string;
  name: string;
  titles: string[];
  builtin?: boolean;
}

export const BUILTIN_CHAPTER_PRESETS: ChapterPreset[] = [
  { id: "wedding", name: "Matrimonio", builtin: true, titles: ["Casa sposo", "Casa sposa", "Chiesa", "Esterni", "Ristorante", "Festa"] },
  { id: "baptism", name: "Battesimo", builtin: true, titles: ["Preparativi", "Cerimonia", "Famiglia", "Festa"] },
  { id: "birthday", name: "Compleanno / Comunione", builtin: true, titles: ["Preparativi", "Cerimonia", "Ritratti", "Festa"] },
  { id: "portrait", name: "Servizio fotografico", builtin: true, titles: ["Ritratti", "Coppia", "Dettagli"] },
];

const norm = (value: string) => value.replace(/\s+/g, " ").trim().toLocaleLowerCase();

export function chapterColor(index: number): string {
  return CHAPTER_COLORS[index % CHAPTER_COLORS.length];
}

export function findChapter(project: Project, chapterId: string | null): AlbumChapterV2 | undefined {
  return chapterId ? project.chapters.find((chapter) => chapter.id === chapterId) : undefined;
}

export function chapterOfAsset(project: Project, assetId: string): AlbumChapterV2 | undefined {
  return project.chapters.find((chapter) => chapter.assetIds.includes(assetId));
}

export function createChapter(project: Project, title: string, color?: string): Project {
  const name = title.replace(/\s+/g, " ").trim();
  if (!name) throw new Error("Inserisci un nome per il capitolo.");
  if (project.chapters.some((chapter) => norm(chapter.title) === norm(name))) throw new Error(`Esiste già un capitolo «${name}».`);
  const chapter: AlbumChapterV2 = { id: newId("chap"), title: name, color: color ?? chapterColor(project.chapters.length), assetIds: [] };
  return touch({ ...project, chapters: [...project.chapters, chapter] });
}

export function renameChapter(project: Project, chapterId: string, title: string): Project {
  const name = title.replace(/\s+/g, " ").trim();
  if (!name) throw new Error("Inserisci un nome per il capitolo.");
  if (!findChapter(project, chapterId)) throw new Error("Capitolo inesistente.");
  if (project.chapters.some((chapter) => chapter.id !== chapterId && norm(chapter.title) === norm(name))) throw new Error(`Esiste già un capitolo «${name}».`);
  return touch({ ...project, chapters: project.chapters.map((chapter) => (chapter.id === chapterId ? { ...chapter, title: name } : chapter)) });
}

export function recolorChapter(project: Project, chapterId: string, color: string): Project {
  if (!findChapter(project, chapterId)) throw new Error("Capitolo inesistente.");
  return touch({ ...project, chapters: project.chapters.map((chapter) => (chapter.id === chapterId ? { ...chapter, color } : chapter)) });
}

/** Elimina il capitolo: le sue foto restano nell'album, senza capitolo. */
export function removeChapter(project: Project, chapterId: string): Project {
  if (!findChapter(project, chapterId)) throw new Error("Capitolo inesistente.");
  return touch({ ...project, chapters: project.chapters.filter((chapter) => chapter.id !== chapterId) });
}

export function moveChapter(project: Project, chapterId: string, direction: -1 | 1): Project {
  const index = project.chapters.findIndex((chapter) => chapter.id === chapterId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= project.chapters.length) return project;
  const chapters = [...project.chapters];
  [chapters[index], chapters[target]] = [chapters[target], chapters[index]];
  return touch({ ...project, chapters });
}

/** Assegna le foto a un capitolo (o a nessuno con null). Una foto sta in un solo capitolo. */
export function assignAssets(project: Project, assetIds: readonly string[], chapterId: string | null): Project {
  if (chapterId !== null && !findChapter(project, chapterId)) throw new Error("Capitolo inesistente.");
  const moving = new Set(assetIds.filter((id) => project.assets.some((asset) => asset.id === id)));
  if (moving.size === 0) return project;
  let changed = false;
  const chapters = project.chapters.map((chapter) => {
    const kept = chapter.assetIds.filter((id) => !moving.has(id));
    const added = chapter.id === chapterId ? [...kept, ...[...moving].filter((id) => !kept.includes(id))] : kept;
    if (added.length !== chapter.assetIds.length || added.some((id, index) => id !== chapter.assetIds[index])) changed = true;
    return added === chapter.assetIds ? chapter : { ...chapter, assetIds: added };
  });
  return changed ? touch({ ...project, chapters }) : project;
}

/** Aggiunge al progetto i capitoli di un gruppo predefinito che ancora non esistono (confronto senza maiuscole). */
export function applyChapterPreset(project: Project, preset: ChapterPreset): Project {
  let result = project;
  for (const title of preset.titles) {
    if (!result.chapters.some((chapter) => norm(chapter.title) === norm(title))) result = createChapter(result, title);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Gruppi salvati dall'utente
// ---------------------------------------------------------------------------

const PRESETS_KEY = "filex.albumFlow.chapterPresets";

export function loadChapterPresets(): ChapterPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ChapterPreset => Boolean(item) && typeof item.id === "string" && typeof item.name === "string" && Array.isArray(item.titles));
  } catch {
    return [];
  }
}

export function saveChapterPreset(name: string, titles: readonly string[]): ChapterPreset[] {
  const clean = titles.map((title) => title.replace(/\s+/g, " ").trim()).filter(Boolean);
  const label = name.replace(/\s+/g, " ").trim();
  if (!label || clean.length === 0) throw new Error("Dai un nome al gruppo e inserisci almeno un capitolo.");
  const presets = loadChapterPresets().filter((preset) => norm(preset.name) !== norm(label));
  presets.push({ id: newId("preset"), name: label, titles: clean });
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(presets)); } catch { /* preferenza non critica */ }
  return presets;
}

export function deleteChapterPreset(presetId: string): ChapterPreset[] {
  const presets = loadChapterPresets().filter((preset) => preset.id !== presetId);
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(presets)); } catch { /* preferenza non critica */ }
  return presets;
}
