import { useEffect, useMemo, useState } from "react";
import type {
  AdobeProcess,
  CacheCategory,
  CacheRisk,
  CacheSweepScanResult,
  CleanupResult,
  OlderAdobeVersion,
} from "./contracts";
import cacheSweepIcon from "../../../ICONE E LOGHI/filex-generated/cache-sweep.png";

type Profile = "recommended" | "custom" | "deep";
type DialogState =
  | { kind: "confirm" }
  | { kind: "close"; processes: AdobeProcess[] }
  | { kind: "force"; processes: AdobeProcess[] }
  | { kind: "uninstall"; candidate: OlderAdobeVersion }
  | null;

const riskLabels: Record<CacheRisk, string> = {
  recommended: "Consigliata",
  attention: "Richiede attenzione",
  advanced: "Avanzata",
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value.toLocaleString("it-IT", { maximumFractionDigits: index >= 3 ? 2 : 1 })} ${units[index]}`;
}

function selectedForProfile(categories: CacheCategory[], profile: Profile): Set<string> {
  if (profile === "recommended") {
    return new Set(categories.filter((item) => item.selectedByDefault && item.totalBytes > 0).map((item) => item.ruleId));
  }
  if (profile === "deep") {
    return new Set(categories.filter((item) => item.totalBytes > 0).map((item) => item.ruleId));
  }
  return new Set();
}

export default function App() {
  const [scan, setScan] = useState<CacheSweepScanResult | null>(null);
  const [profile, setProfile] = useState<Profile>("recommended");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isBusy, setIsBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [result, setResult] = useState<CleanupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [operationMessage, setOperationMessage] = useState<string | null>(null);

  const runScan = async () => {
    setIsBusy(true);
    setError(null);
    setResult(null);
    setOperationMessage(null);
    try {
      const next = await window.cacheSweep.scan();
      setScan(next);
      setProfile("recommended");
      setSelected(selectedForProfile(next.categories, "recommended"));
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : String(scanError));
    } finally {
      setIsBusy(false);
    }
  };

  useEffect(() => {
    void runScan();
  }, []);

  const selectedCategories = useMemo(
    () => scan?.categories.filter((item) => selected.has(item.ruleId)) ?? [],
    [scan, selected],
  );
  const selectedBytes = selectedCategories.reduce((sum, item) => sum + item.totalBytes, 0);
  const selectedApps = new Set(selectedCategories.flatMap((item) => item.applications)).size;

  const chooseProfile = (next: Profile) => {
    if (!scan) return;
    setProfile(next);
    if (next !== "custom") setSelected(selectedForProfile(scan.categories, next));
  };

  const toggleCategory = (ruleId: string) => {
    setProfile("custom");
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(ruleId)) next.delete(ruleId);
      else next.add(ruleId);
      return next;
    });
  };

  const beginCleanup = () => {
    if (selected.size === 0) return;
    setDialog({ kind: "confirm" });
  };

  const preflightProcesses = () => {
    if (!scan) return;
    const related = scan.runningProcesses.filter((process) =>
      process.involvedRuleIds.some((ruleId) => selected.has(ruleId)),
    );
    setDialog(related.length > 0 ? { kind: "close", processes: related } : null);
    if (related.length === 0) void executeCleanup();
  };

  const closeProcesses = async (force: boolean) => {
    setIsBusy(true);
    setError(null);
    try {
      const closeResult = await window.cacheSweep.closeProcesses([...selected], force);
      if (closeResult.remaining.length > 0 && !force) {
        setDialog({ kind: "force", processes: closeResult.remaining });
        return;
      }
      setDialog(null);
      await executeCleanup();
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : String(closeError));
      setDialog(null);
    } finally {
      setIsBusy(false);
    }
  };

  const executeCleanup = async () => {
    setIsBusy(true);
    setError(null);
    try {
      const cleanupResult = await window.cacheSweep.cleanup([...selected]);
      setResult(cleanupResult);
      const refreshed = await window.cacheSweep.scan();
      setScan(refreshed);
      setSelected(new Set());
    } catch (cleanupError) {
      setError(cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
    } finally {
      setIsBusy(false);
    }
  };

  const uninstallOldVersion = async (candidate: OlderAdobeVersion) => {
    setDialog(null);
    setIsBusy(true);
    setError(null);
    setOperationMessage(null);
    try {
      const uninstallResult = await window.cacheSweep.uninstallOldVersion(candidate.candidateId);
      if (uninstallResult.status === "completed" || uninstallResult.status === "cancelled") {
        setOperationMessage(uninstallResult.message);
      } else {
        setError(uninstallResult.message);
      }
      const refreshed = await window.cacheSweep.scan();
      setScan(refreshed);
      setSelected(selectedForProfile(refreshed.categories, profile));
    } catch (uninstallError) {
      setError(uninstallError instanceof Error ? uninstallError.message : String(uninstallError));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <main className="app-shell">
      <header className="hero">
        <div className="brand-lockup">
          <img src={cacheSweepIcon} alt="" className="brand-icon" />
          <div>
            <p className="eyebrow">FILEX · SOLO ADOBE</p>
            <h1>Adobe Cleaner</h1>
            <p className="subtitle">Cache e vecchie versioni Adobe, sotto controllo</p>
            <p className="scope-note">Esclusivamente applicazioni Adobe supportate. Non è un pulitore generico del PC.</p>
          </div>
        </div>
        <button className="secondary-button" onClick={() => void runScan()} disabled={isBusy}>
          {isBusy ? "Analisi in corso…" : "Analizza di nuovo"}
        </button>
      </header>

      {error && <div className="notice error-notice">{error}</div>}
      {operationMessage && <div className="notice success-notice">{operationMessage}</div>}
      {scan && !scan.platformSupported && (
        <div className="notice error-notice">Questa versione di Adobe Cleaner supporta soltanto Windows.</div>
      )}
      {scan?.warnings.map((warning) => <div className="notice" key={warning}>{warning}</div>)}

      <section className="overview-grid">
        <article className="metric-card">
          <span>Applicazioni Adobe rilevate</span>
          <strong>{scan?.installations.length ?? "—"}</strong>
        </article>
        <article className="metric-card">
          <span>Cache recuperabile</span>
          <strong>{scan ? formatBytes(scan.categories.reduce((sum, item) => sum + item.totalBytes, 0)) : "—"}</strong>
        </article>
        <article className="metric-card">
          <span>Processi Adobe attivi</span>
          <strong>{scan?.runningProcesses.length ?? "—"}</strong>
        </article>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">PROFILO</p>
            <h2>Scegli il livello di pulizia</h2>
          </div>
          <div className="profile-tabs" role="tablist" aria-label="Profilo di pulizia">
            {(["recommended", "custom", "deep"] as Profile[]).map((item) => (
              <button
                key={item}
                className={profile === item ? "active" : ""}
                onClick={() => chooseProfile(item)}
              >
                {item === "recommended" ? "Consigliata" : item === "custom" ? "Personalizzata" : "Profonda"}
              </button>
            ))}
          </div>
        </div>

        <div className="cache-list">
          {scan?.categories.map((category) => (
            <article className={`cache-card risk-${category.risk}`} key={category.ruleId}>
              <label className="cache-select">
                <input
                  type="checkbox"
                  checked={selected.has(category.ruleId)}
                  disabled={category.totalBytes === 0 || isBusy}
                  onChange={() => toggleCategory(category.ruleId)}
                />
                <span className="checkmark" />
              </label>
              <div className="cache-content">
                <div className="cache-title-row">
                  <div>
                    <span className={`risk-badge ${category.risk}`}>{riskLabels[category.risk]}</span>
                    <h3>{category.title}</h3>
                    <p className="apps-label">{category.applications.join(" · ")}</p>
                  </div>
                  <div className="cache-size">
                    <strong>{formatBytes(category.totalBytes)}</strong>
                    <span>{category.fileCount.toLocaleString("it-IT")} file</span>
                  </div>
                </div>
                <div className="explanation-grid">
                  <div><span>Cosa viene eliminato</span><p>{category.whatIsDeleted}</p></div>
                  <div><span>Cosa succede dopo</span><p>{category.consequence}</p></div>
                </div>
                {category.warning && <p className="warning-text">{category.warning}</p>}
                {category.targets.length > 0 && (
                  <details>
                    <summary>Mostra {category.targets.length === 1 ? "il percorso" : "i percorsi"}</summary>
                    {category.targets.map((target) => <code key={target.path}>{target.path}</code>)}
                  </details>
                )}
              </div>
            </article>
          ))}
          {scan && scan.categories.length === 0 && (
            <div className="empty-state">Nessuna cache Adobe supportata è stata trovata per questo account Windows.</div>
          )}
        </div>
      </section>

      <section className="section-block installations-block">
        <div className="section-heading">
          <div><p className="eyebrow">RILEVAMENTO</p><h2>Applicazioni Adobe</h2></div>
        </div>
        <div className="installation-grid">
          {scan?.installations.map((installation) => (
            <article key={`${installation.productId}-${installation.version}-${installation.source}`}>
              <span className={installation.supportedRuleIds.length > 0 ? "status-dot supported" : "status-dot"} />
              <div>
                <strong>{installation.displayName}</strong>
                <p>{installation.version ? `Versione ${installation.version}` : "Versione non disponibile"}</p>
                <small>{installation.supportedRuleIds.length > 0 ? "Cache supportata" : "Rilevata · nessuna pulizia sicura disponibile"}</small>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section-block old-versions-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">VERSIONI PRECEDENTI</p>
            <h2>Recupera spazio dalle vecchie app Adobe</h2>
          </div>
        </div>
        <p className="section-intro">Adobe Cleaner propone solo una versione con numero principale inferiore quando sul PC è presente anche una versione più recente dello stesso programma. La versione corrente non può essere selezionata.</p>
        <div className="old-version-list">
          {scan?.olderVersions.map((candidate) => (
            <article className="old-version-card" key={candidate.candidateId}>
              <div>
                <span className="risk-badge attention">Vecchia versione rilevata</span>
                <h3>{candidate.displayName}</h3>
                <p>Versione installata <strong>{candidate.version}</strong> · versione più recente <strong>{candidate.currentVersion}</strong></p>
                <small>La rimozione usa il disinstallatore ufficiale Adobe e conserva preferenze e plug-in condivisi.</small>
                {candidate.installLocation && <code>{candidate.installLocation}</code>}
              </div>
              <button className="danger-outline-button" disabled={isBusy} onClick={() => setDialog({ kind: "uninstall", candidate })}>Rimuovi versione {candidate.version}</button>
            </article>
          ))}
          {scan && scan.olderVersions.length === 0 && (
            <div className="empty-state">Nessuna vecchia versione Adobe rimovibile in sicurezza è stata rilevata.</div>
          )}
        </div>
        <p className="source-note">Suggerimento: in Creative Cloud Desktop puoi attivare “Rimuovi versioni precedenti” nelle opzioni avanzate degli aggiornamenti.</p>
      </section>

      {result && (
        <section className="result-card">
          <div><p className="eyebrow">OPERAZIONE COMPLETATA</p><h2>{formatBytes(result.deletedBytes)} liberati</h2></div>
          <p>{result.deletedFiles.toLocaleString("it-IT")} file eliminati · {result.skippedItems.toLocaleString("it-IT")} elementi saltati</p>
          {result.categories.map((item) => (
            <div className="result-row" key={item.ruleId}>
              <span>{item.title}</span><strong>{item.status === "blocked" ? "Bloccata" : formatBytes(item.deletedBytes)}</strong>
            </div>
          ))}
        </section>
      )}

      <footer className="action-bar">
        <div>
          <span>Selezionate {selectedCategories.length} categorie</span>
          <strong>{formatBytes(selectedBytes)}</strong>
        </div>
        <button className="primary-button" disabled={isBusy || selected.size === 0} onClick={beginCleanup}>
          {isBusy ? "Operazione in corso…" : `Libera ${formatBytes(selectedBytes)} da ${selectedApps} app`}
        </button>
      </footer>

      {dialog && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true">
            {dialog.kind === "confirm" && <>
              <p className="eyebrow">CONFERMA</p><h2>Controlla prima di procedere</h2>
              <p>Verranno eliminate {selectedCategories.length} categorie per un totale stimato di <strong>{formatBytes(selectedBytes)}</strong>.</p>
              <ul>{selectedCategories.map((item) => <li key={item.ruleId}><strong>{item.title}</strong>: {item.consequence}</li>)}</ul>
              <div className="modal-actions"><button onClick={() => setDialog(null)}>Annulla</button><button className="primary-button" onClick={preflightProcesses}>Continua</button></div>
            </>}
            {dialog.kind === "close" && <>
              <p className="eyebrow">APPLICAZIONI APERTE</p><h2>Salva il lavoro prima di continuare</h2>
              <p>FileX chiederà la chiusura normale dei processi Adobe coinvolti. Verifica di avere salvato documenti e progetti.</p>
              <ul>{dialog.processes.map((process) => <li key={process.pid}>{process.displayName} <code>PID {process.pid}</code></li>)}</ul>
              <div className="modal-actions"><button onClick={() => setDialog(null)}>Annulla</button><button className="primary-button" onClick={() => void closeProcesses(false)}>Chiudi normalmente</button></div>
            </>}
            {dialog.kind === "force" && <>
              <p className="eyebrow danger">ATTENZIONE</p><h2>Alcuni processi sono ancora aperti</h2>
              <p>La chiusura forzata può causare la perdita delle modifiche non salvate. FileX non può verificare se tutti i documenti Adobe sono stati salvati.</p>
              <ul>{dialog.processes.map((process) => <li key={process.pid}>{process.displayName} <code>PID {process.pid}</code></li>)}</ul>
              <div className="modal-actions"><button onClick={() => setDialog(null)}>Non forzare</button><button className="danger-button" onClick={() => void closeProcesses(true)}>Forza chiusura</button></div>
            </>}
            {dialog.kind === "uninstall" && <>
              <p className="eyebrow danger">DISINSTALLAZIONE ADOBE</p><h2>Rimuovere {dialog.candidate.displayName} {dialog.candidate.version}?</h2>
              <p>FileX ha rilevato anche la versione più recente <strong>{dialog.candidate.currentVersion}</strong>. Verrà avviato il disinstallatore ufficiale Adobe esclusivamente per la vecchia versione.</p>
              <ul>
                <li>Salva e chiudi i documenti aperti: FileX tenterà una chiusura normale dell'applicazione.</li>
                <li>Preferenze e plug-in condivisi vengono conservati.</li>
                <li>Potrebbe apparire la richiesta UAC di Windows.</li>
                <li>La versione più recente non viene rimossa.</li>
              </ul>
              <div className="modal-actions"><button onClick={() => setDialog(null)}>Annulla</button><button className="danger-button" onClick={() => void uninstallOldVersion(dialog.candidate)}>Rimuovi vecchia versione</button></div>
            </>}
          </section>
        </div>
      )}
    </main>
  );
}
