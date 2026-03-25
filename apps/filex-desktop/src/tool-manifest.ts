import type { DesktopToolId } from "@photo-tools/desktop-contracts";

export interface DesktopToolDescriptor {
  id: DesktopToolId;
  displayName: string;
  workspacePackageName: string;
  workspaceDistDirRelativeToShell: string;
  packagedDistDir: string;
  defaultWindowWidth: number;
  defaultWindowHeight: number;
  minWindowWidth: number;
  minWindowHeight: number;
  devUrl?: string;
}

export const desktopToolManifest = {
  "auto-layout-app": {
    id: "auto-layout-app",
    displayName: "Auto Layout",
    workspacePackageName: "@photo-tools/auto-layout-app",
    workspaceDistDirRelativeToShell: "../auto-layout-app/dist",
    packagedDistDir: "apps/auto-layout-app/dist",
    defaultWindowWidth: 1600,
    defaultWindowHeight: 1000,
    minWindowWidth: 1280,
    minWindowHeight: 820,
  },
  "image-party-frame": {
    id: "image-party-frame",
    displayName: "Image Party Frame",
    workspacePackageName: "@photo-tools/image-party-frame-app",
    workspaceDistDirRelativeToShell: "../image-party-frame/dist",
    packagedDistDir: "apps/image-party-frame/dist",
    defaultWindowWidth: 1600,
    defaultWindowHeight: 1000,
    minWindowWidth: 1280,
    minWindowHeight: 820,
  },
  "image-id-print": {
    id: "image-id-print",
    displayName: "Image ID Print",
    workspacePackageName: "@photo-tools/image-id-print",
    workspaceDistDirRelativeToShell: "../IMAGE ID PRINT/dist",
    packagedDistDir: "apps/IMAGE ID PRINT/dist",
    defaultWindowWidth: 1440,
    defaultWindowHeight: 960,
    minWindowWidth: 1120,
    minWindowHeight: 760,
  },
  "archivio-flow": {
    id: "archivio-flow",
    displayName: "Archivio Flow",
    workspacePackageName: "@photo-tools/archivio-flow",
    workspaceDistDirRelativeToShell: "../archivio-flow/dist",
    packagedDistDir: "apps/archivio-flow/dist",
    defaultWindowWidth: 1540,
    defaultWindowHeight: 980,
    minWindowWidth: 1220,
    minWindowHeight: 800,
  },
  "photo-selector-app": {
    id: "photo-selector-app",
    displayName: "Selezione Foto",
    workspacePackageName: "@photo-tools/photo-selector-app",
    workspaceDistDirRelativeToShell: "../photo-selector-app/dist",
    packagedDistDir: "apps/photo-selector-app/dist",
    defaultWindowWidth: 1680,
    defaultWindowHeight: 1020,
    minWindowWidth: 1280,
    minWindowHeight: 820,
    devUrl: "http://127.0.0.1:4175",
  },
} satisfies Record<DesktopToolId, DesktopToolDescriptor>;

export function isDesktopToolId(value: string): value is DesktopToolId {
  return value in desktopToolManifest;
}

export function getDesktopToolOrDefault(value: string | undefined): DesktopToolDescriptor {
  if (value && isDesktopToolId(value)) {
    return desktopToolManifest[value];
  }

  return desktopToolManifest["photo-selector-app"];
}
