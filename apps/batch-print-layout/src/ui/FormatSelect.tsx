import { ALL_FORMATS, type FormatTarget, type OrderGroup } from "../order/model";
import { folderNames } from "../order/naming";

interface FormatSelectProps {
  groups: OrderGroup[];
  /** Gruppo attuale della foto; assente quando si agisce su più foto insieme. */
  current?: string;
  label: string;
  placeholder?: string;
  onAssign: (target: FormatTarget, mode: "move" | "add") => void;
}

/** Scelta del formato di una o più foto: cambia il formato oppure aggiunge una seconda stampa. */
export function FormatSelect({ groups, current, label, placeholder, onAssign }: FormatSelectProps) {
  // Gli stessi nomi delle cartelle distinguono due 10×15 con impostazioni diverse.
  const names = folderNames(groups);
  const used = new Set(groups.map((group) => group.format.id));
  const currentGroup = groups.find((group) => group.id === current);
  const others = ALL_FORMATS.filter((format) => !used.has(format.id));
  const groupLabel = (group: OrderGroup) => (groups.filter((item) => item.format.id === group.format.id).length > 1 ? names.get(group.id)! : group.format.label);

  const choose = (value: string) => {
    const [mode, kind, id] = value.split("|");
    const format = ALL_FORMATS.find((item) => item.id === id);
    const target: FormatTarget | null = kind === "g" ? { groupId: id } : format ? { format } : null;
    if (target) onAssign(target, mode as "move" | "add");
  };

  return (
    <select className="format-select" aria-label={label} title={label} value={current ? `move|g|${current}` : ""} onChange={(event) => choose(event.target.value)}>
      {placeholder ? <option value="">{placeholder}</option> : null}
      <optgroup label="Stampa in">
        {groups.map((group) => <option key={group.id} value={`move|g|${group.id}`}>{groupLabel(group)}</option>)}
      </optgroup>
      <optgroup label="Altro formato">
        {others.map((format) => <option key={format.id} value={`move|f|${format.id}`}>{format.label}</option>)}
      </optgroup>
      <optgroup label="Stampa anche in (doppia)">
        {groups.filter((group) => group.id !== current).map((group) => <option key={group.id} value={`add|g|${group.id}`}>+ {groupLabel(group)}</option>)}
        {ALL_FORMATS.filter((format) => !used.has(format.id) && format.id !== currentGroup?.format.id).map((format) => <option key={format.id} value={`add|f|${format.id}`}>+ {format.label}</option>)}
      </optgroup>
    </select>
  );
}
