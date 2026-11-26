import { Plus, Trash2 } from "lucide-react";
import { effectiveBorderMm, hasFrame } from "../order/geometry";
import { countPrints, type Order, type OrderGroup } from "../order/model";

interface GroupListProps {
  order: Order;
  selectedGroupId: string;
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

export function GroupList({ order, selectedGroupId, onSelectGroup, onAddGroup, onRemoveGroup }: GroupListProps) {
  const remove = (group: OrderGroup) => {
    if (group.photos.length > 0 && !window.confirm(`Il formato ${group.format.label} contiene ${group.photos.length} foto. Rimuoverlo?`)) return;
    onRemoveGroup(group.id);
  };

  return (
    <aside className="rail">
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
                  <small>{group.photos.length} foto · {countPrints(group)} stampe</small>
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
