import { useCallback, useEffect, useMemo, useState } from "react";
import type { PreviewMediaFile } from "../previewPolicy";
import { buildPreviewSourceKey } from "../previewPolicy";
import { getArchivioFullPreviewBlob, warmArchivioFullPreview } from "../archivioDesktopApi";

interface Props {
  files: PreviewMediaFile[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

function fitMaxDimension(): number {
  const viewport = Math.max(window.innerWidth || 0, window.innerHeight || 0, 1024);
  const ratio = window.devicePixelRatio && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  return Math.min(2560, Math.ceil(viewport * ratio));
}

export function SdLightbox({ files, index, onIndexChange, onClose }: Props) {
  const file = files[index] ?? null;
  const [blob, setBlob] = useState<Blob | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [shareOpen, setShareOpen] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [waAskPhone, setWaAskPhone] = useState(false);
  const [waPhone, setWaPhone] = useState(() => window.localStorage.getItem("filex.shareWaPhone") ?? "");
  const maxDimension = useMemo(() => fitMaxDimension(), []);

  const goTo = useCallback((next: number) => {
    if (files.length === 0) return;
    const wrapped = (next + files.length) % files.length;
    onIndexChange(wrapped);
  }, [files.length, onIndexChange]);

  useEffect(() => {
    if (!file) {
      setSrc(null);
      setStatus("error");
      return;
    }
    let alive = true;
    let objectUrl: string | null = null;
    setBlob(null);
    setSrc(null);
    setStatus("loading");
    setShareOpen(false);
    setShareMessage(null);
    setWaAskPhone(false);
    const sourceKey = buildPreviewSourceKey(file);
    void getArchivioFullPreviewBlob(file.filePath, maxDimension, sourceKey)
      .then((nextBlob) => {
        if (!alive) return;
        if (!nextBlob) {
          setStatus("error");
          return;
        }
        objectUrl = URL.createObjectURL(nextBlob);
        setBlob(nextBlob);
        setSrc(objectUrl);
        setStatus("ready");
      })
      .catch(() => {
        if (alive) setStatus("error");
      });
    for (const delta of [1, -1, 2, -2]) {
      const neighbor = files[(index + delta + files.length) % files.length];
      if (neighbor && neighbor.filePath !== file.filePath) {
        warmArchivioFullPreview(neighbor.filePath, maxDimension, buildPreviewSourceKey(neighbor));
      }
    }
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, files, index, maxDimension]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goTo(index + 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goTo(index - 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [goTo, index, onClose]);

  if (!file) return null;

  async function blobToPngClipboardItem(source: Blob): Promise<ClipboardItem | null> {
    try {
      if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return null;
      const bitmap = await createImageBitmap(source);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(bitmap, 0, 0);
        const png = await new Promise<Blob | null>((resolve) => canvas.toBlob((next) => resolve(next), "image/png"));
        if (!png) return null;
        return new ClipboardItem({ "image/png": png });
      } finally {
        if (typeof bitmap.close === "function") bitmap.close();
      }
    } catch {
      return null;
    }
  }

  async function copyCurrentImage(): Promise<boolean> {
    try {
      if (!blob) return false;
      const item = await blobToPngClipboardItem(blob);
      if (!item) return false;
      await navigator.clipboard.write([item]);
      return true;
    } catch {
      return false;
    }
  }

  async function handleCopyImage() {
    setShareMessage("Copia in corso…");
    const copied = await copyCurrentImage();
    setShareMessage(copied
      ? "Immagine copiata: incollala con Ctrl+V in chat, email o WhatsApp."
      : "Copia non riuscita in questo contesto: usa Scarica e allega il file manualmente.");
  }

  function handleShareWhatsApp() {
    setWaAskPhone(true);
    setShareMessage("Inserisci il numero: copierò l'immagine e aprirò la chat, poi incolla con Ctrl+V.");
  }

  async function handleOpenWhatsAppChat() {
    const digits = waPhone.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) {
      setShareMessage("Inserisci un numero valido in formato internazionale (es. 393491234567).");
      return;
    }
    setShareMessage("Copia in corso…");
    const copied = await copyCurrentImage();
    if (!copied) handleDownload();
    window.localStorage.setItem("filex.shareWaPhone", waPhone);
    setWaAskPhone(false);
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(`Ti invio questa foto: ${file.fileName}`)}`, "_blank", "noopener");
    setShareMessage(copied
      ? "Chat aperta: incolla l'immagine con Ctrl+V nel messaggio."
      : "Chat aperta: la copia non è riuscita, allega la foto scaricata.");
  }

  async function handleShareEmail() {
    await copyCurrentImage();
    window.location.href = `mailto:?subject=${encodeURIComponent(`Foto ${file.fileName}`)}&body=${encodeURIComponent("Ti invio questa foto in anteprima.")}`;
    setShareMessage("Email aperta: incolla l'immagine copiata nel messaggio.");
  }

  function handleDownload() {
    if (!src) return;
    const anchor = document.createElement("a");
    anchor.href = src;
    anchor.download = file.fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  const navButtonStyle: React.CSSProperties = {
    border: "1px solid var(--line-strong)",
    background: "rgba(35, 41, 37, 0.85)",
    color: "var(--text)",
    borderRadius: 999,
    width: 44,
    height: 44,
    fontSize: "1.2rem",
    cursor: "pointer",
    flexShrink: 0,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Anteprima ${file.fileName}`}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(8, 10, 9, 0.94)",
        display: "flex",
        flexDirection: "column",
        padding: "0.9rem 1.1rem",
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.6rem" }}
      >
        <span style={{ color: "var(--text-muted)", fontSize: "0.85rem", whiteSpace: "nowrap" }}>
          {index + 1} di {files.length}
        </span>
        <strong style={{ fontSize: "0.95rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {file.fileName}
        </strong>
        <button
          type="button"
          onClick={() => { setShareOpen((value) => !value); setShareMessage(null); setWaAskPhone(false); }}
          aria-label="Condividi foto"
          aria-expanded={shareOpen}
          className="ghost-button"
          style={{ padding: "0.45rem 0.85rem", fontSize: "0.85rem" }}
          disabled={status !== "ready"}
          title="Copia o invia la foto al cliente"
        >
          Condividi
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Chiudi anteprima"
          className="ghost-button"
          style={{ padding: "0.45rem 0.85rem", fontSize: "0.85rem" }}
        >
          Chiudi ✕
        </button>
      </div>

      {shareOpen && (
        <div
          onClick={(event) => event.stopPropagation()}
          style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.6rem" }}
        >
          <button type="button" onClick={() => { void handleCopyImage(); }} className="secondary-button" style={{ padding: "0.4rem 0.75rem", fontSize: "0.8rem" }}>
            Copia immagine
          </button>
          <button type="button" onClick={() => { void handleShareWhatsApp(); }} className="secondary-button" style={{ padding: "0.4rem 0.75rem", fontSize: "0.8rem" }}>
            WhatsApp
          </button>
          <button type="button" onClick={() => { void handleShareEmail(); }} className="secondary-button" style={{ padding: "0.4rem 0.75rem", fontSize: "0.8rem" }}>
            Email
          </button>
          <button type="button" onClick={handleDownload} className="ghost-button" style={{ padding: "0.4rem 0.75rem", fontSize: "0.8rem" }}>
            Scarica
          </button>
          {shareMessage && (
            <span role="status" style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>{shareMessage}</span>
          )}
        </div>
      )}
      {shareOpen && waAskPhone && (
        <div
          onClick={(event) => event.stopPropagation()}
          style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.6rem" }}
        >
          <label htmlFor="sd-share-phone" style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
            Numero WhatsApp (formato internazionale):
          </label>
          <input
            id="sd-share-phone"
            type="tel"
            value={waPhone}
            onChange={(event) => setWaPhone(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") handleOpenWhatsAppChat(); }}
            placeholder="es. 393491234567"
            inputMode="tel"
            style={{
              border: "1px solid var(--line-strong)",
              background: "var(--bg-panel)",
              color: "var(--text)",
              borderRadius: 10,
              padding: "0.4rem 0.6rem",
              fontSize: "0.85rem",
              minWidth: 180,
            }}
          />
          <button type="button" onClick={handleOpenWhatsAppChat} className="primary-button" style={{ padding: "0.4rem 0.9rem", fontSize: "0.8rem" }}>
            Apri chat
          </button>
        </div>
      )}

      <div
        onClick={(event) => event.stopPropagation()}
        style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", gap: "0.6rem" }}
      >
        <button
          type="button"
          onClick={() => goTo(index - 1)}
          disabled={files.length < 2}
          aria-label="Foto precedente"
          style={navButtonStyle}
        >
          ‹
        </button>
        <div style={{ flex: 1, minWidth: 0, height: "100%", display: "grid", placeItems: "center" }}>
          {status !== "ready" || !src ? (
            <div style={{ color: "var(--text-muted)", fontSize: "0.9rem", display: "grid", placeItems: "center", gap: "0.6rem" }}>
              {status === "error" ? (
                <span>Anteprima a schermo intero non disponibile per questo file.</span>
              ) : (
                <span className="media-preview-loading">
                  <span className="media-preview-loading__spinner" aria-hidden="true" />
                  Carico anteprima a piena qualità…
                </span>
              )}
            </div>
          ) : (
            <img
              src={src}
              alt={file.fileName}
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 8 }}
            />
          )}
        </div>
        <button
          type="button"
          onClick={() => goTo(index + 1)}
          disabled={files.length < 2}
          aria-label="Foto successiva"
          style={navButtonStyle}
        >
          ›
        </button>
      </div>

      <p
        onClick={(event) => event.stopPropagation()}
        style={{ margin: "0.6rem 0 0", textAlign: "center", color: "var(--text-muted)", fontSize: "0.78rem" }}
      >
        Frecce ← → per sfogliare · Esc per chiudere
      </p>
    </div>
  );
}
