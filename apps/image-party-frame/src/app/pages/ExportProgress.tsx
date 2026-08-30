import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { AlertCircle, Ban, CheckCircle2, FileImage, FolderOpen, Loader2, RotateCcw, UploadCloud, XCircle } from "lucide-react";
import { Button } from "../components/ui/button";
import { Progress } from "../components/ui/progress";
import {
  defaultProjectExportSettings,
  getCustomTemplateBackgroundFiles,
  getImageFile,
  useProject,
} from "../contexts/ProjectContext";
import {
  cancelExportJob,
  createExportIntent,
  createExportJob,
  getExportJob,
  loadExportSession,
  openExportFolder,
  PartyFrameApiError,
  updateExportSession,
  type BatchExportImage,
  type ExportJobPhase,
  type ExportJobSnapshot,
  type ExportSessionRecord,
  type UploadProgressSnapshot,
} from "../hooks/useApi";

const POLL_INTERVAL_MS = 750;
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

function isTerminal(snapshot: ExportJobSnapshot | null): boolean {
  return Boolean(snapshot && TERMINAL_STATUSES.has(snapshot.status));
}

function waitForNextPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const abort = () => {
      window.clearTimeout(timeoutId);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timeoutId = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, POLL_INTERVAL_MS);
    signal.addEventListener("abort", abort, { once: true });
  });
}

function phaseLabel(phase: ExportJobPhase | null): string {
  switch (phase) {
    case "queued": return "In attesa nella coda del server";
    case "preparing": return "Verifica sorgenti e preparazione";
    case "rendering": return "Applicazione crop e cornice";
    case "writing": return "Scrittura atomica del file";
    case "cleaning": return "Pulizia dei file temporanei";
    case "completed": return "Esportazione terminata";
    case "cancelled": return "Esportazione annullata";
    case "failed": return "Esportazione interrotta";
    default: return "Inizializzazione del job";
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** unitIndex;
  return `${value.toFixed(unitIndex === 0 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function toApiError(error: unknown): PartyFrameApiError {
  if (error instanceof PartyFrameApiError) return error;
  return new PartyFrameApiError({
    message: error instanceof Error ? error.message : "Esportazione non riuscita.",
    code: "EXPORT_REQUEST_FAILED",
    retryable: true,
  });
}

export default function ExportProgress() {
  const { project } = useProject();
  const exportSettings = project.exportSettings ?? defaultProjectExportSettings;
  const selectedImages = useMemo(
    () => exportSettings.onlyApproved
      ? project.images.filter((image) => image.approval === "approved")
      : [...project.images],
    [exportSettings.onlyApproved, project.images]
  );
  const initialItemNames = useMemo(
    () => Object.fromEntries(selectedImages.map((image) => [
      image.id,
      image.relativePath || image.path || image.id,
    ])),
    [selectedImages]
  );
  const [intent, setIntent] = useState<ExportSessionRecord>(() => {
    const resumable = loadExportSession();
    if (resumable?.jobId || resumable?.projectId === project.projectId) {
      return resumable;
    }
    return createExportIntent(project.projectId, initialItemNames);
  });
  const [snapshot, setSnapshot] = useState<ExportJobSnapshot | null>(intent.snapshot ?? null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressSnapshot>({ loaded: 0, total: 0, percent: null });
  const [clientPhase, setClientPhase] = useState<"preparing" | "uploading" | "server" | "terminal">(
    isTerminal(intent.snapshot ?? null) || (intent.status === "cancelled" && !intent.jobId) ? "terminal" : "preparing"
  );
  const [requestError, setRequestError] = useState<PartyFrameApiError | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [locallyCancelled, setLocallyCancelled] = useState(intent.status === "cancelled" && !intent.jobId);
  const [runVersion, setRunVersion] = useState(0);
  const [openingFolder, setOpeningFolder] = useState(false);
  const [openFolderError, setOpenFolderError] = useState<string | null>(null);
  const runControllerRef = useRef<AbortController | null>(null);
  const projectAvailable = project.projectId === intent.projectId && project.images.length > 0;

  const imageById = useMemo(() => new Map(project.images.map((image) => [image.id, image])), [project.images]);
  const displayName = useCallback(
    (imageId: string) => intent.itemNames[imageId]
      || imageById.get(imageId)?.relativePath
      || imageById.get(imageId)?.path
      || imageId,
    [imageById, intent.itemNames]
  );

  const applySnapshot = useCallback((nextSnapshot: ExportJobSnapshot) => {
    setSnapshot(nextSnapshot);
    setClientPhase(isTerminal(nextSnapshot) ? "terminal" : "server");
    updateExportSession(intent.intentId, {
      jobId: nextSnapshot.id,
      status: nextSnapshot.status,
      snapshot: nextSnapshot,
    });
  }, [intent.intentId]);

  useEffect(() => {
    const controller = new AbortController();
    runControllerRef.current?.abort();
    runControllerRef.current = controller;
    let active = true;

    const poll = async (jobId: string) => {
      while (!controller.signal.aborted) {
        const nextSnapshot = await getExportJob(jobId, controller.signal);
        if (!active) return;
        applySnapshot(nextSnapshot);
        if (isTerminal(nextSnapshot)) return;
        await waitForNextPoll(controller.signal);
      }
    };

    const run = async () => {
      setRequestError(null);
      setCancelError(null);
      setLocallyCancelled(false);
      const persisted = loadExportSession();
      if (persisted?.intentId === intent.intentId && persisted.snapshot && isTerminal(persisted.snapshot)) {
        applySnapshot(persisted.snapshot);
        return;
      }
      if (persisted?.intentId === intent.intentId && persisted.status === "cancelled" && !persisted.jobId) {
        setLocallyCancelled(true);
        setClientPhase("terminal");
        return;
      }
      if (persisted?.intentId === intent.intentId && persisted.jobId) {
        setClientPhase("server");
        await poll(persisted.jobId);
        return;
      }

      setClientPhase("preparing");
      const missingSources: string[] = [];
      const payload = intent.itemIds.map((imageId): BatchExportImage | null => {
        const image = imageById.get(imageId);
        if (!image) {
          missingSources.push(imageId);
          return null;
        }
        const file = image.absolutePath ? undefined : getImageFile(image.id, project.projectId);
        if (!image.absolutePath && !file) {
          missingSources.push(image.id);
          return null;
        }
        return {
          id: image.id,
          originalName: file?.name ?? image.path,
          relativePath: image.relativePath || image.path,
          absolutePath: image.absolutePath,
          orientation: image.orientation,
          file,
          crop: {
            offsetX: image.crop.offsetX,
            offsetY: image.crop.offsetY,
            zoom: image.crop.zoom,
          },
        };
      }).filter((image): image is BatchExportImage => image !== null);

      if (missingSources.length > 0) {
        throw new PartyFrameApiError({
          message: `${missingSources.length} file sorgente non sono disponibili. Ricollega la cartella prima di esportare.`,
          code: "SOURCE_FILES_MISSING",
          retryable: false,
        });
      }
      if (payload.length === 0) {
        throw new PartyFrameApiError({
          message: "Nessuna immagine disponibile per l'esportazione.",
          code: "EMPTY_EXPORT",
          retryable: false,
        });
      }

      setClientPhase("uploading");
      updateExportSession(intent.intentId, { status: "uploading" });
      const created = await createExportJob(
        payload,
        project.template,
        {
          quality: exportSettings.quality,
          format: exportSettings.format,
          colorProfile: "sRGB",
          namingPattern: exportSettings.namingPattern,
          projectName: project.name,
          outputPath: project.outputPath,
          createSubfolder: exportSettings.createSubfolder,
          embedColorProfile: true,
          overwrite: exportSettings.overwrite,
          customTemplate: project.customTemplate,
          customTemplateBackgroundFiles: getCustomTemplateBackgroundFiles(),
        },
        intent.idempotencyKey,
        (progress) => { if (active) setUploadProgress(progress); },
        controller.signal
      );
      if (!active) return;
      applySnapshot(created);
      if (!isTerminal(created)) await poll(created.id);
    };

    void run().catch((error: unknown) => {
      if (!active || controller.signal.aborted) return;
      const apiError = toApiError(error);
      setRequestError(apiError);
      updateExportSession(intent.intentId, { status: "connection-error" });
    });

    return () => {
      active = false;
      controller.abort();
      if (runControllerRef.current === controller) runControllerRef.current = null;
    };
  }, [applySnapshot, exportSettings, imageById, intent, project, runVersion]);

  const handleCancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    setCancelError(null);
    const persisted = loadExportSession();
    const jobId = snapshot?.id || (persisted?.intentId === intent.intentId ? persisted.jobId : undefined);

    if (!jobId) {
      runControllerRef.current?.abort();
      setLocallyCancelled(true);
      setClientPhase("terminal");
      updateExportSession(intent.intentId, { status: "cancelled" });
      setCancelling(false);
      return;
    }

    try {
      applySnapshot(await cancelExportJob(jobId));
    } catch (error) {
      setCancelError(toApiError(error).message);
    } finally {
      setCancelling(false);
    }
  };

  const handleReconnect = () => {
    setRequestError(null);
    setRunVersion((current) => current + 1);
  };

  const retryIds = useMemo(() => {
    if (!snapshot?.result) return [...intent.itemIds];
    const successfulIds = new Set(snapshot.result.success.map((item) => item.id));
    return intent.itemIds.filter((imageId) => !successfulIds.has(imageId));
  }, [intent.itemIds, snapshot]);

  const handleNewRetry = () => {
    if (!projectAvailable) {
      setRequestError(new PartyFrameApiError({
        message: "Riapri il progetto per avviare un nuovo tentativo; il job corrente resta consultabile.",
        code: "PROJECT_SESSION_REQUIRED",
        retryable: false,
      }));
      return;
    }
    const targetIds = retryIds.length > 0 ? retryIds : intent.itemIds;
    const nextNames = Object.fromEntries(targetIds.map((imageId) => [imageId, displayName(imageId)]));
    const nextIntent = createExportIntent(project.projectId, nextNames, true);
    setIntent(nextIntent);
    setSnapshot(null);
    setRequestError(null);
    setCancelError(null);
    setLocallyCancelled(false);
    setUploadProgress({ loaded: 0, total: 0, percent: null });
    setClientPhase("preparing");
  };

  const handleOpenFolder = async () => {
    const outputDir = snapshot?.result?.outputDir;
    if (!outputDir) {
      setOpenFolderError("Nessuna cartella output disponibile per questa esportazione.");
      return;
    }
    setOpenFolderError(null);
    setOpeningFolder(true);
    const success = await openExportFolder(outputDir);
    setOpeningFolder(false);
    if (!success) setOpenFolderError("Impossibile aprire la cartella di output.");
  };

  const result = snapshot?.result;
  const succeeded = result?.success.length ?? 0;
  const failed = result?.failed.length ?? 0;
  const expected = intent.itemIds.length;
  const totalExportedSize = result?.success.reduce((total, item) => total + item.size, 0) ?? 0;
  const terminal = locallyCancelled || isTerminal(snapshot);
  const working = !terminal && !requestError;
  const partial = snapshot?.status === "completed" && succeeded > 0 && failed > 0;
  const completelyFailed = snapshot?.status === "failed" || (snapshot?.status === "completed" && succeeded === 0 && failed > 0);
  const completedSuccessfully = snapshot?.status === "completed" && failed === 0;
  const currentItemName = snapshot?.progress.currentItemId ? displayName(snapshot.progress.currentItemId) : null;

  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-[var(--app-text)] flex flex-col">
      <div className="h-16 bg-[var(--app-topbar)] border-b border-[var(--app-border)] flex items-center px-8">
        <div className="flex items-center gap-3">
          <FileImage className="w-6 h-6 text-[var(--brand-accent)]" />
          <span className="font-semibold">Esportazione progetto</span>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-8">
        <div className="mx-auto w-full max-w-3xl">
          <section className="rounded-[28px] border border-[var(--app-border)] bg-[var(--app-surface)] p-8 shadow-[0_24px_60px_rgba(0,0,0,0.18)] space-y-7">
            {working ? (
              <>
                <div>
                  <h1 className="text-3xl font-semibold tracking-[-0.03em]">{clientPhase === "uploading" ? "Trasferimento sorgenti" : "Esportazione in corso"}</h1>
                  <p className="mt-2 text-[var(--app-text-muted)]">Puoi tornare indietro: il job verrà ripreso senza crearne uno duplicato.</p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-field)] p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 font-medium">
                        {clientPhase === "uploading" ? <UploadCloud className="h-4 w-4 text-[var(--brand-accent)]" /> : <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />}
                        Trasferimento al server
                      </div>
                      <span className="text-sm text-[var(--app-text-muted)]">{clientPhase === "uploading" ? uploadProgress.percent === null ? "in corso" : `${uploadProgress.percent}%` : "ricevuto"}</span>
                    </div>
                    <Progress value={clientPhase === "uploading" ? uploadProgress.percent ?? 0 : 100} className="mt-4 h-2" />
                    {clientPhase === "uploading" ? <p className="mt-2 text-xs text-[var(--app-text-subtle)]">{formatBytes(uploadProgress.loaded)}{uploadProgress.total > 0 ? ` di ${formatBytes(uploadProgress.total)}` : " trasferiti"}</p> : null}
                  </div>

                  <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-field)] p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 font-medium">
                        {clientPhase === "server" ? <Loader2 className="h-4 w-4 animate-spin text-[var(--brand-accent)]" /> : <span className="h-4 w-4 rounded-full border border-[var(--app-border-strong)]" />}
                        Elaborazione server
                      </div>
                      <span className="text-sm text-[var(--app-text-muted)]">{snapshot?.progress.percent ?? 0}%</span>
                    </div>
                    <Progress value={snapshot?.progress.percent ?? 0} className="mt-4 h-2" />
                    <p className="mt-2 text-xs text-[var(--app-text-subtle)]">{snapshot ? `${snapshot.progress.completed} di ${snapshot.progress.total} file conclusi` : "In attesa del job"}</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--app-border)] bg-[rgba(0,0,0,0.06)] p-5">
                  <div className="text-xs uppercase tracking-[0.18em] text-[var(--app-text-subtle)]">Fase reale</div>
                  <div className="mt-2 flex items-center gap-3">
                    <Loader2 className="h-5 w-5 animate-spin text-[var(--brand-accent)]" />
                    <div>
                      <div className="font-medium">{clientPhase === "uploading" ? "Caricamento multipart" : phaseLabel(snapshot?.progress.phase ?? null)}</div>
                      {currentItemName ? <div className="mt-1 text-sm text-[var(--app-text-muted)]">{currentItemName}</div> : null}
                    </div>
                  </div>
                </div>

                {cancelError ? <div className="rounded-2xl border border-[var(--danger)] bg-[rgba(207,175,163,0.12)] p-4 text-sm text-[var(--danger)]">Annullamento non riuscito: {cancelError}</div> : null}
                <div className="flex justify-end">
                  <Button variant="outline" onClick={() => void handleCancel()} disabled={cancelling} className="border-[var(--danger)] text-[var(--danger)]">
                    <Ban className="h-4 w-4 mr-2" />
                    {cancelling ? "Annullamento..." : clientPhase === "uploading" ? "Interrompi caricamento" : "Annulla esportazione"}
                  </Button>
                </div>
              </>
            ) : requestError ? (
              <>
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[rgba(207,175,163,0.18)] text-[var(--danger)]"><AlertCircle className="h-6 w-6" /></div>
                  <div>
                    <h1 className="text-2xl font-semibold">Esportazione sospesa</h1>
                    <p className="mt-2 text-[var(--app-text-muted)]">{requestError.message}</p>
                    <p className="mt-2 text-xs text-[var(--app-text-subtle)]">Codice: {requestError.code}{requestError.status ? ` · HTTP ${requestError.status}` : ""}</p>
                    {requestError.status === 429 ? <p className="mt-3 text-sm text-[var(--brand-accent)]">La coda è temporaneamente piena. Attendi qualche secondo e riprova: lo stesso identificativo evita duplicati.</p> : null}
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-3">
                  {projectAvailable ? (
                    <Button asChild variant="outline"><Link to="/export-settings">Modifica impostazioni</Link></Button>
                  ) : null}
                  {requestError.retryable ? (
                    <Button onClick={handleReconnect} className="bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]"><RotateCcw className="h-4 w-4 mr-2" />Riprova senza duplicare</Button>
                  ) : (
                    <Button onClick={handleNewRetry} className="bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]"><RotateCcw className="h-4 w-4 mr-2" />Avvia un nuovo tentativo</Button>
                  )}
                  {(snapshot?.id || loadExportSession()?.jobId) ? <Button variant="outline" onClick={() => void handleCancel()} disabled={cancelling} className="border-[var(--danger)] text-[var(--danger)]">Annulla job</Button> : null}
                </div>
              </>
            ) : (
              <>
                <div className="text-center">
                  <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${completedSuccessfully ? "bg-[var(--success)] text-white" : partial ? "bg-[var(--brand-accent)] text-white" : "bg-[rgba(207,175,163,0.18)] text-[var(--danger)]"}`}>
                    {completedSuccessfully ? <CheckCircle2 className="h-9 w-9" /> : locallyCancelled || snapshot?.status === "cancelled" ? <Ban className="h-8 w-8" /> : completelyFailed ? <XCircle className="h-9 w-9" /> : <AlertCircle className="h-8 w-8" />}
                  </div>
                  <h1 className="mt-4 text-3xl font-semibold">{completedSuccessfully ? "Esportazione completata" : partial ? "Esportazione completata in parte" : locallyCancelled || snapshot?.status === "cancelled" ? "Esportazione annullata" : "Esportazione fallita"}</h1>
                  <p className="mt-2 text-[var(--app-text-muted)]">{succeeded} riusciti, {failed} falliti su {expected} file richiesti</p>
                  {snapshot?.error ? <p className="mt-3 text-sm text-[var(--danger)]">{snapshot.error.message} ({snapshot.error.code})</p> : null}
                </div>

                <div className="grid grid-cols-2 gap-4 rounded-2xl border border-[var(--app-border)] bg-[var(--app-field)] p-5 text-sm md:grid-cols-4">
                  <div><div className="text-[var(--app-text-subtle)]">Riusciti</div><div className="mt-1 text-lg text-[var(--success)]">{succeeded}</div></div>
                  <div><div className="text-[var(--app-text-subtle)]">Falliti</div><div className="mt-1 text-lg text-[var(--danger)]">{failed}</div></div>
                  <div><div className="text-[var(--app-text-subtle)]">Tempo server</div><div className="mt-1 text-lg">{Math.round((result?.totalTime ?? 0) / 1000)} s</div></div>
                  <div><div className="text-[var(--app-text-subtle)]">Dimensione</div><div className="mt-1 text-lg">{formatBytes(totalExportedSize)}</div></div>
                </div>

                {result && (result.success.length > 0 || result.failed.length > 0) ? (
                  <div className="max-h-72 space-y-2 overflow-auto rounded-2xl border border-[var(--app-border)] p-3">
                    {result.success.map((item) => <div key={`success-${item.id}`} className="flex items-start gap-3 rounded-xl bg-[rgba(103,117,107,0.10)] p-3 text-sm"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success)]" /><div className="min-w-0"><div className="truncate">{displayName(item.id)}</div><div className="truncate text-xs text-[var(--app-text-subtle)]">Output: {item.filename}</div></div></div>)}
                    {result.failed.map((item) => <div key={`failed-${item.id}`} className="flex items-start gap-3 rounded-xl bg-[rgba(207,175,163,0.10)] p-3 text-sm"><XCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger)]" /><div className="min-w-0"><div className="truncate">{displayName(item.id)}</div><div className="text-xs text-[var(--danger)]">{item.error}</div></div></div>)}
                  </div>
                ) : null}

                {openFolderError ? <div className="rounded-2xl border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{openFolderError}</div> : null}
                <div className="flex flex-wrap justify-end gap-3">
                  <Button variant="outline" onClick={() => void handleOpenFolder()} disabled={openingFolder || !result?.outputDir}><FolderOpen className="h-4 w-4 mr-2" />{openingFolder ? "Apertura..." : "Apri cartella output"}</Button>
                  {projectAvailable && (!completedSuccessfully || retryIds.length > 0) ? <Button variant="outline" onClick={handleNewRetry}><RotateCcw className="h-4 w-4 mr-2" />{retryIds.length > 0 && retryIds.length < expected ? `Riprova ${retryIds.length} file` : "Riprova esportazione"}</Button> : null}
                  <Button asChild className="bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]"><Link to="/">Torna alla Home</Link></Button>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
