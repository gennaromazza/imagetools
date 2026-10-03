import type { AlbumProjectV2 } from "@photo-tools/shared-types";
import type { DesktopAlbumBackupVersion, DesktopGoogleDriveStatus } from "@photo-tools/desktop-contracts";
import { mediaIdsOfProject } from "../model/design";
import { collectEmbeddedMedia, restoreEmbeddedMedia } from "../model/mediaStore";
import { parseAlbumProject, readEmbeddedMedia, serializeAlbumProject } from "../model/portability";
import { getDesktop } from "./api";
import { markBackedUp } from "./autoBackup";

/** Backup del solo progetto su Google Drive (mai le foto), attraverso l'app desktop FileX. */

const NO_DESKTOP = "Google Drive è disponibile solo nell'app desktop FileX.";

export const driveAvailable = (): boolean => Boolean(getDesktop()?.exportAlbumFlowProjectToDrive);

export async function driveStatus(): Promise<DesktopGoogleDriveStatus | null> {
  const api = getDesktop();
  return api?.getGoogleDriveStatus ? api.getGoogleDriveStatus() : null;
}

export async function driveConnect(): Promise<DesktopGoogleDriveStatus> {
  const api = getDesktop();
  if (!api?.connectGoogleDrive) throw new Error(NO_DESKTOP);
  return api.connectGoogleDrive();
}

/** Salva su Drive il file del progetto, con le immagini della libreria che usa (sfondi e grafiche). */
export async function backupToDrive(project: AlbumProjectV2): Promise<DesktopAlbumBackupVersion> {
  const api = getDesktop();
  if (!api?.exportAlbumFlowProjectToDrive) throw new Error(NO_DESKTOP);
  const media = await collectEmbeddedMedia(mediaIdsOfProject(project));
  const version = await api.exportAlbumFlowProjectToDrive({
    projectId: project.projectId,
    projectName: project.projectName,
    spreads: project.spreads.length,
    photos: project.assets.length,
    content: serializeAlbumProject(project, media),
  });
  // Ricorda cosa è già su Drive: il backup alla chiusura salva solo gli album modificati dopo.
  markBackedUp(project.projectId, project.updatedAt);
  return version;
}

export async function listBackups(projectName?: string): Promise<DesktopAlbumBackupVersion[]> {
  const api = getDesktop();
  if (!api?.listAlbumFlowDriveVersions) throw new Error(NO_DESKTOP);
  return api.listAlbumFlowDriveVersions(projectName);
}

/** Scarica una versione, la controlla come ogni file di progetto e rimette in libreria le immagini incluse. */
export async function downloadBackup(versionId: string): Promise<AlbumProjectV2> {
  const api = getDesktop();
  if (!api?.downloadAlbumFlowDriveVersion) throw new Error(NO_DESKTOP);
  const raw = await api.downloadAlbumFlowDriveVersion(versionId);
  const project = parseAlbumProject(raw);
  await restoreEmbeddedMedia(readEmbeddedMedia(raw));
  return project;
}
