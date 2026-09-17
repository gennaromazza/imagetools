import type { DesktopAlbumFlowHandoffManifestV1 } from "@photo-tools/desktop-contracts";

export const MAX_ALBUM_HANDOFF_BYTES = 16 * 1024 * 1024;
export const MAX_ALBUM_ASSETS = 10_000;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, max = 32768): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && !value.includes("\0");
}
function strings(value: unknown, max = 256): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every((item) => text(item, 1024));
}
function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
function fail(): never { throw new Error("Manifest Album Flow non valido o incoerente."); }

/** Validate untrusted IPC / disk JSON before publishing it or acknowledging receipt. */
export function parseAlbumFlowManifest(value: unknown): DesktopAlbumFlowHandoffManifestV1 {
  if (!record(value) || value.schemaVersion !== 1 || value.sourceToolId !== "photo-selector-app"
    || !text(value.handoffId, 128) || !text(value.sourceRoot) || !text(value.projectId, 256)
    || !text(value.projectName, 256) || !text(value.createdAt, 64) || !text(value.expiresAt, 64)
    || !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.expiresAt))
    || Date.parse(value.expiresAt) <= Date.parse(value.createdAt)
    || (value.selectorRevision !== undefined && !text(value.selectorRevision, 256))
    || !Array.isArray(value.labels) || value.labels.length > 1000
    || !Array.isArray(value.assets) || !value.assets.length || value.assets.length > MAX_ALBUM_ASSETS) fail();
  const labelIds = new Set<string>();
  const labels = value.labels.map((label) => {
    if (!record(label) || !text(label.id, 1024) || labelIds.has(label.id) || !text(label.name, 256)
      || !["selector-color", "selector-custom"].includes(String(label.source))
      || (label.color !== undefined && (typeof label.color !== "string" || !/^#[0-9a-f]{6}$/i.test(label.color)))) fail();
    labelIds.add(label.id);
    return { id: label.id, name: label.name, source: label.source as "selector-color" | "selector-custom",
      ...(label.color ? { color: label.color as string } : {}) };
  });
  const assetIds = new Set<string>();
  let selectionOrder = 0;
  const assets = value.assets.map((asset) => {
    if (!record(asset) || !text(asset.assetId, 1024) || assetIds.has(asset.assetId)
      || !text(asset.relativePath) || !text(asset.fileName, 1024)
      || (asset.absolutePath !== undefined && !text(asset.absolutePath))
      || (asset.sourceFileKey !== undefined && !text(asset.sourceFileKey, 32768))
      || !positive(asset.width) || !positive(asset.height) || !positive(asset.aspectRatio)
      || !["vertical", "horizontal", "square"].includes(String(asset.orientation))
      || typeof asset.selected !== "boolean" || !Number.isInteger(asset.rating)
      || (asset.rating as number) < 0 || (asset.rating as number) > 5
      || !["picked", "rejected", "unmarked"].includes(String(asset.pickStatus))
      || (asset.colorLabel !== null && !["red", "yellow", "green", "blue", "purple"].includes(String(asset.colorLabel)))
      || !strings(asset.customLabels) || !strings(asset.labelIds)
      || asset.labelIds.some((id) => !labelIds.has(id))
      || new Set(asset.labelIds).size !== asset.labelIds.length
      || (asset.rotationDegrees !== undefined && ![0, 90, 180, 270].includes(asset.rotationDegrees as number))
      || (asset.size !== undefined && (!Number.isSafeInteger(asset.size) || (asset.size as number) < 0))
      || asset.selectionOrder !== (asset.selected ? selectionOrder++ : -1)) fail();
    const relative = asset.relativePath.replace(/\\/g, "/");
    if (/^(\/|[a-z]:)/i.test(relative) || relative.split("/").some((part) => !part || part === "." || part === "..")) fail();
    assetIds.add(asset.assetId);
    // Whitelist fields: previews, executable content and arbitrary properties never cross the boundary.
    return {
      assetId: asset.assetId, relativePath: relative, fileName: asset.fileName,
      absolutePath: asset.absolutePath as string | undefined,
      sourceFileKey: asset.sourceFileKey as string | undefined,
      width: asset.width, height: asset.height, aspectRatio: asset.aspectRatio,
      orientation: asset.orientation as "vertical" | "horizontal" | "square",
      selected: asset.selected, selectionOrder: asset.selectionOrder as number,
      rating: asset.rating as number, pickStatus: asset.pickStatus as "picked" | "rejected" | "unmarked",
      colorLabel: asset.colorLabel as "red" | "yellow" | "green" | "blue" | "purple" | null,
      customLabels: [...asset.customLabels], labelIds: [...asset.labelIds],
      rotationDegrees: asset.rotationDegrees as number | undefined, size: asset.size as number | undefined,
    };
  });
  if (!selectionOrder) fail();
  return {
    schemaVersion: 1, sourceToolId: "photo-selector-app",
    handoffId: value.handoffId, projectId: value.projectId, projectName: value.projectName,
    sourceRoot: value.sourceRoot, selectorRevision: value.selectorRevision as string | undefined,
    createdAt: value.createdAt, expiresAt: value.expiresAt, labels, assets,
  };
}
