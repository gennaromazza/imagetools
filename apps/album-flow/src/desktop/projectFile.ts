import type { AlbumProjectV2 } from "@photo-tools/shared-types";
import { mediaIdsOfProject } from "../model/design";
import { stampOf } from "../model/fileLink";
import { collectEmbeddedMedia } from "../model/mediaStore";
import { parseAlbumProject, serializeAlbumProject } from "../model/portability";
import { getDesktop } from "./api";

/**
 * Il file `.filex-album.json` collegato a un album, letto e scritto con le funzioni che l'app desktop offre già
 * (nessun canale nuovo). La scrittura passa da un file provvisorio nella stessa cartella, poi rinominato.
 */

const UNREACHABLE = "File non raggiungibile: controlla la rete e l'unità E:.";

/** Cartella e nome; il separatore è quello usato per ultimo nel percorso (Windows, rete o macOS). */
export function splitFilePath(path: string): { directory: string; fileName: string } {
  const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return cut < 0 ? { directory: "", fileName: path } : { directory: path.slice(0, cut), fileName: path.slice(cut + 1) };
}

/** Percorso completo di un file dentro una cartella, con il separatore che la cartella già usa. */
export function joinFilePath(directory: string, fileName: string): string {
  const separator = directory.includes("\\") ? "\\" : "/";
  return `${directory.endsWith(separator) ? directory.slice(0, -1) : directory}${separator}${fileName}`;
}

export function canLinkFiles(): boolean {
  const api = getDesktop();
  // Un'app desktop più vecchia può non avere tutte le funzioni: si controlla che esistano davvero.
  return [api?.getPathForFile, api?.readFile, api?.statFiles, api?.writeFilesReplacing].every((fn) => typeof fn === "function");
}

/** Percorso del file scelto in «Apri progetto…» (null nel browser). */
export function pathOfPickedFile(file: File): string | null {
  try { return getDesktop()?.getPathForFile?.(file) || null; } catch { return null; }
}

/** Impronta del file sul disco, o null se non si raggiunge. */
export async function statProjectFile(path: string): Promise<string | null> {
  try {
    const stat = (await getDesktop()?.statFiles?.([path]))?.[0];
    return stat ? stampOf(stat) : null;
  } catch { return null; }
}

export async function readProjectFile(path: string): Promise<{ project: AlbumProjectV2; raw: string; stamp: string }> {
  const payload = await getDesktop()?.readFile?.(path).catch(() => null);
  if (!payload) throw new Error(UNREACHABLE);
  const raw = new TextDecoder().decode(payload.bytes);
  return { project: parseAlbumProject(raw), raw, stamp: stampOf(payload) };
}

/** Contenuto del file progetto: album più sfondi e grafiche della libreria che usa. */
export async function projectFileBytes(project: AlbumProjectV2): Promise<Uint8Array> {
  const media = await collectEmbeddedMedia(mediaIdsOfProject(project));
  return new TextEncoder().encode(serializeAlbumProject(project, media));
}

/** Sovrascrive il file collegato e restituisce la sua nuova impronta. */
export async function writeProjectFile(project: AlbumProjectV2, path: string): Promise<string> {
  const api = getDesktop();
  if (!api?.writeFilesReplacing) throw new Error("Salvare sul file richiede l'app desktop FileX.");
  const { directory, fileName } = splitFilePath(path);
  try {
    await api.writeFilesReplacing(directory, [{ fileName, bytes: await projectFileBytes(project) }]);
  } catch {
    throw new Error(UNREACHABLE);
  }
  const stamp = await statProjectFile(path);
  if (!stamp) throw new Error(UNREACHABLE);
  return stamp;
}
