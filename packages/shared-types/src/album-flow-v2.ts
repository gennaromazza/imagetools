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
  /** Raddrizzamento della foto dentro la cella, in gradi (-45…45); assente = 0. */
  angle?: number;
  /** Forma della foto: rapporto larghezza/altezza (0,2…5). La foto occupa nella cella una finestra di questa forma, ritagliata; assente = segue la cella. */
  shape?: number;
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
  /** Layout protetto: Mescola, i layout proposti e Auto Build non lo toccano. */
  locked?: boolean;
  /** Nell'ordine di lettura delle foglie del layout. */
  items: AlbumItem[];
  /** Seme dello shuffle: indice nella lista dei layout candidati. */
  seed: number;
}

/** Aspetto di un testo: è lo stesso per un'impostazione salvata nella libreria e per un testo sullo spread. */
export interface TextStyleSpec {
  /** Identificativo di una famiglia della libreria dei font (solo font con licenza libera). */
  font: string;
  /** Corpo in punti tipografici. */
  sizePt: number;
  weight: 300 | 400 | 600 | 700;
  italic: boolean;
  color: string;
  align: "left" | "center" | "right" | "justify";
  /** Interlinea come multiplo del corpo. */
  lineHeight: number;
  /** Spaziatura tra le lettere in em (può essere negativa). */
  trackingEm: number;
  uppercase: boolean;
  /** Spazio dopo ogni paragrafo, in punti. */
  paragraphSpacePt: number;
  /** Capolettera: numero di righe che occupa (0 = nessuno). */
  dropCapLines: number;
  opacity: number;
}

/** Testo libero sullo spread; l'altezza segue il contenuto. Misure in frazione dello spread (0-1). */
export interface SpreadTextOverlay extends TextStyleSpec {
  kind: "text";
  id: string;
  x: number;
  y: number;
  w: number;
  rotation: number;
  z: number;
  text: string;
  /** Nome dello stile della libreria da cui è partito, se c'è. */
  styleName?: string;
  /** Gli elementi con lo stesso gruppo si spostano insieme (finché non vengono sganciati). */
  groupId?: string;
}

/** Elemento grafico (immagine, ornamento, filetto) preso dalla libreria. */
export interface SpreadGraphicOverlay {
  kind: "graphic";
  id: string;
  mediaId: string;
  /** Proporzioni (larghezza / altezza) dell'immagine originale. */
  aspect: number;
  x: number;
  y: number;
  w: number;
  rotation: number;
  z: number;
  opacity: number;
  groupId?: string;
}

export type SpreadOverlay = SpreadTextOverlay | SpreadGraphicOverlay;

/** Quale parte dello spread copre uno sfondo. */
export type SpreadBackgroundScope = "spread" | "left" | "right";

/** Sfondo a immagine di uno spread o di una sua pagina; la tinta dell'area resta sotto. */
export interface SpreadBackground {
  scope: SpreadBackgroundScope;
  mediaId: string;
  aspect: number;
  fit: "cover" | "contain" | "tile";
  opacity: number;
  /** Lato della piastrella in cm, solo con fit "tile". */
  tileCm?: number;
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
  /** Sfondi a immagine (al più uno per pagina, oppure uno su tutto lo spread). */
  backgrounds?: SpreadBackground[];
  /** Testi e grafiche sopra le foto, dal livello più basso al più alto. */
  overlays?: SpreadOverlay[];
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
  /** Foto scelta come copertina del progetto (mostrata nella Home); assente = la prima foto impaginata. */
  coverAssetId?: string;
  assets: AlbumAssetV2[];
  labels: AlbumLabelDefinition[];
  chapters: AlbumChapterV2[];
  spreads: AlbumSpread[];
  favoriteLayouts: FavoriteLayout[];
  settings: AlbumProjectSettingsV2;
}
