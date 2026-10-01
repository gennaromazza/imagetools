import type {
  GeneratedPageLayout,
  ImageAsset,
  LayoutTemplate,
  SheetSpec,
} from "./auto-layout";

export type AlbumProjectSchemaVersion = 1;

export interface AlbumLabelDefinition {
  id: string;
  name: string;
  color?: string;
  source: "selector-custom" | "selector-color" | "album";
}

export interface AlbumChapter {
  id: string;
  title: string;
  labelIds: string[];
  orderedAssetIds: string[];
  source: "selector-label" | "manual";
}

/** Segnalazioni editoriali per l'Auto Build: copertina, panorama, foto principale (pagina dedicata). */
export type AlbumAssetTag = "cover" | "panorama" | "main";

export interface AlbumAsset extends ImageAsset {
  albumTags?: AlbumAssetTag[];
  /** Percorso assoluto sul disco quando la foto arriva dall'app desktop. */
  absolutePath?: string;
  selected: boolean;
  selectionOrder: number;
  labelIds: string[];
  importedAt?: string;
}

export interface AlbumProjectSettings {
  sheet: SheetSpec;
  defaultFitMode: "fit" | "fill" | "crop";
  cropStrategy: "balanced" | "portraitSafe" | "landscapeSafe";
  outputFormat: "jpg" | "png" | "tif";
}

export interface AlbumProject {
  schemaVersion: AlbumProjectSchemaVersion;
  projectId: string;
  projectName: string;
  sourceFolderPath: string;
  createdAt: string;
  updatedAt: string;
  selectorRevision?: string;
  assets: AlbumAsset[];
  labels: AlbumLabelDefinition[];
  chapters: AlbumChapter[];
  pages: GeneratedPageLayout[];
  availableTemplates?: LayoutTemplate[];
  settings: AlbumProjectSettings;
}
