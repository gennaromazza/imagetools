/**
 * Diagnostica prestazioni, solo locale.
 *
 * Registra dati tecnici (scatti dell'interfaccia durante lo scroll, long task,
 * caratteristiche del PC) in memoria e li espone in un file JSON che l'utente
 * può esportare a mano. Non scrive su disco, non usa la rete e non contiene
 * nomi di file, percorsi o contenuto delle foto.
 */

const ENABLED_STORAGE_KEY = "photoSelector.perfDiagnostics.enabled";
const MAX_LONG_TASKS = 200;
const MAX_SCROLL_SESSIONS = 100;
const SCROLL_IDLE_MS = 350;
const WHEEL_ATTRIBUTION_MS = 150;
const FRAME_JANK_MS = 50;
const FRAME_FREEZE_MS = 100;

export type ScrollInputKind = "wheel" | "other";

export interface LongTaskEntry {
  atMs: number;
  durationMs: number;
}

export interface ScrollSession {
  startedAtMs: number;
  durationMs: number;
  input: ScrollInputKind;
  scrollEvents: number;
  frames: number;
  jankFrames: number;
  freezeFrames: number;
  maxFrameMs: number;
  p95FrameMs: number;
}

export interface FrameStats {
  frames: number;
  jankFrames: number;
  freezeFrames: number;
  maxFrameMs: number;
  p95FrameMs: number;
}

/** Statistiche sugli intervalli tra frame consecutivi (in ms). */
export function summarizeFrameDeltas(deltas: readonly number[]): FrameStats {
  if (deltas.length === 0) {
    return { frames: 0, jankFrames: 0, freezeFrames: 0, maxFrameMs: 0, p95FrameMs: 0 };
  }
  const sorted = [...deltas].sort((left, right) => left - right);
  const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return {
    frames: deltas.length,
    jankFrames: deltas.filter((delta) => delta > FRAME_JANK_MS).length,
    freezeFrames: deltas.filter((delta) => delta > FRAME_FREEZE_MS).length,
    maxFrameMs: Math.round(sorted[sorted.length - 1] ?? 0),
    p95FrameMs: Math.round(sorted[p95Index] ?? 0),
  };
}

export interface PerfDiagnosticsReport {
  schemaVersion: 1;
  generatedAt: string;
  environment: Record<string, unknown>;
  context: Record<string, unknown>;
  summary: {
    scrollSessions: number;
    wheelSessions: number;
    otherSessions: number;
    wheelFreezeFrames: number;
    otherFreezeFrames: number;
    wheelWorstFrameMs: number;
    otherWorstFrameMs: number;
    longTasks: number;
    longTasksOver200Ms: number;
  };
  scrollSessions: ScrollSession[];
  longTasks: LongTaskEntry[];
}

const longTasks: LongTaskEntry[] = [];
const scrollSessions: ScrollSession[] = [];

let started = false;
let lastWheelAt = -Infinity;
let activeSession: {
  startedAt: number;
  input: ScrollInputKind;
  scrollEvents: number;
  lastEventAt: number;
  deltas: number[];
  lastFrameAt: number | null;
  rafId: number | null;
  idleTimer: number | null;
} | null = null;

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function isPerfDiagnosticsEnabled(): boolean {
  try {
    return window.localStorage.getItem(ENABLED_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setPerfDiagnosticsEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(ENABLED_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // Preferenza non persistibile: vale solo per questa sessione.
  }
  if (!enabled) {
    stopActiveSession();
    longTasks.length = 0;
    scrollSessions.length = 0;
  }
}

function pushBounded<T>(list: T[], item: T, max: number): void {
  list.push(item);
  if (list.length > max) {
    list.splice(0, list.length - max);
  }
}

/** Da chiamare una volta all'avvio dell'app. */
export function startPerfDiagnostics(): void {
  if (started || typeof window === "undefined") {
    return;
  }
  started = true;

  window.addEventListener("wheel", () => {
    lastWheelAt = now();
  }, { passive: true, capture: true });

  try {
    const observer = new PerformanceObserver((list) => {
      if (!isPerfDiagnosticsEnabled()) {
        return;
      }
      for (const entry of list.getEntries()) {
        pushBounded(longTasks, {
          atMs: Math.round(entry.startTime),
          durationMs: Math.round(entry.duration),
        }, MAX_LONG_TASKS);
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
  } catch {
    // longtask non supportato: restano comunque le sessioni di scroll.
  }
}

function stopActiveSession(): void {
  if (!activeSession) {
    return;
  }
  if (activeSession.rafId !== null) {
    window.cancelAnimationFrame(activeSession.rafId);
  }
  if (activeSession.idleTimer !== null) {
    window.clearTimeout(activeSession.idleTimer);
  }
  activeSession = null;
}

function finishSession(): void {
  const session = activeSession;
  if (!session) {
    return;
  }
  const endedAt = session.lastEventAt;
  stopActiveSession();
  const stats = summarizeFrameDeltas(session.deltas);
  pushBounded(scrollSessions, {
    startedAtMs: Math.round(session.startedAt),
    durationMs: Math.round(endedAt - session.startedAt),
    input: session.input,
    scrollEvents: session.scrollEvents,
    ...stats,
  }, MAX_SCROLL_SESSIONS);
}

function sampleFrame(timestamp: number): void {
  const session = activeSession;
  if (!session) {
    return;
  }
  if (session.lastFrameAt !== null) {
    session.deltas.push(timestamp - session.lastFrameAt);
  }
  session.lastFrameAt = timestamp;
  session.rafId = window.requestAnimationFrame(sampleFrame);
}

/** Da chiamare a ogni evento di scroll della griglia. */
export function notePerfScrollEvent(): void {
  if (!started || !isPerfDiagnosticsEnabled()) {
    return;
  }
  const at = now();
  if (!activeSession) {
    activeSession = {
      startedAt: at,
      input: at - lastWheelAt <= WHEEL_ATTRIBUTION_MS ? "wheel" : "other",
      scrollEvents: 0,
      lastEventAt: at,
      deltas: [],
      lastFrameAt: null,
      rafId: null,
      idleTimer: null,
    };
    activeSession.rafId = window.requestAnimationFrame(sampleFrame);
  } else if (at - lastWheelAt <= WHEEL_ATTRIBUTION_MS) {
    activeSession.input = "wheel";
  }
  activeSession.scrollEvents += 1;
  activeSession.lastEventAt = at;
  if (activeSession.idleTimer !== null) {
    window.clearTimeout(activeSession.idleTimer);
  }
  activeSession.idleTimer = window.setTimeout(finishSession, SCROLL_IDLE_MS);
}

function collectEnvironment(): Record<string, unknown> {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const memory = (performance as Performance & {
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
  }).memory;
  return {
    platform: nav.platform,
    userAgent: nav.userAgent,
    logicalCores: nav.hardwareConcurrency ?? null,
    deviceMemoryGbCapped: nav.deviceMemory ?? null,
    devicePixelRatio: window.devicePixelRatio,
    screen: { width: window.screen.width, height: window.screen.height },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    jsHeap: memory
      ? {
          usedMb: Math.round(memory.usedJSHeapSize / 1048576),
          totalMb: Math.round(memory.totalJSHeapSize / 1048576),
          limitMb: Math.round(memory.jsHeapSizeLimit / 1048576),
        }
      : null,
  };
}

function sumBy(sessions: ScrollSession[], pick: (session: ScrollSession) => number): number {
  return sessions.reduce((total, session) => total + pick(session), 0);
}

/** Costruisce il report; `context` porta i dati noti alla UI (GPU, cartella, cache). */
export function buildPerfDiagnosticsReport(context: Record<string, unknown>): PerfDiagnosticsReport {
  const wheel = scrollSessions.filter((session) => session.input === "wheel");
  const other = scrollSessions.filter((session) => session.input === "other");
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: collectEnvironment(),
    context,
    summary: {
      scrollSessions: scrollSessions.length,
      wheelSessions: wheel.length,
      otherSessions: other.length,
      wheelFreezeFrames: sumBy(wheel, (session) => session.freezeFrames),
      otherFreezeFrames: sumBy(other, (session) => session.freezeFrames),
      wheelWorstFrameMs: Math.max(0, ...wheel.map((session) => session.maxFrameMs)),
      otherWorstFrameMs: Math.max(0, ...other.map((session) => session.maxFrameMs)),
      longTasks: longTasks.length,
      longTasksOver200Ms: longTasks.filter((task) => task.durationMs > 200).length,
    },
    scrollSessions: [...scrollSessions],
    longTasks: [...longTasks],
  };
}

/** Salva il report come file JSON tramite il download del browser. */
export function exportPerfDiagnosticsReport(context: Record<string, unknown>): string {
  const report = buildPerfDiagnosticsReport(context);
  const stamp = report.generatedAt.replace(/[-:]/g, "").slice(0, 13).replace("T", "-");
  const fileName = `image-select-diagnostica-${stamp}.json`;
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return fileName;
}
