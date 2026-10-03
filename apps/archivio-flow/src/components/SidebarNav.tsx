import { visibleNavItems, type NavId } from "../wizardModel";

export type NavScreen = "sd" | "nuovo" | "archivio" | "drive" | "impostazioni";

const ITEMS: Record<Exclude<NavId, "exit">, { icon: string; label: string; screens: NavScreen[] }> = {
  import: { icon: "＋", label: "Importa dalla scheda", screens: ["sd", "nuovo"] },
  archive: { icon: "▦", label: "Archivio lavori", screens: ["archivio"] },
  drive: { icon: "☁", label: "Google Drive", screens: ["drive"] },
  backup: { icon: "⧉", label: "Backup Guard", screens: [] },
  settings: { icon: "⚙", label: "Impostazioni", screens: ["impostazioni"] },
};

/**
 * Navigazione laterale: nel percorso a passi restano solo le voci utili e "Esci dal percorso",
 * cosi' non si cambia sezione per sbaglio a meta' importazione. Nessun sottotitolo, tranne il numero di lavori.
 */
export function SidebarNav({ screen, inGuidedFlow, archiveSummary, backupBusy, onSelect }: {
  screen: NavScreen;
  inGuidedFlow: boolean;
  /** "202 lavori salvati" o "Controllo nomi in corso…". */
  archiveSummary: string;
  backupBusy: boolean;
  onSelect: (id: NavId) => void;
}) {
  return <nav className="stack" aria-label="Sezioni">
    {visibleNavItems(inGuidedFlow).map((id) => {
      if (id === "exit") {
        return <button key={id} type="button" className="workflow-step workflow-step--exit" onClick={() => onSelect(id)} title="Esci dal percorso e torna alla scelta delle foto" aria-label="Esci dal percorso">
          <span aria-hidden="true">✕</span>
          <strong>Esci dal percorso</strong>
        </button>;
      }
      const item = ITEMS[id];
      const active = item.screens.includes(screen);
      const label = id === "backup" && backupBusy ? "Apro Backup Guard…" : item.label;
      return <button key={id} type="button" className={active ? "workflow-step workflow-step--active" : "workflow-step"} onClick={() => onSelect(id)} title={label} aria-label={label} aria-current={active ? "page" : undefined} disabled={id === "backup" && backupBusy}>
        <span aria-hidden="true">{item.icon}</span>
        <strong>{label}</strong>
        {id === "archive" && <small>{archiveSummary}</small>}
      </button>;
    })}
  </nav>;
}
