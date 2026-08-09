import type { DesktopReleaseChannel, DesktopToolId } from "@photo-tools/desktop-contracts";

export interface DesktopToolDescriptor {
  id: DesktopToolId;
  displayName: string;
  productName: string;
  executableName: string;
  legacyUpgradeDisplayNames?: string[];
  legacyExecutableNames?: string[];
  workspacePackageName: string;
  versionPackageRelativeToShell: string;
  workspaceDistDirRelativeToShell: string;
  packagedDistDir: string;
  brandAssetName: string;
  defaultWindowWidth: number;
  defaultWindowHeight: number;
  minWindowWidth: number;
  minWindowHeight: number;
  devUrl?: string;
  releaseChannelDefault: DesktopReleaseChannel;
  releaseManifestKey: string;
  aiSidecarOptional?: boolean;
  suiteVisible: boolean;
}

export const desktopToolManifest = {
  "suite-launcher": {
    id: "suite-launcher",
    displayName: "FileX Suite",
    productName: "FileX Suite",
    executableName: "FileX-Suite",
    legacyUpgradeDisplayNames: ["FileX Suite", "FileX Desktop Suite"],
    workspacePackageName: "@photo-tools/filex-desktop",
    versionPackageRelativeToShell: ".",
    workspaceDistDirRelativeToShell: ".output/suite-launcher",
    packagedDistDir: "apps/filex-desktop/suite-launcher",
    brandAssetName: "LOGO_Image_tool",
    defaultWindowWidth: 1480,
    defaultWindowHeight: 920,
    minWindowWidth: 1180,
    minWindowHeight: 760,
    releaseChannelDefault: "stable",
    releaseManifestKey: "suite-launcher",
    suiteVisible: false,
  },
  "image-party-frame": {
    id: "image-party-frame",
    displayName: "Image Party Frame",
    productName: "Image Party Frame",
    executableName: "Image-Party-Frame",
    legacyUpgradeDisplayNames: ["Image Party Frame"],
    workspacePackageName: "@photo-tools/image-party-frame-app",
    versionPackageRelativeToShell: "../image-party-frame",
    workspaceDistDirRelativeToShell: "../image-party-frame/.output/web",
    packagedDistDir: "apps/image-party-frame/web",
    brandAssetName: "logo",
    defaultWindowWidth: 1600,
    defaultWindowHeight: 1000,
    minWindowWidth: 1280,
    minWindowHeight: 820,
    releaseChannelDefault: "stable",
    releaseManifestKey: "image-party-frame",
    suiteVisible: true,
  },
  "batch-print-layout": {
    id: "batch-print-layout",
    displayName: "Batch Print Layout",
    productName: "Batch Print Layout",
    executableName: "Batch-Print-Layout",
    legacyUpgradeDisplayNames: ["Batch Print Layout"],
    workspacePackageName: "@photo-tools/batch-print-layout",
    versionPackageRelativeToShell: "../batch-print-layout",
    workspaceDistDirRelativeToShell: "../batch-print-layout/.output/web",
    packagedDistDir: "apps/batch-print-layout/web",
    brandAssetName: "LOGO_Image_tool",
    defaultWindowWidth: 1540,
    defaultWindowHeight: 980,
    minWindowWidth: 1180,
    minWindowHeight: 760,
    devUrl: "http://127.0.0.1:4205",
    releaseChannelDefault: "stable",
    releaseManifestKey: "batch-print-layout",
    suiteVisible: true,
  },
  "archivio-flow": {
    id: "archivio-flow",
    displayName: "Archivio Flow",
    productName: "Archivio Flow",
    executableName: "Archivio-Flow",
    legacyUpgradeDisplayNames: ["Archivio Flow"],
    workspacePackageName: "@photo-tools/archivio-flow",
    versionPackageRelativeToShell: "../archivio-flow",
    workspaceDistDirRelativeToShell: "../archivio-flow/.output/web",
    packagedDistDir: "apps/archivio-flow/web",
    brandAssetName: "photo_Archivie",
    defaultWindowWidth: 1540,
    defaultWindowHeight: 980,
    minWindowWidth: 1220,
    minWindowHeight: 800,
    releaseChannelDefault: "stable",
    releaseManifestKey: "archivio-flow",
    suiteVisible: true,
  },
  "image-converter": {
    id: "image-converter",
    displayName: "Image Converter",
    productName: "Image Converter",
    executableName: "Image-Converter",
    legacyUpgradeDisplayNames: ["Image Converter"],
    workspacePackageName: "@photo-tools/image-converter",
    versionPackageRelativeToShell: "../image-converter",
    workspaceDistDirRelativeToShell: "../image-converter/.output/web",
    packagedDistDir: "apps/image-converter/web",
    brandAssetName: "LOGO_Image_tool",
    defaultWindowWidth: 1440,
    defaultWindowHeight: 940,
    minWindowWidth: 1100,
    minWindowHeight: 740,
    releaseChannelDefault: "stable",
    releaseManifestKey: "image-converter",
    suiteVisible: true,
  },
  "image-file-finder": {
    id: "image-file-finder",
    displayName: "Trova Foto da Lista",
    productName: "Trova Foto da Lista",
    executableName: "Trova-Foto-da-Lista",
    legacyUpgradeDisplayNames: ["Trova Foto da Lista"],
    workspacePackageName: "@photo-tools/image-file-finder",
    versionPackageRelativeToShell: "../image-file-finder",
    workspaceDistDirRelativeToShell: "../image-file-finder/.output/web",
    packagedDistDir: "apps/image-file-finder/web",
    brandAssetName: "LOGO_Image_tool",
    defaultWindowWidth: 1440,
    defaultWindowHeight: 940,
    minWindowWidth: 1100,
    minWindowHeight: 740,
    devUrl: "http://127.0.0.1:4215",
    releaseChannelDefault: "stable",
    releaseManifestKey: "image-file-finder",
    suiteVisible: true,
  },
  "photo-selector-app": {
    id: "photo-selector-app",
    displayName: "Image Select Pro",
    productName: "Image Select Pro",
    executableName: "Image-Select-Pro",
    legacyUpgradeDisplayNames: [
      "Image Select Pro",
      "Image-Select-Pro",
      "Selezione Foto",
      "Image_selection",
      "Image Selection",
      "Photo Tools | Selezione Foto",
    ],
    legacyExecutableNames: [
      "Image_selection",
      "Image Selection",
      "Selezione-Foto",
    ],
    workspacePackageName: "@photo-tools/photo-selector-app",
    versionPackageRelativeToShell: "../photo-selector-app",
    workspaceDistDirRelativeToShell: "../photo-selector-app/.output/web",
    packagedDistDir: "apps/photo-selector-app/web",
    brandAssetName: "photo_selector",
    defaultWindowWidth: 1680,
    defaultWindowHeight: 1020,
    minWindowWidth: 1280,
    minWindowHeight: 820,
    devUrl: "http://127.0.0.1:4175",
    releaseChannelDefault: "stable",
    releaseManifestKey: "photo-selector-app",
    suiteVisible: true,
  },
} satisfies Record<DesktopToolId, DesktopToolDescriptor>;

export function getSuiteManagedTools(): DesktopToolDescriptor[] {
  return Object.values(desktopToolManifest).filter((tool) => tool.suiteVisible);
}

export function isDesktopToolId(value: string): value is DesktopToolId {
  return value in desktopToolManifest;
}

export function getDesktopToolOrDefault(value: string | undefined): DesktopToolDescriptor {
  if (value && isDesktopToolId(value)) {
    return desktopToolManifest[value];
  }

  return desktopToolManifest["photo-selector-app"];
}

function normalizeRuntimeToken(value: string): string {
  return value.trim().toLowerCase();
}

export function findDesktopToolByRuntimeToken(value: string | undefined): DesktopToolDescriptor | null {
  if (!value) return null;
  const token = normalizeRuntimeToken(value);
  if (!token) return null;

  for (const descriptor of Object.values(desktopToolManifest)) {
    if (normalizeRuntimeToken(descriptor.id) === token) {
      return descriptor;
    }
    if (normalizeRuntimeToken(descriptor.executableName) === token) {
      return descriptor;
    }
    if (normalizeRuntimeToken(descriptor.productName) === token) {
      return descriptor;
    }
    if (normalizeRuntimeToken(descriptor.displayName) === token) {
      return descriptor;
    }
  }

  return null;
}
