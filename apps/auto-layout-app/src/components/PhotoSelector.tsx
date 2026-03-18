import { useMemo, useState } from "react";
import type { ImageAsset, ImageOrientation } from "@photo-tools/shared-types";

interface PhotoSelectorProps {
  photos: ImageAsset[];
  selectedIds: string[];
  onSelectionChange: (selectedIds: string[]) => void;
}

const orientationOrder: Record<ImageOrientation, number> = {
  horizontal: 0,
  vertical: 1,
  square: 2
};

const orientationLabels: Record<ImageOrientation, string> = {
  horizontal: "Orizzontale",
  vertical: "Verticale",
  square: "Quadrata"
};

const orientationIcons: Record<ImageOrientation, string> = {
  horizontal: "H",
  vertical: "V",
  square: "Q"
};

export function PhotoSelector({ photos, selectedIds, onSelectionChange }: PhotoSelectorProps) {
  const [sortBy, setSortBy] = useState<"name" | "orientation">("name");

  const sortedPhotos = useMemo(() => {
    const sorted = [...photos];

    if (sortBy === "name") {
      sorted.sort((left, right) => left.fileName.localeCompare(right.fileName));
    } else {
      sorted.sort((left, right) => orientationOrder[left.orientation] - orientationOrder[right.orientation]);
    }

    return sorted;
  }, [photos, sortBy]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const togglePhoto = (id: string) => {
    const newSelection = new Set(selectedSet);

    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }

    onSelectionChange(Array.from(newSelection));
  };

  const toggleAll = (select: boolean) => {
    if (select) {
      onSelectionChange(photos.map((photo) => photo.id));
    } else {
      onSelectionChange([]);
    }
  };

  const allSelected = photos.length > 0 && selectedIds.length === photos.length;
  const someSelected = selectedIds.length > 0 && selectedIds.length < photos.length;

  return (
    <div className="photo-selector">
      <div className="photo-selector__controls">
        <div className="photo-selector__stats">
          <span className="photo-selector__count">
            {selectedIds.length} di {photos.length} foto selezionate
          </span>
        </div>

        <div className="photo-selector__actions">
          <button
            type="button"
            className={`checkbox-button ${allSelected ? "checkbox-button--checked" : someSelected ? "checkbox-button--indeterminate" : ""}`}
            onClick={() => toggleAll(!allSelected)}
            aria-label={allSelected ? "Deseleziona tutte" : "Seleziona tutte"}
          >
            {allSelected ? "Tutte" : someSelected ? "Alcune" : "Nessuna"}
          </button>

          <select
            className="photo-selector__sort"
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as "name" | "orientation")}
            aria-label="Ordina foto per"
          >
            <option value="name">Ordina per nome</option>
            <option value="orientation">Ordina per orientamento</option>
          </select>
        </div>
      </div>

      <div className="photo-selector__grid">
        {sortedPhotos.length === 0 ? (
          <div className="photo-selector__empty">
            <p>Nessuna foto disponibile</p>
          </div>
        ) : (
          sortedPhotos.map((photo) => {
            const isSelected = selectedSet.has(photo.id);
            const previewUrl = photo.thumbnailUrl ?? photo.previewUrl ?? photo.sourceUrl;
            const aspectRatio = photo.width > 0 && photo.height > 0 ? `${photo.width} / ${photo.height}` : undefined;

            return (
              <div
                key={photo.id}
                className={`photo-card ${isSelected ? "photo-card--selected" : ""}`}
                onClick={() => togglePhoto(photo.id)}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-label={`${photo.fileName}${isSelected ? ", selezionata" : ""}`}
                data-preview-asset-id={photo.id}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    togglePhoto(photo.id);
                  }
                }}
              >
                <div className="photo-card__image-wrapper" style={aspectRatio ? { aspectRatio } : undefined}>
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt={photo.fileName}
                      className="photo-card__image"
                      loading="lazy"
                    />
                  ) : (
                    <div className="photo-card__image photo-card__image--placeholder">{photo.fileName}</div>
                  )}
                  <div className="photo-card__overlay">
                    <div className={`photo-card__checkbox ${isSelected ? "photo-card__checkbox--checked" : ""}`}>
                      {isSelected ? "OK" : ""}
                    </div>
                  </div>
                </div>

                <div className="photo-card__info">
                  <div className="photo-card__name" title={photo.fileName}>
                    {photo.fileName}
                  </div>
                  <div className="photo-card__meta">
                    <span className="photo-card__orientation" title={orientationLabels[photo.orientation]}>
                      {orientationIcons[photo.orientation]}
                    </span>
                    <span className="photo-card__dimensions">
                      {Math.round(photo.width)}x{Math.round(photo.height)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="photo-selector__footer">
        <p className="photo-selector__hint">
          Seleziona le foto che vuoi impaginare. Invio seleziona, Space apre l'anteprima veloce.
        </p>
      </div>
    </div>
  );
}
