import { useEffect, useState } from "react";
import type { ImportResult, Job } from "../types";
import { getArchivioImportProgress, getArchivioStudioFlowStatus, resumeArchivioImport } from "../archivioDesktopApi";
import { describeInterrupted, findResumableSession, type ResumableLike } from "../wizardModel";

export type ResumePhase = "idle" | "running" | "done" | "error";

/** Parte visibile del riquadro: separata dai dati per poterla provare senza scheda e senza server. */
export function ResumeBannerView({ session, jobName, phase, progressPct, progressLabel, message, now, onResume, onDismiss }: {
  session: ResumableLike; jobName?: string | null; phase: ResumePhase;
  progressPct?: number; progressLabel?: string; message?: string | null; now?: number;
  onResume: () => void; onDismiss: () => void;
}) {
  return <div className={`resume-banner resume-banner--${phase}`} role="status">
    <div className="resume-banner__text">
      {phase === "idle" && <>
        <strong>Importazione interrotta</strong>
        <span>{describeInterrupted(session, now)}{jobName ? ` Lavoro: «${jobName}».` : ""} Vuoi finire di copiare le foto rimaste?</span>
      </>}
      {phase === "running" && <>
        <strong>Riprendo da dove si era fermata…</strong>
        <span>{progressLabel || "Preparazione"} · {Math.round(progressPct ?? 0)}%</span>
        <progress max={100} value={Math.max(0, Math.min(100, progressPct ?? 0))} aria-label="Avanzamento della ripresa" />
      </>}
      {phase === "done" && <><strong>Ripresa completata</strong><span>{message}</span></>}
      {phase === "error" && <><strong>Non sono riuscito a riprendere</strong><span role="alert">{message}</span></>}
    </div>
    <div className="button-row">
      {(phase === "idle" || phase === "error") && <button type="button" className="primary-button" onClick={onResume}>{phase === "error" ? "Riprova" : "Riprendi"}</button>}
      {phase !== "running" && <button type="button" className="ghost-button" onClick={onDismiss}>{phase === "done" ? "Chiudi" : "Ignora"}</button>}
    </div>
  </div>;
}

const DISMISSED_KEY = "filex.archivio-flow.dismissed-resume";

function readDismissed(): string[] {
  try { return JSON.parse(window.sessionStorage.getItem(DISMISSED_KEY) ?? "[]") as string[]; } catch { return []; }
}

/** Avviso in cima alla scelta delle foto: se questa scheda ha un'importazione rimasta a meta', si puo' riprendere con un clic. */
export function ResumeBanner({ sdPath, jobs, onFinished }: { sdPath: string | null; jobs: Job[]; onFinished: (result: ImportResult) => void }) {
  const [session, setSession] = useState<(ResumableLike & { jobId?: string | null }) | null>(null);
  const [phase, setPhase] = useState<ResumePhase>("idle");
  const [progress, setProgress] = useState<{ pct: number; label: string }>({ pct: 0, label: "" });
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setSession(null); setPhase("idle"); setMessage(null);
    if (!sdPath) return;
    let active = true;
    void getArchivioStudioFlowStatus()
      .then((status) => {
        if (!active) return;
        const found = findResumableSession(status.resumable, sdPath);
        setSession(found && !readDismissed().includes(found.id) ? found : null);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [sdPath]);

  if (!session) return null;
  const jobName = jobs.find((job) => job.id === session.jobId)?.nomeLavoro ?? null;

  function dismiss() {
    try { window.sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...readDismissed(), session!.id])); } catch { /* il riquadro si ripresentera' al prossimo avvio */ }
    setSession(null);
  }

  async function resume() {
    setPhase("running"); setMessage(null); setProgress({ pct: 0, label: "" });
    const timer = window.setInterval(() => {
      void getArchivioImportProgress().then((snapshot) => setProgress({ pct: snapshot.overallProgressPct, label: snapshot.currentPhaseLabel })).catch(() => undefined);
    }, 1000);
    try {
      const result = await resumeArchivioImport(session!.id);
      onFinished(result);
      setPhase("done");
      setMessage(`Ho copiato altri ${result.copiedFiles.toLocaleString("it-IT")} file${result.errors.length ? ` (${result.errors.length} con errori)` : ""}.`);
    } catch (error) {
      setPhase("error");
      setMessage(error instanceof Error ? error.message : "Ripresa non riuscita.");
    } finally {
      window.clearInterval(timer);
    }
  }

  return <ResumeBannerView session={session} jobName={jobName} phase={phase} progressPct={progress.pct} progressLabel={progress.label} message={message} onResume={() => { void resume(); }} onDismiss={dismiss} />;
}
