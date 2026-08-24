import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import type { FileSendSession, FileSendSnapshot, FileSendWifiConfig } from "./contracts";
import "./session-bar.css";

type Choice = "home" | "local" | "remote";
type Direction = "receive" | "send";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function wifiPayload(wifi: FileSendWifiConfig): string {
  const escape = (value: string) => value.replace(/([\\;,:\"])/g, "\\$1");
  return wifi.security === "nopass"
    ? `WIFI:T:nopass;S:${escape(wifi.ssid)};;`
    : `WIFI:T:WPA;S:${escape(wifi.ssid)};P:${escape(wifi.password)};H:false;;`;
}

const qrOptions = { width: 420, margin: 2, color: { dark: "#071426", light: "#ffffffff" }, errorCorrectionLevel: "M" as const };

function localDateTimeValue(timestamp: number): string {
  const date = new Date(timestamp);
  return new Date(timestamp - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function App() {
  const [snapshot, setSnapshot] = useState<FileSendSnapshot | null>(null);
  const [choice, setChoice] = useState<Choice>("home");
  const [direction, setDirection] = useState<Direction | null>(null);
  const [label, setLabel] = useState("");
  const [remoteExpiresAt, setRemoteExpiresAt] = useState(() => localDateTimeValue(Date.now() + 24 * 60 * 60 * 1000));
  const [uploadQr, setUploadQr] = useState("");
  const [wifiQr, setWifiQr] = useState("");
  const [wifiSsid, setWifiSsid] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detectingWifi, setDetectingWifi] = useState(false);
  const [copied, setCopied] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wifiInitialized = useRef(false);
  const dashboardInitialized = useRef(false);

  const refresh = async () => {
    try { setSnapshot(await window.fileXSend.getSnapshot()); }
    catch (cause) { setError(message(cause)); }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 800);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!snapshot || wifiInitialized.current) return;
    wifiInitialized.current = true;
    setWifiSsid(snapshot.wifi.ssid);
    setWifiPassword(snapshot.wifi.password);
  }, [snapshot]);

  useEffect(() => {
    if (!snapshot || dashboardInitialized.current) return;
    dashboardInitialized.current = true;
    if (!snapshot.session && snapshot.history.length > 0) setShowDashboard(true);
  }, [snapshot]);

  useEffect(() => {
    const url = snapshot?.session?.uploadUrl;
    if (!url) { setUploadQr(""); return; }
    void QRCode.toDataURL(url, qrOptions).then(setUploadQr);
  }, [snapshot?.session?.uploadUrl]);

  useEffect(() => {
    if (!snapshot?.session || snapshot.mode !== "local" || !snapshot.wifi.ssid) { setWifiQr(""); return; }
    void QRCode.toDataURL(wifiPayload(snapshot.wifi), qrOptions).then(setWifiQr);
  }, [snapshot?.session, snapshot?.mode, snapshot?.wifi]);

  const wifiReady = Boolean(snapshot?.wifi.ssid) && (snapshot?.wifi.security === "nopass" || (snapshot?.wifi.password.length ?? 0) >= 8);
  const wifiDraftValid = wifiSsid.trim().length > 0 && wifiPassword.length >= 8;
  const expiryTimestamp = new Date(remoteExpiresAt).getTime();
  const expiryValid = Number.isFinite(expiryTimestamp) && expiryTimestamp >= Date.now() + 15 * 60 * 1000 && expiryTimestamp <= Date.now() + 7 * 24 * 60 * 60 * 1000;

  const start = async () => {
    setBusy(true); setError(null);
    try {
      const next = direction === "send"
        ? await window.fileXSend.startSendSession(choice === "remote" ? "remote" : "local", label, expiryTimestamp)
        : choice === "remote"
          ? await window.fileXSend.startRemoteSession(label, expiryTimestamp)
          : await window.fileXSend.startSession(label);
      setSnapshot(next); setLabel("");
      setCreatingSession(false);
      setShowDashboard(false);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  };

  const close = async () => {
    if (!snapshot?.session || !snapshot.mode) return;
    setBusy(true); setError(null);
    try { setSnapshot(await window.fileXSend.closeSession(snapshot.mode, snapshot.session.id)); setChoice("home"); setDirection(null); setCreatingSession(false); setShowDashboard(true); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  };

  const detectWifi = async () => {
    setDetectingWifi(true); setError(null);
    try {
      const next = await window.fileXSend.detectWifi(); setSnapshot(next);
      if (next.wifi.ssid) { setWifiSsid(next.wifi.ssid); setWifiPassword(next.wifi.password); }
    } catch (cause) { setError(message(cause)); }
    finally { setDetectingWifi(false); }
  };

  const saveWifi = async () => {
    try { setSnapshot(await window.fileXSend.saveWifi({ ssid: wifiSsid, password: wifiPassword, security: "WPA" })); }
    catch (cause) { setError(message(cause)); }
  };

  const chooseFolder = async () => {
    try { setSnapshot(await window.fileXSend.chooseOutputRoot()); }
    catch (cause) { setError(message(cause)); }
  };

  const copyLink = async () => {
    if (!snapshot?.session) return;
    await navigator.clipboard.writeText(snapshot.session.uploadUrl);
    setCopied(true); window.setTimeout(() => setCopied(false), 1800);
  };

  const selectSession = async (mode: "local" | "remote", sessionId: string) => {
    try {
      setSnapshot(await window.fileXSend.selectSession(mode, sessionId));
      setChoice("home"); setDirection(null); setCreatingSession(false); setShowDashboard(false); setError(null);
    } catch (cause) { setError(message(cause)); }
  };

  const newSession = () => {
    setChoice("home"); setDirection(null); setCreatingSession(true); setShowDashboard(false); setError(null);
  };

  const deleteHistoryEntry = async (sessionId: string) => {
    setBusy(true); setError(null);
    try {
      if (typeof window.fileXSend.deleteHistoryEntry !== "function") {
        throw new Error("FileX Send è stato aggiornato. Chiudi e riapri l’applicazione per attivare la cancellazione dello storico.");
      }
      setSnapshot(await window.fileXSend.deleteHistoryEntry(sessionId));
    }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  };

  if (!snapshot) return <main className="loading">Avvio di FileX Send…</main>;
  const viewingSession = Boolean(snapshot.session) && !creatingSession && !showDashboard;

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><img className="brand-mark" src="./filex-send-logo.png" alt="Logo FileX Send" /><div><strong>FileX Send</strong><small>Consegna semplice di foto e video</small></div></div>
      <div className={`network-pill ${snapshot.warning ? "warning" : ""}`}><span />{snapshot.mode === "remote" ? "Sessione Internet" : snapshot.warning ? "Rete da verificare" : "Sistema pronto"}</div>
    </header>
    {(snapshot.sessions.length > 0 || snapshot.history.length > 0) && <SessionBar snapshot={snapshot} creating={creatingSession} dashboard={showDashboard} selectSession={selectSession} showOverview={() => { setShowDashboard(true); setCreatingSession(false); }} newSession={newSession} />}
    {error && <div className="notice error">{error}</div>}

    {showDashboard && !creatingSession && <ClientDashboard snapshot={snapshot} selectSession={selectSession} newSession={newSession} deleteHistoryEntry={deleteHistoryEntry} deleting={busy} />}
    {!viewingSession && !showDashboard && choice === "home" && !direction && <DirectionChoice onChoose={setDirection} />}
    {!viewingSession && !showDashboard && choice === "home" && direction && <ModeChoice onChoose={setChoice} remoteAvailable={snapshot.remoteAvailable} direction={direction} onBack={() => setDirection(null)} />}

    {!viewingSession && !showDashboard && choice !== "home" && <section className="welcome-grid">
      <div className="welcome-copy">
        <button className="back-button" onClick={() => setChoice("home")}>← Indietro</button>
        <p className="eyebrow">{choice === "local" ? "CLIENTE QUI CON TE" : "CLIENTE A DISTANZA"}</p>
        <h1>{direction === "send" ? (choice === "local" ? <>Condividi direttamente<br />nella rete locale.</> : <>Crea il link.<br />Aggiungi i file dopo.</>) : choice === "local" ? <>Ricevi direttamente<br />nella rete locale.</> : <>Crea un link.<br />Al resto pensa FileX.</>}</h1>
        <p className="lead">{direction === "send" ? "Crea prima la condivisione, poi trascina file e cartelle o aggiungili dal pulsante dedicato." : choice === "local" ? "Il cliente si collega al Wi-Fi, scansiona il QR e invia." : "Invia il link via WhatsApp o email. Le foto arriveranno automaticamente nella cartella."}</p>
        <label className="client-label"><span>Nome cliente <em>facoltativo</em></span><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Es. Famiglia Rossi" maxLength={60} /></label>
        {choice === "remote" && <label className="client-label"><span>Il cliente può inviare fino a</span><input type="datetime-local" value={remoteExpiresAt} min={localDateTimeValue(Date.now() + 15 * 60 * 1000)} max={localDateTimeValue(Date.now() + 7 * 24 * 60 * 60 * 1000)} onChange={(event) => setRemoteExpiresAt(event.target.value)} /><small>Da 15 minuti a 7 giorni. I file già inviati restano in attesa del tuo PC.</small></label>}
        <button className="primary-action" onClick={() => void start()} disabled={busy || (choice === "local" ? !wifiReady || Boolean(snapshot.warning) : !snapshot.remoteAvailable || !expiryValid)}>{busy ? "Creazione link…" : direction === "send" ? "Crea collegamento" : choice === "local" ? "Nuovo trasferimento locale" : "Crea link temporaneo"}<span>→</span></button>
      </div>
      {choice === "local"
        ? <WifiCard snapshot={snapshot} wifiReady={wifiReady} wifiSsid={wifiSsid} wifiPassword={wifiPassword} showPassword={showPassword} detecting={detectingWifi} draftValid={wifiDraftValid} setWifiSsid={setWifiSsid} setWifiPassword={setWifiPassword} setShowPassword={setShowPassword} detectWifi={detectWifi} saveWifi={saveWifi} chooseFolder={chooseFolder} />
        : <RemoteReadyCard snapshot={snapshot} chooseFolder={chooseFolder} refresh={refresh} />}
    </section>}

    {viewingSession && snapshot.mode === "local" && <LocalSession snapshot={snapshot} wifiQr={wifiQr} uploadQr={uploadQr} busy={busy} close={close} />}
    {viewingSession && snapshot.mode === "remote" && <RemoteSession snapshot={snapshot} uploadQr={uploadQr} copied={copied} copyLink={copyLink} busy={busy} close={close} />}

    <footer><span>{snapshot.mode === "remote" ? "Link temporaneo e consegna automatica" : "Trasferimento protetto"}</span><span>•</span><span>{snapshot.mode === "remote" ? "Eliminazione cloud un’ora dopo il download" : "I file restano sotto il tuo controllo"}</span></footer>
  </main>;
}

function SessionBar({ snapshot, creating, dashboard, selectSession, showOverview, newSession }: { snapshot: FileSendSnapshot; creating: boolean; dashboard: boolean; selectSession: (mode: "local" | "remote", sessionId: string) => Promise<void>; showOverview: () => void; newSession: () => void }) {
  return <nav className="session-bar" aria-label="Sessioni clienti"><button className={`overview-button ${dashboard ? "active" : ""}`} onClick={showOverview}>Panoramica <small>{snapshot.sessions.length} attive · {snapshot.history.length} concluse</small></button><div className="session-tabs">{snapshot.sessions.map(({ mode, session }) => <button key={`${mode}-${session.id}`} className={!creating && !dashboard && snapshot.mode === mode && snapshot.session?.id === session.id ? "active" : ""} onClick={() => void selectSession(mode, session.id)}><span className={session.activeUploads > 0 ? "busy" : session.clientCompleted ? "done" : ""} /><strong>{session.label}</strong><small>{mode === "remote" ? "Internet" : "Locale"}</small></button>)}</div><button className={`new-session ${creating ? "active" : ""}`} onClick={newSession}>＋ Nuovo cliente</button></nav>;
}

function ClientDashboard({ snapshot, selectSession, newSession, deleteHistoryEntry, deleting }: { snapshot: FileSendSnapshot; selectSession: (mode: "local" | "remote", sessionId: string) => Promise<void>; newSession: () => void; deleteHistoryEntry: (sessionId: string) => Promise<void>; deleting: boolean }) {
  const [historySearch, setHistorySearch] = useState("");
  const normalizedSearch = historySearch.trim().toLocaleLowerCase("it-IT");
  const filteredHistory = useMemo(() => snapshot.history.filter(({ mode, session, closedAt }) => {
    if (!normalizedSearch) return true;
    const searchable = [
      session.label,
      mode === "remote" ? "internet remoto" : "locale",
      session.direction === "receive" ? "ricevuto ricezione" : "inviato condivisione",
      formatDateTime(session.createdAt),
      formatDateTime(closedAt),
      ...session.receivedFiles.map((file) => file.name),
    ].join(" ").toLocaleLowerCase("it-IT");
    return searchable.includes(normalizedSearch);
  }), [snapshot.history, normalizedSearch]);

  const confirmDelete = async (session: FileSendSession) => {
    const confirmed = window.confirm(`Eliminare definitivamente “${session.label}” dallo storico?\n\nI file presenti sul disco non verranno cancellati.`);
    if (confirmed) await deleteHistoryEntry(session.id);
  };

  return <section className="client-dashboard"><div className="dashboard-heading"><div><p className="eyebrow">CLIENTI E CONSEGNE</p><h1>Panoramica trasferimenti</h1><p>Ogni sessione conserva cliente, file, orari e cartella di destinazione.</p></div><button onClick={newSession}>＋ Nuovo cliente</button></div>{snapshot.sessions.length > 0 && <DashboardSection title="Sessioni attive" count={snapshot.sessions.length}>{snapshot.sessions.map(({ mode, session }) => <SessionSummaryCard key={`${mode}-${session.id}`} mode={mode} session={session} active onOpen={() => void selectSession(mode, session.id)} />)}</DashboardSection>}<div className="dashboard-section history-section"><div className="history-toolbar"><h2>Storico <span>{snapshot.history.length}</span></h2><label className="history-search"><span aria-hidden="true">⌕</span><input type="search" value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Cerca cliente o file…" aria-label="Cerca nello storico" /></label></div><div className="client-card-grid">{filteredHistory.length > 0 ? filteredHistory.map(({ mode, session, closedAt }) => <SessionSummaryCard key={`history-${session.id}`} mode={mode} session={session} closedAt={closedAt} onOpen={session.direction === "receive" ? () => void window.fileXSend.openHistoryFolder(session.id) : undefined} onDelete={() => void confirmDelete(session)} deleting={deleting} />) : <div className="history-empty">{snapshot.history.length === 0 ? "Le sessioni archiviate compariranno qui." : `Nessun risultato per “${historySearch.trim()}”.`}</div>}</div></div></section>;
}

function DashboardSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return <div className="dashboard-section"><h2>{title}<span>{count}</span></h2><div className="client-card-grid">{children}</div></div>;
}

function SessionSummaryCard({ mode, session, active = false, closedAt, onOpen, onDelete, deleting = false }: { mode: "local" | "remote"; session: FileSendSession; active?: boolean; closedAt?: number; onOpen?: () => void; onDelete?: () => void; deleting?: boolean }) {
  const files = session.receivedFiles.slice(-3).reverse();
  const total = session.receivedBytes + session.activeUploadBytes;
  return <article className={`client-summary-card ${active ? "active-session" : ""}`}><div className="client-card-top"><div><small>{session.direction === "receive" ? "RICEVUTO DA" : "INVIATO A"}</small><h3>{session.label}</h3></div><span>{active ? session.activeUploads ? "Invio in corso" : "In attesa" : "Conclusa"}</span></div><div className="session-meta"><span>{mode === "remote" ? "Internet" : "Locale"}</span><time>{formatDateTime(session.createdAt)}</time>{closedAt && <time>Chiusa {formatDateTime(closedAt)}</time>}</div><div className="session-totals"><div><small>File</small><strong>{session.receivedFiles.length}</strong></div><div><small>Dimensione</small><strong>{formatBytes(total)}</strong></div></div><small className="files-heading">ULTIMI FILE</small><div className="recent-files">{files.length > 0 ? <>{files.map((file) => <div key={file.id}><span>{file.name}</span><time>{new Date(file.receivedAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</time></div>)}{session.receivedFiles.length > files.length && <p>＋ altri {session.receivedFiles.length - files.length} file nella cartella</p>}</> : <p>Nessun file ancora ricevuto.</p>}</div>{(onOpen || onDelete) && <div className="card-actions">{onOpen && <button className="open-card" onClick={onOpen}>{active ? "Apri sessione" : "Apri cartella cliente"} →</button>}{onDelete && <button className="delete-history" onClick={onDelete} disabled={deleting} aria-label={`Elimina ${session.label} dallo storico`}>Elimina</button>}</div>}</article>;
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function DirectionChoice({ onChoose }: { onChoose: (direction: Direction) => void }) {
  return <section className="mode-screen"><div className="mode-heading"><p className="eyebrow">FILEX SEND</p><h1>Cosa vuoi fare?</h1><p>Puoi ricevere file dal cliente oppure consegnargli i tuoi.</p></div><div className="mode-grid"><button className="mode-card" onClick={() => onChoose("receive")}><span className="mode-icon">⇩</span><small>DAL CLIENTE AL PC</small><strong>Ricevi file</strong><p>Il cliente sceglie foto, video o documenti dal telefono.</p><b>Continua →</b></button><button className="mode-card remote" onClick={() => onChoose("send")}><span className="mode-icon">⇧</span><small>DAL PC AL CLIENTE</small><strong>Invia file</strong><p>Scegli dal PC e condividi con un QR o un link.</p><b>Continua →</b></button></div></section>;
}

function ModeChoice({ onChoose, remoteAvailable, direction, onBack }: { onChoose: (choice: Choice) => void; remoteAvailable: boolean; direction: Direction; onBack: () => void }) {
  return <section className="mode-screen"><button className="back-button mode-back" onClick={onBack}>← Indietro</button><div className="mode-heading"><p className="eyebrow">{direction === "send" ? "INVIA FILE" : "RICEVI FILE"}</p><h1>Dove si trova il cliente?</h1><p>Una scelta, poi FileX Send prepara tutto automaticamente.</p></div><div className="mode-grid"><button className="mode-card" onClick={() => onChoose("local")}><span className="mode-icon">⌁</span><small>STESSO POSTO</small><strong>Qui con me</strong><p>Wi-Fi locale e trasferimento diretto.</p><b>Continua →</b></button><button className="mode-card remote" onClick={() => onChoose("remote")}><span className="mode-icon">↗</span><small>DA CASA O ALTROVE</small><strong>A distanza</strong><p>Link temporaneo da condividere col cliente.</p><b>{remoteAvailable ? "Continua →" : "Configura servizio →"}</b></button></div></section>;
}

function WifiCard(props: { snapshot: FileSendSnapshot; wifiReady: boolean; wifiSsid: string; wifiPassword: string; showPassword: boolean; detecting: boolean; draftValid: boolean; setWifiSsid: (value: string) => void; setWifiPassword: (value: string) => void; setShowPassword: (value: boolean) => void; detectWifi: () => Promise<void>; saveWifi: () => Promise<void>; chooseFolder: () => Promise<void> }) {
  const { snapshot } = props;
  return <aside className="ready-card wifi-settings"><div className="ready-icon">⌁</div><h2>Wi-Fi clienti</h2>{props.wifiReady ? <div className="detected-wifi"><span className="detected-dot" /><div><small>{snapshot.wifiSource === "detected" ? "Rete rilevata automaticamente" : "Rete memorizzata"}</small><strong>{snapshot.wifi.ssid}</strong><p>Il QR includerà automaticamente l’accesso.</p></div></div> : <div className="wifi-missing"><strong>Nessuna rete disponibile</strong><p>{snapshot.wifiError}</p></div>}<button className="detect-button" onClick={() => void props.detectWifi()} disabled={props.detecting}>{props.detecting ? "Rilevamento…" : "Rileva di nuovo"}</button>{!props.wifiReady && <details className="manual-wifi"><summary>Configurazione manuale</summary><label><span>Nome rete</span><input value={props.wifiSsid} onChange={(event) => props.setWifiSsid(event.target.value)} /></label><label><span>Password</span><div className="password-field"><input type={props.showPassword ? "text" : "password"} value={props.wifiPassword} onChange={(event) => props.setWifiPassword(event.target.value)} /><button onClick={() => props.setShowPassword(!props.showPassword)}>{props.showPassword ? "Nascondi" : "Mostra"}</button></div></label><button className="save-manual" disabled={!props.draftValid} onClick={() => void props.saveWifi()}>Salva rete</button></details>}<Destination snapshot={snapshot} chooseFolder={props.chooseFolder} /></aside>;
}

function RemoteReadyCard({ snapshot, chooseFolder, refresh }: { snapshot: FileSendSnapshot; chooseFolder: () => Promise<void>; refresh: () => Promise<void> }) {
  return <aside className="ready-card remote-ready"><div className="ready-icon">↗</div><h2>Consegna Internet</h2>{snapshot.remoteAvailable ? <div className="detected-wifi"><span className="detected-dot" /><div><small>SERVIZIO ONLINE</small><strong>Pronto a creare il link</strong><p>Scegli tu data e ora di scadenza.</p></div></div> : <div className="wifi-missing"><strong>Servizio non configurato</strong><p>{snapshot.remoteError}</p></div>}<button className="detect-button" onClick={() => void refresh()}>Controlla di nuovo</button><ul className="remote-benefits"><li>Nessun account per il cliente</li><li>Funziona anche con il PC spento</li><li>Cancellazione un’ora dopo il download</li></ul><Destination snapshot={snapshot} chooseFolder={chooseFolder} /></aside>;
}

function Destination({ snapshot, chooseFolder }: { snapshot: FileSendSnapshot; chooseFolder: () => Promise<void> }) {
  return <div className="destination"><small>Cartella di destinazione</small><strong title={snapshot.outputRoot}>{snapshot.outputRoot}</strong><button onClick={() => void chooseFolder()}>Cambia</button></div>;
}

function LocalSession({ snapshot, wifiQr, uploadQr, busy, close }: { snapshot: FileSendSnapshot; wifiQr: string; uploadQr: string; busy: boolean; close: () => Promise<void> }) {
  const sending = snapshot.session!.direction === "send";
  return <section className="session-grid"><QrCard step="1" eyebrow="CONNETTI AL WI-FI" title={snapshot.wifi.ssid} qr={wifiQr} help="Scansiona e conferma Connetti." /><QrCard step="2" eyebrow="APRI FILEX SEND" title={sending ? "Apri e scarica" : "Scegli e invia"} qr={uploadQr} help="Dopo la connessione, scansiona questo QR." /><TransferPanel session={snapshot.session!} mode="local" busy={busy} close={close} remote={false} /> </section>;
}

function RemoteSession({ snapshot, uploadQr, copied, copyLink, busy, close }: { snapshot: FileSendSnapshot; uploadQr: string; copied: boolean; copyLink: () => Promise<void>; busy: boolean; close: () => Promise<void> }) {
  const sending = snapshot.session!.direction === "send";
  const recovered = !snapshot.session!.uploadUrl;
  return <section className="remote-session"><article className="qr-card remote-link-card"><p className="eyebrow">{recovered ? "SESSIONE RECUPERATA" : "LINK TEMPORANEO"}</p><h1>{recovered ? "Sessione Internet attiva" : "Invialo al cliente"}</h1>{recovered ? <p className="qr-help">Questa sessione era già attiva e ora è stata recuperata automaticamente. Il cliente può continuare a usare il link che ha già ricevuto.</p> : <><div className="qr-wrap">{uploadQr ? <img src={uploadQr} alt="QR del link remoto" /> : <div className="qr-loading" />}</div><code className="share-url">{snapshot.session!.uploadUrl}</code><button className="copy-button" onClick={() => void copyLink()}>{copied ? "Link copiato ✓" : "Copia link"}</button><p className="qr-help">{sending ? "Il cliente può scaricare i file" : "Il cliente può inviare"} fino al {snapshot.session!.expiresAt ? new Date(snapshot.session!.expiresAt).toLocaleString("it-IT") : "termine impostato"}. Il link resta attivo anche se chiudi l’app.</p></>}</article><TransferPanel session={snapshot.session!} mode="remote" busy={busy} close={close} remote /></section>;
}

function QrCard({ step, eyebrow, title, qr, help }: { step: string; eyebrow: string; title: string; qr: string; help: string }) {
  return <article className="qr-card step-card"><div className="step-number">{step}</div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><div className="qr-wrap">{qr ? <img src={qr} alt={title} /> : <div className="qr-loading" />}</div><p className="qr-help">{help}</p></article>;
}

function TransferPanel({ session, mode, busy, close, remote }: { session: FileSendSession; mode: "local" | "remote"; busy: boolean; close: () => Promise<void>; remote: boolean }) {
  const sending = session.direction === "send";
  const [expiryDraft, setExpiryDraft] = useState(() => session.expiresAt ? localDateTimeValue(session.expiresAt) : "");
  const [addingFiles, setAddingFiles] = useState(false);
  const total = useMemo(() => session.receivedBytes + session.activeUploadBytes, [session]);
  const linkExpired = Boolean(session.expiresAt && session.expiresAt <= Date.now());
  const canClose = sending || (session.activeUploads === 0 && (!remote || session.clientCompleted || linkExpired));
  useEffect(() => { if (session.expiresAt) setExpiryDraft(localDateTimeValue(session.expiresAt)); }, [session.id, session.expiresAt]);
  const addFiles = async () => { setAddingFiles(true); try { await window.fileXSend.addSendFiles(mode, session.id); } finally { setAddingFiles(false); } };
  const dropFiles = async (event: React.DragEvent<HTMLDivElement>) => { event.preventDefault(); if (!event.dataTransfer.files.length) return; setAddingFiles(true); try { await window.fileXSend.addDroppedSendFiles(mode, session.id, Array.from(event.dataTransfer.files)); } finally { setAddingFiles(false); } };
  const saveExpiry = async () => { const expiresAt = new Date(expiryDraft).getTime(); if (!Number.isFinite(expiresAt)) return; await window.fileXSend.updateRemoteExpiry(session.id, expiresAt); };
  const expiryValid = Number.isFinite(new Date(expiryDraft).getTime()) && new Date(expiryDraft).getTime() >= Date.now() + 15 * 60 * 1000 && new Date(expiryDraft).getTime() <= Date.now() + 7 * 24 * 60 * 60 * 1000;
  return <article className="transfer-card"><div className="session-heading"><div><p className="eyebrow">{sending ? "CONDIVISIONE" : "RICEZIONE"}</p><h2>{session.label}</h2></div><span className="status live">{linkExpired ? "Link scaduto" : addingFiles ? "Caricamento in corso" : sending ? "Disponibile" : session.activeUploads ? "Invio in corso" : "In attesa"}</span></div><div className="metrics"><div><small>{sending ? "File condivisi" : "File ricevuti"}</small><strong>{session.receivedFiles.length}</strong></div><div><small>{sending ? "Dati condivisi" : "Dati ricevuti"}</small><strong>{formatBytes(total)}</strong></div></div>{remote && <div className="expiry-editor"><label>Scadenza del link<input type="datetime-local" value={expiryDraft} min={localDateTimeValue(Date.now() + 15 * 60 * 1000)} max={localDateTimeValue(Date.now() + 7 * 24 * 60 * 60 * 1000)} onChange={(event) => setExpiryDraft(event.target.value)} /></label><button className="secondary" onClick={() => void saveExpiry()} disabled={busy || !expiryValid}>Salva scadenza</button></div>}{sending && <div className={`send-drop-zone ${addingFiles ? "is-uploading" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => void dropFiles(event)}><strong>{addingFiles ? "Caricamento dei file in corso…" : "Trascina qui file o cartelle"}</strong><small>{addingFiles ? "I file compariranno nell’elenco uno alla volta." : "Le sottocartelle vengono incluse automaticamente."}</small><button className="secondary" onClick={() => void addFiles()} disabled={busy || addingFiles}>{addingFiles ? "Caricamento…" : "＋ Aggiungi file o cartella"}</button></div>}<div className="file-list">{session.receivedFiles.length === 0 ? <div className="empty"><span>⇩</span><strong>{sending ? "Aggiungi i file da condividere" : "In attesa delle foto"}</strong></div> : session.receivedFiles.slice().reverse().map((file) => <div className="file-row" key={file.id}><span className="file-check">✓</span><div><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></div></div>)}</div><div className="session-actions">{!sending && <button className="secondary" onClick={() => void window.fileXSend.openSessionFolder(mode, session.id)}>Apri cartella</button>}<button className="finish" onClick={() => void close()} disabled={busy || !canClose}>{sending ? "Termina condivisione" : session.activeUploads ? "Invio in corso…" : remote && !canClose ? "In attesa del cliente" : remote ? "Archivia invio" : "Termina sessione"}</button></div></article>;
}

function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
