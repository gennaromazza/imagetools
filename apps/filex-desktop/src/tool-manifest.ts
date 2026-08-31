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
  electronMainOutputFile: string;
  electronPreloadOutputFile: string;
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
  licenseRuntime: "management" | "shared-runtime" | "standalone";
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
    electronMainOutputFile: "suite-main.js",
    electronPreloadOutputFile: "suite-preload.js",
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
    licenseRuntime: "management",
  },
  "image-party-frame": {
    id: "image-party-frame",
    displayName: "Image Party Frame",
    productName: "Image Party Frame",
    executableName: "Image-Party-Frame",
    legacyUpgradeDisplayNames: ["Image Party Frame"],
    workspacePackageName: "@photo-tools/image-party-frame-app",
    versionPackageRelativeToShell: "../image-party-frame",
    electronMainOutputFile: "main.js",
    electronPreloadOutputFile: "preload.js",
    workspaceDistDirRelativeToShell: "../image-party-frame/.output/web",
    packagedDistDir: "apps/image-party-frame/web",
    brandAssetName: "logo",
    defaultWindowWidth: 1600,
    defaultWindowHeight: 1000,
    minWindowWidth: 1280,
    minWindowHeight: 820,
    devUrl: "http://127.0.0.1:4170",
    releaseChannelDefault: "stable",
    releaseManifestKey: "image-party-frame",
    suiteVisible: true,
    licenseRuntime: "shared-runtime",
  },
  "batch-print-layout": {
    id: "batch-print-layout",
    displayName: "Batch Print Layout",
    productName: "Batch Print Layout",
    executableName: "Batch-Print-Layout",
    legacyUpgradeDisplayNames: ["Batch Print Layout"],
    workspacePackageName: "@photo-tools/batch-print-layout",
    versionPackageRelativeToShell: "../batch-print-layout",
    electronMainOutputFile: "main.js",
    electronPreloadOutputFile: "preload.js",
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
    licenseRuntime: "shared-runtime",
  },
  "id-photo": {
    id: "id-photo",
    displayName: "FileX ID Photo",
    productName: "FileX ID Photo",
    executableName: "FileX-ID-Photo",
    legacyUpgradeDisplayNames: ["FileX ID Photo"],
    workspacePackageName: "@photo-tools/id-photo",
    versionPackageRelativeToShell: "../id-photo",
    electronMainOutputFile: "main.js",
    electronPreloadOutputFile: "preload.js",
    workspaceDistDirRelativeToShell: "../id-photo/.output/web",
    packagedDistDir: "apps/id-photo/web",
    brandAssetName: "id-photo",
    defaultWindowWidth: 1540,
    defaultWindowHeight: 980,
    minWindowWidth: 1180,
    minWindowHeight: 760,
    devUrl: "http://127.0.0.1:4225",
    releaseChannelDefault: "stable",
    releaseManifestKey: "id-photo",
    suiteVisible: true,
    licenseRuntime: "shared-runtime",
  },
  "archivio-flow": {
    id: "archivio-flow",
    displayName: "Archivio Flow",
    productName: "Archivio Flow",
    executableName: "Archivio-Flow",
    legacyUpgradeDisplayNames: ["Archivio Flow"],
    workspacePackageName: "@photo-tools/archivio-flow",
    versionPackageRelativeToShell: "../archivio-flow",
    electronMainOutputFile: "main.js",
    electronPreloadOutputFile: "preload.js",
    workspaceDistDirRelativeToShell: "../archivio-flow/.output/web",
    packagedDistDir: "apps/archivio-flow/web",
    brandAssetName: "photo_Archivie",
    defaultWindowWidth: 1540,
    defaultWindowHeight: 980,
    minWindowWidth: 1220,
    minWindowHeight: 800,
    devUrl: "http://127.0.0.1:4175",
    releaseChannelDefault: "stable",
    releaseManifestKey: "archivio-flow",
    suiteVisible: true,
    licenseRuntime: "shared-runtime",
  },
  "image-converter": {
    id: "image-converter",
    displayName: "Image Converter",
    productName: "Image Converter",
    executableName: "Image-Converter",
    legacyUpgradeDisplayNames: ["Image Converter"],
    workspacePackageName: "@photo-tools/image-converter",
    versionPackageRelativeToShell: "../image-converter",
    electronMainOutputFile: "main.js",
    electronPreloadOutputFile: "preload.js",
    workspaceDistDirRelativeToShell: "../image-converter/.output/web",
    packagedDistDir: "apps/image-converter/web",
    brandAssetName: "LOGO_Image_tool",
    defaultWindowWidth: 1440,
    defaultWindowHeight: 940,
    minWindowWidth: 1100,
    minWindowHeight: 740,
    devUrl: "http://127.0.0.1:4185",
    releaseChannelDefault: "stable",
    releaseManifestKey: "image-converter",
    suiteVisible: true,
    licenseRuntime: "shared-runtime",
  },
  "image-file-finder": {
    id: "image-file-finder",
    displayName: "Trova Foto da Lista",
    productName: "Trova Foto da Lista",
    executableName: "Trova-Foto-da-Lista",
    legacyUpgradeDisplayNames: ["Trova Foto da Lista"],
    workspacePackageName: "@photo-tools/image-file-finder",
    versionPackageRelativeToShell: "../image-file-finder",
    electronMainOutputFile: "main.js",
    electronPreloadOutputFile: "preload.js",
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
    licenseRuntime: "shared-runtime",
  },
  "cache-sweep": {
    id: "cache-sweep",
    displayName: "FileX Adobe Cleaner",
    productName: "FileX Adobe Cleaner",
    executableName: "FileX-Adobe-Cleaner",
    legacyUpgradeDisplayNames: ["FileX Adobe Cleaner", "FileX Cache Sweep"],
    legacyExecutableNames: ["FileX-Cache-Sweep"],
    workspacePackageName: "@photo-tools/cache-sweep",
    versionPackageRelativeToShell: "../cache-sweep",
    electronMainOutputFile: "cache-sweep/electron/main.js",
    electronPreloadOutputFile: "cache-sweep/electron/preload.cjs",
    workspaceDistDirRelativeToShell: "../cache-sweep/.output/web",
    packagedDistDir: "apps/cache-sweep/web",
    brandAssetName: "cache-sweep",
    defaultWindowWidth: 1280,
    defaultWindowHeight: 900,
    minWindowWidth: 940,
    minWindowHeight: 720,
    devUrl: "http://127.0.0.1:4235",
    releaseChannelDefault: "stable",
    releaseManifestKey: "cache-sweep",
    suiteVisible: true,
    licenseRuntime: "standalone",
  },
  "filex-send": {
    id: "filex-send",
    displayName: "FileX Send",
    productName: "FileX Send",
    executableName: "FileX-Send",
    legacyUpgradeDisplayNames: ["FileX Send", "FileXSend"],
    legacyExecutableNames: ["FileXSend"],
    workspacePackageName: "@photo-tools/filex-send",
    versionPackageRelativeToShell: "../filex-send",
    electronMainOutputFile: "filex-send/electron/main.js",
    electronPreloadOutputFile: "filex-send/electron/preload.cjs",
    workspaceDistDirRelativeToShell: "../filex-send/.output/web",
    packagedDistDir: "apps/filex-send/web",
    brandAssetName: "filex-send",
    defaultWindowWidth: 1280,
    defaultWindowHeight: 860,
    minWindowWidth: 980,
    minWindowHeight: 700,
    devUrl: "http://127.0.0.1:4245",
    releaseChannelDefault: "stable",
    releaseManifestKey: "filex-send",
    suiteVisible: true,
    licenseRuntime: "standalone",
  },
  "backup-guard": {
    id: "backup-guard",
    displayName: "FileX Backup Guard",
    productName: "FileX Backup Guard",
    executableName: "FileX-Backup-Guard",
    legacyUpgradeDisplayNames: ["FileX Backup Guard"],
    workspacePackageName: "@photo-tools/backup-guard",
    versionPackageRelativeToShell: "../backup-guard",
    electronMainOutputFile: "backup-guard/electron/main.js",
    electronPreloadOutputFile: "backup-guard/electron/preload.cjs",
    workspaceDistDirRelativeToShell: "../backup-guard/.output/web",
    packagedDistDir: "apps/backup-guard/web",
    brandAssetName: "backup-guard",
    defaultWindowWidth: 1380,
    defaultWindowHeight: 920,
    minWindowWidth: 1060,
    minWindowHeight: 720,
    devUrl: "http://127.0.0.1:4255",
    releaseChannelDefault: "stable",
    releaseManifestKey: "backup-guard",
    suiteVisible: true,
    licenseRuntime: "standalone",
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
    electronMainOutputFile: "main.js",
    electronPreloadOutputFile: "preload.js",
    workspaceDistDirRelativeToShell: "../photo-selector-app/.output/web",
    packagedDistDir: "apps/photo-selector-app/web",
    brandAssetName: "photo_selector",
    defaultWindowWidth: 1680,
    defaultWindowHeight: 1020,
    minWindowWidth: 1280,
    minWindowHeight: 820,
    devUrl: "http://127.0.0.1:5000",
    releaseChannelDefault: "stable",
    releaseManifestKey: "photo-selector-app",
    suiteVisible: true,
    licenseRuntime: "shared-runtime",
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
