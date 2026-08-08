import { PhotoClassificationHelpButton } from "../PhotoClassificationHelpButton";
import { PhotoSearchBar } from "../PhotoSearchBar";

type SortMode = "name" | "orientation" | "rating" | "createdAt";
type CreatedAtSortDirection = "asc" | "desc";

interface ViewControlsPanelProps {
  searchQuery: string;
  resultCount: number;
  totalCount: number;
  cardSize: number;
  sortBy: SortMode;
  createdAtSortDirection: CreatedAtSortDirection;
  isSettingsPanelOpen: boolean;
  onSearchChange: (value: string) => void;
  onCardSizeChange: (value: number) => void;
  onSortChange: (sortBy: SortMode, direction?: CreatedAtSortDirection) => void;
  onSettingsToggle: () => void;
}

export function ViewControlsPanel(props: ViewControlsPanelProps) {
  return (
    <div className="view-controls-panel">
      <div className="command-bar__search">
        <PhotoSearchBar value={props.searchQuery} onChange={props.onSearchChange} resultCount={props.resultCount} totalCount={props.totalCount} />
      </div>
      <div className="command-bar__group command-bar__group--view">
        <label className="photo-selector__zoom-label" title="Dimensione anteprime">
          <span className="command-bar__label">Zoom</span>
          <input
            type="range"
            className="photo-selector__zoom-slider"
            min={100}
            max={320}
            step={10}
            value={props.cardSize}
            onChange={(event) => props.onCardSizeChange(Number(event.target.value))}
            aria-label="Dimensione anteprime"
          />
        </label>
        <select
          className="photo-selector__sort photo-selector__toolbar-control"
          value={props.sortBy === "createdAt" ? `createdAt:${props.createdAtSortDirection}` : props.sortBy}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "createdAt:asc" || value === "createdAt:desc") {
              props.onSortChange("createdAt", value.endsWith("asc") ? "asc" : "desc");
            } else {
              props.onSortChange(value as SortMode);
            }
          }}
        >
          <option value="name">Nome A–Z</option>
          <option value="createdAt:desc">Più recenti</option>
          <option value="createdAt:asc">Meno recenti</option>
          <option value="orientation">Orientamento</option>
          <option value="rating">Valutazione</option>
        </select>
        <button type="button" className={`icon-button${props.isSettingsPanelOpen ? " icon-button--active" : ""}`} onClick={props.onSettingsToggle} title="Impostazioni workspace">⚙</button>
        <PhotoClassificationHelpButton />
      </div>
    </div>
  );
}
