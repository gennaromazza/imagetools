import { buildAutoLayoutResult, createAutoLayoutPlan } from "@photo-tools/core";
import { DEFAULT_AUTO_LAYOUT_REQUEST } from "@photo-tools/presets";
import type { AutoLayoutRequest, AutoLayoutResult, ColorLabel, ImageAsset, OutputFormat, PickStatus } from "@photo-tools/shared-types";
import type { Project } from "./components/ProjectDashboard";

export const PROJECTS_STORAGE_KEY = "imagetool-projects";

const DEFAULT_PROJECT_REQUEST: AutoLayoutRequest = {
  ...DEFAULT_AUTO_LAYOUT_REQUEST,
  assets: [],
  output: { ...DEFAULT_AUTO_LAYOUT_REQUEST.output },
  sheet: { ...DEFAULT_AUTO_LAYOUT_REQUEST.sheet }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function toNumberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toBooleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toPickStatus(value: unknown): PickStatus {
  return value === "picked" || value === "rejected" || value === "unmarked" ? value : "unmarked";
}

function toColorLabel(value: unknown): ColorLabel | null {
  return value === "red" || value === "yellow" || value === "green" || value === "blue" || value === "purple"
    ? value
    : null;
}

function toOutputFormat(value: unknown, fallback: OutputFormat): OutputFormat {
  return value === "jpg" || value === "png" || value === "tif" ? value : fallback;
}

function normalizeImageAsset(rawAsset: unknown): ImageAsset | null {
  if (!isRecord(rawAsset)) {
    return null;
  }

  const fileName = toStringValue(rawAsset.fileName, "immagine");
  const path = toStringValue(rawAsset.path, fileName);
  const width = toNumberValue(rawAsset.width, 0);
  const height = toNumberValue(rawAsset.height, 0);
  const fallbackOrientation = height > width ? "vertical" : width > height ? "horizontal" : "square";
  const orientation =
    rawAsset.orientation === "vertical" || rawAsset.orientation === "horizontal" || rawAsset.orientation === "square"
      ? rawAsset.orientation
      : fallbackOrientation;

  return {
    id: toStringValue(rawAsset.id, path),
    fileName,
    path,
    sourceFileKey: toStringValue(rawAsset.sourceFileKey, path),
    rating: Math.max(0, Math.min(5, Math.round(toNumberValue(rawAsset.rating, 0)))),
    pickStatus: toPickStatus(rawAsset.pickStatus),
    colorLabel: toColorLabel(rawAsset.colorLabel),
    width,
    height,
    orientation,
    aspectRatio: toNumberValue(rawAsset.aspectRatio, height > 0 ? width / height : 1),
    sourceUrl: typeof rawAsset.sourceUrl === "string" ? rawAsset.sourceUrl : undefined,
    thumbnailUrl: typeof rawAsset.thumbnailUrl === "string" ? rawAsset.thumbnailUrl : undefined,
    previewUrl: typeof rawAsset.previewUrl === "string" ? rawAsset.previewUrl : undefined
  };
}

function normalizeAssets(rawAssets: unknown, fallbackAssets: ImageAsset[] = []): ImageAsset[] {
  if (!Array.isArray(rawAssets)) {
    return fallbackAssets;
  }

  const normalized = rawAssets
    .map((asset) => normalizeImageAsset(asset))
    .filter((asset): asset is ImageAsset => asset !== null);

  return normalized.length > 0 ? normalized : fallbackAssets;
}

function stripAssetUrls(asset: ImageAsset): ImageAsset {
  return {
    ...asset,
    sourceUrl: undefined,
    thumbnailUrl: undefined,
    previewUrl: undefined
  };
}

function stripAssetUrlsFromRequest(request: AutoLayoutRequest): AutoLayoutRequest {
  return {
    ...request,
    assets: request.assets.map(stripAssetUrls)
  };
}

function stripAssetUrlsFromResult(result: AutoLayoutResult): AutoLayoutResult {
  return {
    ...result,
    request: stripAssetUrlsFromRequest(result.request),
    unassignedAssets: result.unassignedAssets.map(stripAssetUrls)
  };
}

function normalizeRequest(rawRequest: unknown, fallbackAssets: ImageAsset[]): AutoLayoutRequest {
  const request = isRecord(rawRequest) ? rawRequest : {};
  const sheet = isRecord(request.sheet) ? request.sheet : {};
  const output = isRecord(request.output) ? request.output : {};
  const assets = normalizeAssets(request.assets, fallbackAssets);

  return {
    ...DEFAULT_PROJECT_REQUEST,
    jobName: toStringValue(request.jobName, DEFAULT_PROJECT_REQUEST.jobName),
    sourceFolderPath: toStringValue(request.sourceFolderPath, DEFAULT_PROJECT_REQUEST.sourceFolderPath),
    assets,
    fitMode:
      request.fitMode === "fit" || request.fitMode === "fill" || request.fitMode === "crop"
        ? request.fitMode
        : DEFAULT_PROJECT_REQUEST.fitMode,
    planningMode:
      request.planningMode === "desiredSheetCount" || request.planningMode === "maxPhotosPerSheet"
        ? request.planningMode
        : DEFAULT_PROJECT_REQUEST.planningMode,
    desiredSheetCount: toNumberValue(request.desiredSheetCount, DEFAULT_PROJECT_REQUEST.desiredSheetCount ?? 0),
    maxPhotosPerSheet: toNumberValue(request.maxPhotosPerSheet, DEFAULT_PROJECT_REQUEST.maxPhotosPerSheet ?? 0),
    allowTemplateVariation: toBooleanValue(
      request.allowTemplateVariation,
      DEFAULT_PROJECT_REQUEST.allowTemplateVariation
    ),
    templates: Array.isArray(request.templates) ? request.templates : DEFAULT_PROJECT_REQUEST.templates,
    sheet: {
      ...DEFAULT_PROJECT_REQUEST.sheet,
      presetId: toStringValue(sheet.presetId, DEFAULT_PROJECT_REQUEST.sheet.presetId),
      label: toStringValue(sheet.label, DEFAULT_PROJECT_REQUEST.sheet.label),
      widthCm: toNumberValue(sheet.widthCm, DEFAULT_PROJECT_REQUEST.sheet.widthCm),
      heightCm: toNumberValue(sheet.heightCm, DEFAULT_PROJECT_REQUEST.sheet.heightCm),
      dpi: toNumberValue(sheet.dpi, DEFAULT_PROJECT_REQUEST.sheet.dpi),
      marginCm: toNumberValue(sheet.marginCm, DEFAULT_PROJECT_REQUEST.sheet.marginCm),
      gapCm: toNumberValue(sheet.gapCm, DEFAULT_PROJECT_REQUEST.sheet.gapCm),
      bleedCm: toNumberValue(sheet.bleedCm, DEFAULT_PROJECT_REQUEST.sheet.bleedCm ?? 0),
      backgroundColor: toStringValue(sheet.backgroundColor, DEFAULT_PROJECT_REQUEST.sheet.backgroundColor ?? "#ffffff"),
      backgroundImageUrl: typeof sheet.backgroundImageUrl === "string" ? sheet.backgroundImageUrl : "",
      photoBorderColor: toStringValue(sheet.photoBorderColor, DEFAULT_PROJECT_REQUEST.sheet.photoBorderColor ?? "#ffffff"),
      photoBorderWidthCm: toNumberValue(sheet.photoBorderWidthCm, DEFAULT_PROJECT_REQUEST.sheet.photoBorderWidthCm ?? 0)
    },
    output: {
      ...DEFAULT_PROJECT_REQUEST.output,
      folderPath: toStringValue(output.folderPath, DEFAULT_PROJECT_REQUEST.output.folderPath),
      format: toOutputFormat(output.format, DEFAULT_PROJECT_REQUEST.output.format),
      fileNamePattern: toStringValue(output.fileNamePattern, DEFAULT_PROJECT_REQUEST.output.fileNamePattern),
      quality: toNumberValue(output.quality, DEFAULT_PROJECT_REQUEST.output.quality)
    }
  };
}

function normalizeResult(rawResult: unknown, fallbackRequest: AutoLayoutRequest): AutoLayoutResult | undefined {
  if (!isRecord(rawResult)) {
    return undefined;
  }

  const request = normalizeRequest(rawResult.request, fallbackRequest.assets);
  const fallbackPlan = createAutoLayoutPlan(request);

  if (!Array.isArray(rawResult.pages)) {
    return fallbackPlan;
  }

  try {
    return buildAutoLayoutResult(
      request,
      rawResult.pages as AutoLayoutResult["pages"],
      Array.isArray(rawResult.availableTemplates)
        ? (rawResult.availableTemplates as AutoLayoutResult["availableTemplates"])
        : fallbackPlan.availableTemplates
    );
  } catch {
    return fallbackPlan;
  }
}

export function normalizeProjectRecord(
  rawProject: unknown,
  options: { fallbackCatalogAssets?: ImageAsset[] } = {}
): Project | null {
  if (!isRecord(rawProject)) {
    return null;
  }

  const fallbackCatalogAssets = options.fallbackCatalogAssets ?? [];
  const rawCatalogAssets = normalizeAssets(rawProject.catalogAssets, fallbackCatalogAssets);
  const request = normalizeRequest(rawProject.request, rawCatalogAssets);
  const catalogAssets = rawCatalogAssets.length > 0 ? rawCatalogAssets : request.assets;
  const normalizedRequest = normalizeRequest(rawProject.request, catalogAssets);
  const result = normalizeResult(rawProject.result, normalizedRequest);

  return {
    id: toStringValue(rawProject.id, `project-${Date.now()}`),
    name: toStringValue(rawProject.name, "Progetto senza nome"),
    createdAt: toNumberValue(rawProject.createdAt, Date.now()),
    updatedAt: toNumberValue(rawProject.updatedAt, Date.now()),
    request: normalizedRequest,
    result,
    catalogAssets,
    assetCount: catalogAssets.length,
    pageCount: result?.pages.length ?? toNumberValue(rawProject.pageCount, 0)
  };
}

export function loadStoredProjects(): Project[] {
  const saved = localStorage.getItem(PROJECTS_STORAGE_KEY);
  if (!saved) {
    return [];
  }

  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) {
      localStorage.removeItem(PROJECTS_STORAGE_KEY);
      return [];
    }

    return parsed
      .map((project) => normalizeProjectRecord(project))
      .filter((project): project is Project => project !== null);
  } catch (error) {
    console.error("Impossibile leggere i progetti salvati:", error);
    localStorage.removeItem(PROJECTS_STORAGE_KEY);
    return [];
  }
}

export function saveStoredProjects(projects: Project[]): void {
  localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
}

export function createPersistentProjectSnapshot(project: Project): Project {
  return {
    ...project,
    request: stripAssetUrlsFromRequest(project.request),
    result: project.result ? stripAssetUrlsFromResult(project.result) : undefined,
    catalogAssets: project.catalogAssets?.map(stripAssetUrls)
  };
}
