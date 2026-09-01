import type {
  DesktopCloudProjectManifest,
  DesktopCloudProjectVersion,
  DesktopGoogleDriveStatus,
} from "@photo-tools/desktop-contracts";

function getApi() {
  return typeof window === "undefined" ? null : window.filexDesktop ?? null;
}

export async function getGoogleDriveStatus(): Promise<DesktopGoogleDriveStatus> {
  const api = getApi();
  if (!api?.getGoogleDriveStatus) {
    return { configured: false, connected: false, accountEmail: null, requiresReconnect: false };
  }
  return api.getGoogleDriveStatus();
}

export async function connectGoogleDrive(): Promise<DesktopGoogleDriveStatus> {
  const api = getApi();
  if (!api?.connectGoogleDrive) {
    throw new Error("Google Drive è disponibile solo nella shell desktop FileX.");
  }
  return api.connectGoogleDrive();
}

export async function disconnectGoogleDrive(): Promise<DesktopGoogleDriveStatus> {
  const api = getApi();
  if (!api?.disconnectGoogleDrive) {
    throw new Error("Google Drive è disponibile solo nella shell desktop FileX.");
  }
  return api.disconnectGoogleDrive();
}

export interface GoogleDriveWorkspaceMatch {
  mode: "project" | "free";
  workspaceId?: string;
  projectName?: string;
  sourceFolderName?: string;
  totalAssets?: number;
}

function normalizedMatchValue(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

/**
 * Keeps Drive recovery portable: identity matches are shown first, but a
 * copied/recreated folder is not hidden merely because its disk or project ID
 * changed. The downloaded manifest is still mapped and validated photo by
 * photo before any local selection is applied.
 */
export function rankGoogleDriveVersionsForWorkspace(
  versions: DesktopCloudProjectVersion[],
  workspace: GoogleDriveWorkspaceMatch,
): DesktopCloudProjectVersion[] {
  const expectedWorkspaceId = normalizedMatchValue(workspace.workspaceId);
  const expectedProjectName = normalizedMatchValue(workspace.projectName);
  const expectedFolderName = normalizedMatchValue(workspace.sourceFolderName);

  const score = (version: DesktopCloudProjectVersion): number => {
    let value = 0;
    const versionWorkspaceId = normalizedMatchValue(version.selectionId ?? version.workspaceId);
    const versionProjectName = normalizedMatchValue(version.displayName ?? version.projectName);
    const versionFolderName = normalizedMatchValue(version.sourceFolderName);
    if (expectedWorkspaceId && versionWorkspaceId === expectedWorkspaceId) value += 100;
    if (expectedProjectName && versionProjectName === expectedProjectName) value += 20;
    if (expectedFolderName && versionFolderName === expectedFolderName) value += 10;
    if (typeof workspace.totalAssets === "number" && version.totalAssets === workspace.totalAssets) value += 5;
    return value;
  };

  return versions
    .filter((version) => (version.workspaceMode ?? version.kind ?? "project") === workspace.mode)
    .sort((left, right) => score(right) - score(left) || right.createdAt.localeCompare(left.createdAt));
}

export async function exportProjectToGoogleDrive(
  manifest: DesktopCloudProjectManifest,
): Promise<DesktopCloudProjectVersion> {
  const api = getApi();
  if (!api?.exportPhotoSelectorProjectToDrive) {
    throw new Error("Google Drive è disponibile solo nella shell desktop FileX.");
  }
  return api.exportPhotoSelectorProjectToDrive(manifest);
}

export async function listGoogleDriveVersions(
  projectName?: string,
): Promise<DesktopCloudProjectVersion[]> {
  const api = getApi();
  if (!api?.listPhotoSelectorDriveVersions) {
    throw new Error("Google Drive è disponibile solo nella shell desktop FileX.");
  }
  return api.listPhotoSelectorDriveVersions(projectName);
}

export async function downloadGoogleDriveVersion(
  versionId: string,
): Promise<DesktopCloudProjectManifest> {
  const api = getApi();
  if (!api?.downloadPhotoSelectorDriveVersion) {
    throw new Error("Google Drive è disponibile solo nella shell desktop FileX.");
  }
  return api.downloadPhotoSelectorDriveVersion(versionId);
}
