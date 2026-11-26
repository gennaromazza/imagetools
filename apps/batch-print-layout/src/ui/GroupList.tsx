import { Images, Plus, Trash2 } from "lucide-react";
import { effectiveBorderMm, hasFrame } from "../order/geometry";
import { countPrints, type Order, type OrderGroup } from "../order/model";

interface GroupListProps {
  order: Order;
  /** Null quando è aperta la vista «Tutte le foto». */
  selectedGroupId: string | null;
  onSelectAll: () => void;
  onSelectGroup: (id: string) => void;
  onAddGroup: () => void;
  onRemoveGroup: (id: string) => void;
}

function details(group: OrderGroup): string {
  const fit = group.fitMode === "cover" ? "Riempi" : "Foto intera";
  const border = effectiveBorderMm(group);
  if (hasFrame(group.format)) return `${fit} · con cornice`;
  return border > 0 ? `${fit} · bordino ${border} mm` : `${fit} · senza bordo`;
}

export function GroupList({ order, selectedGroupId, onSelectAll, onSelectGroup, onAddGroup, onRemoveGroup }: GroupListProps) {
  const remove = (group: OrderGroup) => {
    if (group.photos.length > 0 && !window.confirm(`Il formato ${group.format.label} contiene ${group.photos.length} foto. Rimuoverlo?`)) return;
    onRemoveGroup(group.id);
  };

  return (
    <aside className="rail">
      <div className={`format ${selectedGroupId === null ? "format--active" : ""}`}>
        <button type="button" className="format__main" onClick={onSelectAll} aria-pressed={selectedGroupId === null}>
          <span className="format__shape" aria-hidden="true"><Images size={22} /></span>
          <span className="format__text">
            <strong>Tutte le foto</strong>
            <small>Formato foto per foto</small>
          </span>
        </button>
      </div>
      <p className="eyebrow">Formati</p>
      <ul className="rail__list">
        {order.groups.map((group) => {
          const ratio = group.format.widthCm / group.format.heightCm;
          return (
            <li key={group.id} className={`format ${group.id === selectedGroupId ? "format--active" : ""}`}>
              <button type="button" className="format__main" onClick={() => onSelectGroup(group.id)} aria-pressed={group.id === selectedGroupId}>
                <span className="format__shape" aria-hidden="true">
                  <i style={ratio >= 1 ? { width: "100%", aspectRatio: ratio } : { height: "100%", aspectRatio: ratio }} />
                </span>
                <span className="format__text">
                  <strong title={group.format.label}>{group.format.label}</strong>
                  <small>{details(group)}</small>
                  <small>{group.photos.length} foto · {countPrints(group)} {countPrints(group) === 1 ? "stampa" : "stampe"}</small>
                </span>
              </button>
              {order.groups.length > 1 ? (
                <button type="button" className="icon-btn format__remove" onClick={() => remove(group)} aria-label={`Rimuovi il formato ${group.format.label}`}>
                  <Trash2 size={14} />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <button type="button" className="btn btn--ghost rail__add" onClick={onAddGroup}>
        <Plus size={16} /> Aggiungi formato
      </button>
    </aside>
  );
}
