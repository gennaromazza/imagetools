import { createPortal } from "react-dom";
import type { ColorLabel, PickStatus } from "@photo-tools/shared-types";
import {
  COLOR_LABEL_NAMES,
  COLOR_LABELS,
  getColorShortcutHint,
  PICK_STATUS_LABELS,
} from "../services/photo-classification";

interface PhotoSelectionContextMenuProps {
  x: number;
  y: number;
  targetCount: number;
  colorLabelNames?: Record<ColorLabel, string>;
  onApplyRating: (rating: number) => void;
  onApplyPickStatus: (pickStatus: PickStatus) => void;
  onApplyColor: (colorLabel: ColorLabel | null) => void;
  onInvertVisible: () => void;
  onClearSelection: () => void;
}

export function PhotoSelectionContextMenu({
  x,
  y,
  targetCount,
  colorLabelNames = COLOR_LABEL_NAMES,
  onApplyRating,
  onApplyPickStatus,
  onApplyColor,
  onInvertVisible,
  onClearSelection,
}: PhotoSelectionContextMenuProps) {
  const menu = (
    <div
      className="selection-context-menu"
      style={{ left: `${x}px`, top: `${y}px` }}
      onMouseDown={(event) => event.stopPropagation()}
      role="menu"
      aria-label={
        targetCount === 1
          ? "Menu contestuale della foto selezionata"
          : `Menu contestuale per ${targetCount} foto selezionate`
      }
    >
      <div className="selection-context-menu__header">
        <strong>
          {targetCount === 1 ? "1 foto selezionata" : `${targetCount} foto selezionate`}
        </strong>
        <span>Valutazione, stato, etichetta e gestione selezione.</span>
      </div>

      <div className="selection-context-menu__section">
        <span className="selection-context-menu__label">Valutazione</span>
        <div className="selection-context-menu__stars">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              className="selection-context-menu__star"
              onClick={() => onApplyRating(value)}
              role="menuitem"
            >
              {Array.from({ length: value }, () => "★").join("")}
            </button>
          ))}
          <button
            type="button"
            className="selection-context-menu__ghost"
            onClick={() => onApplyRating(0)}
            role="menuitem"
          >
            Azzera stelle
          </button>
        </div>
      </div>

      <div className="selection-context-menu__section">
        <span className="selection-context-menu__label">Stato</span>
        <div className="selection-context-menu__pills">
          {(["picked", "rejected", "unmarked"] as PickStatus[]).map((value) => (
            <button
              key={value}
              type="button"
              className="selection-context-menu__pill"
              onClick={() => onApplyPickStatus(value)}
              role="menuitem"
            >
              {PICK_STATUS_LABELS[value]}
            </button>
          ))}
        </div>
      </div>

      <div className="selection-context-menu__section">
        <span className="selection-context-menu__label">Etichetta colore</span>
        <div className="selection-context-menu__colors">
          <button
            type="button"
            className="selection-context-menu__ghost"
            onClick={() => onApplyColor(null)}
            role="menuitem"
          >
            Rimuovi colore
          </button>
          {COLOR_LABELS.map((value) => (
            <button
              key={value}
              type="button"
              className={`asset-color-dot asset-color-dot--${value}`}
              title={`${colorLabelNames[value]} | ${getColorShortcutHint(value)}`}
              onClick={() => onApplyColor(value)}
              role="menuitem"
            />
          ))}
        </div>
      </div>

      <div className="selection-context-menu__section">
        <span className="selection-context-menu__label">Selezione</span>
        <div className="selection-context-menu__actions">
          <button
            type="button"
            className="selection-context-menu__ghost"
            onClick={onInvertVisible}
            role="menuitem"
          >
            Inverti visibili
          </button>
          <button
            type="button"
            className="selection-context-menu__ghost"
            onClick={onClearSelection}
            role="menuitem"
          >
            Deseleziona tutto
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return menu;
  }

  return createPortal(menu, document.body);
}
