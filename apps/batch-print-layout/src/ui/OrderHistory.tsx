import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { loadHistory } from "../order/history";

const day = (iso: string) => new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });

export function OrderHistory() {
  const [entries] = useState(() => loadHistory(window.localStorage));
  // Voci la cui cartella si può aprire davvero in questo momento.
  const [available, setAvailable] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    const check = async () => {
      const files = entries.flatMap((entry) => (entry.checkFile ? [entry.checkFile] : []));
      if (!window.filexDesktop || files.length === 0) return;
      const found = new Set((await window.filexDesktop.statFiles(files)).map((stat) => stat.absolutePath));
      if (active) setAvailable(new Set(entries.filter((entry) => entry.checkFile && found.has(entry.checkFile)).map((entry) => entry.id)));
    };
    void check().catch(() => undefined);
    // Un disco ricollegato torna disponibile quando si rientra nella finestra.
    window.addEventListener("focus", check);
    return () => {
      active = false;
      window.removeEventListener("focus", check);
    };
  }, [entries]);

  if (entries.length === 0) {
    return (
      <section className="history" aria-label="Cronologia dei lavori">
        <p className="eyebrow">Cronologia</p>
        <p className="hint">Ancora nessun lavoro: qui compaiono gli ordini cliente appena li crei e i lavori che esporti.</p>
      </section>
    );
  }

  return (
    <section className="history" aria-label="Cronologia dei lavori">
      <p className="eyebrow">Cronologia</p>
      <ul>
        {entries.map((entry) => {
          const open = available.has(entry.id);
          const note = !entry.exportedAt ? "Non ancora esportato" : open ? "Apri cartella" : "Cartella non disponibile";
          return (
            <li key={entry.id}>
              <button type="button" disabled={!open} title={entry.folderPath} onClick={() => void window.filexDesktop?.revealInFolder(entry.folderPath!)}>
                <span className="history__name">{entry.customerName || "Lavoro veloce"}</span>
                <span className="history__details">
                  {day(entry.createdAt)}
                  {entry.prints ? ` · ${entry.prints} ${entry.prints === 1 ? "stampa" : "stampe"}` : ""}
                  {entry.formats?.length ? ` · ${entry.formats.join(", ")}` : ""}
                </span>
                <span className="history__action">{open ? <FolderOpen size={15} /> : null} {note}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
