import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DesktopToolId } from "@photo-tools/desktop-contracts";

export interface DesktopToolDescriptor {
  id: DesktopToolId;
  displayName: string;
  productName: string;
  signatureLine?: string;
  executableName: string;
  legacyUpgradeDisplayNames?: string[];
  workspacePackageName: string;
  workspaceDistDirRelativeToShell: string;
  packagedDistDir: string;
  brandAssetName: string;
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
    productName: "Auto Layout",
    executableName: "Auto-Layout",
    legacyUpgradeDisplayNames: ["Auto Layout"],
    workspacePackageName: "@photo-tools/auto-layout-app",
    workspaceDistDirRelativeToShell: "../auto-layout-app/dist",
    packagedDistDir: "apps/auto-layout-app/dist",
    brandAssetName: "auto_layout_logo",
    defaultWindowWidth: 1600,
    defaultWindowHeight: 1000,
    minWindowWidth: 1280,
    minWindowHeight: 820,
  },
  "image-party-frame": {
    id: "image-party-frame",
    displayName: "Image Party Frame",
    productName: "Image Party Frame",
    executableName: "Image-Party-Frame",
    legacyUpgradeDisplayNames: ["Image Party Frame"],
    workspacePackageName: "@photo-tools/image-party-frame-app",
    workspaceDistDirRelativeToShell: "../image-party-frame/dist",
    packagedDistDir: "apps/image-party-frame/dist",
    brandAssetName: "party_frame_logo",
    defaultWindowWidth: 1600,
    defaultWindowHeight: 1000,
    minWindowWidth: 1280,
    minWindowHeight: 820,
  },
  "image-id-print": {
    id: "image-id-print",
    displayName: "Image ID Print",
    productName: "Image ID Print",
    signatureLine: "by ImageStudio di Gennaro Mazzacane",
    executableName: "Image-ID-Print",
    legacyUpgradeDisplayNames: ["Image ID Print"],
    workspacePackageName: "@photo-tools/image-id-print",
    workspaceDistDirRelativeToShell: "../IMAGE ID PRINT/dist",
    packagedDistDir: "apps/IMAGE ID PRINT/dist",
    brandAssetName: "id_print_logo",
    defaultWindowWidth: 1440,
    defaultWindowHeight: 960,
    minWindowWidth: 1120,
    minWindowHeight: 760,
  },
  "archivio-flow": {
    id: "archivio-flow",
    displayName: "Archivio Flow",
    productName: "Archivio Flow",
    executableName: "Archivio-Flow",
    legacyUpgradeDisplayNames: ["Archivio Flow"],
    workspacePackageName: "@photo-tools/archivio-flow",
    workspaceDistDirRelativeToShell: "../archivio-flow/dist",
    packagedDistDir: "apps/archivio-flow/dist",
    brandAssetName: "photo_Archivie",
    defaultWindowWidth: 1540,
    defaultWindowHeight: 980,
    minWindowWidth: 1220,
    minWindowHeight: 800,
  },
  "photo-selector-app": {
    id: "photo-selector-app",
    displayName: "Selezione Foto",
    productName: "Selezione Foto",
    executableName: "Selezione-Foto",
    legacyUpgradeDisplayNames: [
      "Selezione Foto",
      "Image_selection",
      "Image Selection",
      "Photo Tools | Selezione Foto",
    ],
    workspacePackageName: "@photo-tools/photo-selector-app",
    workspaceDistDirRelativeToShell: "../photo-selector-app/dist",
    packagedDistDir: "apps/photo-selector-app/dist",
    brandAssetName: "photo_selector",
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

function readPackagedToolId(): DesktopToolId | undefined {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const currentDir = dirname(currentFile);
    const packageJsonPath = resolve(currentDir, "..", "package.json");
    if (!existsSync(packageJsonPath)) {
      return undefined;
    }

    const payload = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      filexTool?: string;
    };
    return payload.filexTool && isDesktopToolId(payload.filexTool)
      ? payload.filexTool
      : undefined;
  } catch {
    return undefined;
  }
}

export function getDesktopToolOrDefault(value: string | undefined): DesktopToolDescriptor {
  const explicitTool = value && isDesktopToolId(value) ? value : readPackagedToolId();
  if (explicitTool) {
    return desktopToolManifest[explicitTool];
  }

  return desktopToolManifest["photo-selector-app"];
}
