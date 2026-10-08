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

/** Ctrl+A seleziona le foto visibili; se lo sono già tutte, le deseleziona. */
export function shouldSelectAllVisible(
  visibleIds: readonly string[],
  selectedIds: ReadonlySet<string>,
): boolean {
  return !(visibleIds.length > 0 && visibleIds.every((photoId) => selectedIds.has(photoId)));
}

export interface LassoRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Foto toccate dal rettangolo: ricalcolate a ogni movimento, così restringerlo le rimuove. */
export function findLassoHitIds(
  cardRects: ReadonlyMap<string, LassoRect>,
  selection: LassoRect,
): Set<string> {
  const hits = new Set<string>();
  for (const [photoId, card] of cardRects) {
    if (
      card.left < selection.right
      && card.right > selection.left
      && card.top < selection.bottom
      && card.bottom > selection.top
    ) {
      hits.add(photoId);
    }
  }
  return hits;
}

/**
 * Esito del lasso: senza modificatori è una nuova selezione (anche vuota, se non tocca nulla),
 * con Maiusc/Ctrl/Cmd aggiunge a quella esistente.
 */
export function resolveLassoSelection(
  baseIds: readonly string[],
  hitIds: ReadonlySet<string>,
  additive: boolean,
): string[] {
  const next = new Set(additive ? baseIds : []);
  for (const photoId of hitIds) {
    next.add(photoId);
  }
  return Array.from(next);
}

/** Foto che riceve il focus e l'ancora di Maiusc+click dopo lasso o Ctrl+A. */
export function pickSelectionAnchor(
  selectedIds: ReadonlySet<string>,
  visibleIds: readonly string[],
  currentFocusId: string | null,
): string | null {
  if (currentFocusId && selectedIds.has(currentFocusId)) {
    return currentFocusId;
  }
  return visibleIds.find((photoId) => selectedIds.has(photoId)) ?? null;
}

/**
 * Destinatari delle scorciatoie di classificazione: con più foto selezionate vale la
 * selezione intera (anche se il focus è rimasto altrove), con una sola o nessuna vale la
 * foto col focus, così frecce + tasto restano un gesto «una decisione per foto».
 */
export function resolveClassificationTargetIds(
  selectedIds: readonly string[],
  focusedId: string | null,
): string[] {
  if (selectedIds.length > 1) {
    return [...selectedIds];
  }
  if (focusedId) {
    return [focusedId];
  }
  return [...selectedIds];
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
