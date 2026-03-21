import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ColorLabel, ImageAsset, PickStatus } from "@photo-tools/shared-types";
import { PhotoClassificationHelpButton } from "./PhotoClassificationHelpButton";
import { PhotoQuickPreviewModal } from "./PhotoQuickPreviewModal";
import { PhotoSearchBar } from "./PhotoSearchBar";
import { PhotoCard } from "./PhotoCard";
import { PhotoSelectionContextMenu } from "./PhotoSelectionContextMenu";
import { createOnDemandPreviewAsync, getSubfolder, extractSubfolders } from "../services/folder-access";
import {
  COLOR_LABEL_NAMES,
  COLOR_LABELS,
  DEFAULT_PHOTO_FILTERS,
  getAssetRating,
  matchesPhotoFilters,
  resolvePhotoClassificationShortcut,
} from "../services/photo-classification";
import {
  loadPhotoSelectorPreferences,
  savePhotoSelectorPreferences,
  type PhotoFilterPreset,
} from "../services/photo-selector-preferences";

interface PhotoSelectorProps {
  photos: ImageAsset[];
  selectedIds: string[];
  onSelectionChange: (selectedIds: string[]) => void;
  onPhotosChange?: (photos: ImageAsset[]) => void;
  onVisibleIdsChange?: (visibleIds: Set<string>) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

type SortMode = "name" | "orientation" | "rating";
type PickFilter = "all" | PickStatus;
type ColorFilter = "all" | ColorLabel;

function describeMetadataChanges(
  changes: Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel">>,
  targetCount: number
): string {
  const subject = targetCount === 1 ? "1 foto" : `${targetCount} foto`;
  if (changes.rating !== undefined) {
    return changes.rating > 0
      ? `${subject}: assegnate ${changes.rating} stelle`
      : `${subject}: stelle azzerate`;
  }
  if (changes.pickStatus !== undefined) {
    return `${subject}: stato ${changes.pickStatus === "picked" ? "Pick" : changes.pickStatus === "rejected" ? "Scartata" : "Neutra"}`;
  }
  if (changes.colorLabel !== undefined) {
    return `${subject}: etichetta ${changes.colorLabel ? COLOR_LABEL_NAMES[changes.colorLabel] : "rimossa"}`;
  }
  return `${subject}: metadati aggiornati`;
}

function getSeriesKey(photo: ImageAsset): string {
  const stem = photo.fileName.replace(/\.[^.]+$/, "");
  const normalized = stem.replace(/[_\-\s]*\d+$/, "").trim();
  return normalized || stem;
}

function getTimeClusterKey(photo: ImageAsset): string {
  const timestampRaw = photo.sourceFileKey?.split("::").at(-1);
  const timestamp = timestampRaw ? Number(timestampRaw) : NaN;
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "orario-non-disponibile";
  }

  const date = new Date(timestamp);
  const bucketMinutes = Math.floor(date.getMinutes() / 5) * 5;
  const bucket = new Date(date);
  bucket.setMinutes(bucketMinutes, 0, 0);

  const day = bucket.toLocaleDateString("it-IT");
  const time = bucket.toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${day} ${time}`;
}

export function PhotoSelector({
  photos,
  selectedIds,
  onSelectionChange,
  onPhotosChange,
  onVisibleIdsChange,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}: PhotoSelectorProps) {
  const [sortBy, setSortBy] = useState<SortMode>("name");
  const [pickFilter, setPickFilter] = useState<PickFilter>(DEFAULT_PHOTO_FILTERS.pickStatus);
  const [ratingFilter, setRatingFilter] = useState(DEFAULT_PHOTO_FILTERS.ratingFilter);
  const [colorFilter, setColorFilter] = useState<ColorFilter>(DEFAULT_PHOTO_FILTERS.colorLabel);
  const [folderFilter, setFolderFilter] = useState<string>("all");
  const [seriesFilter, setSeriesFilter] = useState<string>("all");
  const [timeClusterFilter, setTimeClusterFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [customColorNames, setCustomColorNames] = useState<Record<ColorLabel, string>>(() => ({ ...COLOR_LABEL_NAMES }));
  const [filterPresets, setFilterPresets] = useState<PhotoFilterPreset[]>([]);
  const [newPresetName, setNewPresetName] = useState("");
  const [timelineEntries, setTimelineEntries] = useState<Array<{ id: string; label: string }>>([]);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
  const [isBatchToolsOpen, setIsBatchToolsOpen] = useState(false);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const [contextMenuState, setContextMenuState] = useState<{
    x: number;
    y: number;
    targetIds: string[];
  } | null>(null);
  const [focusedPhotoId, setFocusedPhotoId] = useState<string | null>(null);
  const lastClickedIdRef = useRef<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const hasActiveFilters =
    pickFilter !== "all" ||
    ratingFilter !== "any" ||
    colorFilter !== "all" ||
    folderFilter !== "all" ||
    seriesFilter !== "all" ||
    timeClusterFilter !== "all" ||
    searchQuery !== "";

  const pushTimelineEntry = useCallback((label: string) => {
    setTimelineEntries((current) => [
      { id: `timeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, label },
      ...current,
    ].slice(0, 5));
  }, []);

  useEffect(() => {
    const preferences = loadPhotoSelectorPreferences();
    setCustomColorNames(preferences.colorNames);
    setFilterPresets(preferences.filterPresets);
  }, []);

  const applyPhotoChanges = useCallback((
    id: string,
    changes: Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel">>
  ) => {
    if (!onPhotosChange) return;

    let changed = false;
    const nextPhotos = photos.map((photo) => {
      if (photo.id !== id) {
        return photo;
      }

      const nextRating = changes.rating ?? photo.rating;
      const nextPickStatus = changes.pickStatus ?? photo.pickStatus;
      const nextColorLabel = changes.colorLabel !== undefined ? changes.colorLabel : photo.colorLabel;

      if (
        nextRating === photo.rating &&
        nextPickStatus === photo.pickStatus &&
        nextColorLabel === photo.colorLabel
      ) {
        return photo;
      }

      changed = true;
      return {
        ...photo,
        ...changes
      };
    });

    if (changed) {
      onPhotosChange(nextPhotos);
      pushTimelineEntry(describeMetadataChanges(changes, 1));
    }
  }, [onPhotosChange, photos, pushTimelineEntry]);

  function resetFilters() {
    setPickFilter("all");
    setRatingFilter("any");
    setColorFilter("all");
    setFolderFilter("all");
    setSeriesFilter("all");
    setTimeClusterFilter("all");
    setSearchQuery("");
  }

  const persistPreferences = useCallback((
    nextColorNames: Record<ColorLabel, string>,
    nextFilterPresets: PhotoFilterPreset[]
  ) => {
    savePhotoSelectorPreferences({
      colorNames: nextColorNames,
      filterPresets: nextFilterPresets,
    });
  }, []);

  const handleColorNameChange = useCallback((label: ColorLabel, value: string) => {
    setCustomColorNames((current) => {
      const next = {
        ...current,
        [label]: value.trim() || COLOR_LABEL_NAMES[label],
      };
      persistPreferences(next, filterPresets);
      return next;
    });
  }, [filterPresets, persistPreferences]);

  const handleSavePreset = useCallback(() => {
    const trimmedName = newPresetName.trim();
    if (!trimmedName) {
      return;
    }

    const nextPreset: PhotoFilterPreset = {
      id: `preset-${Date.now()}`,
      name: trimmedName,
      filters: {
        pickStatus: pickFilter,
        ratingFilter,
        colorLabel: colorFilter,
        folderFilter,
        seriesFilter,
        timeClusterFilter,
        searchQuery,
      },
    };

    setFilterPresets((current) => {
      const next = [nextPreset, ...current].slice(0, 12);
      persistPreferences(customColorNames, next);
      return next;
    });
    setNewPresetName("");
  }, [colorFilter, customColorNames, folderFilter, newPresetName, persistPreferences, pickFilter, ratingFilter, searchQuery, seriesFilter, timeClusterFilter]);

  const applyPreset = useCallback((preset: PhotoFilterPreset) => {
    setPickFilter(preset.filters.pickStatus);
    setRatingFilter(preset.filters.ratingFilter);
    setColorFilter(preset.filters.colorLabel);
    setFolderFilter(preset.filters.folderFilter ?? "all");
    setSeriesFilter(preset.filters.seriesFilter ?? "all");
    setTimeClusterFilter(preset.filters.timeClusterFilter ?? "all");
    setSearchQuery(preset.filters.searchQuery ?? "");
  }, []);

  const removePreset = useCallback((presetId: string) => {
    setFilterPresets((current) => {
      const next = current.filter((preset) => preset.id !== presetId);
      persistPreferences(customColorNames, next);
      return next;
    });
  }, [customColorNames, persistPreferences]);

  // Extract unique subfolders for the folder filter dropdown
  const subfolders = useMemo(() => extractSubfolders(photos), [photos]);
  const seriesGroups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const photo of photos) {
      const key = getSeriesKey(photo);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
  }, [photos]);
  const timeClusters = useMemo(() => {
    const counts = new Map<string, number>();
    for (const photo of photos) {
      const key = getTimeClusterKey(photo);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((left, right) => left.key.localeCompare(right.key));
  }, [photos]);

  const visiblePhotos = useMemo(() => {
    const lowerSearch = searchQuery.toLowerCase();
    const filtered = photos.filter((photo) => {
      if (!matchesPhotoFilters(photo, {
        pickStatus: pickFilter,
        ratingFilter,
        colorLabel: colorFilter
      })) return false;

      if (folderFilter !== "all" && getSubfolder(photo.path) !== folderFilter) return false;
      if (seriesFilter !== "all" && getSeriesKey(photo) !== seriesFilter) return false;
      if (timeClusterFilter !== "all" && getTimeClusterKey(photo) !== timeClusterFilter) return false;

      if (lowerSearch && !photo.fileName.toLowerCase().includes(lowerSearch)) return false;

      return true;
    });

    filtered.sort((left, right) => {
      if (sortBy === "rating") {
        return (
          getAssetRating(right) - getAssetRating(left) ||
          left.fileName.localeCompare(right.fileName)
        );
      }

      if (sortBy === "orientation") {
        return (
          left.orientation.localeCompare(right.orientation) ||
          left.fileName.localeCompare(right.fileName)
        );
      }

      return left.fileName.localeCompare(right.fileName);
    });

    return filtered;
  }, [colorFilter, folderFilter, photos, pickFilter, ratingFilter, searchQuery, seriesFilter, sortBy, timeClusterFilter]);

  // Search in all photos so preview doesn't close when filters change
  const previewAsset = previewAssetId
    ? (photos.find((p) => p.id === previewAssetId) ?? null)
    : null;

  useEffect(() => {
    if (!contextMenuState) {
      return;
    }

    const closeMenu = () => setContextMenuState(null);
    window.addEventListener("mousedown", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("mousedown", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [contextMenuState]);

  // Consolidated keyboard handler: Escape chain + arrow navigation
  const handleWindowKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Context menu open: only handle Escape
      if (contextMenuState) {
        if (event.key === "Escape") {
          event.preventDefault();
          setContextMenuState(null);
        }
        return;
      }
      // Quick preview open: let it handle keys
      if (previewAssetId) return;

      // Arrow navigation within grid
      const arrowKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
      if (!arrowKeys.includes(event.key)) return;

      const target = event.target as HTMLElement;
      if (target.closest("select, input, textarea")) return;

      event.preventDefault();
      if (visiblePhotos.length === 0) return;

      const currentIndex = focusedPhotoId
        ? visiblePhotos.findIndex((p) => p.id === focusedPhotoId)
        : -1;

      const grid = gridRef.current;
      let cols = 4;
      if (grid) {
        const firstCard = grid.querySelector<HTMLElement>(".photo-card");
        if (firstCard && firstCard.offsetWidth > 0) {
          cols = Math.max(1, Math.floor(grid.clientWidth / firstCard.offsetWidth));
        }
      }

      let nextIndex: number;
      if (currentIndex < 0) {
        nextIndex = 0;
      } else if (event.key === "ArrowRight") {
        nextIndex = Math.min(visiblePhotos.length - 1, currentIndex + 1);
      } else if (event.key === "ArrowLeft") {
        nextIndex = Math.max(0, currentIndex - 1);
      } else if (event.key === "ArrowDown") {
        nextIndex = Math.min(visiblePhotos.length - 1, currentIndex + cols);
      } else {
        nextIndex = Math.max(0, currentIndex - cols);
      }

      if (nextIndex !== currentIndex || currentIndex < 0) {
        const next = visiblePhotos[nextIndex];
        setFocusedPhotoId(next.id);
        const el = grid?.querySelector<HTMLElement>(`[data-preview-asset-id="${next.id}"]`);
        if (el) {
          el.focus();
          el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      }
    },
    [contextMenuState, focusedPhotoId, previewAssetId, visiblePhotos]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [handleWindowKeyDown]);

  function togglePhoto(id: string, event?: React.MouseEvent) {
    const nextSelection = new Set(selectedSet);

    // Shift+click range selection
    if (event?.shiftKey && lastClickedIdRef.current) {
      const lastIdx = visiblePhotos.findIndex((p) => p.id === lastClickedIdRef.current);
      const curIdx = visiblePhotos.findIndex((p) => p.id === id);
      if (lastIdx >= 0 && curIdx >= 0) {
        const [from, to] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx];
        for (let i = from; i <= to; i++) {
          nextSelection.add(visiblePhotos[i].id);
        }
        lastClickedIdRef.current = id;
        onSelectionChange(Array.from(nextSelection));
        return;
      }
    }

    if (nextSelection.has(id)) {
      nextSelection.delete(id);
    } else {
      nextSelection.add(id);
    }

    lastClickedIdRef.current = id;
    onSelectionChange(Array.from(nextSelection));
  }

  function toggleAll(selectAll: boolean) {
    if (selectAll) {
      const idsToSelect = hasActiveFilters
        ? visiblePhotos.map((p) => p.id)
        : photos.map((p) => p.id);
      onSelectionChange(idsToSelect);
      pushTimelineEntry(
        hasActiveFilters
          ? `Selezionate ${idsToSelect.length} foto visibili con i filtri attivi`
          : `Selezionate tutte le ${idsToSelect.length} foto`
      );
    } else {
      onSelectionChange([]);
      pushTimelineEntry("Deselezionate tutte le foto");
    }
  }

  function updatePhoto(
    id: string,
    changes: Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel">>
  ) {
    applyPhotoChanges(id, changes);
  }

  const applyBatchChanges = useCallback((
    targetIds: string[],
    changes: Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel">>
  ) => {
    if (!onPhotosChange || targetIds.length === 0) {
      return;
    }

    const idSet = new Set(targetIds);
    let changed = false;
    const nextPhotos = photos.map((photo) => {
      if (!idSet.has(photo.id)) {
        return photo;
      }

      const nextRating = changes.rating ?? photo.rating;
      const nextPickStatus = changes.pickStatus ?? photo.pickStatus;
      const nextColorLabel = changes.colorLabel !== undefined ? changes.colorLabel : photo.colorLabel;

      if (
        nextRating === photo.rating &&
        nextPickStatus === photo.pickStatus &&
        nextColorLabel === photo.colorLabel
      ) {
        return photo;
      }

      changed = true;
      return {
        ...photo,
        ...changes,
      };
    });

    if (changed) {
      onPhotosChange(nextPhotos);
      pushTimelineEntry(describeMetadataChanges(changes, targetIds.length));
    }
  }, [onPhotosChange, photos, pushTimelineEntry]);

  const clearSelection = useCallback(() => {
    onSelectionChange([]);
    pushTimelineEntry("Selezione svuotata");
  }, [onSelectionChange, pushTimelineEntry]);

  const invertVisibleSelection = useCallback(() => {
    const visibleIdSet = new Set(visiblePhotos.map((photo) => photo.id));
    const nextSelection = new Set(selectedIds.filter((id) => !visibleIdSet.has(id)));
    for (const photo of visiblePhotos) {
      if (!selectedSet.has(photo.id)) {
        nextSelection.add(photo.id);
      }
    }
    onSelectionChange(Array.from(nextSelection));
    pushTimelineEntry("Selezione visibile invertita");
  }, [onSelectionChange, pushTimelineEntry, selectedIds, selectedSet, visiblePhotos]);

  // ── Stable callbacks for PhotoCard (identity doesn't matter due to custom memo) ──
  const handleFocus = useCallback((id: string) => {
    setFocusedPhotoId(id);
  }, []);

  const handlePreview = useCallback((id: string) => {
    setPreviewAssetId(id);
  }, []);

  const handleContextMenu = useCallback((id: string, x: number, y: number) => {
    if (!onPhotosChange) return;
    const targetIds = selectedSet.has(id) ? selectedIds : [id];
    setContextMenuState({ x, y, targetIds });
  }, [onPhotosChange, selectedIds, selectedSet]);

  const handleUpdatePhoto = useCallback((id: string, changes: Partial<Pick<ImageAsset, "rating" | "pickStatus" | "colorLabel">>) => {
    applyPhotoChanges(id, changes);
  }, [applyPhotoChanges]);

  // ── IntersectionObserver for viewport tracking (pipeline priority) ──
  const observerRef = useRef<IntersectionObserver | null>(null);
  const visibleIdsRef = useRef(new Set<string>());

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || !onVisibleIdsChange) return;

    const observer = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const id = el.dataset.previewAssetId;
          if (!id) continue;
          if (entry.isIntersecting) {
            if (!visibleIdsRef.current.has(id)) { visibleIdsRef.current.add(id); changed = true; }
          } else {
            if (visibleIdsRef.current.has(id)) { visibleIdsRef.current.delete(id); changed = true; }
          }
        }
        if (changed) onVisibleIdsChange(new Set(visibleIdsRef.current));
      },
      { root: grid, rootMargin: "200px 0px" }
    );
    observerRef.current = observer;

    // Observe all cards currently in the grid
    const cards = grid.querySelectorAll<HTMLElement>("[data-preview-asset-id]");
    for (let i = 0; i < cards.length; i++) {
      observer.observe(cards[i]);
    }

    // Auto-observe new cards added to the grid via MutationObserver
    const mutation = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (let i = 0; i < m.addedNodes.length; i++) {
          const node = m.addedNodes[i];
          if (node instanceof HTMLElement && node.dataset.previewAssetId) {
            observer.observe(node);
          }
        }
      }
    });
    mutation.observe(grid, { childList: true });

    return () => {
      observer.disconnect();
      mutation.disconnect();
    };
  }, [onVisibleIdsChange]);

  // ── On-demand preview URL for QuickPreviewModal ──
  // Key insight: the URL must be stable for a given asset ID so the browser
  // can finish decoding large JPEGs without being interrupted by thumbnail
  // batch updates that change the asset object reference every ~120 ms.
  const previewUrlRef = useRef<{ id: string; url: string } | null>(null);
  const [asyncPreviewUrl, setAsyncPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!previewAsset) {
      if (previewUrlRef.current) {
        previewUrlRef.current = null;
      }
      setAsyncPreviewUrl(null);
      return;
    }

    if (previewUrlRef.current && previewUrlRef.current.id === previewAsset.id) {
      return;
    }

    let active = true;

    if (previewUrlRef.current) {
      previewUrlRef.current = null;
      setAsyncPreviewUrl(null);
    }

    createOnDemandPreviewAsync(previewAsset.id, 0).then((url) => {
      if (!active) return;
      if (url) {
        previewUrlRef.current = { id: previewAsset.id, url };
        setAsyncPreviewUrl(url);
      }
    });

    return () => {
      active = false;
    };
  }, [previewAsset]);

  // Preload nearby assets in high quality to make arrow/space navigation instant.
  useEffect(() => {
    if (!previewAssetId || visiblePhotos.length === 0) return;

    const currentIndex = visiblePhotos.findIndex((p) => p.id === previewAssetId);
    if (currentIndex < 0) return;

    const idsToWarm: string[] = [];
    for (let delta = 1; delta <= 5; delta++) {
      const prev = visiblePhotos[currentIndex - delta];
      const next = visiblePhotos[currentIndex + delta];
      if (prev) idsToWarm.push(prev.id);
      if (next) idsToWarm.push(next.id);
    }

    if (idsToWarm.length === 0) return;
    void Promise.all(
      idsToWarm.map((id, index) =>
        createOnDemandPreviewAsync(id, index < 4 ? 1 : 2).catch(() => null)
      )
    );
  }, [previewAssetId, visiblePhotos]);

  const previewAssetWithUrl = useMemo(() => {
    if (!previewAsset) return null;

    if (previewAsset.previewUrl || previewAsset.sourceUrl) return previewAsset;

    if (previewUrlRef.current && previewUrlRef.current.id === previewAsset.id) {
      return {
        ...previewAsset,
        previewUrl: previewUrlRef.current.url,
        sourceUrl: previewUrlRef.current.url,
      };
    }

    return previewAsset; // Until async finishes, use what we have (thumbnailUrl usually)
  }, [previewAsset, asyncPreviewUrl]);

  const allSelected = photos.length > 0 && selectedIds.length === photos.length;
  const someSelected = selectedIds.length > 0 && selectedIds.length < photos.length;
  const visibleSelectedCount = useMemo(
    () => visiblePhotos.filter((photo) => selectedSet.has(photo.id)).length,
    [selectedSet, visiblePhotos],
  );

  function selectVisible() {
    onSelectionChange(visiblePhotos.map((photo) => photo.id));
    pushTimelineEntry(`Selezionate ${visiblePhotos.length} foto visibili`);
  }

  function addVisibleToSelection() {
    const nextSelection = new Set(selectedIds);
    for (const photo of visiblePhotos) {
      nextSelection.add(photo.id);
    }
    onSelectionChange(Array.from(nextSelection));
    pushTimelineEntry(`Aggiunte ${visiblePhotos.length} foto visibili alla selezione`);
  }

  function removeVisibleFromSelection() {
    const visibleIds = new Set(visiblePhotos.map((photo) => photo.id));
    onSelectionChange(selectedIds.filter((id) => !visibleIds.has(id)));
    pushTimelineEntry("Rimosse dalla selezione le foto visibili");
  }

  function activatePickedOnly() {
    onSelectionChange(photos.filter((photo) => photo.pickStatus === "picked").map((photo) => photo.id));
    pushTimelineEntry("Selezionate solo le foto Pick");
  }

  function excludeRejected() {
    onSelectionChange(selectedIds.filter((id) => {
      const photo = photos.find((asset) => asset.id === id);
      return photo?.pickStatus !== "rejected";
    }));
    pushTimelineEntry("Escluse dalla selezione le scartate");
  }

  function selectByMinimumRating(minRating: number) {
    onSelectionChange(photos.filter((photo) => getAssetRating(photo) >= minRating).map((photo) => photo.id));
    pushTimelineEntry(`Selezionate le foto con almeno ${minRating} stelle`);
  }

  const handleUndoClick = useCallback(() => {
    onUndo?.();
    pushTimelineEntry("Annullata ultima modifica");
  }, [onUndo, pushTimelineEntry]);

  const handleRedoClick = useCallback(() => {
    onRedo?.();
    pushTimelineEntry("Ripristinata modifica annullata");
  }, [onRedo, pushTimelineEntry]);

  return (
    <>
      <div className="photo-selector">
        <div className="photo-selector__controls">
          <div className="photo-selector__stats">
            <span className="photo-selector__count" aria-live="polite">
              {selectedIds.length} di {photos.length} foto selezionate
              {hasActiveFilters ? ` — ${visiblePhotos.length} visibili con i filtri` : ""}
            </span>
          </div>

          <div className="photo-selector__actions">
            {(onUndo || onRedo) ? (
              <div className="photo-selector__action-cluster">
                <span className="photo-selector__action-cluster-label">Cronologia</span>
                <div className="photo-selector__undo-group">
                <button
                  type="button"
                  className="icon-button"
                  onClick={handleUndoClick}
                  disabled={!canUndo}
                  title="Annulla (Ctrl+Z)"
                  aria-label="Annulla"
                >
                  ↩
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={handleRedoClick}
                  disabled={!canRedo}
                  title="Ripeti (Ctrl+Shift+Z)"
                  aria-label="Ripeti"
                >
                  ↪
                </button>
                </div>
              </div>
            ) : null}
            <div className="photo-selector__action-cluster">
              <span className="photo-selector__action-cluster-label">Ricerca</span>
              <div className="photo-selector__action-inline">
                <PhotoSearchBar
                  value={searchQuery}
                  onChange={setSearchQuery}
                  resultCount={visiblePhotos.length}
                  totalCount={photos.length}
                />
                <PhotoClassificationHelpButton title="Scorciatoie selezione iniziale" />
              </div>
            </div>
            <div className="photo-selector__action-cluster">
              <span className="photo-selector__action-cluster-label">Catalogo</span>
              <div className="photo-selector__action-inline">
                <button
                  type="button"
                  className={`checkbox-button ${
                    allSelected
                      ? "checkbox-button--checked"
                      : someSelected
                        ? "checkbox-button--indeterminate"
                        : ""
                  }`}
                  onClick={() => toggleAll(!allSelected)}
                  aria-label={allSelected ? "Deseleziona tutte" : "Seleziona tutte"}
                  title={hasActiveFilters ? "Seleziona solo le foto visibili con i filtri attivi" : "Seleziona tutte"}
                >
                  {allSelected ? "Tutte" : someSelected ? "Alcune" : "Nessuna"}
                </button>

                <select
                  className="photo-selector__sort"
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as SortMode)}
                  aria-label="Ordina foto per"
                >
                  <option value="name">Ordina per nome</option>
                  <option value="orientation">Ordina per orientamento</option>
                  <option value="rating">Ordina per stelle</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="photo-selector__filters">
          {hasActiveFilters ? (
            <button
              type="button"
              className="photo-selector__reset-filters"
              onClick={resetFilters}
              title="Azzera tutti i filtri"
            >
              ✕ Azzera filtri
            </button>
          ) : null}

          {subfolders.length > 1 ? (
            <select
              className={folderFilter !== "all" ? "photo-selector__sort photo-selector__sort--active photo-selector__sort--folder" : "photo-selector__sort photo-selector__sort--folder"}
              value={folderFilter}
              onChange={(event) => setFolderFilter(event.target.value)}
              aria-label="Filtra per cartella"
            >
              <option value="all">📁 Tutte le cartelle ({photos.length})</option>
              {subfolders.map(({ folder, count }) => (
                <option key={folder} value={folder}>
                  {folder === "" ? "📄 Root" : `📂 ${folder}`} ({count})
                </option>
              ))}
            </select>
          ) : null}

          <select
            className={pickFilter !== "all" ? "photo-selector__sort photo-selector__sort--active" : "photo-selector__sort"}
            value={pickFilter}
            onChange={(event) => setPickFilter(event.target.value as PickFilter)}
          >
            <option value="all">Tutti gli stati</option>
            <option value="picked">Solo pick</option>
            <option value="rejected">Solo scartate</option>
            <option value="unmarked">Solo neutre</option>
          </select>

          <select
            className={ratingFilter !== "any" ? "photo-selector__sort photo-selector__sort--active" : "photo-selector__sort"}
            value={ratingFilter}
            onChange={(event) => setRatingFilter(event.target.value)}
          >
            <option value="any">Tutte le stelle</option>
            <optgroup label="Minimo">
              <option value="1+">★ 1 o più</option>
              <option value="2+">★★ 2 o più</option>
              <option value="3+">★★★ 3 o più</option>
              <option value="4+">★★★★ 4 o più</option>
            </optgroup>
            <optgroup label="Esattamente">
              <option value="0">Senza stelle</option>
              <option value="1">★ Solo 1</option>
              <option value="2">★★ Solo 2</option>
              <option value="3">★★★ Solo 3</option>
              <option value="4">★★★★ Solo 4</option>
              <option value="5">★★★★★ Solo 5</option>
            </optgroup>
          </select>

          <select
            className={colorFilter !== "all" ? "photo-selector__sort photo-selector__sort--active" : "photo-selector__sort"}
            value={colorFilter}
            onChange={(event) => setColorFilter(event.target.value as ColorFilter)}
          >
            <option value="all">Tutti i colori</option>
            {COLOR_LABELS.map((value) => (
              <option key={value} value={value}>
                {customColorNames[value]}
              </option>
            ))}
          </select>

          {seriesGroups.length > 1 ? (
            <select
              className={seriesFilter !== "all" ? "photo-selector__sort photo-selector__sort--active" : "photo-selector__sort"}
              value={seriesFilter}
              onChange={(event) => setSeriesFilter(event.target.value)}
              aria-label="Filtra per serie di scatto"
            >
              <option value="all">Tutte le serie</option>
              {seriesGroups.map(({ key, count }) => (
                <option key={key} value={key}>
                  {key} ({count})
                </option>
              ))}
            </select>
          ) : null}

          {timeClusters.length > 1 ? (
            <select
              className={timeClusterFilter !== "all" ? "photo-selector__sort photo-selector__sort--active" : "photo-selector__sort"}
              value={timeClusterFilter}
              onChange={(event) => setTimeClusterFilter(event.target.value)}
              aria-label="Filtra per fascia oraria"
            >
              <option value="all">Tutte le fasce orarie</option>
              {timeClusters.map(({ key, count }) => (
                <option key={key} value={key}>
                  {key === "orario-non-disponibile" ? "Orario non disponibile" : key} ({count})
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <section className="photo-selector__collapsible-shell">
          <div className="photo-selector__collapsible-header">
            <div className="photo-selector__collapsible-copy">
              <span className="photo-selector__workspace-label">Workspace avanzato</span>
              <span className="photo-selector__collapsible-summary">
                Preset filtri e nomi personalizzati etichette.
              </span>
            </div>
            <button
              type="button"
              className="ghost-button ghost-button--small"
              onClick={() => setIsWorkspaceOpen((current) => !current)}
            >
              {isWorkspaceOpen ? "Nascondi" : "Mostra"}
            </button>
          </div>

        <div
          className="photo-selector__workspace-panel"
          hidden={!isWorkspaceOpen}
        >
          <div className="photo-selector__workspace-group">
            <span className="photo-selector__workspace-label">Preset filtri</span>
            <div className="photo-selector__preset-form">
              <input
                className="photo-selector__preset-input"
                value={newPresetName}
                onChange={(event) => setNewPresetName(event.target.value)}
                placeholder="Nome preset, ad esempio Cerimonia 3+"
              />
              <button
                type="button"
                className="ghost-button ghost-button--small"
                onClick={handleSavePreset}
                disabled={!newPresetName.trim()}
              >
                Salva preset
              </button>
            </div>
            <div className="photo-selector__preset-list">
              {filterPresets.length === 0 ? (
                <span className="photo-selector__workspace-empty">
                  Nessun preset salvato.
                </span>
              ) : (
                filterPresets.map((preset) => (
                  <div key={preset.id} className="photo-selector__preset-chip">
                    <button
                      type="button"
                      className="photo-selector__preset-apply"
                      onClick={() => applyPreset(preset)}
                    >
                      {preset.name}
                    </button>
                    <button
                      type="button"
                      className="photo-selector__preset-remove"
                      aria-label={`Rimuovi preset ${preset.name}`}
                      onClick={() => removePreset(preset.id)}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="photo-selector__workspace-group">
            <span className="photo-selector__workspace-label">Nomi etichette colore</span>
            <div className="photo-selector__label-grid">
              {COLOR_LABELS.map((value) => (
                <label key={value} className="photo-selector__label-editor">
                  <span className="photo-selector__label-chip">
                    <span className={`asset-color-dot asset-color-dot--${value}`} />
                  </span>
                  <input
                    value={customColorNames[value]}
                    onChange={(event) => handleColorNameChange(value, event.target.value)}
                    aria-label={`Nome personalizzato etichetta ${COLOR_LABEL_NAMES[value]}`}
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
        </section>

        <div className="photo-selector__quick-actions-shell">
          <span className="photo-selector__workspace-label">Azioni rapide</span>
          <div className="photo-selector__quick-actions">
          <button
            type="button"
            className="ghost-button ghost-button--small"
            onClick={selectVisible}
            disabled={visiblePhotos.length === 0}
          >
            Seleziona visibili
          </button>
          <button
            type="button"
            className="ghost-button ghost-button--small"
            onClick={addVisibleToSelection}
            disabled={visiblePhotos.length === 0}
          >
            Aggiungi visibili
          </button>
          <button
            type="button"
            className="ghost-button ghost-button--small"
            onClick={removeVisibleFromSelection}
            disabled={visibleSelectedCount === 0}
          >
            Togli visibili
          </button>
          <button
            type="button"
            className="ghost-button ghost-button--small"
            onClick={activatePickedOnly}
            disabled={photos.length === 0}
          >
            Solo pick
          </button>
          <button
            type="button"
            className="ghost-button ghost-button--small"
            onClick={excludeRejected}
            disabled={selectedIds.length === 0}
          >
            Escludi scartate
          </button>
          <button
            type="button"
            className="ghost-button ghost-button--small"
            onClick={() => selectByMinimumRating(3)}
            disabled={photos.length === 0}
          >
            3+ stelle
          </button>
          <button
            type="button"
            className="ghost-button ghost-button--small"
            onClick={() => selectByMinimumRating(5)}
            disabled={photos.length === 0}
          >
            Solo 5 stelle
          </button>
          <span className="photo-selector__quick-summary">
            {visibleSelectedCount}/{visiblePhotos.length} visibili attive
          </span>
        </div>
        </div>

        {timelineEntries.length > 0 ? (
          <div className="photo-selector__timeline" aria-label="Cronologia azioni recenti">
            <span className="photo-selector__timeline-label">Ultime azioni</span>
            <div className="photo-selector__timeline-list">
              {timelineEntries.map((entry) => (
                <span key={entry.id} className="photo-selector__timeline-item">
                  {entry.label}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {selectedIds.length > 0 ? (
          <section
            className="photo-selector__selection-bar"
            aria-label="Azioni rapide per la selezione corrente"
          >
            <div className="photo-selector__collapsible-header">
              <div className="photo-selector__selection-copy">
                <span className="photo-selector__selection-count">
                  {selectedIds.length === 1
                    ? "1 foto selezionata"
                    : `${selectedIds.length} foto selezionate`}
                </span>
                <span className="photo-selector__selection-meta">
                  Batch rapido su stelle, stato, colore e gestione selezione.
                </span>
              </div>
              <button
                type="button"
                className="ghost-button ghost-button--small"
                onClick={() => setIsBatchToolsOpen((current) => !current)}
              >
                {isBatchToolsOpen ? "Chiudi strumenti batch" : "Apri strumenti batch"}
              </button>
            </div>

            <div
              className="photo-selector__selection-tools"
              hidden={!isBatchToolsOpen}
            >
              <div className="photo-selector__selection-group" aria-label="Valutazione">
                <span className="photo-selector__selection-label">Stelle</span>
                <div className="photo-selector__selection-stars">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      className="photo-selector__batch-star"
                      onClick={() => applyBatchChanges(selectedIds, { rating: value })}
                      title={`Assegna ${value} stella${value > 1 ? "e" : ""}`}
                    >
                      {Array.from({ length: value }, () => "★").join("")}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="ghost-button ghost-button--small"
                    onClick={() => applyBatchChanges(selectedIds, { rating: 0 })}
                  >
                    Azzera
                  </button>
                </div>
              </div>

              <div className="photo-selector__selection-group" aria-label="Stato">
                <span className="photo-selector__selection-label">Stato</span>
                <div className="photo-selector__selection-pills">
                  {(["picked", "rejected", "unmarked"] as PickStatus[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className="photo-selector__batch-pill"
                      onClick={() => applyBatchChanges(selectedIds, { pickStatus: value })}
                    >
                      {value === "picked" ? "Pick" : value === "rejected" ? "Scartata" : "Neutra"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="photo-selector__selection-group" aria-label="Etichette colore">
                <span className="photo-selector__selection-label">Etichette</span>
                <div className="photo-selector__selection-colors">
                  <button
                    type="button"
                    className="ghost-button ghost-button--small"
                    onClick={() => applyBatchChanges(selectedIds, { colorLabel: null })}
                  >
                    Nessuna
                  </button>
                  {COLOR_LABELS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`asset-color-dot asset-color-dot--${value}`}
                      title={customColorNames[value]}
                      onClick={() => applyBatchChanges(selectedIds, { colorLabel: value })}
                    />
                  ))}
                </div>
              </div>

              <div className="photo-selector__selection-group" aria-label="Gestione selezione">
                <span className="photo-selector__selection-label">Selezione</span>
                <div className="photo-selector__selection-actions">
                  <button
                    type="button"
                    className="ghost-button ghost-button--small"
                    onClick={invertVisibleSelection}
                  >
                    Inverti visibili
                  </button>
                  <button
                    type="button"
                    className="ghost-button ghost-button--small"
                    onClick={clearSelection}
                  >
                    Deseleziona
                  </button>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <div
          ref={gridRef}
          className="photo-selector__grid"
          role="listbox"
          aria-label="Griglia foto selezionabili"
          aria-multiselectable="true"
        >
          {visiblePhotos.length === 0 ? (
            <div className="photo-selector__empty">
              <p>Nessuna foto disponibile con i filtri attuali.</p>
            </div>
          ) : (
            visiblePhotos.map((photo) => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                isSelected={selectedSet.has(photo.id)}
                onToggle={togglePhoto}
                onUpdatePhoto={handleUpdatePhoto}
                onFocus={handleFocus}
                onPreview={handlePreview}
                onContextMenu={handleContextMenu}
                editable={!!onPhotosChange}
              />
            ))
          )}
        </div>

        <div className="photo-selector__footer">
          <p className="photo-selector__hint">
            Shift+click per selezionare un intervallo. Ctrl+Z / Ctrl+Shift+Z per annulla/ripeti.
            Tasto destro o Ctrl/Cmd + 6/7/8/9/V per i colori, 1-5 stelle, P/X/U stato, Spazio preview.
          </p>
          <span className="sr-only" aria-live="polite">
            {selectedIds.length === 1 ? "Una foto selezionata" : `${selectedIds.length} foto selezionate`}
          </span>
        </div>
      </div>

      <PhotoQuickPreviewModal
        asset={previewAssetWithUrl}
        assets={visiblePhotos}
        onClose={() => setPreviewAssetId(null)}
        onSelectAsset={setPreviewAssetId}
        onUpdateAsset={(assetId, changes) => updatePhoto(assetId, changes)}
      />

      {contextMenuState ? (
        <PhotoSelectionContextMenu
          x={contextMenuState.x}
          y={contextMenuState.y}
          targetCount={contextMenuState.targetIds.length}
          colorLabelNames={customColorNames}
          onApplyRating={(rating) => {
            applyBatchChanges(contextMenuState.targetIds, { rating });
            setContextMenuState(null);
          }}
          onApplyPickStatus={(pickStatus) => {
            applyBatchChanges(contextMenuState.targetIds, { pickStatus });
            setContextMenuState(null);
          }}
          onApplyColor={(colorLabel) => {
            applyBatchChanges(contextMenuState.targetIds, { colorLabel });
            setContextMenuState(null);
          }}
          onInvertVisible={() => {
            invertVisibleSelection();
            setContextMenuState(null);
          }}
          onClearSelection={() => {
            clearSelection();
            setContextMenuState(null);
          }}
        />
      ) : null}
    </>
  );
}
