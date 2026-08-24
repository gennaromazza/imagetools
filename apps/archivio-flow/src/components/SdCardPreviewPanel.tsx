import { useEffect, useState } from "react";
import type { FilterPreviewData, SafeToFormatResult, SdPreview } from "../types";
import { checkArchivioSafeToFormat, getArchivioFilterPreview, getArchivioSdPreview } from "../archivioDesktopApi";
import { DesktopPreviewImage } from "./DesktopPreviewImage";

interface Props {
  sdPath: string;
  onStartImport: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(0, Math.round(bytes / 1e3))} KB`;
}

export function SdCardPreviewPanel({ sdPath, onStartImport }: Props) {
  const [preview, setPreview] = useState<SdPreview | null>(null);
  const [media, setMedia] = useState<FilterPreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [safeCheck, setSafeCheck] = useState<SafeToFormatResult | null>(null);
  const [checkingSafe, setCheckingSafe] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setSafeCheck(null);
    Promise.all([
      getArchivioSdPreview(sdPath),
      getArchivioFilterPreview({ sdPath, maxSamples: 48 }),
    ])
      .then(([sdPreview, filterPreview]) => {
        if (!active) return;
        setPreview(sdPreview);
        setMedia(filterPreview);
      })
      .catch(() => {
        if (!active) return;
        setPreview(null);
        setMedia(null);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sdPath]);

  async function verifySd() {
    setCheckingSafe(true);
    try {
      setSafeCheck(await checkArchivioSafeToFormat(sdPath));
    } finally {
      setCheckingSafe(false);
    }
  }

  const statusCopy = checkingSafe
    ? "Verifica in corso…"
    : safeCheck?.status === "SAFE"
      ? `Tutto a posto: ${safeCheck.verifiedFiles}/${safeCheck.totalFiles} file sono già archiviati.`
      : safeCheck?.status === "PARTIAL"
        ? `Attenzione: ${safeCheck.verifiedFiles}/${safeCheck.totalFiles} file verificati. ${safeCheck.reason ?? "Non formattare ancora."}`
        : safeCheck?.status === "UNSAFE"
          ? "Non formattare: questa SD non risulta ancora archiviata."
          : safeCheck?.status === "UNKNOWN"
            ? `Esito non disponibile: ${safeCheck.reason ?? "ripeti il controllo."}`
            : "Controlla se questa SD è già stata importata prima di formattarla.";

  return (
    <div className="stack">
      <div className="panel-section" style={{ padding: "0.85rem 1rem" }}>
        <div>
          <div style={{ display: "flex", gap: "0.8rem", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            <div>
              <strong>SD: {sdPath}</strong>
              <span style={{ marginLeft: "0.65rem", color: "var(--text-muted)", fontSize: "0.88rem" }}>
                {loading ? "Rilevamento contenuto…" : `${preview?.totalFiles ?? 0} file · ${(preview?.rawFiles ?? 0) + (preview?.jpgFiles ?? 0)} foto · ${preview?.videoFiles ?? 0} video`}
              </span>
            </div>
            <div className="button-row">
              <button className="ghost-button" onClick={() => { void verifySd(); }} disabled={checkingSafe || loading}>
                {checkingSafe ? "Verifica…" : safeCheck?.status === "SAFE" ? "SD sicura" : "Verifica SD"}
              </button>
              <button className="primary-button" onClick={onStartImport} disabled={loading}>Importa questa SD</button>
            </div>
          </div>
        </div>
      </div>

      <section className="panel-section import-step" style={{ padding: "var(--space-4)" }}>
        <div className="stack" style={{ gap: "0.8rem" }}>
          <div>
            <strong>{media ? `${media.matchedFiles} file multimediali` : "Carico contenuto…"}</strong>
          </div>
          {media && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: "0.5rem" }}>
              {media.sampleFiles.map((file, index) => (
                <div key={`${file.filePath}-${index}`} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "0.35rem", background: "rgba(0,0,0,0.15)" }}>
                  {file.mediaType === "video" || file.isJpg ? (
                    <DesktopPreviewImage sdPath={sdPath} filePath={file.filePath} alt={file.fileName} style={{ width: "100%", height: 100, objectFit: "cover", borderRadius: 7 }} />
                  ) : (
                    <div style={{ width: "100%", height: 100, borderRadius: 7, display: "grid", placeItems: "center", background: "rgba(255,255,255,0.05)", color: "var(--text-muted)" }}>
                      FOTO {file.ext.toUpperCase()}
                    </div>
                  )}
                  <div style={{ marginTop: "0.4rem", fontSize: "0.8rem", wordBreak: "break-all" }}>{file.fileName}</div>
                  <div style={{ marginTop: "0.2rem", fontSize: "0.76rem", color: "var(--text-muted)" }}>{formatBytes(file.size)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <details className="import-advanced-panel">
        <summary>Sicurezza e impostazioni SD</summary>
        <div className="stack" style={{ gap: "0.8rem", marginTop: "0.75rem" }}>
          <div className="message-box" style={{ borderColor: safeCheck?.status === "SAFE" ? "var(--success)" : safeCheck ? "#d4a35c" : "var(--line)" }}>
            <strong>Sicurezza formattazione</strong>
            <p style={{ margin: "0.35rem 0 0", color: "var(--text-muted)" }}>{statusCopy}</p>
          </div>
          <div className="message-box" style={{ background: "rgba(255,255,255,0.03)" }}>
            <strong>Vuoi evitare l’apertura di Esplora risorse?</strong>
            <p style={{ margin: "0.35rem 0", color: "var(--text-muted)" }}>Configura AutoPlay di Windows su “Nessuna azione”.</p>
            <a href="ms-settings:autoplay" target="_blank" rel="noreferrer" className="secondary-button" style={{ display: "inline-flex", textDecoration: "none" }}>Apri impostazioni AutoPlay</a>
          </div>
          <div className="message-box" style={{ background: "rgba(255,255,255,0.03)" }}>
            <strong>Avvio con Windows</strong>
            <p style={{ margin: "0.35rem 0", color: "var(--text-muted)" }}>Puoi attivarlo o disattivarlo nella schermata Impostazioni.</p>
          </div>
        </div>
      </details>
    </div>
  );
}
