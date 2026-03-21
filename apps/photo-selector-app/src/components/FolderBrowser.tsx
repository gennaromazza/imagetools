import { useEffect, useRef, useState } from "react";
import {
  fileListToEntries,
  getRecentFolders,
  hasNativeFolderAccess,
  openFolderNative,
  reopenRecentFolder,
  type FolderEntry,
  type RecentFolder,
} from "../services/folder-access";

interface FolderBrowserProps {
  onFolderOpened: (name: string, entries: FolderEntry[]) => void;
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

export function FolderBrowser({ onFolderOpened }: FolderBrowserProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [openingRecentFolder, setOpeningRecentFolder] = useState<string | null>(null);
  const recentFolders = getRecentFolders();
  const supportsNative = hasNativeFolderAccess();

  useEffect(() => {
    if (!fileInputRef.current) return;
    fileInputRef.current.setAttribute("webkitdirectory", "");
    fileInputRef.current.setAttribute("directory", "");
  }, []);

  async function handleBrowse() {
    if (supportsNative) {
      const result = await openFolderNative();
      if (result) onFolderOpened(result.name, result.entries);
    } else {
      fileInputRef.current?.click();
    }
  }

  function handleFallbackInput(files: FileList | null) {
    if (!files || files.length === 0) return;
    const result = fileListToEntries(files);
    onFolderOpened(result.name, result.entries);
  }

  async function handleRecentFolderOpen(folder: RecentFolder) {
    if (!supportsNative || openingRecentFolder) {
      return;
    }

    setOpeningRecentFolder(folder.name);
    try {
      const result = await reopenRecentFolder(folder.name);
      if (result) {
        onFolderOpened(result.name, result.entries);
        return;
      }

      await handleBrowse();
    } finally {
      setOpeningRecentFolder(null);
    }
  }

  return (
    <div className="folder-browser">
      <div className="folder-browser__hero">
        <div className="folder-browser__icon">📁</div>
        <h2 className="folder-browser__title">Apri una cartella</h2>
        <p className="folder-browser__subtitle">
          Seleziona una cartella con le foto per iniziare la selezione.
        </p>

        <div className="folder-browser__actions">
          <button type="button" className="primary-button" onClick={handleBrowse}>
            Sfoglia cartella...
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
              )
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
                {supportsNative ? (
                  <button
                    type="button"
                    className="folder-browser__recent-button"
                    onClick={() => void handleRecentFolderOpen(folder)}
                    disabled={openingRecentFolder !== null}
                  >
                    <div className="folder-browser__recent-icon">📂</div>
                    <div className="folder-browser__recent-info">
                      <span className="folder-browser__recent-name">{folder.name}</span>
                      <span className="folder-browser__recent-meta">
                        {openingRecentFolder === folder.name
                          ? "Riapertura in corso..."
                          : `${folder.imageCount} foto · ${formatRelativeTime(folder.openedAt)}`}
                      </span>
                    </div>
                  </button>
                ) : (
                  <>
                    <div className="folder-browser__recent-icon">📂</div>
                    <div className="folder-browser__recent-info">
                      <span className="folder-browser__recent-name">{folder.name}</span>
                      <span className="folder-browser__recent-meta">
                        {folder.imageCount} foto · {formatRelativeTime(folder.openedAt)}
                      </span>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.cr2,.cr3,.crw,.nef,.nrw,.arw,.srf,.sr2,.raf,.dng,.rw2,.orf,.pef,.srw,.3fr,.x3f,.gpr"
        multiple
        className="hidden-file-input"
        onChange={(ev) => handleFallbackInput(ev.target.files)}
      />
    </div>
  );
}
