import { useEffect, useMemo, useState } from "react";
import type { BackupGuardConfiguration, BackupGuardConflictAction, BackupGuardDeepVerificationResult, BackupGuardExecutionProgress, BackupGuardExecutionResult, BackupGuardHistoryEntry, BackupGuardPendingProject, BackupGuardScanResult, BackupGuardTrashSession } from "./contracts";
import logo from "./assets/backup-guard.png";

type Screen = "protection" | "differences" | "trash" | "history" | "lightroom" | "settings";
const labels = { "copy-to-clone": "Da aggiungere al clone", "import-from-clone": "Nuovi sul clone", "delete-from-clone": "Da eliminare dal clone", "restore-to-clone": "Da ripristinare sul clone", conflict: "Conflitti" } as const;

function bytes(value: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"]; let amount = value; let index = 0;
  while (amount >= 1000 && index < units.length - 1) { amount /= 1000; index++; }
  return `${new Intl.NumberFormat("it-IT", { maximumFractionDigits: index ? 1 : 0 }).format(amount)} ${units[index]}`;
}
function duration(value: number | null): string { if (value === null || !Number.isFinite(value)) return "calcolo…"; if (value < 60) return `${Math.ceil(value)} s`; const minutes = Math.ceil(value / 60); return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`; }

export default function App() {
  const api = window.backupGuard;
  const [screen, setScreen] = useState<Screen>("protection");
  const [config, setConfig] = useState<BackupGuardConfiguration | null>(null);
  const [master, setMaster] = useState(""); const [clone, setClone] = useState("");
  const [result, setResult] = useState<BackupGuardScanResult | null>(null);
  const [history, setHistory] = useState<BackupGuardHistoryEntry[]>([]);
  const [trash, setTrash] = useState<BackupGuardTrashSession[]>([]);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [confirmDeletions, setConfirmDeletions] = useState(false);
  const [execution, setExecution] = useState<BackupGuardExecutionResult | null>(null);
  const [verification, setVerification] = useState<BackupGuardDeepVerificationResult | null>(null);
  const [progress, setProgress] = useState<BackupGuardExecutionProgress | null>(null);
  const [pendingProjects, setPendingProjects] = useState<BackupGuardPendingProject[]>([]);
  const [testMode, setTestMode] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const differences = result?.differences ?? [];
  const massDeletion = Boolean(config && result && (result.deletionFiles > config.deletionFileThreshold || result.deletionBytes > config.deletionByteThreshold));
  const filteredHistory = history.filter((item) => `${item.summary} ${item.error ?? ""} ${item.result?.differences.map((difference) => difference.relativePath).join(" ") ?? ""}`.toLowerCase().includes(historyQuery.trim().toLowerCase()));

  useEffect(() => {
    if (!api) { setMessage("Apri Backup Guard dall'app desktop FileX."); return; }
    void Promise.all([api.getConfiguration(), api.listHistory(), api.listPendingProjects(), api.isTestMode()]).then(([saved, items, projects, testing]) => {
      setConfig(saved); setMaster(saved?.masterPath ?? ""); setClone(saved?.clonePath ?? ""); setHistory(items); setPendingProjects(projects); setTestMode(testing);
    });
  }, [api]);
  useEffect(() => { if (screen === "trash" && api) void api.listTrash().then(setTrash).catch((error) => setMessage(String(error))); }, [api, screen]);

  const totalBytes = useMemo(() => differences.reduce((sum, item) => sum + (item.masterBytes ?? item.cloneBytes ?? 0), 0), [differences]);
  const progressPercent = progress ? Math.min(100, progress.totalBytes > 0 ? progress.bytesCompleted / progress.totalBytes * 100 : progress.totalOperations > 0 ? progress.completedOperations / progress.totalOperations * 100 : 3) : 0;
  function notify(title: string, body: string): void { try { if (Notification.permission === "granted") new Notification(title, { body }); else if (Notification.permission === "default") void Notification.requestPermission(); } catch { /* notifica opzionale */ } }
  async function browse(role: "master" | "clone") { const value = await api?.browseFolder(role); if (value) role === "master" ? setMaster(value) : setClone(value); }
  async function save() { if (!api) return; setBusy(true); setMessage(""); try { const saved = await api.saveConfiguration(master, clone); setConfig(saved); setScreen("protection"); setMessage("Archivio principale e clone associati."); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }
  async function scan() { if (!api) return; setBusy(true); setMessage(""); setConfirmDeletions(false); try { const next = await api.scan(); setResult(next); setHistory(await api.listHistory()); setScreen("differences"); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }

  async function withProgress<T>(operation: () => Promise<T>): Promise<T> {
    if (!api) throw new Error("API non disponibile.");
    setBusy(true); setMessage(""); const timer = setInterval(() => void api.getProgress().then(setProgress), 250);
    try { return await operation(); } finally { clearInterval(timer); setProgress(await api.getProgress()); setBusy(false); }
  }
  async function execute() {
    if (!api || !result) return; setExecution(null);
    try {
      const done = await withProgress(() => api.execute(result.id, confirmDeletions));
      setExecution(done); setResult(null); setConfirmDeletions(false);
      const [items, projects] = await Promise.all([api.listHistory(), api.listPendingProjects()]); setHistory(items); setPendingProjects(projects);
      setMessage("Archivio sincronizzato e verificato."); setScreen("protection"); notify("FileX Backup Guard", `${done.verifiedFiles} file verificati. Clone protetto.`);
    } catch (error) { const text = error instanceof Error ? error.message : String(error); setMessage(text); notify("Backup Guard richiede attenzione", text); }
  }
  async function deepVerify() {
    if (!api) return; setVerification(null);
    try { const done = await withProgress(() => api.deepVerify()); setVerification(done); setHistory(await api.listHistory()); setMessage(done.mismatches.length ? `Verifica terminata: ${done.mismatches.length} anomalie.` : "Verifica profonda completata: ogni byte corrisponde."); notify("Verifica profonda completata", done.mismatches.length ? `${done.mismatches.length} anomalie trovate.` : "Master e clone corrispondono byte per byte."); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }
  async function resolveConflict(path: string, action: BackupGuardConflictAction) {
    if (!api || !result) return;
    const descriptions = { "keep-both": "conservare entrambe le copie", "use-master": "usare il master e sostituire il clone", "use-clone": "usare il clone, salvando prima il master" };
    if (!window.confirm(`Confermi di ${descriptions[action]} per:\n${path}?`)) return;
    try { const done = await withProgress(() => api.resolveConflict(result.id, path, action)); const next = await api.scan(); setResult(next); setHistory(await api.listHistory()); setMessage(done.outputPath ? `Conflitto gestito. Risultato: ${done.outputPath}` : "Conflitto gestito."); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }
  async function recover(sessionId: string) { if (!api) return; try { const done = await withProgress(() => api.recoverTrash(sessionId)); setMessage(`${done.restoredFiles} file recuperati in ${done.recoveryPath}`); await api.openPath(done.recoveryPath); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }
  async function removeTrash(sessionId: string) { if (!api || !window.confirm("Eliminare definitivamente questa sessione dal cestino FileX? L'operazione non è reversibile.")) return; try { await api.deleteTrash(sessionId); setTrash(await api.listTrash()); setMessage("Sessione eliminata definitivamente dal cestino."); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }
  async function exportReport() { if (!api) return; try { const done = await api.exportHistoryReport(); if (done.ok && done.path) setMessage(`Report salvato in ${done.path}`); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } }

  const nav: Array<[Screen, string, string]> = [
    ["protection", "Protezione", "Stato archivio"], ["differences", "Differenze", result ? `${differences.length} rilevate` : "Esegui un controllo"], ["trash", "Cestino e recupero", "Cancellazioni protette"], ["history", "Cronologia", `${history.length} sessioni`], ["lightroom", "Cataloghi Lightroom", "Snapshot dedicati"], ["settings", "Impostazioni", "Master e clone"],
  ];
  return <div className="shell">
    <aside><div className="brand"><img src={logo} alt="FileX Backup Guard"/><h1>Backup Guard</h1><p>Protezione archivio FileX</p></div><nav>{nav.map(([id, title, small], index) => <button className={screen === id ? "active" : ""} onClick={() => setScreen(id)} key={id}><span>{index + 1}</span><div><strong>{title}</strong><small>{small}</small></div></button>)}</nav><div className="suite-pill">FILEX SUITE <strong>Sincronizzazione verificata</strong></div></aside>
    <main>{testMode && <div className="test-mode">MODALITÀ COLLAUDO · master e clone possono essere sullo stesso disco</div>}{message && <div className="notice">{message}</div>}{progress?.active && <div className="progress"><div className="progress-head"><strong>{progress.paused ? "In pausa" : progress.phase} · {progress.completedOperations}/{progress.totalOperations}</strong><span>{bytes(progress.bytesPerSecond)}/s · tempo residuo {duration(progress.etaSeconds)}</span></div><span>{progress.currentPath ?? "Preparazione…"} · {bytes(progress.currentFileBytes)} / {bytes(progress.currentFileTotalBytes)}</span><div><i style={{ width: `${progressPercent}%` }}/></div><div className="progress-actions"><button onClick={() => progress.paused ? api?.resume().then(setProgress) : api?.pause().then(setProgress)}>{progress.paused ? "Riprendi" : "Pausa"}</button><button className="danger-button" onClick={() => api?.cancel().then(setProgress)}>Annulla in sicurezza</button></div></div>}

      {screen === "protection" && <><header><div><span className="eyebrow">PROTEZIONE ARCHIVIO</span><h2>{config ? "Controlla il tuo clone" : "Configura la prima protezione"}</h2><p>Il principale resta la fonte di verità. Copia a singola lettura, controllo SHA-256 e verifica profonda su richiesta.</p></div>{config && <div className="header-actions"><button disabled={busy} onClick={deepVerify}>Verifica profonda</button><button className="primary" disabled={busy} onClick={scan}>{busy ? "Operazione in corso…" : "Controlla archivio"}</button></div>}</header>{pendingProjects.length > 0 && <section className="pending-projects"><strong>{pendingProjects.length} lavori importati da Archivio Flow attendono protezione</strong>{pendingProjects.slice(0, 4).map((project) => <span key={project.eventId}>{project.projectName} · {project.fileCount} file</span>)}</section>}{verification && <section className={`success-summary ${verification.mismatches.length ? "warning" : ""}`}><strong>Verifica profonda: {verification.verifiedFiles} file · {bytes(verification.verifiedBytes)}</strong><span>{verification.mismatches.length ? `${verification.mismatches.length} checksum diversi` : "Tutti i checksum corrispondono"}</span></section>}{execution && <section className="success-summary"><strong>Ultima sincronizzazione completata</strong><span>{execution.verifiedFiles} file verificati · {execution.deletedFromClone} eliminati dal clone · {bytes(execution.bytesTransferred)} trasferiti</span></section>}<section className="pair"><article><span className="role">ARCHIVIO PRINCIPALE</span><h3>{config ? config.masterPath : "Non configurato"}</h3><div className="status ok">Fonte di verità · Protetta</div></article><div className="arrow">↓</div><article><span className="role">CLONE ESTERNO</span><h3>{config ? config.clonePath : "Non configurato"}</h3><div className="status">{config ? "Associato" : "Da selezionare"}</div></article>{!config && <button className="primary" onClick={() => setScreen("settings")}>Configura Backup Guard</button>}</section></>}

      {screen === "settings" && <><header><div><span className="eyebrow">CONFIGURAZIONE</span><h2>Associa archivio e clone</h2><p>I ruoli restano fissi e i volumi fisici devono essere distinti.</p></div></header><section className="form"><label>Archivio principale<div><input value={master} readOnly placeholder="Seleziona la fonte di verità"/><button onClick={() => browse("master")}>Sfoglia</button></div></label><label>Clone esterno<div><input value={clone} readOnly placeholder="Seleziona la copia esterna"/><button onClick={() => browse("clone")}>Sfoglia</button></div></label><button className="primary" disabled={busy || !master || !clone} onClick={save}>Salva associazione</button></section></>}

      {screen === "differences" && <><header><div><span className="eyebrow">PIANO DI SINCRONIZZAZIONE</span><h2>{result ? `${differences.length} differenze rilevate` : "Nessun controllo disponibile"}</h2><p>{result ? `${result.masterFiles} file nel principale · ${result.cloneFiles} nel clone · ${bytes(totalBytes)} interessati` : "Avvia un controllo dalla sezione Protezione."}</p></div>{result && differences.some((item) => item.kind !== "conflict") && <button className="primary" disabled={busy || result.lightroomLocks.length > 0 || (result.deletionFiles > 0 && !confirmDeletions)} onClick={execute}>Rendi il clone uguale</button>}</header>{result && <>{result.lightroomLocks.length > 0 && <div className="danger-note">Chiudi Lightroom: {result.lightroomLocks.length} cataloghi risultano aperti.</div>}{massDeletion && <div className="danger-note"><strong>ATTENZIONE: CANCELLAZIONE MASSIVA.</strong> La quantità supera la soglia di sicurezza configurata. Controlla il piano prima di confermare.</div>}{result.deletionFiles > 0 && <label className="delete-confirm"><input type="checkbox" checked={confirmDeletions} onChange={(event) => setConfirmDeletions(event.target.checked)}/><span>Confermo la rimozione dal clone di {result.deletionFiles} file ({bytes(result.deletionBytes)}). Saranno recuperabili nel cestino FileX.</span></label>}<section className="metrics">{Object.entries(labels).map(([key, label]) => <article key={key}><span>{label}</span><strong>{result.totals[key as keyof typeof result.totals]}</strong></article>)}</section><section className="list">{differences.length === 0 ? <div className="empty">Il clone è già uguale al principale.</div> : differences.slice(0, 500).map((item) => <article key={`${item.kind}:${item.relativePath}`}><div><span className={`badge ${item.kind}`}>{labels[item.kind]}</span><strong>{item.relativePath}</strong><small>{item.reason}</small>{item.kind === "conflict" && <div className="conflict-actions"><button onClick={() => resolveConflict(item.relativePath, "keep-both")}>Conserva entrambe</button><button onClick={() => resolveConflict(item.relativePath, "use-master")}>Usa master</button><button onClick={() => resolveConflict(item.relativePath, "use-clone")}>Usa clone</button></div>}</div><b>{item.entryType === "file" ? bytes(item.masterBytes ?? item.cloneBytes ?? 0) : "Cartella"}</b></article>)}</section></>}</>}

      {screen === "trash" && <><header><div><span className="eyebrow">CESTINO FILEX</span><h2>Cancellazioni sempre recuperabili</h2><p>I file rimossi dal clone restano isolati per sessione. Il recupero crea una cartella separata nel master e non sovrascrive nulla.</p></div></header><section className="list">{trash.length === 0 ? <div className="empty">Il cestino è vuoto.</div> : trash.map((item) => <article key={item.sessionId}><div><span className="badge delete-from-clone">Sessione protetta</span><strong>{item.fileCount} file · {bytes(item.totalBytes)}</strong><small>{new Date(item.createdAt).toLocaleString("it-IT")} · {item.relativePaths.slice(0, 3).join(" · ")}{item.relativePaths.length > 3 ? "…" : ""}</small><div className="conflict-actions"><button onClick={() => recover(item.sessionId)}>Recupera nel master</button><button className="danger-button" onClick={() => removeTrash(item.sessionId)}>Elimina definitivamente</button></div></div><b>{item.sessionId.slice(0, 8)}</b></article>)}</section></>}

      {screen === "history" && <><header><div><span className="eyebrow">CRONOLOGIA</span><h2>Ogni operazione resta registrata</h2><p>Controlli, sincronizzazioni, verifiche profonde ed errori in ordine cronologico.</p></div><div className="header-actions"><button onClick={exportReport}>Esporta report JSON</button></div></header><section className="history-search"><input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="Cerca file, cartella, operazione o errore…"/></section><section className="list">{filteredHistory.length === 0 ? <div className="empty">{history.length ? "Nessun risultato per questa ricerca." : "La cronologia è ancora vuota."}</div> : filteredHistory.map((item) => <article key={item.id}><div><span className={`badge ${item.status}`}>{item.status === "completed" ? "Controllo" : item.status === "executed" ? "Operazione" : item.status === "verified" ? "Verifica profonda" : "Errore"}</span><strong>{item.summary}</strong><small>{new Date(item.createdAt).toLocaleString("it-IT")}{item.error ? ` · ${item.error}` : ""}{item.execution?.trashPath ? ` · Cestino: ${item.execution.trashPath}` : ""}</small></div><b>{item.result ? `${item.result.differences.length} differenze` : item.execution ? (item.execution.bytesTransferred ? bytes(item.execution.bytesTransferred) : "Nessun trasferimento") : "—"}</b></article>)}</section></>}

      {screen === "lightroom" && <><header><div><span className="eyebrow">LIGHTROOM CLASSIC</span><h2>Cataloghi protetti come un insieme</h2><p>Backup Guard rileva i file .lrcat.lock e blocca la sincronizzazione finché Lightroom non viene chiuso.</p></div></header><section className="empty feature"><strong>Snapshot automatico prima di risolvere un conflitto</strong><p>.lrcat, .lrcat-data e i dati .lrdata collegati vengono preservati in “FileX Recuperati/Cataloghi Lightroom” prima di scegliere la copia master o clone.</p></section></>}
    </main>
  </div>;
}
