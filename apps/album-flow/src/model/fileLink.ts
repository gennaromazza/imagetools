import type { AlbumProjectV2 } from "@photo-tools/shared-types";
import type { KeyValueStorage } from "../desktop/autoBackup";
import { serializeAlbumProject } from "./portability";

/**
 * Album collegato a un file `.filex-album.json` su disco (per esempio sul disco condiviso dello studio), per lavorare
 * sullo stesso album da due PC. Il collegamento vale solo per questo PC: sta nell'archivio locale, mai nel file.
 * Qui ci sono solo le scelte, senza disco, così si possono provare.
 */

export interface FileLink {
  /** Percorso completo del file. */
  path: string;
  /** Dimensione e data di modifica del file all'ultima lettura o scrittura fatta da questo PC. */
  stamp: string;
  /** Impronta del contenuto dell'album in quel momento. */
  savedHash: string;
}

export const FILE_LINKS_KEY = "filex.albumFlow.fileLinks";

const defaultStorage = (): KeyValueStorage | null => {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
};

const isLink = (value: unknown): value is FileLink => {
  const link = value as FileLink | null;
  return Boolean(link) && typeof link!.path === "string" && typeof link!.stamp === "string" && typeof link!.savedHash === "string";
};

export function loadFileLinks(storage: KeyValueStorage | null = defaultStorage()): Record<string, FileLink> {
  try {
    const parsed = JSON.parse(storage?.getItem(FILE_LINKS_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, FileLink] => isLink(entry[1])));
  } catch { return {}; }
}

function saveFileLinks(links: Record<string, FileLink>, storage: KeyValueStorage | null): void {
  try { storage?.setItem(FILE_LINKS_KEY, JSON.stringify(links)); } catch { /* si ripeterà al prossimo salvataggio */ }
}

export function setFileLink(projectId: string, link: FileLink, storage: KeyValueStorage | null = defaultStorage()): void {
  saveFileLinks({ ...loadFileLinks(storage), [projectId]: link }, storage);
}

export function removeFileLink(projectId: string, storage: KeyValueStorage | null = defaultStorage()): void {
  const links = loadFileLinks(storage);
  if (!(projectId in links)) return;
  delete links[projectId];
  saveFileLinks(links, storage);
}

/** Impronta del contenuto (FNV-1a a 32 bit più la lunghezza). Non si usa `updatedAt`: non tutte le operazioni lo aggiornano. */
export function albumFingerprint(project: AlbumProjectV2): string {
  const text = serializeAlbumProject(project);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16)}-${text.length}`;
}

/** Stesso formato delle impronte dei file in `desktop/api.ts`. */
export const stampOf = (stat: { size: number; lastModified: number }): string => `${stat.size}:${stat.lastModified}`;

export type FileStatus = "saved" | "unsaved" | "changed-elsewhere" | "conflict" | "unreachable";

/** `currentStamp` null: il file non si raggiunge (rete staccata, unità non collegata). */
export function fileStatus(link: FileLink, currentStamp: string | null, fingerprint: string): FileStatus {
  if (currentStamp === null) return "unreachable";
  const changedHere = fingerprint !== link.savedHash;
  const changedThere = currentStamp !== link.stamp;
  if (changedThere) return changedHere ? "conflict" : "changed-elsewhere";
  return changedHere ? "unsaved" : "saved";
}

export type SaveDecision = "write" | "ask-overwrite" | "unreachable";

/** Prima di scrivere: se un altro PC ha salvato nel frattempo si chiede, mai sovrascrivere in silenzio. */
export function decideSave(link: FileLink, currentStamp: string | null): SaveDecision {
  if (currentStamp === null) return "unreachable";
  return currentStamp === link.stamp ? "write" : "ask-overwrite";
}

export type OpenDecision = "load" | "keep" | "ask-load" | "ask-load-losing";

/**
 * Aprendo un file (o un album collegato): `local` è l'album di questo PC con lo stesso id, se c'è.
 * `fileHash` è l'impronta dell'album nel file, quando è già stato letto (serve per gli album mai collegati).
 */
export function decideOpen(local: { fingerprint: string } | null, link: FileLink | undefined, fileStamp: string, fileHash?: string): OpenDecision {
  if (!local) return "load";
  if (!link) return fileHash !== undefined && fileHash === local.fingerprint ? "load" : "ask-load-losing";
  // File invariato: dalla Home si tiene l'album di questo PC; scegliendo apposta il file (già letto) e trovandolo diverso, si chiede.
  if (fileStamp === link.stamp) return fileHash !== undefined && fileHash !== local.fingerprint ? "ask-load-losing" : "keep";
  return local.fingerprint === link.savedHash ? "ask-load" : "ask-load-losing";
}

/** Alla chiusura del programma (senza poter chiedere): solo gli album con modifiche nuove e il file non toccato da altri. */
export function closeSaveTargets(projects: readonly AlbumProjectV2[], links: Readonly<Record<string, FileLink>>, stamps: Readonly<Record<string, string | null>>): AlbumProjectV2[] {
  return projects.filter((project) => {
    const link = links[project.projectId];
    if (!link || !(project.projectId in stamps)) return false;
    return fileStatus(link, stamps[project.projectId] ?? null, albumFingerprint(project)) === "unsaved";
  });
}
