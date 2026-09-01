export interface ToggleAllSelectionOptions {
  selectAll: boolean;
  hasActiveFilters: boolean;
  selectedIds: readonly string[];
  visibleIds: readonly string[];
  allPhotoIds: readonly string[];
}

export interface ExternalSelectionUpdateOptions {
  sidecarLastModified: number;
  persistedSelectionUpdatedAt?: number;
  localSelectionUpdatedAt?: number;
}

export type RotationTargetMode = "single" | "selection";

export function togglePhotoSelection(selectedIds: readonly string[], photoId: string): string[] {
  const nextSelection = new Set(selectedIds);
  if (nextSelection.has(photoId)) {
    nextSelection.delete(photoId);
  } else {
    nextSelection.add(photoId);
  }
  return Array.from(nextSelection);
}

/** Ctrl+A segue il perimetro mostrato dalla griglia e non conserva foto nascoste. */
export function buildToggleAllSelection({
  selectAll,
  hasActiveFilters,
  selectedIds,
  visibleIds,
  allPhotoIds,
}: ToggleAllSelectionOptions): string[] {
  if (selectAll) {
    return Array.from(new Set(hasActiveFilters ? visibleIds : allPhotoIds));
  }

  if (!hasActiveFilters) {
    return [];
  }

  const visibleSet = new Set(visibleIds);
  return selectedIds.filter((photoId) => !visibleSet.has(photoId));
}

export function countSelectionOutsideFilter(
  selectedIds: readonly string[],
  visibleIds: ReadonlySet<string>,
): number {
  let count = 0;
  for (const photoId of selectedIds) {
    if (!visibleIds.has(photoId)) {
      count += 1;
    }
  }
  return count;
}

export function resolveRotationTargetIds(
  photoId: string | null,
  selectedIds: readonly string[],
  mode: RotationTargetMode,
): string[] {
  if (mode === "selection") {
    return Array.from(new Set(selectedIds));
  }
  return photoId ? [photoId] : [];
}

export function shouldApplyExternalSelectionUpdate({
  sidecarLastModified,
  persistedSelectionUpdatedAt,
  localSelectionUpdatedAt,
}: ExternalSelectionUpdateOptions): boolean {
  const latestKnownLocalUpdate = Math.max(
    persistedSelectionUpdatedAt ?? Number.NEGATIVE_INFINITY,
    localSelectionUpdatedAt ?? Number.NEGATIVE_INFINITY,
  );
  return sidecarLastModified > latestKnownLocalUpdate;
}
