export type DesktopToolId =
  | "auto-layout-app"
  | "image-party-frame"
  | "image-id-print"
  | "archivio-flow"
  | "photo-selector-app";

export interface DesktopRuntimeInfo {
  shell: "electron";
  platform: string;
  isPackaged: boolean;
  appVersion: string;
  toolId: DesktopToolId;
  toolName: string;
}

export interface DesktopFolderEntry {
  name: string;
  relativePath: string;
  absolutePath: string;
  size: number;
  lastModified: number;
}

export interface DesktopFolderOpenResult {
  name: string;
  rootPath: string;
  entries: DesktopFolderEntry[];
}

export interface DesktopFilePayload {
  name: string;
  absolutePath: string;
  bytes: Uint8Array;
  size: number;
  lastModified: number;
}

export interface DesktopRenderedImage {
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
}

export interface FileXDesktopApi {
  getRuntimeInfo: () => Promise<DesktopRuntimeInfo>;
  openFolder: () => Promise<DesktopFolderOpenResult | null>;
  reopenFolder: (rootPath: string) => Promise<DesktopFolderOpenResult | null>;
  readFile: (absolutePath: string) => Promise<DesktopFilePayload | null>;
  getThumbnail: (
    absolutePath: string,
    maxDimension: number,
    quality: number,
  ) => Promise<DesktopRenderedImage | null>;
  getPreview: (absolutePath: string) => Promise<DesktopRenderedImage | null>;
  readSidecarXmp: (absolutePath: string) => Promise<string | null>;
  writeSidecarXmp: (absolutePath: string, xml: string) => Promise<boolean>;
}
