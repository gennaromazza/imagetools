import type { Job, StudioFlowStatus, SdPreview } from "./types.js";
import type { PreviewMediaFile } from "./previewPolicy.js";

export interface ImportSelection {
  existingJobId?: string | null;
  selectedFilePaths?: string[];
  mtimeFrom?: string;
  mtimeTo?: string;
  suggestedJobDate?: string;
  suggestedFiles?: PreviewMediaFile[];
  sourceSummary?: SdPreview;
  sourceIdentity?: string;
}

export function localTimestamp(ms: number): string {
  return new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, -1);
}

export function selectImportRange(current: ReadonlySet<string>, orderedPaths: string[], anchor: string | null, clicked: string, shift: boolean): Set<string> {
  const next = new Set(current);
  const start = anchor === null ? -1 : orderedPaths.indexOf(anchor);
  const end = orderedPaths.indexOf(clicked);
  if (end < 0) return next;
  if (shift && start >= 0) {
    for (const path of orderedPaths.slice(Math.min(start, end), Math.max(start, end) + 1)) next.add(path);
  } else if (next.has(clicked)) next.delete(clicked);
  else next.add(clicked);
  return next;
}

export function suggestImportJobs(jobs: Job[], sessions: StudioFlowStatus["sessions"], selected: PreviewMediaFile[]) {
  if (!selected.length) return [];
  const start = selected.reduce((min, file) => Math.min(min, file.mtimeMs), Infinity);
  const day = localTimestamp(start).slice(0, 10);
  return jobs.filter((job) => job.folderExists !== false).map((job) => {
    const completed = sessions.filter((session) => session.jobId === job.id && session.status === "COMPLETED");
    const overlapCount = selected.filter((file) => completed.some((session) => session.mediaStartMs != null && session.mediaEndMs != null && file.mtimeMs >= session.mediaStartMs && file.mtimeMs <= session.mediaEndMs)).length;
    const recent = Math.max(0, ...completed.map((session) => session.completedAt ?? session.startedAt));
    const sameDay = job.dataLavoro === day;
    return { job, score: overlapCount ? 3 + overlapCount / selected.length : sameDay ? 2 : recent ? 1 : 0, recent,
      reason: overlapCount ? `Gli orari di ${overlapCount}/${selected.length} file si sovrappongono a un’importazione già completata in questo lavoro (mtime).`
        : sameDay ? "La data del lavoro coincide con quella dei file: potrebbe comunque essere un evento diverso."
        : `Importazione completata il ${new Date(recent).toLocaleDateString("it-IT")}; verifica che sia lo stesso evento.` };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || b.recent - a.recent || a.job.id.localeCompare(b.job.id)).slice(0, 3);
}
