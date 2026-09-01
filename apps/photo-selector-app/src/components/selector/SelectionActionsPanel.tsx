import type { DesktopSelectionMode } from "@photo-tools/desktop-contracts";

interface SelectionActionsPanelProps {
  canUndo: boolean;
  canRedo: boolean;
  hasActiveFilters: boolean;
  allSelected: boolean;
  allVisibleSelected: boolean;
  someSelected: boolean;
  someVisibleSelected: boolean;
  visibleCount: number;
  visibleSelectedCount: number;
  selectedOutsideFilterCount: number;
  currentFolderSelectedCount: number;
  selectedCount: number;
  psdSelectedCount: number;
  workspaceMode: DesktopSelectionMode | null;
  compareCount: number;
  isMenuOpen: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onToggleAll: (selectAll: boolean) => void;
  onToggleMenu: () => void;
  onSelectVisible: () => void;
  onAddVisible: () => void;
  onRemoveVisible: () => void;
  onInvertVisible: () => void;
  onRotateSelected: (direction: "left" | "right") => void;
  onActivatePickedOnly: () => void;
  onConvertPsdSelected: () => void;
  onCompare: () => void;
}

export function SelectionActionsPanel(props: SelectionActionsPanelProps) {
  const selectionChecked = props.allSelected || props.allVisibleSelected;
  const selectionPartial = props.someSelected || props.someVisibleSelected;

  return (
    <div className="selection-actions-panel">
      <div className="command-bar__group command-bar__group--history" aria-label="Cronologia">
        <button type="button" className="icon-button" onClick={props.onUndo} disabled={!props.canUndo} title="Annulla">↶</button>
        <button type="button" className="icon-button" onClick={props.onRedo} disabled={!props.canRedo} title="Ripeti">↷</button>
      </div>
      <span className="command-bar__selection-count">
        {props.hasActiveFilters
          ? `${props.visibleSelectedCount} visibili selezionate${props.selectedOutsideFilterCount > 0 ? ` · ${props.selectedOutsideFilterCount} fuori filtro` : ""}`
          : `${props.currentFolderSelectedCount} nella cartella`}
        {props.selectedCount !== props.currentFolderSelectedCount
          ? ` · ${props.selectedCount} ${props.workspaceMode === "project" ? "nel progetto" : "nella selezione libera"}`
          : ""}
      </span>
      <div className="command-bar__group command-bar__group--primary">
      <button
        type="button"
        className={`checkbox-button photo-selector__toolbar-control ${selectionChecked ? "checkbox-button--checked" : selectionPartial ? "checkbox-button--indeterminate" : ""}`}
        onClick={() => props.onToggleAll(!(props.hasActiveFilters ? props.allVisibleSelected : props.allSelected))}
      >
        {props.hasActiveFilters
          ? props.allVisibleSelected ? "Deseleziona visibili" : "Seleziona visibili"
          : props.allSelected ? "Deseleziona tutto" : "Seleziona tutto"}
      </button>
      <button type="button" className="ghost-button ghost-button--small" onClick={props.onToggleMenu} aria-expanded={props.isMenuOpen}>
        Azioni <span aria-hidden="true">⌄</span>
      </button>
      {props.compareCount >= 2 && props.compareCount <= 4 ? (
        <button
          type="button"
          className="ghost-button ghost-button--small"
          onClick={props.onCompare}
          title={`Confronta ${props.compareCount} foto selezionate nella griglia (Ctrl+B)`}
          aria-keyshortcuts="Control+B"
        >
          Confronta ({props.compareCount})
        </button>
      ) : null}
      </div>
      {props.isMenuOpen ? (
        <div className="photo-selector__selection-actions-menu">
          <button type="button" className="ghost-button ghost-button--small" onClick={props.onSelectVisible}>Sostituisci con visibili ({props.visibleCount})</button>
          <button type="button" className="ghost-button ghost-button--small" onClick={props.onAddVisible} disabled={props.visibleCount === 0}>Aggiungi visibili</button>
          <button type="button" className="ghost-button ghost-button--small" onClick={props.onRemoveVisible} disabled={props.visibleSelectedCount === 0}>Rimuovi visibili</button>
          <button type="button" className="ghost-button ghost-button--small" onClick={props.onInvertVisible} disabled={props.visibleCount === 0}>Inverti visibili</button>
          <button type="button" className="ghost-button ghost-button--small" onClick={() => props.onRotateSelected("left")} disabled={props.selectedCount === 0}>Ruota {props.selectedCount} selezionate a sinistra</button>
          <button type="button" className="ghost-button ghost-button--small" onClick={() => props.onRotateSelected("right")} disabled={props.selectedCount === 0}>Ruota {props.selectedCount} selezionate a destra</button>
          <button type="button" className="ghost-button ghost-button--small" onClick={props.onActivatePickedOnly}>Sostituisci con Pick</button>
          {props.psdSelectedCount > 0 ? (
            <button type="button" className="ghost-button ghost-button--small" onClick={props.onConvertPsdSelected}>
              Converti {props.psdSelectedCount === 1 ? "PSD" : `${props.psdSelectedCount} PSD`} in JPEG…
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
