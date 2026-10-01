import type { AlbumAssetV2 } from "@photo-tools/shared-types";
import { newId } from "./ids";
import { assignAssets } from "./chapters";
import { touch, type Project } from "./project";

/** Foto proposta per l'importazione: arriva da una cartella (app desktop) o da file scelti nel browser. */
export interface ImportCandidate {
  fileName: string;
  absolutePath?: string;
  size?: number;
  lastModified?: number;
  width?: number;
  height?: number;
  captureTimeMs?: number | null;
  rating?: number;
  /** Anteprima temporanea (blob) usata solo senza app desktop. */
  previewUrl?: string;
  /** Cartella di provenienza: nome della cartella scelta più le sottocartelle, separati da «/». Serve a escluderne alcune. */
  folder?: string;
}

/** Percorsi uguali anche se scritti con separatori diversi; senza distinzione di maiuscole per i percorsi Windows. */
export function normalizePathKey(path: string): string {
  const unified = path.replaceAll("\\", "/").replace(/\/+/g, "/");
  return /^[A-Za-z]:\//.test(unified) || unified.startsWith("//") ? unified.toLowerCase() : unified;
}

export function candidateKey(candidate: Pick<ImportCandidate, "absolutePath" | "fileName" | "size">): string {
  return candidate.absolutePath ? `p:${normalizePathKey(candidate.absolutePath)}` : `n:${candidate.fileName.toLowerCase()}|${candidate.size ?? 0}`;
}

export function assetKey(asset: Pick<AlbumAssetV2, "absolutePath" | "fileName" | "size">): string {
  return candidateKey({ absolutePath: asset.absolutePath, fileName: asset.fileName, size: asset.size });
}

export interface DuplicateEntry {
  candidate: ImportCandidate;
  existingAssetId: string;
}

export interface ImportPlan {
  /** Foto nuove, da aggiungere. */
  fresh: ImportCandidate[];
  /** Foto già presenti nell'album (stesso percorso, o stesso nome e peso senza percorso). */
  duplicates: DuplicateEntry[];
  /** Ripetizioni dentro lo stesso lotto, già scartate. */
  repeatedInBatch: number;
}

/** Separa le foto nuove da quelle già presenti, così l'utente decide cosa fare dei duplicati. */
export function planImport(project: Project, candidates: readonly ImportCandidate[]): ImportPlan {
  const existing = new Map(project.assets.map((asset) => [assetKey(asset), asset.id]));
  const seen = new Set<string>();
  const plan: ImportPlan = { fresh: [], duplicates: [], repeatedInBatch: 0 };
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    if (seen.has(key)) { plan.repeatedInBatch += 1; continue; }
    seen.add(key);
    const existingId = existing.get(key);
    if (existingId) plan.duplicates.push({ candidate, existingAssetId: existingId });
    else plan.fresh.push(candidate);
  }
  return plan;
}

export function orientationOf(width: number, height: number): AlbumAssetV2["orientation"] {
  const ratio = width / Math.max(height, 1);
  return ratio > 1.08 ? "horizontal" : ratio < 0.92 ? "vertical" : "square";
}

/** Dimensioni di riserva quando non sono note: il motore lavora comunque con una proporzione 3:2. */
export const FALLBACK_SIZE = { width: 6000, height: 4000 } as const;

export function assetFromCandidate(candidate: ImportCandidate, manualOrder: number): AlbumAssetV2 {
  const width = candidate.width && candidate.width > 0 ? candidate.width : FALLBACK_SIZE.width;
  const height = candidate.height && candidate.height > 0 ? candidate.height : FALLBACK_SIZE.height;
  return {
    id: newId("as"),
    fileName: candidate.fileName,
    path: candidate.fileName,
    ...(candidate.absolutePath ? { absolutePath: candidate.absolutePath } : {}),
    ...(candidate.previewUrl ? { previewUrl: candidate.previewUrl, thumbnailUrl: candidate.previewUrl } : {}),
    width,
    height,
    aspectRatio: width / height,
    orientation: orientationOf(width, height),
    ...(candidate.size !== undefined ? { size: candidate.size } : {}),
    ...(candidate.lastModified !== undefined ? { createdAt: candidate.lastModified } : {}),
    ...(typeof candidate.captureTimeMs === "number" ? { captureTimeMs: candidate.captureTimeMs } : {}),
    rating: Math.max(0, Math.min(5, Math.round(candidate.rating ?? 0))),
    ...(candidate.rating !== undefined ? { selectorRating: Math.max(0, Math.min(5, Math.round(candidate.rating))) } : {}),
    manualOrder,
    importedAt: new Date().toISOString(),
  };
}

export interface ImportChoice {
  /** Capitolo di destinazione, o null per lasciarle senza capitolo. */
  chapterId: string | null;
  /** Cosa fare dei duplicati: "skip" li ignora, "add" li aggiunge comunque come nuove foto. */
  duplicates: "skip" | "add";
}

export interface ImportResult {
  project: Project;
  addedAssetIds: string[];
  skipped: number;
}

export function applyImport(project: Project, plan: ImportPlan, choice: ImportChoice): ImportResult {
  const candidates = choice.duplicates === "add" ? [...plan.fresh, ...plan.duplicates.map((entry) => entry.candidate)] : plan.fresh;
  if (candidates.length === 0) return { project, addedAssetIds: [], skipped: plan.duplicates.length + plan.repeatedInBatch };
  const start = project.assets.reduce((max, asset) => Math.max(max, asset.manualOrder ?? -1), -1) + 1;
  const created = candidates.map((candidate, index) => assetFromCandidate(candidate, start + index));
  let next: Project = touch({ ...project, assets: [...project.assets, ...created] });
  if (choice.chapterId !== null) next = assignAssets(next, created.map((asset) => asset.id), choice.chapterId);
  return {
    project: next,
    addedAssetIds: created.map((asset) => asset.id),
    skipped: choice.duplicates === "skip" ? plan.duplicates.length + plan.repeatedInBatch : plan.repeatedInBatch,
  };
}

/** Estensioni di immagine accettate quando si trascinano file o cartelle sulla finestra. */
export const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".heic", ".cr2", ".cr3", ".nef", ".arw", ".raf", ".orf", ".rw2", ".dng"];

export function isImageFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

// ---------------------------------------------------------------------------
// Coppie RAW + JPG
// ---------------------------------------------------------------------------

const RAW_EXTENSIONS = new Set([".cr2", ".cr3", ".nef", ".arw", ".raf", ".orf", ".rw2", ".dng"]);
/** Formato preferito quando la stessa foto esiste in più versioni (indice più basso = preferito). */
const FORMAT_PRIORITY = [".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".heic"];

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

function stemKey(candidate: ImportCandidate): string {
  const path = candidate.absolutePath ?? candidate.fileName;
  const unified = path.replaceAll("\\", "/");
  const dot = unified.lastIndexOf(".");
  const stem = dot > unified.lastIndexOf("/") ? unified.slice(0, dot) : unified;
  return /^[A-Za-z]:\//.test(stem) || stem.startsWith("//") ? stem.toLowerCase() : stem;
}

function priority(candidate: ImportCandidate): number {
  const extension = extensionOf(candidate.fileName);
  const index = FORMAT_PRIORITY.indexOf(extension);
  if (index >= 0) return index;
  return RAW_EXTENSIONS.has(extension) ? 100 : 50;
}

/**
 * Quando nella stessa cartella ci sono RAW e JPG con lo stesso nome (coppie della fotocamera) si importa una sola foto:
 * il JPG, più leggero e già sviluppato; il RAW resta solo se è l'unica versione.
 */
export function dedupeRawJpgPairs(candidates: readonly ImportCandidate[]): { kept: ImportCandidate[]; ignored: number } {
  const best = new Map<string, ImportCandidate>();
  const order: string[] = [];
  for (const candidate of candidates) {
    const key = stemKey(candidate);
    const current = best.get(key);
    if (!current) { best.set(key, candidate); order.push(key); }
    else if (priority(candidate) < priority(current)) best.set(key, candidate);
  }
  const kept = order.map((key) => best.get(key)!);
  return { kept, ignored: candidates.length - kept.length };
}

/** Cartella di un percorso (Windows o macOS/Linux); vuota se il percorso non ne ha una. */
/** Le cartelle da cui arrivano le foto, con quante ne contengono; la cartella scelta per prima, poi le sottocartelle in ordine naturale. */
export function folderGroups(candidates: readonly ImportCandidate[]): Array<{ folder: string; count: number }> {
  const counts = new Map<string, number>();
  for (const candidate of candidates) counts.set(candidate.folder ?? "", (counts.get(candidate.folder ?? "") ?? 0) + 1);
  return [...counts].map(([folder, count]) => ({ folder, count })).sort((a, b) => a.folder.localeCompare(b.folder, "it", { numeric: true, sensitivity: "base" }));
}

export function withoutFolders(candidates: readonly ImportCandidate[], excluded: ReadonlySet<string>): ImportCandidate[] {
  return excluded.size === 0 ? [...candidates] : candidates.filter((candidate) => !excluded.has(candidate.folder ?? ""));
}

export function folderOf(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index > 0 ? path.slice(0, index) : "";
}
