import { createPortal } from "react-dom";
import { useLayoutEffect, useRef, useState } from "react";
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
  hasFileAccess?: boolean;
  rootFolderPath?: string;
  targetPath?: string;
  onApplyRating: (rating: number) => void;
  onApplyPickStatus: (pickStatus: PickStatus) => void;
  onApplyColor: (colorLabel: ColorLabel | null) => void;
  onInvertVisible: () => void;
  onClearSelection: () => void;
  onToggleSelection?: () => void;
  onOpenPreview?: () => void;
  onCopyFiles?: () => void;
  onMoveFiles?: () => void;
  onSaveAs?: () => void;
  onCopyPath?: () => void;
  onOpenWithEditor?: () => void;
}

export function PhotoSelectionContextMenu({
  x,
  y,
  targetCount,
  colorLabelNames = COLOR_LABEL_NAMES,
  hasFileAccess = true,
  rootFolderPath,
  targetPath,
  onApplyRating,
  onApplyPickStatus,
  onApplyColor,
  onInvertVisible,
  onClearSelection,
  onToggleSelection,
  onOpenPreview,
  onCopyFiles,
  onMoveFiles,
  onSaveAs,
  onCopyPath,
  onOpenWithEditor,
}: PhotoSelectionContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const MARGIN = 12;

  // Start invisible at click position; after first paint measure real size and reposition.
  const [pos, setPos] = useState<{ top: number; left: number; visible: boolean }>({
    top: y,
    left: x,
    visible: false,
  });

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    const w = el.offsetWidth;
    const top =
      y + h + MARGIN > window.innerHeight
        ? Math.max(MARGIN, window.innerHeight - h - MARGIN)
        : y;
    const left =
      x + w + MARGIN > window.innerWidth
        ? Math.max(MARGIN, window.innerWidth - w - MARGIN)
        : x;
    setPos({ top, left, visible: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  const menu = (
    <div
      ref={menuRef}
      className="selection-context-menu"
      style={{
        left: `${pos.left}px`,
        top: `${pos.top}px`,
        visibility: pos.visible ? "visible" : "hidden",
      }}
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
      </div>

      <div className="selection-context-menu__section">
        <button
          type="button"
          className="selection-context-menu__action-item"
          onClick={onOpenPreview}
          role="menuitem"
        >
          <span className="icon">🔍</span> Anteprima a tutto schermo <span className="shortcut">Space</span>
        </button>
        <button
          type="button"
          className="selection-context-menu__action-item"
          onClick={onToggleSelection}
          role="menuitem"
        >
          <span className="icon">✅</span> {targetCount === 1 ? "Inverti selezione singola" : "Aggiungi/Rimuovi tutto"} <span className="shortcut">Click</span>
        </button>
      </div>

      <div className="selection-context-menu__divider" />

      <div className="selection-context-menu__section">
        <span className="selection-context-menu__label">Valutazione <span className="shortcut-hint">1-5</span></span>
        <div className="selection-context-menu__stars">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              className="selection-context-menu__star"
              onClick={() => onApplyRating(value)}
              role="menuitem"
            >
              {value}★
            </button>
          ))}
          <button
            type="button"
            className="selection-context-menu__ghost"
            style={{ fontSize: "0.7rem", padding: "0.2rem 0.4rem" }}
            onClick={() => onApplyRating(0)}
            role="menuitem"
          >
            0
          </button>
        </div>
      </div>

      <div className="selection-context-menu__section">
        <span className="selection-context-menu__label">Stato <span className="shortcut-hint">P / X / U</span></span>
        <div className="selection-context-menu__pills">
          {(["picked", "rejected", "unmarked"] as PickStatus[]).map((value) => (
            <button
              key={value}
              type="button"
              className={`selection-context-menu__pill selection-context-menu__pill--${value}`}
              onClick={() => onApplyPickStatus(value)}
              role="menuitem"
            >
              {PICK_STATUS_LABELS[value]}
            </button>
          ))}
        </div>
      </div>

      <div className="selection-context-menu__section">
        <span className="selection-context-menu__label">Etichetta colore <span className="shortcut-hint">6-9 / V</span></span>
        <div className="selection-context-menu__colors">
          <button
            type="button"
            className="selection-context-menu__color-remove"
            onClick={() => onApplyColor(null)}
            title="Rimuovi colore (V)"
            role="menuitem"
          >
            ✕
          </button>
          {COLOR_LABELS.map((value) => (
            <button
              key={value}
              type="button"
              className={`asset-color-dot asset-color-dot--${value} asset-color-dot--interactive`}
              title={`${colorLabelNames[value]} | ${getColorShortcutHint(value)}`}
              onClick={() => onApplyColor(value)}
              role="menuitem"
            />
          ))}
        </div>
      </div>

      <div className="selection-context-menu__section">
        <button
          type="button"
          className="selection-context-menu__action-item"
          onClick={onInvertVisible}
          role="menuitem"
        >
          <span className="icon">🔄</span> Inverti visibili
        </button>
      </div>

      <div className="selection-context-menu__divider" />

      {/* ── File operations ── */}
      <div className="selection-context-menu__section">
        <span className="selection-context-menu__label">Operazioni file</span>
        <button
          type="button"
          className="selection-context-menu__action-item"
          onClick={onOpenWithEditor}
          role="menuitem"
          title="Apre le foto nell'editor predefinito tramite script BAT (supporta selezione multipla)"
        >
          <span className="icon">🎨</span> Apri con editor
        </button>
        <button
          type="button"
          className="selection-context-menu__action-item"
          onClick={onSaveAs}
          role="menuitem"
          title="Salva una copia accessibile per aprirla in Photoshop o altro editor"
        >
          <span className="icon">💾</span> Salva copia come...
        </button>
        <button
          type="button"
          className="selection-context-menu__action-item"
          onClick={onCopyFiles}
          role="menuitem"
          title="Copia i file fisicamente in un'altra cartella"
        >
          <span className="icon">📁</span> Copia in cartella...
        </button>
        <button
          type="button"
          className="selection-context-menu__action-item"
          onClick={onMoveFiles}
          role="menuitem"
          title="Sposta i file fisicamente in un'altra cartella (rimuove dall'originale)"
        >
          <span className="icon">✂️</span> Sposta in cartella...
        </button>
        <button
          type="button"
          className="selection-context-menu__action-item"
          onClick={onCopyPath}
          role="menuitem"
          title={rootFolderPath && targetPath ? `${rootFolderPath.replace(/[\\/]+$/, "")}/${targetPath}` : !rootFolderPath ? "Imposta la cartella radice in ⚙ per ottenere il percorso assoluto" : "Copia il percorso negli appunti"}
        >
          <span className="icon">📋</span> Copia percorso{!rootFolderPath ? " (configura radice in ⚙)" : ""}
        </button>
      </div>

      <div className="selection-context-menu__divider" />

      <div className="selection-context-menu__section">
        <button
          type="button"
          className="selection-context-menu__action-item selection-context-menu__action-item--danger"
          onClick={onClearSelection}
          role="menuitem"
        >
          <span className="icon">⊘</span> Deseleziona tutto
        </button>
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return menu;
  }

  return createPortal(menu, document.body);
}
