import { useCallback, useEffect, useState } from "react";
import type { GoogleDriveStatus, StudioFlowStatus } from "../types";
import {
  connectArchivioGoogleDrive,
  disconnectArchivioGoogleDrive,
  getArchivioGoogleDriveStatus,
  getArchivioStudioFlowStatus,
  syncArchivioDriveRegistry,
} from "../archivioDesktopApi";

const GOOGLE_DRIVE_API_CONSOLE_URL = "https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=391620173227";

type Feedback = { type: "success" | "error"; message: string; actionUrl?: string } | null;

export function GoogleDrivePanel() {
  const [driveStatus, setDriveStatus] = useState<GoogleDriveStatus | null>(null);
  const [studioFlowStatus, setStudioFlowStatus] = useState<StudioFlowStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<"connect" | "disconnect" | "sync" | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [lastRegistryUrl, setLastRegistryUrl] = useState<string | null>(null);
  const [webPreview, setWebPreview] = useState(() => !window.filexDesktop);

  const refresh = useCallback(async () => {
    setLoading(true);
    if (!window.filexDesktop) {
      setWebPreview(true);
      setFeedback(null);
      setLoading(false);
      return;
    }
    try {
      const [nextDriveStatus, nextStudioFlowStatus] = await Promise.all([
        getArchivioGoogleDriveStatus(),
        getArchivioStudioFlowStatus(),
      ]);
      setDriveStatus(nextDriveStatus);
      setStudioFlowStatus(nextStudioFlowStatus);
      setWebPreview(false);
      setFeedback(null);
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Stato Google Drive non disponibile.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleConnect() {
    setBusyAction("connect");
    setFeedback(null);
    try {
      const status = await connectArchivioGoogleDrive();
      setDriveStatus(status);
      setFeedback({ type: "success", message: "Google Drive collegato correttamente." });
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Collegamento non riuscito." });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDisconnect() {
    setBusyAction("disconnect");
    setFeedback(null);
    try {
      const status = await disconnectArchivioGoogleDrive();
      setDriveStatus(status);
      setFeedback({ type: "success", message: "Account Google Drive scollegato." });
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Disconnessione non riuscita." });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSync() {
    setBusyAction("sync");
    setFeedback(null);
    try {
      const result = await syncArchivioDriveRegistry();
      setFeedback({ type: "success", message: result.message });
      setLastRegistryUrl(result.driveUrl ?? null);
      setStudioFlowStatus(await getArchivioStudioFlowStatus());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sincronizzazione non riuscita.";
      setFeedback({
        type: "error",
        message,
        actionUrl: /Google Drive API non è attiva/i.test(message) ? GOOGLE_DRIVE_API_CONSOLE_URL : undefined,
      });
    } finally {
      setBusyAction(null);
    }
  }

  const pendingEvents = studioFlowStatus?.health.pendingOutbox ?? 0;
  const isConnected = driveStatus?.connected === true;

  return (
    <div className="stack" style={{ gap: "var(--space-4)" }}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">REGISTRO REMOTO</span>
          <h2>Google Drive</h2>
          <p>Replica di sicurezza dei manifest StudioFlow. Le fotografie non vengono caricate.</p>
        </div>
        <button className="ghost-button" onClick={() => void refresh()} disabled={loading || busyAction !== null}>
          {loading ? "Aggiorno…" : "Aggiorna stato"}
        </button>
      </div>

      <div className="panel-section" style={{ padding: "var(--space-4)" }}>
        <div className="stack">
          <div className="stats-grid">
            <div className={isConnected ? "stat-card stat-card--highlight" : "stat-card"}>
              <span>Connessione</span>
              <strong>{loading ? "…" : webPreview ? "App desktop richiesta" : isConnected ? "Collegato" : "Non collegato"}</strong>
              <small>{webPreview ? "Avvia dalla dashboard FileX" : driveStatus?.accountEmail ?? "Nessun account Google"}</small>
            </div>
            <div className={pendingEvents > 0 ? "stat-card stat-card--highlight" : "stat-card"}>
              <span>Eventi da sincronizzare</span>
              <strong>{loading || webPreview ? "—" : pendingEvents}</strong>
              <small>{webPreview ? "Disponibile nell’app desktop" : pendingEvents === 0 ? "Registro locale allineato" : "Conservati localmente fino al prossimo invio"}</small>
            </div>
            <div className="stat-card">
              <span>Contenuto remoto</span>
              <strong>Solo manifest</strong>
              <small>Nessuna foto e nessun percorso assoluto locale</small>
            </div>
          </div>

          {driveStatus?.requiresReconnect && (
            <div className="message-box"><p style={{ color: "var(--danger)" }}>La sessione Google è scaduta: collega nuovamente l’account.</p></div>
          )}

          {webPreview && (
            <div className="message-box" style={{ borderColor: "var(--line-strong)", background: "rgba(184, 154, 99, 0.06)" }}>
              <p>Questa è l’anteprima web. Per collegare Google Drive e leggere il registro locale, avvia Archivio Flow dalla dashboard FileX.</p>
            </div>
          )}

          {driveStatus && !driveStatus.configured && (
            <div className="message-box">
              <p>Questa build di sviluppo non include ancora il Client ID OAuth FileX. Nelle release ufficiali è integrato automaticamente: ogni cliente collegherà qui il proprio account Google.</p>
            </div>
          )}

          {feedback && (
            <div className="message-box" style={{ borderColor: feedback.type === "success" ? "var(--success)" : "var(--danger)" }}>
              <p style={{ color: feedback.type === "success" ? "var(--success)" : "var(--danger)" }}>{feedback.message}</p>
              {feedback.actionUrl && (
                <p style={{ marginTop: "var(--space-2)" }}>
                  <a href={feedback.actionUrl} target="_blank" rel="noreferrer">Apri Google Cloud Console</a>
                </p>
              )}
            </div>
          )}

          {lastRegistryUrl && (
            <div className="message-box" style={{ borderColor: "var(--success)" }}>
              <p>Il registro è disponibile nel tuo Drive. Da lì puoi aprirlo e condividerlo con gli strumenti di Google Drive.</p>
              <p style={{ marginTop: "var(--space-2)" }}>
                <a href={lastRegistryUrl} target="_blank" rel="noreferrer">Apri registro in Google Drive</a>
              </p>
            </div>
          )}

          <div className="button-row">
            {!isConnected ? (
              <button className="primary-button" onClick={handleConnect} disabled={webPreview || busyAction !== null || driveStatus?.configured === false}>
                {webPreview ? "Disponibile nell’app desktop" : busyAction === "connect" ? "Collegamento…" : "Collega Google Drive"}
              </button>
            ) : (
              <>
                <button className="primary-button" onClick={handleSync} disabled={busyAction !== null}>
                  {busyAction === "sync" ? "Sincronizzazione…" : `Sincronizza ora${pendingEvents > 0 ? ` (${pendingEvents})` : ""}`}
                </button>
                <button className="ghost-button" onClick={handleDisconnect} disabled={busyAction !== null}>
                  {busyAction === "disconnect" ? "Disconnessione…" : "Scollega account"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="panel-section" style={{ padding: "var(--space-4)" }}>
        <div className="stack" style={{ gap: "0.55rem" }}>
          <strong>Come funziona</strong>
          <p style={{ margin: 0, color: "var(--text-muted)" }}>
            Le importazioni vengono sempre concluse e verificate sul database locale. Quando Drive è disponibile, StudioFlow invia una copia versionata del registro nella cartella “FileX StudioFlow Registry” dell’account collegato. L’account è condiviso tra i tool FileX sullo stesso profilo del computer. Se sei offline, gli eventi restano in coda e potrai sincronizzarli in seguito.
          </p>
        </div>
      </div>
    </div>
  );
}
