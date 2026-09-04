import { useEffect, useMemo, useRef, useState } from "react";
import type { FilterPreviewData, SafeToFormatResult, SdPreview } from "../types";
import {
  checkArchivioSafeToFormat,
  getArchivioFilterPreview,
  getArchivioSdPreview,
  sendArchivioPhotoSelectionToTool,
} from "../archivioDesktopApi";
import { DesktopPreviewImage } from "./DesktopPreviewImage";
import { buildPreviewSourceKey, filterMediaForDate, isPreviewableMedia, localIsoDate } from "../previewPolicy";
import {
  PHOTO_TOOL_SELECTION_LIMIT,
  PHOTO_TOOL_TARGETS,
  addVisibleCompatiblePhotos,
  isPhotoToolCompatible,
  togglePhotoSelection,
  validatePhotoToolSelection,
  type PhotoToolTargetId,
} from "../photoToolRouting";

interface Props {
  sdPath: string | null;
  onStartImport: (dateFilter: string | null) => void;
}

const PREVIEW_PAGE_SIZE = 24;

function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
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
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [sendingTarget, setSendingTarget] = useState<PhotoToolTargetId | null>(null);
  const [routingFeedback, setRoutingFeedback] = useState<string | null>(null);
  const loadMoreTriggerRef = useRef<HTMLDivElement | null>(null);
  const routingRequestIdRef = useRef(0);

  const media = useMemo(() => {
    if (!allMedia || filterMode === "all") return allMedia;
    const sampleFiles = filterMediaForDate(allMedia.sampleFiles, selectedDate);
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

  const visibleFiles = useMemo(
    () => media?.sampleFiles.slice(0, visibleMediaCount) ?? [],
    [media, visibleMediaCount],
  );
  const visibleCompatibleCount = useMemo(
    () => visibleFiles.filter(isPhotoToolCompatible).length,
    [visibleFiles],
  );
  const previewIsTruncated = Boolean(allMedia && allMedia.matchedFiles > allMedia.sampleFiles.length);

  useEffect(() => {
    if (!sdPath) {
      setPreview(null);
      setAllMedia(null);
      setLoading(false);
      setSelectedPaths(new Set());
      setSendingTarget(null);
      setRoutingFeedback(null);
      setVisibleMediaCount(PREVIEW_PAGE_SIZE);
      setSafeCheck(null);
      setCheckingSafe(false);
      return;
    }
    let active = true;
    setLoading(true);
    setSafeCheck(null);
    setSelectedPaths(new Set());
    setSendingTarget(null);
    setRoutingFeedback(null);
    routingRequestIdRef.current += 1;
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
    if (!sdPath) {
      setCheckingSafe(false);
      setRoutingFeedback("Nessuna scheda SD rilevata.");
      return;
    }
    setCheckingSafe(true);
    try {
      setSafeCheck(await checkArchivioSafeToFormat(sdPath));
    } finally {
      setCheckingSafe(false);
    }
  }

  function handlePhotoToggle(filePath: string) {
    const update = togglePhotoSelection(selectedPaths, filePath);
    setSelectedPaths(update.selectedPaths);
    setRoutingFeedback(update.limitReached
      ? `Limite raggiunto: puoi inviare al massimo ${PHOTO_TOOL_SELECTION_LIMIT} foto alla volta.`
      : null);
  }

  function handleSelectVisible() {
    const update = addVisibleCompatiblePhotos(selectedPaths, visibleFiles);
    setSelectedPaths(update.selectedPaths);
    if (update.limitReached) {
      setRoutingFeedback(`Selezionate ${update.selectedPaths.size} foto. Raggiunto il limite di ${PHOTO_TOOL_SELECTION_LIMIT}.`);
    } else if (update.addedCount > 0) {
      setRoutingFeedback(`Aggiunte ${update.addedCount} foto visibili alla selezione.`);
    } else {
      setRoutingFeedback("Le foto compatibili visibili sono già selezionate.");
    }
  }

  async function handleSendToTool(targetToolId: PhotoToolTargetId) {
    if (!sdPath) {
      setRoutingFeedback("Nessuna scheda SD rilevata.");
      return;
    }
    const validation = validatePhotoToolSelection(targetToolId, selectedPaths.size);
    if (!validation.valid) {
      setRoutingFeedback(validation.message);
      return;
    }
    const target = PHOTO_TOOL_TARGETS.find((item) => item.id === targetToolId);
    const requestId = routingRequestIdRef.current + 1;
    routingRequestIdRef.current = requestId;
    setSendingTarget(targetToolId);
    setRoutingFeedback(`Invio di ${selectedPaths.size} foto a ${target?.label ?? targetToolId}…`);
    try {
      const result = await sendArchivioPhotoSelectionToTool({
        targetToolId,
        sourceRoot: sdPath,
        absolutePaths: [...selectedPaths],
      });
      if (routingRequestIdRef.current !== requestId) return;
      setRoutingFeedback(result.ok
        ? (result.message || `${target?.label ?? "Il tool"} è stato aperto con ${selectedPaths.size} foto.`)
        : (result.message || `Non è stato possibile aprire ${target?.label ?? "il tool"}.`));
    } catch (error) {
      if (routingRequestIdRef.current !== requestId) return;
      setRoutingFeedback(error instanceof Error
        ? error.message
        : `Non è stato possibile aprire ${target?.label ?? "il tool"}.`);
    } finally {
      if (routingRequestIdRef.current === requestId) setSendingTarget(null);
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
              {sdPath ? (
                <strong>SD: {sdPath}</strong>
              ) : (
                <strong>Nessuna scheda SD rilevata</strong>
              )}
              <span style={{ marginLeft: "0.65rem", color: "var(--text-muted)", fontSize: "0.88rem" }}>
                {loading ? "Rilevamento contenuto…" : (preview?.totalFiles ?? 0) > 0 ? `${preview?.totalFiles} file · ${(preview?.rawFiles ?? 0) + (preview?.jpgFiles ?? 0)} foto · ${preview?.videoFiles ?? 0} video` : "In attesa di una scheda"}
              </span>
            </div>
            <div className="button-row">
              <button className="ghost-button" onClick={() => { void verifySd(); }} disabled={!sdPath || checkingSafe || loading}>
                {checkingSafe ? "Verifica…" : safeCheck?.status === "SAFE" ? "SD sicura" : "Verifica SD"}
              </button>
              <button className="primary-button" onClick={() => onStartImport(filterMode === "date" ? selectedDate : null)} disabled={!sdPath || loading}>
                {filterMode === "date" ? "Importa questa data" : "Importa questa SD"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {!sdPath ? (
        <section className="panel-section" style={{ padding: "var(--space-5)", display: "grid", placeItems: "center", minHeight: "320px", textAlign: "center" }}>
          <div style={{ display: "grid", justifyItems: "center", gap: "1rem" }}>
            <div aria-hidden="true" style={{ display: "grid", placeItems: "center", width: "88px", height: "88px", borderRadius: "20px", background: "rgba(184, 154, 99, 0.1)", border: "1px solid var(--line)" }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent-strong)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="7" y="9" width="10" height="11" rx="2" />
                <path d="M10 6h4v3h-4z" />
                <path d="M9 12h6" />
                <path d="M9 15h6" />
              </svg>
            </div>
            <div>
              <strong style={{ fontSize: "1.2rem" }}>In attesa di una scheda</strong>
              <p style={{ margin: "0.4rem 0 0", color: "var(--text-muted)", fontSize: "0.9rem" }}>Inserisci una SD nel lettore per iniziare.</p>
            </div>
          </div>
        </section>
      ) : (
        <>
        <section className="panel-section import-step" style={{ padding: "var(--space-4)" }}>
        <div className="stack" style={{ gap: "0.8rem" }}>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "end", justifyContent: "space-between", flexWrap: "wrap" }}>
            <div>
              <strong>{media
                ? filterMode === "date"
                  ? `${media.sampleFiles.length} elementi disponibili per questa data · visualizzati ${Math.min(visibleMediaCount, media.sampleFiles.length)}${previewIsTruncated && ` · Vista parziale · max 5.000`}`
                  : `${media.matchedFiles} file filtrati · ${media.sampleFiles.length} disponibili in griglia · visualizzati ${Math.min(visibleMediaCount, media.sampleFiles.length)}${previewIsTruncated && ` · Vista parziale · max 5.000`}`
                : "Carico contenuto…"}</strong>
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
          {selectedPaths.size > 0 && (
            <div className="sd-tool-routing" aria-label="Invia foto selezionate ai tool FileX">
            <div className="sd-tool-routing__header">
              <div>
                <strong>Continua il lavoro in FileX</strong>
                <p>
                  {selectedPaths.size} foto selezionate. La selezione resta attiva cambiando filtro o data e si azzera
                  quando inserisci un’altra SD.
                </p>
              </div>
              <div className="button-row">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleSelectVisible}
                  disabled={loading || sendingTarget !== null || visibleCompatibleCount === 0 || selectedPaths.size >= PHOTO_TOOL_SELECTION_LIMIT}
                >
                  Seleziona visibili ({visibleCompatibleCount})
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    setSelectedPaths(new Set());
                    setRoutingFeedback("Selezione azzerata.");
                  }}
                  disabled={sendingTarget !== null || selectedPaths.size === 0}
                >
                  Azzera
                </button>
              </div>
            </div>
            <div className="sd-tool-routing__actions" role="group" aria-label="Tool di destinazione">
              {PHOTO_TOOL_TARGETS.map((target) => {
                const validation = validatePhotoToolSelection(target.id, selectedPaths.size);
                const isSending = sendingTarget === target.id;
                return (
                  <button
                    key={target.id}
                    type="button"
                    className="primary-button"
                    onClick={() => { void handleSendToTool(target.id); }}
                    disabled={sendingTarget !== null || !validation.valid}
                    title={validation.valid
                      ? `Apri ${target.label} con la selezione corrente`
                      : validation.message}
                  >
                    {isSending ? `Apro ${target.label}…` : `Apri in ${target.label}`}
                  </button>
                );
              })}
              <small>Party Frame e Batch Layout accettano fino a 500 foto. Photo ID richiede una sola foto.</small>
            </div>
            {routingFeedback && <p className="sd-tool-routing__feedback" role="status" aria-live="polite">{routingFeedback}</p>}
          </div>
          )}
          {media && (
            <div className="sd-media-grid">
              {visibleFiles.map((file) => {
                const compatible = isPhotoToolCompatible(file);
                const selected = selectedPaths.has(file.filePath);
                return (
                  <label
                    key={`${file.filePath}:${buildPreviewSourceKey(file)}`}
                    className={`sd-media-card${selected ? " sd-media-card--selected" : ""}${compatible ? "" : " sd-media-card--incompatible"}`}
                    title={compatible ? `Seleziona ${file.fileName}` : "Formato non inviabile direttamente ai tool foto"}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={!compatible || sendingTarget !== null}
                      onChange={() => handlePhotoToggle(file.filePath)}
                      aria-label={compatible ? `Seleziona ${file.fileName}` : `${file.fileName}: formato non inviabile direttamente`}
                    />
                    {isPreviewableMedia(file) ? (
                      <DesktopPreviewImage sdPath={sdPath!} filePath={file.filePath} sourceFileKey={buildPreviewSourceKey(file)} alt={file.fileName} style={{ width: "100%", height: 100, objectFit: "cover", borderRadius: 7 }} />
                    ) : (
                      <div style={{ width: "100%", height: 100, borderRadius: 7, display: "grid", placeItems: "center", background: "rgba(255,255,255,0.05)", color: "var(--text-muted)" }}>
                        FOTO {file.ext.toUpperCase()}
                      </div>
                    )}
                    <div style={{ marginTop: "0.4rem", fontSize: "0.8rem", wordBreak: "break-all" }}>{file.fileName}</div>
                    <div className="sd-media-card__meta">
                      <span>{formatBytes(file.size)}</span>
                      <span>{compatible ? (selected ? "Selezionata" : "Pronta per i tool") : "Da sviluppare/convertire"}</span>
                    </div>
                  </label>
                );
              })}
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
        </>
      )}
    </div>
  );
}
