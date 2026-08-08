import type { ColorLabel, PickStatus } from "@photo-tools/shared-types";
import { COLOR_LABELS } from "../../services/photo-classification";

interface QuickStatsPanelProps {
  ratingCounts: Map<number, number>;
  pickCounts: Map<PickStatus, number>;
  colorCounts: Map<ColorLabel, number>;
  ratingFilter: string;
  pickFilter: "all" | PickStatus;
  colorFilter: "all" | ColorLabel;
  customColorNames: Record<ColorLabel, string>;
  onRatingFilterChange: (value: string) => void;
  onPickFilterChange: (value: "all" | PickStatus) => void;
  onColorFilterChange: (value: "all" | ColorLabel) => void;
}

export function QuickStatsPanel(props: QuickStatsPanelProps) {
  return (
    <div className="quick-stats-panel">
      {[1, 2, 3, 4, 5].map((rating) => {
        const count = props.ratingCounts.get(rating) ?? 0;
        if (count === 0) return null;
        const active = props.ratingFilter === String(rating);
        return (
          <button key={rating} type="button" className={`photo-selector__qs-chip photo-selector__qs-chip--star${active ? " photo-selector__qs-chip--active" : ""}`} onClick={() => props.onRatingFilterChange(active ? "any" : String(rating))}>
            {"★".repeat(rating)} <span className="photo-selector__qs-count">{count}</span>
          </button>
        );
      })}
      {(["picked", "rejected"] as PickStatus[]).map((status) => {
        const count = props.pickCounts.get(status) ?? 0;
        if (count === 0) return null;
        const active = props.pickFilter === status;
        return (
          <button key={status} type="button" className={`photo-selector__qs-chip photo-selector__qs-chip--${status}${active ? " photo-selector__qs-chip--active" : ""}`} onClick={() => props.onPickFilterChange(active ? "all" : status)}>
            {status === "picked" ? "Pick" : "Scartate"} <span className="photo-selector__qs-count">{count}</span>
          </button>
        );
      })}
      {COLOR_LABELS.map((color) => {
        const count = props.colorCounts.get(color) ?? 0;
        if (count === 0) return null;
        const active = props.colorFilter === color;
        return (
          <button key={color} type="button" className={`photo-selector__qs-chip photo-selector__qs-chip--color-${color}${active ? " photo-selector__qs-chip--active" : ""}`} onClick={() => props.onColorFilterChange(active ? "all" : color)} title={props.customColorNames[color]}>
            <span className={`asset-color-dot asset-color-dot--${color}`} />
            <span className="photo-selector__qs-count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
