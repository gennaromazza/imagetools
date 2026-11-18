/** Cronologia annulla/ripeti generica e immutabile. */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export const HISTORY_LIMIT = 100;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

export function pushHistory<T>(history: History<T>, next: T): History<T> {
  if (Object.is(next, history.present)) return history;
  return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

/** Sostituisce lo stato corrente senza creare un passo annullabile (es. cambio progetto o ricarica). */
export function resetHistory<T>(history: History<T>, present: T): History<T> {
  return { ...history, past: [], present, future: [] };
}

export const canUndo = <T>(history: History<T>) => history.past.length > 0;
export const canRedo = <T>(history: History<T>) => history.future.length > 0;

export function undo<T>(history: History<T>): History<T> {
  if (!canUndo(history)) return history;
  const previous = history.past[history.past.length - 1];
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redo<T>(history: History<T>): History<T> {
  if (!canRedo(history)) return history;
  const [next, ...rest] = history.future;
  return { past: [...history.past, history.present], present: next, future: rest };
}

/** Applica la stessa trasformazione a ogni stato (passato, presente e futuro): per cambiamenti che nessun annulla deve far tornare indietro. */
export function mapHistory<T>(history: History<T>, transform: (state: T) => T): History<T> {
  return { past: history.past.map(transform), present: transform(history.present), future: history.future.map(transform) };
}

/** Sostituisce lo stato corrente mantenendo la cronologia: serve a fondere modifiche continue (slider, rotella). */
export function replacePresent<T>(history: History<T>, next: T): History<T> {
  return Object.is(next, history.present) ? history : { ...history, present: next, future: [] };
}
