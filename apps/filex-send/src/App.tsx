import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import type { FileSendSession, FileSendSnapshot, FileSendWifiConfig } from "./contracts";

type Choice = "home" | "local" | "remote";

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
  const [error, setError] = useState<string | null>(null);
  const wifiInitialized = useRef(false);

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
      const next = choice === "remote"
        ? await window.fileXSend.startRemoteSession(label, expiryTimestamp)
        : await window.fileXSend.startSession(label);
      setSnapshot(next); setLabel("");
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  };

  const close = async () => {
    setBusy(true); setError(null);
    try { setSnapshot(await window.fileXSend.closeSession()); setChoice("home"); }
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

  if (!snapshot) return <main className="loading">Avvio di FileX Send…</main>;

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">FX</span><div><strong>FileX Send</strong><small>Consegna semplice di foto e video</small></div></div>
      <div className={`network-pill ${snapshot.warning ? "warning" : ""}`}><span />{snapshot.mode === "remote" ? "Sessione Internet" : snapshot.warning ? "Rete da verificare" : "Sistema pronto"}</div>
    </header>
    {error && <div className="notice error">{error}</div>}

    {!snapshot.session && choice === "home" && <ModeChoice onChoose={setChoice} remoteAvailable={snapshot.remoteAvailable} />}

    {!snapshot.session && choice !== "home" && <section className="welcome-grid">
      <div className="welcome-copy">
        <button className="back-button" onClick={() => setChoice("home")}>← Indietro</button>
        <p className="eyebrow">{choice === "local" ? "CLIENTE QUI CON TE" : "CLIENTE A DISTANZA"}</p>
        <h1>{choice === "local" ? <>Ricevi direttamente<br />nella rete locale.</> : <>Crea un link.<br />Al resto pensa FileX.</>}</h1>
        <p className="lead">{choice === "local" ? "Il cliente si collega al Wi-Fi, scansiona il QR e invia." : "Invia il link via WhatsApp o email. Le foto arriveranno automaticamente nella cartella."}</p>
        <label className="client-label"><span>Nome cliente <em>facoltativo</em></span><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Es. Famiglia Rossi" maxLength={60} /></label>
        {choice === "remote" && <label className="client-label"><span>Il cliente può inviare fino a</span><input type="datetime-local" value={remoteExpiresAt} min={localDateTimeValue(Date.now() + 15 * 60 * 1000)} max={localDateTimeValue(Date.now() + 7 * 24 * 60 * 60 * 1000)} onChange={(event) => setRemoteExpiresAt(event.target.value)} /><small>Da 15 minuti a 7 giorni. I file già inviati restano in attesa del tuo PC.</small></label>}
        <button className="primary-action" onClick={() => void start()} disabled={busy || (choice === "local" ? !wifiReady || Boolean(snapshot.warning) : !snapshot.remoteAvailable || !expiryValid)}>{busy ? "Preparazione…" : choice === "local" ? "Nuovo trasferimento locale" : "Crea link temporaneo"}<span>→</span></button>
      </div>
      {choice === "local"
        ? <WifiCard snapshot={snapshot} wifiReady={wifiReady} wifiSsid={wifiSsid} wifiPassword={wifiPassword} showPassword={showPassword} detecting={detectingWifi} draftValid={wifiDraftValid} setWifiSsid={setWifiSsid} setWifiPassword={setWifiPassword} setShowPassword={setShowPassword} detectWifi={detectWifi} saveWifi={saveWifi} chooseFolder={chooseFolder} />
        : <RemoteReadyCard snapshot={snapshot} chooseFolder={chooseFolder} refresh={refresh} />}
    </section>}

    {snapshot.session && snapshot.mode === "local" && <LocalSession snapshot={snapshot} wifiQr={wifiQr} uploadQr={uploadQr} busy={busy} close={close} />}
    {snapshot.session && snapshot.mode === "remote" && <RemoteSession snapshot={snapshot} uploadQr={uploadQr} copied={copied} copyLink={copyLink} busy={busy} close={close} />}

    <footer><span>{snapshot.mode === "remote" ? "Link temporaneo e consegna automatica" : "Trasferimento protetto"}</span><span>•</span><span>{snapshot.mode === "remote" ? "Eliminazione cloud un’ora dopo il download" : "I file restano sotto il tuo controllo"}</span></footer>
  </main>;
}

function ModeChoice({ onChoose, remoteAvailable }: { onChoose: (choice: Choice) => void; remoteAvailable: boolean }) {
  return <section className="mode-screen"><div className="mode-heading"><p className="eyebrow">NUOVO TRASFERIMENTO</p><h1>Dove si trova il cliente?</h1><p>Una scelta, poi FileX Send prepara tutto automaticamente.</p></div><div className="mode-grid"><button className="mode-card" onClick={() => onChoose("local")}><span className="mode-icon">⌁</span><small>STESSO POSTO</small><strong>Qui con me</strong><p>Wi-Fi locale e trasferimento diretto al PC.</p><b>Continua →</b></button><button className="mode-card remote" onClick={() => onChoose("remote")}><span className="mode-icon">↗</span><small>DA CASA O ALTROVE</small><strong>A distanza</strong><p>Link temporaneo da inviare al cliente.</p><b>{remoteAvailable ? "Continua →" : "Configura servizio →"}</b></button></div></section>;
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
  return <section className="session-grid"><QrCard step="1" eyebrow="CONNETTI AL WI-FI" title={snapshot.wifi.ssid} qr={wifiQr} help="Scansiona e conferma Connetti." /><QrCard step="2" eyebrow="APRI FILEX SEND" title="Scegli e invia" qr={uploadQr} help="Dopo la connessione, scansiona questo QR." /><TransferPanel session={snapshot.session!} busy={busy} close={close} remote={false} /> </section>;
}

function RemoteSession({ snapshot, uploadQr, copied, copyLink, busy, close }: { snapshot: FileSendSnapshot; uploadQr: string; copied: boolean; copyLink: () => Promise<void>; busy: boolean; close: () => Promise<void> }) {
  return <section className="remote-session"><article className="qr-card remote-link-card"><p className="eyebrow">LINK TEMPORANEO</p><h1>Invialo al cliente</h1><div className="qr-wrap">{uploadQr ? <img src={uploadQr} alt="QR del link remoto" /> : <div className="qr-loading" />}</div><code className="share-url">{snapshot.session!.uploadUrl}</code><button className="copy-button" onClick={() => void copyLink()}>{copied ? "Link copiato ✓" : "Copia link"}</button><p className="qr-help">Il cliente può inviare fino al {snapshot.session!.expiresAt ? new Date(snapshot.session!.expiresAt).toLocaleString("it-IT") : "termine impostato"}. Il link resta attivo anche se chiudi l’app.</p></article><TransferPanel session={snapshot.session!} busy={busy} close={close} remote /></section>;
}

function QrCard({ step, eyebrow, title, qr, help }: { step: string; eyebrow: string; title: string; qr: string; help: string }) {
  return <article className="qr-card step-card"><div className="step-number">{step}</div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><div className="qr-wrap">{qr ? <img src={qr} alt={title} /> : <div className="qr-loading" />}</div><p className="qr-help">{help}</p></article>;
}

function TransferPanel({ session, busy, close, remote }: { session: FileSendSession; busy: boolean; close: () => Promise<void>; remote: boolean }) {
  const total = useMemo(() => session.receivedBytes + session.activeUploadBytes, [session]);
  const linkExpired = Boolean(session.expiresAt && session.expiresAt <= Date.now());
  const canClose = session.activeUploads === 0 && (!remote || session.clientCompleted || linkExpired);
  return <article className="transfer-card"><div className="session-heading"><div><p className="eyebrow">RICEZIONE</p><h2>{session.label}</h2></div><span className={session.clientCompleted ? "status done" : "status live"}>{session.clientCompleted ? "Completato" : session.activeUploads ? "Invio in corso" : linkExpired ? "Link scaduto" : "In attesa"}</span></div><div className="metrics"><div><small>File ricevuti</small><strong>{session.receivedFiles.length}</strong></div><div><small>Dati ricevuti</small><strong>{formatBytes(total)}</strong></div></div><div className="file-list">{session.receivedFiles.length === 0 ? <div className="empty"><span>⇩</span><strong>In attesa delle foto</strong><p>{remote ? "Puoi chiudere l’app: il link continuerà a ricevere fino alla scadenza." : "I file compariranno qui durante l’invio."}</p></div> : session.receivedFiles.slice().reverse().map((file) => <div className="file-row" key={file.id}><span className="file-check">✓</span><div><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></div></div>)}</div><div className="session-actions"><button className="secondary" onClick={() => void window.fileXSend.openSessionFolder()}>Apri cartella</button><button className="finish" onClick={() => void close()} disabled={busy || !canClose}>{session.activeUploads ? "Invio in corso…" : remote && !canClose ? "In attesa del cliente" : remote ? "Archivia invio" : "Termina sessione"}</button></div></article>;
}

function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
