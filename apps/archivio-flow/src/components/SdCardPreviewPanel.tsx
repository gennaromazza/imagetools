import { useEffect, useMemo, useRef, useState } from "react";
import type { FilterPreviewData, SafeToFormatResult, SdPreview } from "../types";
import { checkArchivioSafeToFormat, getArchivioFilterPreview, getArchivioSdPreview } from "../archivioDesktopApi";
import { DesktopPreviewImage } from "./DesktopPreviewImage";

interface Props {
  sdPath: string;
  onStartImport: (dateFilter: string | null) => void;
}

const PREVIEW_PAGE_SIZE = 24;

function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function localIsoDate(timestamp: number): string {
  const value = new Date(timestamp);
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(0, Math.round(bytes / 1e3))} KB`;
}

export function SdCardPreviewPanel({ sdPath, onStartImport }: Props) {
  const [preview, setPreview] = useState<SdPreview | null>(null);
  const [allMedia, setAllMedia] = useState<FilterPreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [safeCheck, setSafeCheck] = useState<SafeToFormatResult | null>(null);
  const [checkingSafe, setCheckingSafe] = useState(false);
  const [visibleMediaCount, setVisibleMediaCount] = useState(PREVIEW_PAGE_SIZE);
  const [filterMode, setFilterMode] = useState<"all" | "date">("date");
  const [selectedDate, setSelectedDate] = useState(todayIso);
  const loadMoreTriggerRef = useRef<HTMLDivElement | null>(null);

  const media = useMemo(() => {
    if (!allMedia || filterMode === "all") return allMedia;
    const sampleFiles = allMedia.sampleFiles.filter((file) => localIsoDate(file.mtimeMs) === selectedDate);
    return {
      ...allMedia,
      matchedFiles: sampleFiles.length,
      matchedRawFiles: sampleFiles.filter((file) => file.mediaType === "photo" && !file.isJpg).length,
      matchedJpgFiles: sampleFiles.filter((file) => file.isJpg).length,
      matchedVideoFiles: sampleFiles.filter((file) => file.mediaType === "video").length,
      matchedOtherFiles: sampleFiles.filter((file) => file.mediaType === "other").length,
      sampleFiles,
    };
  }, [allMedia, filterMode, selectedDate]);

  const availableDates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const file of allMedia?.sampleFiles ?? []) {
      const date = localIsoDate(file.mtimeMs);
      counts.set(date, (counts.get(date) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([left], [right]) => right.localeCompare(left));
  }, [allMedia]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setSafeCheck(null);
    Promise.all([
      getArchivioSdPreview(sdPath),
      getArchivioFilterPreview({ sdPath, maxSamples: 5000 }),
    ])
      .then(([sdPreview, filterPreview]) => {
        if (!active) return;
        setPreview(sdPreview);
        setAllMedia(filterPreview);
        const newestDate = filterPreview.sampleFiles
          .map((file) => localIsoDate(file.mtimeMs))
          .sort((left, right) => right.localeCompare(left))[0];
        if (newestDate) setSelectedDate(newestDate);
      })
      .catch(() => {
        if (!active) return;
        setPreview(null);
        setAllMedia(null);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sdPath]);

  useEffect(() => {
    setVisibleMediaCount(PREVIEW_PAGE_SIZE);
  }, [media, sdPath]);

  useEffect(() => {
    const trigger = loadMoreTriggerRef.current;
    const total = media?.sampleFiles.length ?? 0;
    if (!trigger || visibleMediaCount >= total) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisibleMediaCount((current) => Math.min(current + PREVIEW_PAGE_SIZE, total));
      }
    }, { rootMargin: "120px 0px" });
    observer.observe(trigger);
    return () => observer.disconnect();
  }, [media?.sampleFiles.length, visibleMediaCount]);

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
              <button className="primary-button" onClick={() => onStartImport(filterMode === "date" ? selectedDate : null)} disabled={loading}>
                {filterMode === "date" ? "Importa questa data" : "Importa questa SD"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <section className="panel-section import-step" style={{ padding: "var(--space-4)" }}>
        <div className="stack" style={{ gap: "0.8rem" }}>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "end", justifyContent: "space-between", flexWrap: "wrap" }}>
            <div>
              <strong>{media ? `${media.matchedFiles} file multimediali · visualizzati ${Math.min(visibleMediaCount, media.sampleFiles.length)} di ${media.sampleFiles.length}` : "Carico contenuto…"}</strong>
              <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.84rem" }}>Scegli se importare tutta la scheda oppure solo un giorno.</p>
            </div>
            <div className="button-row" role="group" aria-label="Filtro importazione SD">
              <button className={filterMode === "all" ? "primary-button" : "ghost-button"} onClick={() => setFilterMode("all")}>Tutto</button>
              <button className={filterMode === "date" ? "primary-button" : "ghost-button"} onClick={() => setFilterMode("date")}>Per data</button>
              {filterMode === "date" && (
                <label style={{ display: "grid", gap: "0.2rem", fontSize: "0.78rem", color: "var(--text-muted)" }}>
                  Altra data
                  <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
                </label>
              )}
            </div>
          </div>
          {filterMode === "date" && availableDates.length > 0 && (
            <div className="button-row" style={{ alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ color: "var(--text-muted)", fontSize: "0.84rem" }}>Date trovate:</span>
              {availableDates.map(([date, count]) => (
                <button
                  key={date}
                  className={selectedDate === date ? "primary-button" : "secondary-button"}
                  onClick={() => setSelectedDate(date)}
                  title={`Mostra ${count} file del ${new Date(`${date}T12:00`).toLocaleDateString("it-IT")}`}
                  style={{ padding: "0.42rem 0.65rem", fontSize: "0.82rem" }}
                >
                  {new Date(`${date}T12:00`).toLocaleDateString("it-IT")} · {count}
                </button>
              ))}
            </div>
          )}
          {media && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: "0.5rem" }}>
              {media.sampleFiles.slice(0, visibleMediaCount).map((file, index) => (
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
          {media && visibleMediaCount < media.sampleFiles.length && (
            <div ref={loadMoreTriggerRef} role="status" style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.88rem", padding: "0.35rem" }}>
              Scorri per caricare altri file…
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
