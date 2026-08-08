import type { ColorLabel, PickStatus } from "@photo-tools/shared-types";
import { COLOR_LABELS } from "../../services/photo-classification";
import type { PhotoFilterPreset } from "../../services/photo-selector-preferences";

type PickFilter = "all" | PickStatus;
type ColorFilter = "all" | ColorLabel;
type FormatFilter = "all" | "jpg" | "raw" | "raw+jpg";

interface PhotoFilterPanelProps {
  folderStats: { total: number; picked: number; rejected: number; completionPct: number } | null;
  activeFilterCount: number;
  hasActiveFilters: boolean;
  photosCount: number;
  subfolders: Array<{ folder: string; count: number }>;
  folderFilter: string;
  pickFilter: PickFilter;
  formatFilter: FormatFilter;
  ratingFilter: string;
  ratingCounts: Map<number, number>;
  colorFilter: ColorFilter;
  customColorNames: Record<ColorLabel, string>;
  customLabelFilter: string;
  customLabelFilterOptions: Array<{ label: string; count: number }>;
  isAdvancedFiltersOpen: boolean;
  seriesGroups: Array<{ key: string; count: number }>;
  seriesFilter: string;
  timeClusters: Array<{ key: string; count: number }>;
  timeClusterFilter: string;
  filterPresets: PhotoFilterPreset[];
  onReset: () => void;
  onFolderFilterChange: (value: string) => void;
  onPickFilterChange: (value: PickFilter) => void;
  onFormatFilterChange: (value: FormatFilter) => void;
  onRatingFilterChange: (value: string) => void;
  onColorFilterChange: (value: ColorFilter) => void;
  onCustomLabelFilterChange: (value: string) => void;
  onAdvancedFiltersToggle: () => void;
  onSeriesFilterChange: (value: string) => void;
  onTimeClusterFilterChange: (value: string) => void;
  onApplyPreset: (preset: PhotoFilterPreset) => void;
}

export function PhotoFilterPanel(props: PhotoFilterPanelProps) {
  const {
    folderStats,
    activeFilterCount,
    hasActiveFilters,
    photosCount,
    subfolders,
    folderFilter,
    pickFilter,
    formatFilter,
    ratingFilter,
    ratingCounts,
    colorFilter,
    customColorNames,
    customLabelFilter,
    customLabelFilterOptions,
    isAdvancedFiltersOpen,
    seriesGroups,
    seriesFilter,
    timeClusters,
    timeClusterFilter,
    filterPresets,
  } = props;

  const advancedFilterCount = [seriesFilter !== "all", timeClusterFilter !== "all"].filter(Boolean).length;
  const exactRatingCount = (rating: number) => ratingCounts.get(rating) ?? 0;
  const minimumRatingCount = (rating: number) => {
    let count = 0;
    for (let value = rating; value <= 5; value += 1) {
      count += exactRatingCount(value);
    }
    return count;
  };
  const activeRating = Number.parseInt(ratingFilter, 10);
  const activeRatingResult = Number.isFinite(activeRating)
    ? ratingFilter.endsWith("+")
      ? `${minimumRatingCount(activeRating)} foto con ${activeRating}+ stelle · ${exactRatingCount(activeRating)} esattamente ${activeRating}★`
      : `${exactRatingCount(activeRating)} foto con esattamente ${activeRating}★`
    : null;

  return (
    <div className="selector-filter-panel">
      {folderStats ? (
        <div className="selector-filter-panel__summary">
          <strong>{folderStats.total} foto</strong>
          <span>{folderStats.picked} pick</span>
          <span>{folderStats.rejected} scartate</span>
          <span>{folderStats.completionPct}% decise</span>
        </div>
      ) : null}

      {hasActiveFilters ? (
        <button type="button" className="ghost-button ghost-button--small selector-filter-panel__reset" onClick={props.onReset}>
          Azzera filtri <span className="photo-selector__filter-count-badge">{activeFilterCount}</span>
        </button>
      ) : null}

      {subfolders.length > 1 ? (
        <label className="field">
          <span>Cartella</span>
          <select value={folderFilter} onChange={(event) => props.onFolderFilterChange(event.target.value)}>
            <option value="all">Tutte ({photosCount})</option>
            {subfolders.map(({ folder, count }) => (
              <option key={folder} value={folder}>{folder === "" ? "Root" : folder} ({count})</option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="field">
        <span>Stato</span>
        <select value={pickFilter} onChange={(event) => props.onPickFilterChange(event.target.value as PickFilter)}>
          <option value="all">Tutti</option>
          <option value="picked">Pick</option>
          <option value="rejected">Scartate</option>
          <option value="unmarked">Neutre</option>
        </select>
      </label>

      <label className="field">
        <span>Formato</span>
        <select value={formatFilter} onChange={(event) => props.onFormatFilterChange(event.target.value as FormatFilter)}>
          <option value="all">Tutti</option>
          <option value="jpg">JPG</option>
          <option value="raw">RAW</option>
          <option value="raw+jpg">RAW + JPG</option>
        </select>
      </label>

      <label className="field">
        <span>Stelle</span>
        <select value={ratingFilter} onChange={(event) => props.onRatingFilterChange(event.target.value)}>
          <option value="any">Tutte</option>
          <optgroup label="Minimo">
            {[1, 2, 3, 4].map((rating) => (
              <option key={`${rating}+`} value={`${rating}+`}>
                {rating === 1 ? "1 stella o più" : `${rating} stelle o più`} ({minimumRatingCount(rating)})
              </option>
            ))}
          </optgroup>
          <optgroup label="Esattamente">
            <option value="0">Senza stelle ({exactRatingCount(0)})</option>
            {[1, 2, 3, 4, 5].map((rating) => (
              <option key={rating} value={rating}>
                {rating === 1 ? "1 stella" : `${rating} stelle`} ({exactRatingCount(rating)})
              </option>
            ))}
          </optgroup>
        </select>
        {activeRatingResult ? <small className="selector-filter-panel__filter-result">{activeRatingResult}</small> : null}
      </label>

      <div className="field photo-selector__color-filter">
        <span>Colore</span>
        <div className="photo-selector__color-filter-dots">
          <button type="button" className={`photo-selector__color-all-btn${colorFilter === "all" ? " photo-selector__color-all-btn--active" : ""}`} onClick={() => props.onColorFilterChange("all")} title="Tutti i colori">x</button>
          {COLOR_LABELS.map((value) => (
            <button
              key={value}
              type="button"
              className={`asset-color-dot asset-color-dot--${value}${colorFilter === value ? " asset-color-dot--selected" : ""}`}
              onClick={() => props.onColorFilterChange(colorFilter === value ? "all" : value)}
              title={customColorNames[value]}
            />
          ))}
        </div>
      </div>

      {customLabelFilterOptions.length > 0 ? (
        <label className="field">
          <span>Label custom</span>
          <select value={customLabelFilter} onChange={(event) => props.onCustomLabelFilterChange(event.target.value)}>
            <option value="all">Tutte</option>
            {customLabelFilterOptions.map(({ label, count }) => <option key={label} value={label}>{label} ({count})</option>)}
          </select>
        </label>
      ) : null}

      <button type="button" className="photo-selector__advanced-toggle" onClick={props.onAdvancedFiltersToggle} aria-expanded={isAdvancedFiltersOpen}>
        Filtri avanzati
        {advancedFilterCount > 0 ? <span className="photo-selector__filter-count-badge">{advancedFilterCount}</span> : null}
        <span aria-hidden="true">{isAdvancedFiltersOpen ? "-" : "+"}</span>
      </button>

      {isAdvancedFiltersOpen ? (
        <div className="selector-filter-panel__advanced">
          {seriesGroups.length > 1 ? (
            <label className="field">
              <span>Serie</span>
              <select value={seriesFilter} onChange={(event) => props.onSeriesFilterChange(event.target.value)}>
                <option value="all">Tutte</option>
                {seriesGroups.map(({ key, count }) => <option key={key} value={key}>{key} ({count})</option>)}
              </select>
            </label>
          ) : null}
          {timeClusters.length > 1 ? (
            <label className="field">
              <span>Fascia oraria</span>
              <select value={timeClusterFilter} onChange={(event) => props.onTimeClusterFilterChange(event.target.value)}>
                <option value="all">Tutte</option>
                {timeClusters.map(({ key, count }) => <option key={key} value={key}>{key} ({count})</option>)}
              </select>
            </label>
          ) : null}
          {filterPresets.length > 0 ? (
            <div className="selector-filter-panel__presets">
              <span>Preset</span>
              {filterPresets.map((preset) => <button key={preset.id} type="button" className="photo-selector__preset-apply" onClick={() => props.onApplyPreset(preset)}>{preset.name}</button>)}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
