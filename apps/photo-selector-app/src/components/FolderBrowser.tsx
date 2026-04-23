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

interface FolderBrowserProps {
  onFolderOpened: (result: FolderOpenResult) => void | Promise<void>;
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

export function FolderBrowser({ onFolderOpened, isBusy = false }: FolderBrowserProps) {
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

  async function handleBrowse() {
    if (isBusy) {
      return;
    }

    const result = await openFolderNative();
    if (result) {
      await onFolderOpened(result);
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
        await onFolderOpened(result);
        return;
      }

      const nextRecentFolders = await removeRecentFolder(folder.path ?? folder.name);
      setRecentFolders(nextRecentFolders);
      await handleBrowse();
    } finally {
      setOpeningRecentFolder(null);
    }
  }

  return (
    <div className="folder-browser">
      <div className="folder-browser__hero">
        <div className="folder-browser__icon" aria-hidden="true">{heroIcon}</div>
        <h2 className="folder-browser__title">Apri una cartella</h2>
        <p className="folder-browser__subtitle">
          Seleziona una cartella con le foto per iniziare la selezione.
        </p>

        <div className="folder-browser__actions">
          <button type="button" className="primary-button" onClick={handleBrowse} disabled={isBusy}>
            {isBusy ? "Apertura in corso..." : "Sfoglia cartella..."}
          </button>
        </div>

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
      </div>

      {recentFolders.length > 0 ? (
        <div className="folder-browser__recent">
          <h3 className="folder-browser__recent-title">Cartelle recenti</h3>
          <ul className="folder-browser__recent-list">
            {recentFolders.map((folder) => (
              <li key={folder.name} className="folder-browser__recent-item">
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
                        : `${folder.imageCount} foto - ${formatRelativeTime(folder.openedAt)}`}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

