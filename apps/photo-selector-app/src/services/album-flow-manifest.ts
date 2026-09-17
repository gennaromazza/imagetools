import type { DesktopAlbumFlowHandoffManifestV1, DesktopPhotoSelectorPreferences } from "@photo-tools/desktop-contracts";
import type { ColorLabel, ImageAsset } from "@photo-tools/shared-types";

export interface AlbumFlowManifestInput {
  projectId: string;
  projectName: string;
  sourceRoot: string;
  assets: ImageAsset[];
  activeAssetIds: readonly string[];
  orderedAssetIds?: readonly string[];
  selectorRevision?: string;
  labels?: readonly string[];
  preferences?: Pick<DesktopPhotoSelectorPreferences, "customLabelsCatalog" | "customLabelColors" | "colorNames">;
  getAbsolutePath?: (assetId: string) => string | null | undefined;
  now?: Date;
  handoffId?: string;
}

const COLORS: Record<ColorLabel, string> = { red: "#b96558", yellow: "#d7b95f", green: "#6f9f68", blue: "#5f89c8", purple: "#8b6fc7" };
const TONES = { sand: "#b89a63", rose: "#c2687a", green: "#59a373", blue: "#5088d1", purple: "#946cc7", slate: "#738493" };
const key = (name: string) => name.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

export function buildAlbumFlowManifest(input: AlbumFlowManifestInput): DesktopAlbumFlowHandoffManifestV1 {
  const now = input.now ?? new Date();
  const byId = new Map(input.assets.map((asset) => [asset.id, asset]));
  if (byId.size !== input.assets.length) throw new Error("Identificativi foto duplicati.");
  const active = new Set(input.activeAssetIds);
  if (!active.size) throw new Error("Seleziona almeno una foto per Album Flow.");
  for (const id of active) if (!byId.has(id)) throw new Error("La selezione contiene foto non più disponibili.");
  const orderedIds = [...new Set([...(input.orderedAssetIds ?? []), ...byId.keys()])].filter((id) => byId.has(id));
  const assets = orderedIds.map((id) => byId.get(id)!);
  const customNames = new Map<string, string>();
  for (const name of [
    ...(input.labels ?? []), ...(input.preferences?.customLabelsCatalog ?? []),
    ...assets.flatMap((asset) => asset.customLabels ?? []),
  ]) {
    if (key(name) && !customNames.has(key(name))) customNames.set(key(name), name);
  }
  const labels: DesktopAlbumFlowHandoffManifestV1["labels"] = [
    ...Object.entries(COLORS).map(([name, color]) => ({
      id: `color-${name}`, name: input.preferences?.colorNames[name as ColorLabel] ?? name,
      color, source: "selector-color" as const,
    })),
    ...[...customNames].map(([normalized, name]) => ({
      // Encoding the whole Unicode key avoids collisions such as "A+B"/"A B".
      id: `custom:${encodeURIComponent(normalized)}`, name,
      color: TONES[input.preferences?.customLabelColors[name] ?? "sand"],
      source: "selector-custom" as const,
    })),
  ];
  let selectedIndex = 0;
  return {
    schemaVersion: 1,
    handoffId: input.handoffId ?? globalThis.crypto.randomUUID(),
    sourceToolId: "photo-selector-app",
    sourceRoot: input.sourceRoot,
    projectId: input.projectId,
    projectName: input.projectName,
    selectorRevision: input.selectorRevision,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    labels,
    assets: assets.map((asset) => {
      const absolutePath = input.getAbsolutePath?.(asset.id) ?? undefined;
      if (input.getAbsolutePath && !absolutePath) throw new Error(`Percorso assoluto mancante per ${asset.fileName}.`);
      const root = input.sourceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
      const normalizedPath = absolutePath?.replace(/\\/g, "/");
      const relativePath = normalizedPath?.toLowerCase().startsWith(root.toLowerCase() + "/")
        ? normalizedPath.slice(root.length + 1) : asset.path.replace(/\\/g, "/");
      return {
        assetId: asset.id, relativePath, absolutePath,
        sourceFileKey: asset.sourceFileKey, fileName: asset.fileName,
        width: asset.width, height: asset.height, aspectRatio: asset.aspectRatio,
        orientation: asset.orientation, selected: active.has(asset.id),
        selectionOrder: active.has(asset.id) ? selectedIndex++ : -1,
        rating: Number.isFinite(asset.rating) ? Math.max(0, Math.min(5, Math.round(asset.rating!))) : 0,
        pickStatus: asset.pickStatus ?? "unmarked", colorLabel: asset.colorLabel ?? null,
        customLabels: [...(asset.customLabels ?? [])],
        labelIds: [...new Set([
          ...(asset.colorLabel ? [`color-${asset.colorLabel}`] : []),
          ...(asset.customLabels ?? []).filter((name) => key(name)).map((name) => `custom:${encodeURIComponent(key(name))}`),
        ])],
        rotationDegrees: asset.rotationDegrees, size: asset.size,
      };
    }),
  };
}
