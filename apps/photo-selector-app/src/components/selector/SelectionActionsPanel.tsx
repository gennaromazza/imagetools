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
  currentFolderSelectedCount: number;
  selectedCount: number;
  isMenuOpen: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onToggleAll: (selectAll: boolean) => void;
  onToggleMenu: () => void;
  onSelectVisible: () => void;
  onAddVisible: () => void;
  onRemoveVisible: () => void;
  onInvertVisible: () => void;
  onActivatePickedOnly: () => void;
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
        {props.currentFolderSelectedCount} nella cartella
        {props.selectedCount !== props.currentFolderSelectedCount
          ? ` · ${props.selectedCount} nel progetto`
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
      {props.selectedCount >= 2 && props.selectedCount <= 4 ? (
        <button type="button" className="ghost-button ghost-button--small" onClick={props.onCompare}>
          Confronta ({props.selectedCount})
        </button>
      ) : null}
      </div>
      {props.isMenuOpen ? (
        <div className="photo-selector__selection-actions-menu">
          <button type="button" className="ghost-button ghost-button--small" onClick={props.onSelectVisible}>Sostituisci con visibili ({props.visibleCount})</button>
          <button type="button" className="ghost-button ghost-button--small" onClick={props.onAddVisible} disabled={props.visibleCount === 0}>Aggiungi visibili</button>
          <button type="button" className="ghost-button ghost-button--small" onClick={props.onRemoveVisible} disabled={props.visibleSelectedCount === 0}>Rimuovi visibili</button>
          <button type="button" className="ghost-button ghost-button--small" onClick={props.onInvertVisible} disabled={props.visibleCount === 0}>Inverti visibili</button>
          <button type="button" className="ghost-button ghost-button--small" onClick={props.onActivatePickedOnly}>Sostituisci con Pick</button>
        </div>
      ) : null}
    </div>
  );
}
