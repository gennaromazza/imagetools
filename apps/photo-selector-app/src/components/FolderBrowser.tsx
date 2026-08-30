import { useEffect, useState } from "react";
import {
  getRecentFolders,
  hydrateRecentFolders,
  openFolderNative,
  removeRecentFolder,
  reopenRecentFolder,
  type FolderOpenResult,
  type RecentFolder,
} from "../services/folder-access";

export type FolderOpenIntent = NonNullable<RecentFolder["mode"]> | "resume";

export interface FolderBrowserProps {
  onFolderOpened: (result: FolderOpenResult, intent: FolderOpenIntent) => void | Promise<void>;
  onCreateProject: () => void | Promise<void>;
  isBusy?: boolean;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "adesso";
  if (minutes < 60) return `${minutes} min fa`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} or${hours === 1 ? "a" : "e"} fa`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} giorn${days === 1 ? "o" : "i"} fa`;
  return new Date(timestamp).toLocaleDateString("it-IT");
}

function formatRecentMode(mode: RecentFolder["mode"]): string {
  if (mode === "project") return "Progetto master";
  if (mode === "free") return "Modalità libera";
  return "Modalità da rilevare";
}

export function FolderBrowser({ onFolderOpened, onCreateProject, isBusy = false }: FolderBrowserProps) {
  const heroIcon = "\u{1F5BC}";
  const recentFolderIcon = "\u{1F4C1}";
  const [openingRecentFolder, setOpeningRecentFolder] = useState<string | null>(null);
  const [recentFolders, setRecentFolders] = useState<RecentFolder[]>(() => getRecentFolders());

  useEffect(() => {
    let active = true;
    void hydrateRecentFolders().then((folders) => {
      if (active) {
        setRecentFolders(folders);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  async function handleBrowse(intent: FolderOpenIntent) {
    if (isBusy) {
      return;
    }

    const result = await openFolderNative();
    if (result) {
      await onFolderOpened(result, intent);
    }
  }

  async function handleRecentFolderOpen(folder: RecentFolder) {
    if (openingRecentFolder || isBusy) {
      return;
    }

    setOpeningRecentFolder(folder.name);
    try {
      const result = await reopenRecentFolder(folder);
      if (result) {
        await onFolderOpened(result, folder.mode ?? "resume");
        return;
      }

      const nextRecentFolders = await removeRecentFolder(folder.path ?? folder.name);
      setRecentFolders(nextRecentFolders);
      await handleBrowse("resume");
    } finally {
      setOpeningRecentFolder(null);
    }
  }

  return (
    <div className="folder-browser">
      <section className="folder-browser__hero" aria-labelledby="folder-browser-title" aria-busy={isBusy}>
        <div className="folder-browser__icon" aria-hidden="true">{heroIcon}</div>
        <h2 id="folder-browser-title" className="folder-browser__title">Come vuoi iniziare?</h2>
        <p className="folder-browser__subtitle">
          Scegli la modalità in base al lavoro di oggi. Potrai tornare qui e aprire un altro spazio in qualsiasi momento.
        </p>

        <div className="folder-browser__mode-grid">
          <article className="folder-browser__mode-card folder-browser__mode-card--free">
            <div className="folder-browser__mode-heading">
              <span className="folder-browser__mode-icon" aria-hidden="true">⚡</span>
              <div>
                <span className="folder-browser__mode-kicker">Rapida e flessibile</span>
                <h3>Selezione libera</h3>
              </div>
            </div>
            <p>
              Apri una cartella, una scheda SD o un disco e inizia subito, senza creare o associare un progetto.
            </p>
            <ul className="folder-browser__mode-benefits">
              <li>Ideale per selezioni veloci e lavori occasionali</li>
              <li>Scelte e classificazioni salvate automaticamente nell’app</li>
              <li>Backup e ripristino manuale della selezione su Google Drive</li>
            </ul>
            <button type="button" className="primary-button" onClick={() => void handleBrowse("free")} disabled={isBusy}>
              {isBusy ? "Apertura in corso..." : "Apri in modalità libera..."}
            </button>
          </article>

          <article className="folder-browser__mode-card folder-browser__mode-card--project">
            <div className="folder-browser__mode-heading">
              <span className="folder-browser__mode-icon" aria-hidden="true">🗂️</span>
              <div>
                <span className="folder-browser__mode-kicker">Strutturata e continuativa</span>
                <h3>Progetto master</h3>
              </div>
            </div>
            <p>
              Riunisce il lavoro e le sue sottocartelle sotto un’identità stabile, pronta per un flusso organizzato.
            </p>
            <ul className="folder-browser__mode-benefits">
              <li>Consigliato per matrimoni, servizi e lavori articolati</li>
              <li>È la modalità usata quando arrivi da Archivio Flow</li>
            </ul>
            <button type="button" className="secondary-button" onClick={() => void onCreateProject()} disabled={isBusy}>
              {isBusy ? "Apertura in corso..." : "Crea o apri un progetto master..."}
            </button>
          </article>
        </div>

        <p className="folder-browser__shared-capabilities" role="note">
          <strong>In entrambe le modalità:</strong> lavori con RAW e JPEG, mantieni gli XMP quando la sorgente è scrivibile e scegli tu quando creare un backup manuale su Drive. La differenza è l’organizzazione come progetto.
        </p>

        <div className="folder-browser__formats">
          <span className="folder-browser__formats-label">Formati supportati</span>
          <div className="folder-browser__format-tags">
            {["JPEG", "PNG", "WebP", "CR2", "CR3", "NEF", "ARW", "RAF", "DNG", "RW2", "ORF", "PEF", "3FR", "X3F"].map(
              (fmt) => (
                <span key={fmt} className="folder-browser__format-tag">
                  {fmt}
                </span>
              ),
            )}
          </div>
        </div>
      </section>

      {recentFolders.length > 0 ? (
        <section className="folder-browser__recent" aria-labelledby="recent-folders-title">
          <div>
            <h3 id="recent-folders-title" className="folder-browser__recent-title">Cartelle recenti</h3>
            <p className="folder-browser__recent-helper">
              Riprendi con la modalità salvata; se la cartella appartiene a un progetto master, verrà riaperto il progetto.
            </p>
          </div>
          <ul className="folder-browser__recent-list">
            {recentFolders.map((folder) => (
              <li key={folder.path ?? folder.name} className="folder-browser__recent-item">
                <button
                  type="button"
                  className="folder-browser__recent-button"
                  onClick={() => void handleRecentFolderOpen(folder)}
                  disabled={openingRecentFolder !== null || isBusy}
                >
                  <div className="folder-browser__recent-icon" aria-hidden="true">{recentFolderIcon}</div>
                  <div className="folder-browser__recent-info">
                    <span className="folder-browser__recent-name">{folder.name}</span>
                    <span className="folder-browser__recent-meta">
                      {openingRecentFolder === folder.name
                        ? "Riapertura in corso..."
                        : `${formatRecentMode(folder.mode)} · ${folder.imageCount} foto · ${formatRelativeTime(folder.openedAt)}`}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

