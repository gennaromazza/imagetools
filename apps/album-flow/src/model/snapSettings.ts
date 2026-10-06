/**
 * Calamite (aggancio a bordi, centri e piega) accese o spente: un'impostazione di chi lavora, ricordata tra una sessione e l'altra.
 * Vale per le foto delle disposizioni libere e per i testi e le grafiche. Di base è accesa.
 */

const KEY = "filex.albumFlow.snapEnabled";
const listeners = new Set<() => void>();

function read(): boolean {
  try { return localStorage.getItem(KEY) !== "0"; } catch { return true; }
}

let enabled = read();

export const getSnapEnabled = (): boolean => enabled;

export function setSnapEnabled(on: boolean): void {
  enabled = on;
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* preferenza non salvata */ }
  listeners.forEach((listener) => listener());
}

export function subscribeSnap(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
