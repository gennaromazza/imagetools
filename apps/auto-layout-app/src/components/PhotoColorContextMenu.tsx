import { createPortal } from "react-dom";
import type { ColorLabel } from "@photo-tools/shared-types";
import {
  COLOR_LABEL_NAMES,
  COLOR_LABELS,
  getColorShortcutHint
} from "../photo-classification";

interface PhotoColorContextMenuProps {
  x: number;
  y: number;
  selectedColor: ColorLabel | null;
  title?: string;
  onSelect: (colorLabel: ColorLabel | null) => void;
}

export function PhotoColorContextMenu({
  x,
  y,
  selectedColor,
  title = "Etichetta colore",
  onSelect
}: PhotoColorContextMenuProps) {
  const menu = (
    <div
      className="ribbon-color-menu"
      style={{ left: `${x}px`, top: `${y}px` }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <span className="ribbon-color-menu__title">{title}</span>
      <button
        type="button"
        className="ribbon-color-menu__clear"
        onClick={() => onSelect(null)}
      >
        Rimuovi colore
      </button>
      <div className="ribbon-color-menu__swatches">
        {COLOR_LABELS.map((value) => (
          <button
            key={value}
            type="button"
            className={
              selectedColor === value
                ? `asset-color-dot asset-color-dot--${value} asset-color-dot--selected`
                : `asset-color-dot asset-color-dot--${value}`
            }
            title={`${COLOR_LABEL_NAMES[value]} | ${getColorShortcutHint(value)}`}
            onClick={() => onSelect(value)}
          />
        ))}
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return menu;
  }

  return createPortal(menu, document.body);
}
