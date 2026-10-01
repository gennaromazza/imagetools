import type { ImageAsset, SheetSpec } from "./auto-layout";
import type { AlbumAssetTag, AlbumLabelDefinition } from "./album-flow";

/** Modello v2 di Album Flow: spread con aree di lavoro e layout ad albero (vedi docs/album-flow/AF-002-ENGINE-V2-SPEC.md). */

/** Larghezza dell'area sinistra rispetto allo spread: intero, 1/2, 1/3 oppure 2/3. */
export type AlbumSplitMode = "full" | "half" | "third" | "two-thirds";
export type AreaFitMode = "fill" | "fit";
export type AreaAlign = "start" | "center" | "end";
export type AlbumStage = "pending" | "editing" | "proofing" | "complete";
export type AlbumSortKey = "capture-time" | "file-name" | "selector-order" | "manual";

export interface AreaStyle {
  gapCm: number;
  paddingCm: number;
  borderCm: number;
  borderColor: string;
  background: string;
  mode: AreaFitMode;
  align: AreaAlign;
  /** Mostra le foto dell'area in bianco e nero. */
  mono: boolean;
}

/** Albero guillotine: "row" affianca i figli, "column" li impila. `ratio` è la quota del primo figlio. */
export type LayoutNode =
  | { kind: "leaf"; itemId: string }
  | { kind: "split"; dir: "row" | "column"; ratio: number; first: LayoutNode; second: LayoutNode };

/** Posizionamento di una foto: l'inquadratura appartiene alla foto, non alla cella. */
export interface AlbumItem {
  id: string;
  assetId: string;
  /** 1 = riempie la cella; fino a 6. */
  zoom: number;
  /** Centro normalizzato (0-1) della zona visibile. */
  cx: number;
  cy: number;
  locked?: boolean;
}

/**
 * Cornice libera di un template con foto che possono sovrapporsi: posizione e misure in frazione dell'area utile
 * (0-1), rotazione in gradi, livello (più alto = più in primo piano).
 */
export interface FreeFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  z: number;
}

export interface AlbumArea {
  id: string;
  style: AreaStyle;
  layout: LayoutNode | null;
  /**
   * Disposizione libera (da un template con sovrapposizioni): cornice di ogni foto per identificativo. Se manca una cornice
   * per qualche foto vale il layout ad albero, che resta sempre coerente come riserva.
   */
  free?: Record<string, FreeFrame>;
  /** Nell'ordine di lettura delle foglie del layout. */
  items: AlbumItem[];
  /** Seme dello shuffle: indice nella lista dei layout candidati. */
  seed: number;
}

export interface AlbumSpread {
  id: string;
  split: AlbumSplitMode;
  /** Gli stili delle aree restano uguali (Ctrl+L). */
  linked: boolean;
  /** Una sola area con "full", altrimenti due (sinistra, destra). */
  areas: AlbumArea[];
  /** Segnato come finito: Auto Build, Mescola e i layout automatici non lo toccano. */
  done?: boolean;
}

/** A che tipo di area si applica un template: pagina (metà spread), foglio intero, un terzo o due terzi. */
export type TemplateTarget = "page" | "full" | "third" | "two-thirds";

/** Template disegnato dall'utente: disposizione ad albero (senza sovrapposizioni) o libera (con sovrapposizioni). */
export interface AreaTemplate {
  id: string;
  name: string;
  kind: "tree" | "free";
  target: TemplateTarget;
  /** Numero di foto che il template ospita. */
  count: number;
  /** Per kind "tree": la forma (foglie numerate in ordine di lettura). */
  shape?: LayoutNode;
  /** Per kind "free": una cornice per foto, nell'ordine di lettura (alto-sinistra → basso-destra). */
  frames?: FreeFrame[];
  createdAt: string;
}

export interface FavoriteLayout {
  id: string;
  name?: string;
  itemCount: number;
  layout: LayoutNode;
}

export interface AlbumChapterV2 {
  id: string;
  title: string;
  /** Colore della scheda nella libreria. */
  color: string;
  assetIds: string[];
}

export interface AlbumAssetV2 extends ImageAsset {
  /** Percorso assoluto sul disco quando la foto arriva dall'app desktop. */
  absolutePath?: string;
  /** Ordine scelto in Image Select Pro, se la foto arriva da lì. */
  selectionOrder?: number;
  /** Ora di scatto in millisecondi (EXIF), se nota. */
  captureTimeMs?: number;
  /** Posizione manuale nella libreria (usata con ordinamento "manual"). */
  manualOrder?: number;
  albumTags?: AlbumAssetTag[];
  labelIds?: string[];
  importedAt?: string;
  /** Stelle come le ha date il Selector (o il file XMP) l'ultima volta: servono a riallinearle o a non sovrascrivere le tue. */
  selectorRating?: number;
}

export interface AlbumProjectSettingsV2 {
  sheet: SheetSpec;
  sortKey: AlbumSortKey;
  defaultStyle: AreaStyle;
  /** «selector»: le stelle sono quelle di Image Select Pro (si scrivono anche nel file XMP e un nuovo invio le aggiorna); «project»: stelle solo di questo album, i file XMP non si toccano. Se manca vale «selector». */
  ratingPolicy?: "selector" | "project";
}

export interface AlbumProjectV2 {
  schemaVersion: 2;
  projectId: string;
  projectName: string;
  sourceFolderPath: string;
  createdAt: string;
  updatedAt: string;
  stage: AlbumStage;
  selectorRevision?: string;
  assets: AlbumAssetV2[];
  labels: AlbumLabelDefinition[];
  chapters: AlbumChapterV2[];
  spreads: AlbumSpread[];
  favoriteLayouts: FavoriteLayout[];
  settings: AlbumProjectSettingsV2;
}
