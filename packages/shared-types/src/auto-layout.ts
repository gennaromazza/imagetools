export type ImageOrientation = "vertical" | "horizontal" | "square";
export type PickStatus = "picked" | "rejected" | "unmarked";
export type ColorLabel = "red" | "yellow" | "green" | "blue" | "purple";
export type RulerUnit = "cm" | "px";

export type FitMode = "fit" | "fill" | "crop";

export type CropStrategy = "balanced" | "portraitSafe" | "landscapeSafe";

export type OutputFormat = "jpg" | "png" | "tif";

export type PlanningMode = "desiredSheetCount" | "maxPhotosPerSheet";

export type TemplateStyle =
  | "hero"
  | "paired"
  | "balanced-grid"
  | "editorial"
  | "collage";

export type TemplateAffinity =
  | "portrait-heavy"
  | "landscape-heavy"
  | "mixed"
  | "any";

export interface ImageAsset {
  id: string;
  fileName: string;
  path: string;
  sourceFileKey?: string;
  xmpHasEdits?: boolean;
  xmpEditInfo?: string;
  rating?: number;
  pickStatus?: PickStatus;
  colorLabel?: ColorLabel | null;
  width: number;
  height: number;
  orientation: ImageOrientation;
  aspectRatio: number;
  thumbnailUrl?: string;
  previewUrl?: string;
  sourceUrl?: string;
}

export interface SheetSpec {
  presetId: string;
  label: string;
  widthCm: number;
  heightCm: number;
  dpi: number;
  marginCm: number;
  gapCm: number;
  bleedCm?: number;
  backgroundColor?: string;
  backgroundImageUrl?: string;
  photoBorderColor?: string;
  photoBorderWidthCm?: number;
  showRulers?: boolean;
  rulerUnit?: RulerUnit;
  verticalGuidesCm?: number[];
  horizontalGuidesCm?: number[];
}

export interface LayoutSlot {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  expectedOrientation: ImageOrientation | "any";
  priority: number;
}

export interface LayoutTemplate {
  id: string;
  label: string;
  description: string;
  style: TemplateStyle;
  affinity: TemplateAffinity;
  targetSheetOrientation: "portrait" | "landscape" | "any";
  minPhotos: number;
  maxPhotos: number;
  slots: LayoutSlot[];
}

export interface LayoutAssignment {
  slotId: string;
  imageId: string;
  fitMode: FitMode;
  zoom: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  locked: boolean;
  cropLeft?: number;
  cropTop?: number;
  cropWidth?: number;
  cropHeight?: number;
}

export interface GeneratedPageLayout {
  id: string;
  pageNumber: number;
  sheetSpec: SheetSpec;
  templateId: string;
  templateLabel: string;
  slotDefinitions: LayoutSlot[];
  assignments: LayoutAssignment[];
  imageIds: string[];
  warnings: string[];
}

export interface OutputSettings {
  folderPath: string;
  format: OutputFormat;
  fileNamePattern: string;
  quality: number;
}

export interface AutoLayoutRequest {
  jobName: string;
  sourceFolderPath: string;
  assets: ImageAsset[];
  sheet: SheetSpec;
  fitMode: FitMode;
  cropStrategy: CropStrategy;
  planningMode: PlanningMode;
  desiredSheetCount?: number;
  maxPhotosPerSheet?: number;
  output: OutputSettings;
  allowTemplateVariation: boolean;
  templates?: LayoutTemplate[];
}

export interface AutoLayoutSummary {
  totalImages: number;
  targetPhotosPerSheet: number;
  generatedSheetCount: number;
  residualImages: number;
  estimatedOutputFiles: number;
  verticalCount: number;
  horizontalCount: number;
  squareCount: number;
}

export interface RenderJob {
  pageId: string;
  outputPath: string;
  format: OutputFormat;
}

export interface AutoLayoutResult {
  request: AutoLayoutRequest;
  pages: GeneratedPageLayout[];
  summary: AutoLayoutSummary;
  availableTemplates: LayoutTemplate[];
  unassignedAssets: ImageAsset[];
  warnings: string[];
  renderQueue: RenderJob[];
}

export interface SheetPreset {
  id: string;
  label: string;
  widthCm: number;
  heightCm: number;
}

export interface LayoutMove {
  sourcePageId: string;
  sourceSlotId: string;
  targetPageId: string;
  targetSlotId: string;
}

export interface ChangePageTemplateRequest {
  pageId: string;
  templateId: string;
}

export interface PlaceImageInSlotRequest {
  imageId: string;
  targetPageId: string;
  targetSlotId: string;
}

export interface ClearSlotAssignmentRequest {
  pageId: string;
  slotId: string;
}

export interface UpdateSlotAssignmentRequest {
  pageId: string;
  slotId: string;
  changes: Partial<
    Pick<
      LayoutAssignment,
      "fitMode" | "zoom" | "offsetX" | "offsetY" | "rotation" | "locked" | "cropLeft" | "cropTop" | "cropWidth" | "cropHeight"
    >
  >;
}

export interface CreatePageRequest {
  imageIds?: string[];
  templateId?: string;
}

export interface RemovePageRequest {
  pageId: string;
}

export interface UpdatePageSheetSpecRequest {
  pageId: string;
  changes: Partial<
    Pick<
      SheetSpec,
      "presetId" | "label" | "widthCm" | "heightCm" | "dpi" | "marginCm" | "gapCm" | "bleedCm" | "backgroundColor" | "backgroundImageUrl" | "photoBorderColor" | "photoBorderWidthCm" | "showRulers" | "rulerUnit" | "verticalGuidesCm" | "horizontalGuidesCm"
    >
  >;
}

export interface ToolNavigationItem {
  id: string;
  label: string;
  description: string;
  isEnabled: boolean;
}

export interface ToolSectionSchema {
  id: string;
  title: string;
  description: string;
}
