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
    return { configured: false, connected: false, accountEmail: null };
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
