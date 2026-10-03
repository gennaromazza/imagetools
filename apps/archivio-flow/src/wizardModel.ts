import type { Job } from "./types";

/**
 * Il percorso e' una guida a domande: una domanda per schermata. L'indicatore in alto mostra
 * 4 tappe stabili; dentro la tappa "lavoro" ci sono piu' schermate (scelta, elenco o nome).
 */
export type WizardStep = 1 | 2 | 3 | 4;

export const WIZARD_STEPS: ReadonlyArray<{ step: WizardStep; title: string; hint: string }> = [
  { step: 1, title: "Scegli le foto", hint: "Dalla scheda" },
  { step: 2, title: "Per quale lavoro", hint: "Nuovo o già esistente" },
  { step: 3, title: "In che cartella", hint: "Facoltativo" },
  { step: 4, title: "Controlla e avvia", hint: "Ultimo sguardo" },
];

/** Le schermate dopo la scelta delle foto (la schermata 1 e' la griglia della scheda). */
export type WizardScreen = "who" | "pick" | "newjob" | "folder" | "confirm" | "done";

export function macroStepOf(screen: WizardScreen): WizardStep {
  switch (screen) {
    case "who": case "pick": case "newjob": return 2;
    case "folder": return 3;
    default: return 4;
  }
}

export interface FlowContext {
  mode: "new" | "existing" | null;
  /** E' stato scelto un lavoro esistente. */
  jobChosen: boolean;
  /** Per un lavoro nuovo: ci sono cartelle predefinite tra cui scegliere? */
  hasFolderChoices: boolean;
}

/** La domanda sulla cartella si salta da sola per un lavoro nuovo quando non c'e' nulla da proporre. */
export function folderStepApplies(ctx: FlowContext): boolean {
  return ctx.mode === "existing" ? true : ctx.hasFolderChoices;
}

export function nextScreen(current: WizardScreen, ctx: FlowContext): WizardScreen {
  switch (current) {
    case "who": return ctx.mode === "existing" ? "pick" : ctx.mode === "new" ? "newjob" : "who";
    case "pick": return ctx.jobChosen ? "folder" : "pick";
    case "newjob": return folderStepApplies(ctx) ? "folder" : "confirm";
    case "folder": return "confirm";
    case "confirm": return "done";
    default: return current;
  }
}

/** Dove porta il clic su una tappa gia' superata dell'indicatore (null = torna alla griglia della scheda). */
export function screenForStep(step: WizardStep, ctx: FlowContext): WizardScreen | null {
  if (step === 1) return null;
  if (step === 2) return ctx.mode === "existing" ? "pick" : ctx.mode === "new" ? "newjob" : "who";
  if (step === 3) return "folder";
  return "confirm";
}

/** Campi da completare prima di lasciare ciascuna schermata. */
const SCREEN_FIELDS: Partial<Record<WizardScreen, readonly string[]>> = {
  pick: ["existingJobId"],
  newjob: ["nomeLavoro", "dataLavoro"],
};

export function issuesForScreen<T extends { field: string }>(screen: WizardScreen, issues: readonly T[]): T[] {
  const fields = SCREEN_FIELDS[screen] ?? [];
  return issues.filter((issue) => fields.includes(issue.field));
}

/** Si puo' tornare solo a una tappa gia' superata; mai saltare avanti senza passare da "Avanti". */
export function canJumpToStep(current: WizardStep, target: WizardStep): boolean {
  return target < current;
}

export function selectionSummary(options: { explicitCount: number | null; filtered: boolean; matchedCount: number | null }): string {
  const { explicitCount, filtered, matchedCount } = options;
  if (explicitCount !== null) return explicitCount === 1 ? "1 foto scelta" : `${explicitCount.toLocaleString("it-IT")} foto scelte`;
  if (matchedCount !== null) {
    const label = matchedCount === 1 ? "1 file" : `${matchedCount.toLocaleString("it-IT")} file`;
    return filtered ? `${label} nell'intervallo scelto` : `${label}: tutta la scheda`;
  }
  return filtered ? "Solo i file dell'intervallo scelto" : "Tutta la scheda";
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export interface JobPickerResult {
  items: Job[];
  total: number;
  hidden: number;
}

/**
 * Elenco dei lavori per la scelta di "lavoro gia' esistente": senza ricerca mostra i piu' recenti
 * (il lavoro piu' probabile e' quasi sempre l'ultimo), con ricerca confronta tutte le parole
 * ignorando maiuscole e accenti. Il lavoro gia' scelto resta sempre visibile in cima.
 */
export function pickJobs(jobs: readonly Job[], query: string, selectedId: string, limit = 6): JobPickerResult {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const matching = jobs.filter((job) => {
    if (words.length === 0) return true;
    const haystack = normalize([job.nomeLavoro, job.dataLavoro, job.autore, job.annoArchivio ?? "", job.categoriaArchivio ?? "", job.percorsoCartella].join(" "));
    return words.every((word) => haystack.includes(word));
  });
  const sorted = [...matching].sort((a, b) => b.dataLavoro.localeCompare(a.dataLavoro) || a.nomeLavoro.localeCompare(b.nomeLavoro, "it"));
  const selected = sorted.find((job) => job.id === selectedId) ?? jobs.find((job) => job.id === selectedId);
  const rest = sorted.filter((job) => job.id !== selectedId);
  const items = (selected ? [selected, ...rest] : rest).slice(0, Math.max(limit, selected ? 1 : 0));
  return { items, total: sorted.length, hidden: Math.max(0, sorted.length - items.length) };
}

/** Ultimo elemento di un percorso Windows o POSIX: il nome della cartella senza tutto il percorso. */
export function lastPathSegment(path: string): string {
  return path.split(/[\\/]+/).filter(Boolean).pop() ?? path;
}

export function formatItalianDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : isoDate;
}

// ── Cifre del riepilogo: dimensioni, tempo, spazio libero ────────────────────

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["byte", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit += 1; }
  const digits = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 1;
  return `${value.toLocaleString("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: digits })} ${units[unit]}`;
}

/** Velocita' di partenza prudente (scheda UHS-I): si sostituisce con quella misurata nelle importazioni precedenti. */
export const DEFAULT_COPY_BYTES_PER_SECOND = 40_000_000;

export function describeDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return "meno di un minuto";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes === 1 ? "circa 1 minuto" : `circa ${minutes} minuti`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourText = hours === 1 ? "1 ora" : `${hours} ore`;
  return rest === 0 ? `circa ${hourText}` : `circa ${hourText} e ${rest} minuti`;
}

export interface SpaceCheck {
  level: "ok" | "tight" | "insufficient" | "unknown";
  text: string;
}

/** Controlla se le foto entrano nel disco di destinazione; scrive il messaggio in parole semplici. */
export function checkSpace(neededBytes: number, freeBytes: number | null): SpaceCheck {
  if (freeBytes === null || !Number.isFinite(freeBytes)) return { level: "unknown", text: neededBytes > 0 ? `Servono circa ${formatBytes(neededBytes)}` : "" };
  const margin = Math.max(1_000_000_000, freeBytes * 0.02);
  if (neededBytes * 1.02 > freeBytes) {
    return { level: "insufficient", text: `Servono circa ${formatBytes(neededBytes)} ma sul disco ce ne sono solo ${formatBytes(freeBytes)} liberi: libera spazio o scegli un'altra cartella base.` };
  }
  if (freeBytes - neededBytes < margin) {
    return { level: "tight", text: `Servono circa ${formatBytes(neededBytes)} e restano ${formatBytes(freeBytes - neededBytes)} liberi: il disco si riempie quasi del tutto.` };
  }
  return { level: "ok", text: `Servono circa ${formatBytes(neededBytes)}, ne hai ${formatBytes(freeBytes)} liberi.` };
}

export interface ArchivedChoice {
  count: number;
  bytes: number;
  /** "in «Evento 1»", "in 2 lavori diversi" oppure vuoto se il lavoro non e' noto. */
  where: string;
}

/** Riassume le foto gia' in archivio tra quelle da importare, citando il lavoro se e' uno solo. */
export function summarizeArchived(archived: ReadonlyArray<{ filePath: string; jobName: string | null; size?: number }>, selectedPaths: ReadonlySet<string> | null): ArchivedChoice | null {
  const relevant = selectedPaths ? archived.filter((entry) => selectedPaths.has(entry.filePath)) : [...archived];
  if (relevant.length === 0) return null;
  const jobs = new Set(relevant.map((entry) => entry.jobName).filter((name): name is string => Boolean(name)));
  const where = jobs.size === 1 && relevant.every((entry) => entry.jobName) ? `in «${[...jobs][0]}»` : jobs.size > 1 ? `in ${jobs.size} lavori diversi` : "";
  return { count: relevant.length, bytes: relevant.reduce((total, entry) => total + (entry.size ?? 0), 0), where };
}

// ── Importazione interrotta: riprendere dalla scheda ─────────────────────────

export interface ResumableLike {
  id: string;
  sourceRoot: string;
  status: string;
  plannedFiles: number;
  verifiedFiles: number;
  updatedAt: number;
}

const RESUMABLE_STATUSES = new Set(["PAUSED", "INTERRUPTED", "FAILED"]);
const RESUME_MAX_AGE_MS = 14 * 24 * 3_600_000;

function samePath(a: string, b: string): boolean {
  const normalize = (value: string) => value.replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase();
  return normalize(a) === normalize(b);
}

/**
 * L'importazione interrotta piu' recente di QUESTA scheda, se c'e' ancora qualcosa da copiare.
 * Ignora le sessioni di altre schede, quelle finite e quelle troppo vecchie per essere ancora utili.
 */
export function findResumableSession<T extends ResumableLike>(sessions: readonly T[], sdPath: string, now: number = Date.now()): T | null {
  const candidates = sessions.filter((session) => RESUMABLE_STATUSES.has(session.status)
    && samePath(session.sourceRoot, sdPath)
    && session.plannedFiles > 0
    && session.verifiedFiles < session.plannedFiles
    && now - session.updatedAt <= RESUME_MAX_AGE_MS);
  return candidates.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
}

function relativeDay(timestamp: number, now: number): string {
  const startOfDay = (value: number) => { const date = new Date(value); date.setHours(0, 0, 0, 0); return date.getTime(); };
  const days = Math.round((startOfDay(now) - startOfDay(timestamp)) / 86_400_000);
  if (days <= 0) return "di oggi";
  if (days === 1) return "di ieri";
  return `di ${days} giorni fa`;
}

export function describeInterrupted(session: ResumableLike, now: number = Date.now()): string {
  const done = session.verifiedFiles.toLocaleString("it-IT");
  const planned = session.plannedFiles.toLocaleString("it-IT");
  return `L'importazione ${relativeDay(session.updatedAt, now)} si è fermata a ${done} file su ${planned}.`;
}

/** Frase per la riga di scelte rapide: "1 foto è già in archivio (in «Evento 1»)". */
export function describeArchivedNote(choice: ArchivedChoice): string {
  const count = choice.count.toLocaleString("it-IT");
  const where = choice.where ? ` (${choice.where})` : "";
  return choice.count === 1 ? `1 foto è già in archivio${where}` : `${count} foto sono già in archivio${where}`;
}

// ── Percorsi, tempi e tastiera ───────────────────────────────────────────────

/** Ultimi elementi di un percorso Windows o POSIX, con "…" davanti se e' stato accorciato. */
export function shortPath(path: string, segments = 3): string {
  const separator = path.includes("\\") ? "\\" : "/";
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (parts.length <= segments) return path;
  return `…${separator}${parts.slice(-segments).join(separator)}`;
}

/** Durata effettiva di un'importazione, in parole: "14 minuti", "1 ora e 5 minuti". */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return "meno di un minuto";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes === 1 ? "1 minuto" : `${minutes} minuti`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourText = hours === 1 ? "1 ora" : `${hours} ore`;
  return rest === 0 ? hourText : `${hourText} e ${rest} ${rest === 1 ? "minuto" : "minuti"}`;
}

/** Il suggerimento su Maiusc compare con una sola foto scelta, finche' non lo si e' usato. */
export function shouldShowShiftTip(selectedCount: number, alreadyUsed: boolean): boolean {
  return selectedCount === 1 && !alreadyUsed;
}

export interface GridPosition { row: number; col: number }

/**
 * Sposta il cursore nella griglia con le frecce, saltando le intestazioni dei giorni.
 * Sinistra/destra passano alla riga precedente/successiva; su/giu' mantengono la colonna quando possibile.
 */
export function moveGridFocus(rows: ReadonlyArray<{ header: boolean; files: readonly unknown[] }>, from: GridPosition, key: string): GridPosition {
  const photoRows: number[] = [];
  rows.forEach((row, index) => { if (!row.header && row.files.length > 0) photoRows.push(index); });
  const at = photoRows.indexOf(from.row);
  if (at === -1 || photoRows.length === 0) return from;
  const lastCol = (rowIndex: number) => rows[rowIndex]!.files.length - 1;
  const toRow = (position: number, col: number): GridPosition => {
    const clamped = Math.max(0, Math.min(photoRows.length - 1, position));
    const row = photoRows[clamped]!;
    return { row, col: Math.min(col, lastCol(row)) };
  };
  switch (key) {
    case "ArrowLeft": return from.col > 0 ? { row: from.row, col: from.col - 1 } : at > 0 ? { row: photoRows[at - 1]!, col: lastCol(photoRows[at - 1]!) } : from;
    case "ArrowRight": return from.col < lastCol(from.row) ? { row: from.row, col: from.col + 1 } : at < photoRows.length - 1 ? { row: photoRows[at + 1]!, col: 0 } : from;
    case "ArrowUp": return at > 0 ? toRow(at - 1, from.col) : from;
    case "ArrowDown": return at < photoRows.length - 1 ? toRow(at + 1, from.col) : from;
    case "PageUp": return toRow(at - 3, from.col);
    case "PageDown": return toRow(at + 3, from.col);
    case "Home": return { row: photoRows[0]!, col: 0 };
    case "End": return { row: photoRows[photoRows.length - 1]!, col: lastCol(photoRows[photoRows.length - 1]!) };
    default: return from;
  }
}

// ── Stato della scheda, annullamento, anteprima grande ───────────────────────

export interface CardStatus {
  level: "all" | "almost" | "mostly";
  text: string;
}

/**
 * Avviso in cima alla scelta delle foto quando la scheda e' (quasi) tutta gia' in archivio:
 * evita di accorgersene solo scorrendo le tessere in grigio.
 */
export function describeCardStatus(total: number, archived: ArchivedChoice | null): CardStatus | null {
  if (!archived || total <= 0 || archived.count <= 0) return null;
  const ratio = archived.count / total;
  const where = archived.where ? ` ${archived.where}` : "";
  if (archived.count >= total) return { level: "all", text: `Questa scheda sembra già scaricata: tutte le ${total.toLocaleString("it-IT")} foto e i video sono già in archivio${where}. Non serve importarli di nuovo.` };
  if (ratio >= 0.9) return { level: "almost", text: `Questa scheda è quasi tutta già scaricata: ${archived.count.toLocaleString("it-IT")} su ${total.toLocaleString("it-IT")} sono già in archivio${where}.` };
  if (ratio >= 0.5) return { level: "mostly", text: `Più della metà di questa scheda (${archived.count.toLocaleString("it-IT")} su ${total.toLocaleString("it-IT")}) è già in archivio${where}.` };
  return null;
}

/** Cosa dire dopo che l'utente ha fermato l'importazione: niente si perde e come si prosegue. */
export function describeCancelled(copied: number, planned: number): string {
  if (copied <= 0) return "Importazione fermata. Non ho copiato nessuna foto: puoi ricominciare quando vuoi.";
  const remaining = Math.max(0, planned - copied);
  const left = remaining > 0 ? `, ne mancano ${remaining.toLocaleString("it-IT")}` : "";
  const done = copied === 1 ? "La foto già copiata resta" : `Le ${copied.toLocaleString("it-IT")} foto già copiate restano`;
  return `Importazione fermata. ${done} al loro posto${left}. Se rifai la stessa importazione nello stesso lavoro, salto quelle già copiate.`;
}

export type LightboxView = "full" | "progressive" | "thumb-fallback" | "loading" | "error";

/** Cosa mostra l'ingrandimento: la foto grande, la miniatura mentre arriva quella grande, o solo l'attesa. */
export function lightboxView(status: "loading" | "error" | "ready", hasFull: boolean, hasThumb: boolean): LightboxView {
  if (status === "ready" && hasFull) return "full";
  if (status === "error") return hasThumb ? "thumb-fallback" : "error";
  return hasThumb ? "progressive" : "loading";
}

// ── Piu' schede inserite ─────────────────────────────────────────────────────

export function describeCard(card: { path: string; volumeName?: string; totalSize?: number }): string {
  const drive = card.path.replace(/[\\/]+$/, "");
  const name = card.volumeName?.trim() || "Scheda";
  return card.totalSize && card.totalSize > 0 ? `${name} (${drive}) · ${formatBytes(card.totalSize)}` : `${name} (${drive})`;
}

/**
 * Passa da solo a una scheda appena inserita soltanto se non se ne sta gia' usando un'altra:
 * con due lettori collegati non si deve perdere la scelta fatta a meta'.
 */
export function shouldSwitchToNewCard(state: { hasActive: boolean; activePresent: boolean; hasNewCard: boolean }): boolean {
  return state.hasNewCard && (!state.hasActive || !state.activePresent);
}

// ── Ultime importazioni ──────────────────────────────────────────────────────

export interface SessionLike {
  id: string;
  jobId: string | null;
  sourceRoot: string;
  destinationRoot: string;
  status: string;
  updatedAt: number;
  completedAt: number | null;
  verifiedFiles: number;
}

export interface RecentImport {
  id: string;
  jobName: string | null;
  files: number;
  when: string;
  folder: string;
  at: number;
}

export function describeWhen(timestamp: number, now: number = Date.now()): string {
  const startOfDay = (value: number) => { const date = new Date(value); date.setHours(0, 0, 0, 0); return date.getTime(); };
  const days = Math.round((startOfDay(now) - startOfDay(timestamp)) / 86_400_000);
  const time = new Date(timestamp).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  if (days <= 0) return `oggi alle ${time}`;
  if (days === 1) return `ieri alle ${time}`;
  return `${new Date(timestamp).toLocaleDateString("it-IT", { day: "numeric", month: "long" })} alle ${time}`;
}

/** Le importazioni concluse piu' recenti, con il nome del lavoro e la cartella da aprire. */
export function recentImports(sessions: readonly SessionLike[], jobs: ReadonlyArray<{ id: string; nomeLavoro: string }>, limit = 6, now: number = Date.now()): RecentImport[] {
  return sessions
    .filter((session) => session.status === "COMPLETED" && session.verifiedFiles > 0)
    .map((session) => ({ session, at: session.completedAt ?? session.updatedAt }))
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map(({ session, at }) => ({
      id: session.id,
      jobName: jobs.find((job) => job.id === session.jobId)?.nomeLavoro ?? null,
      files: session.verifiedFiles,
      when: describeWhen(at, now),
      folder: session.destinationRoot,
      at,
    }));
}

// ── Barra laterale ───────────────────────────────────────────────────────────

export type NavId = "import" | "archive" | "drive" | "backup" | "settings" | "exit";

/** Le schermate a domande (passi 2-4) sono "il percorso": li' si vedono solo le voci utili. */
export function isGuidedFlow(screen: string): boolean {
  return screen === "nuovo";
}

export function visibleNavItems(inGuidedFlow: boolean): NavId[] {
  return inGuidedFlow ? ["import", "archive", "exit"] : ["import", "archive", "drive", "backup", "settings"];
}

/** La barra parte stretta (solo icone) finche' l'utente non la allarga: la scelta si ricorda con una chiave nuova. */
export function initialSidebarCollapsed(stored: string | null): boolean {
  return stored === null ? true : stored === "true";
}
