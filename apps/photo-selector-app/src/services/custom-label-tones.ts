/**
 * Colori delle etichette personalizzate condivisi tra PC.
 *
 * Le foto portano soltanto il NOME dell'etichetta; colore e scorciatoia sono
 * preferenze locali. Per non far cambiare aspetto alla stessa cartella da un PC
 * all'altro, il colore viene scritto anche nei sidecar XMP delle foto etichettate
 * e riletto all'apertura. Regole:
 *  - il colore definito sul PC ha sempre la precedenza (e segnala un conflitto);
 *  - per le etichette sconosciute al PC vale il colore della cartella;
 *  - le scorciatoie restano personali e non vengono mai importate.
 */

export type LabelTone = "sand" | "rose" | "green" | "blue" | "purple" | "slate";

const VALID_TONES: ReadonlySet<string> = new Set(["sand", "rose", "green", "blue", "purple", "slate"]);

export interface LabelToneConflict {
  label: string;
  localTone: LabelTone;
  folderTone: LabelTone;
}

export function isLabelTone(value: unknown): value is LabelTone {
  return typeof value === "string" && VALID_TONES.has(value);
}

export function labelToneKey(label: string): string {
  return label.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function findLocalTone(local: Readonly<Record<string, string>>, label: string): LabelTone | null {
  const key = labelToneKey(label);
  for (const [name, tone] of Object.entries(local)) {
    if (labelToneKey(name) === key && isLabelTone(tone)) {
      return tone;
    }
  }
  return null;
}

/**
 * Unisce i colori letti dai sidecar. Se lo stesso nome ha colori diversi nella
 * cartella vince quello più frequente (a parità, il primo incontrato).
 */
export function mergeFolderLabelTones(
  records: ReadonlyArray<Readonly<Record<string, string>> | undefined>,
  local: Readonly<Record<string, string>>,
): { folderTones: Map<string, { label: string; tone: LabelTone }>; conflicts: LabelToneConflict[] } {
  const votes = new Map<string, { label: string; counts: Map<LabelTone, number>; order: LabelTone[] }>();
  for (const record of records) {
    if (!record) continue;
    for (const [label, tone] of Object.entries(record)) {
      if (!isLabelTone(tone)) continue;
      const key = labelToneKey(label);
      if (!key) continue;
      const entry = votes.get(key) ?? { label, counts: new Map<LabelTone, number>(), order: [] as LabelTone[] };
      if (!entry.counts.has(tone)) entry.order.push(tone);
      entry.counts.set(tone, (entry.counts.get(tone) ?? 0) + 1);
      votes.set(key, entry);
    }
  }

  const folderTones = new Map<string, { label: string; tone: LabelTone }>();
  const conflicts: LabelToneConflict[] = [];
  for (const [key, entry] of votes) {
    let best = entry.order[0];
    for (const tone of entry.order) {
      if ((entry.counts.get(tone) ?? 0) > (entry.counts.get(best) ?? 0)) best = tone;
    }
    folderTones.set(key, { label: entry.label, tone: best });
    const localTone = findLocalTone(local, entry.label);
    if (localTone && localTone !== best) {
      conflicts.push({ label: entry.label, localTone, folderTone: best });
    }
  }
  return { folderTones, conflicts };
}

/** Colore effettivo: locale se definito, altrimenti quello della cartella. */
export function resolveLabelTone(
  label: string,
  local: Readonly<Record<string, string>>,
  folderTones: ReadonlyMap<string, { label: string; tone: LabelTone }>,
): LabelTone | null {
  return findLocalTone(local, label) ?? folderTones.get(labelToneKey(label))?.tone ?? null;
}

// ── Stato di sessione: colori della cartella aperta ─────────────────────────
let currentFolderTones: ReadonlyMap<string, { label: string; tone: LabelTone }> = new Map();
const listeners = new Set<() => void>();

export function getFolderLabelTones(): ReadonlyMap<string, { label: string; tone: LabelTone }> {
  return currentFolderTones;
}

export function setFolderLabelTones(next: ReadonlyMap<string, { label: string; tone: LabelTone }>): void {
  currentFolderTones = next;
  for (const listener of Array.from(listeners)) listener();
}

export function subscribeFolderLabelTones(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
