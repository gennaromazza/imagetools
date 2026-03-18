import type { ColorLabel, ImageAsset, PickStatus } from "@photo-tools/shared-types";

export const COLOR_LABELS: ColorLabel[] = ["red", "yellow", "green", "blue", "purple"];

export const COLOR_LABEL_NAMES: Record<ColorLabel, string> = {
  red: "Rosso",
  yellow: "Giallo",
  green: "Verde",
  blue: "Blu",
  purple: "Viola"
};

export const PICK_STATUS_LABELS: Record<PickStatus, string> = {
  picked: "Pick",
  rejected: "Scartata",
  unmarked: "Neutra"
};

export function getAssetRating(asset: ImageAsset): number {
  return Math.max(0, Math.min(5, Math.round(asset.rating ?? 0)));
}

export function getAssetPickStatus(asset: ImageAsset): PickStatus {
  return asset.pickStatus ?? "unmarked";
}

export function getAssetColorLabel(asset: ImageAsset): ColorLabel | null {
  return asset.colorLabel ?? null;
}

export function formatAssetStars(asset: ImageAsset): string {
  const rating = getAssetRating(asset);
  return rating > 0 ? "★".repeat(rating) : "Nessuna stella";
}
