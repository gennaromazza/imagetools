import type { TextStyleSpec } from "@photo-tools/shared-types";
import { newId } from "./ids";
import { TEXT_LIMITS, sanitizeTextStyle } from "./typography";

/**
 * Il tuo archivio di frasi e di stili di testo, valido per tutti gli album (sta nel salvataggio locale del programma).
 * Le frasi di partenza sono esempi in italiano: si modificano e si cancellano come le tue.
 */

export interface Phrase {
  id: string;
  text: string;
  /** Raggruppa le frasi nell'elenco (es. «Matrimonio», «Viaggio»). */
  group: string;
  /** Nome dello stile da usare quando la inserisci, se ne hai scelto uno. */
  styleName?: string;
}

export interface SavedTextStyle {
  id: string;
  name: string;
  style: TextStyleSpec;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const LIBRARY_KEYS = {
  phrases: "filex.albumFlow.v2.phrases",
  styles: "filex.albumFlow.v2.textStyles",
  /** Versione delle frasi di partenza già unite alla tua libreria. */
  seedVersion: "filex.albumFlow.v2.phrasesSeedVersion",
} as const;

/** Sale quando si aggiungono frasi di partenza: chi ha già una libreria le riceve una sola volta, senza perdere né far riapparire nulla. */
export const SEED_VERSION = 2;

export const MAX_PHRASES = 500;
export const MAX_SAVED_STYLES = 100;

const BASE_SEED_PHRASES: readonly Omit<Phrase, "id">[] = [
  { group: "Matrimonio", text: "Il giorno più bello" },
  { group: "Matrimonio", text: "Per sempre inizia oggi" },
  { group: "Matrimonio", text: "Sì, lo voglio" },
  { group: "Matrimonio", text: "Insieme, da questo momento" },
  { group: "Matrimonio", text: "Save the date" },
  { group: "Matrimonio", text: "Il nostro amore, in un giorno" },
  { group: "Famiglia", text: "Casa è dove siamo insieme" },
  { group: "Famiglia", text: "Piccoli passi, grandi ricordi" },
  { group: "Famiglia", text: "Radici e ali" },
  { group: "Famiglia", text: "Le cose che contano davvero" },
  { group: "Viaggio", text: "Ovunque, purché insieme" },
  { group: "Viaggio", text: "Strade, luce, ricordi" },
  { group: "Viaggio", text: "Il mondo ha ancora tanto da mostrarci" },
  { group: "Titoli", text: "Capitolo primo" },
  { group: "Titoli", text: "Indice" },
  { group: "Titoli", text: "Grazie" },
];

/** Frasi aggiunte nella versione 2: matrimonio, in stile editoriale. */
export const NEW_SEED_PHRASES: readonly Omit<Phrase, "id">[] = [
  { group: "Matrimonio", text: "Due cuori, una sola strada" },
  { group: "Matrimonio", text: "Oggi diciamo sì al nostro per sempre" },
  { group: "Matrimonio", text: "Un giorno, mille emozioni" },
  { group: "Matrimonio", text: "L'amore ha deciso di restare" },
  { group: "Matrimonio", text: "Mano nella mano, per tutta la vita" },
  { group: "Matrimonio", text: "Eravamo noi, da sempre" },
  { group: "Matrimonio", text: "Il sì più bello" },
  { group: "Matrimonio", text: "Ci siamo scelti" },
  { group: "Cerimonia", text: "Il silenzio prima del sì" },
  { group: "Cerimonia", text: "Le promesse" },
  { group: "Cerimonia", text: "Gli sguardi dicono tutto" },
  { group: "Cerimonia", text: "Un bacio, e il resto sparisce" },
  { group: "Cerimonia", text: "Pronti per il grande passo" },
  { group: "Cerimonia", text: "Le lacrime che non si nascondono" },
  { group: "Cerimonia", text: "Dal sì all'eternità" },
  { group: "Cerimonia", text: "Applausi, riso e petali al vento" },
  { group: "Festa", text: "Si brinda all'amore" },
  { group: "Festa", text: "Il primo ballo" },
  { group: "Festa", text: "Balliamo finché c'è musica" },
  { group: "Festa", text: "Tutti a tavola" },
  { group: "Festa", text: "Il taglio della torta" },
  { group: "Festa", text: "La festa è appena iniziata" },
  { group: "Festa", text: "Risate che si sentono da lontano" },
  { group: "Festa", text: "Un brindisi a noi" },
  { group: "Dettagli", text: "Le mani" },
  { group: "Dettagli", text: "Gli anelli" },
  { group: "Dettagli", text: "Il bouquet" },
  { group: "Dettagli", text: "L'abito, il velo, l'attesa" },
  { group: "Dettagli", text: "Piccole cose, grandi emozioni" },
  { group: "Dettagli", text: "Il dettaglio che resta" },
  { group: "Dettagli", text: "Fiori, luce e carta" },
  { group: "Dettagli", text: "Le scarpe, il profumo, i gioielli" },
  { group: "Ringraziamenti", text: "Grazie di cuore" },
  { group: "Ringraziamenti", text: "Grazie per averci accompagnato" },
  { group: "Ringraziamenti", text: "Con tutto l'amore che abbiamo" },
  { group: "Ringraziamenti", text: "Ai nostri genitori" },
  { group: "Ringraziamenti", text: "Agli amici di sempre" },
  { group: "Ringraziamenti", text: "Per averci fatto sentire a casa" },
  { group: "Capitoli", text: "La storia" },
  { group: "Capitoli", text: "I dettagli" },
  { group: "Capitoli", text: "Gli ospiti" },
  { group: "Capitoli", text: "Il ritratto di coppia" },
  { group: "Capitoli", text: "Prima del sì" },
  { group: "Capitoli", text: "Dopo il sì" },
  { group: "Capitoli", text: "Gli ultimi scatti" },
];

export const SEED_PHRASES: readonly Omit<Phrase, "id">[] = [...BASE_SEED_PHRASES, ...NEW_SEED_PHRASES];

function readJson<T>(storage: KeyValueStorage, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

const defaultStorage = (): KeyValueStorage | null => {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
};

/** Aggiunge alla tua libreria le frasi di partenza nuove (quelle che non hai già), una volta sola per versione. */
function withNewSeeds(phrases: Phrase[], storage: KeyValueStorage | null): Phrase[] {
  if (!storage) return phrases;
  let version = 0;
  try { version = Number(storage.getItem(LIBRARY_KEYS.seedVersion)) || 0; } catch { /* come se mancasse */ }
  if (version >= SEED_VERSION) return phrases;
  const known = new Set(phrases.map((phrase) => `${phrase.group}|${phrase.text}`));
  const fresh = NEW_SEED_PHRASES
    .map((phrase, index) => ({ ...phrase, id: `seed-v2-${index}` }))
    .filter((phrase) => !known.has(`${phrase.group}|${phrase.text}`));
  const merged = [...phrases, ...fresh].slice(0, MAX_PHRASES);
  savePhrases(merged, storage);
  return merged;
}

export function loadPhrases(storage: KeyValueStorage | null = defaultStorage()): Phrase[] {
  const stored = storage ? readJson<unknown>(storage, LIBRARY_KEYS.phrases) : null;
  if (!Array.isArray(stored)) return SEED_PHRASES.map((phrase, index) => ({ ...phrase, id: `seed-${index}` }));
  return withNewSeeds(stored.flatMap((entry): Phrase[] => {
    const value = entry as Partial<Phrase> | null;
    if (!value || typeof value.text !== "string" || !value.text.trim() || typeof value.id !== "string") return [];
    return [{ id: value.id, text: value.text.slice(0, TEXT_LIMITS.textLength), group: typeof value.group === "string" && value.group.trim() ? value.group.trim().slice(0, 40) : "Le mie", ...(typeof value.styleName === "string" ? { styleName: value.styleName.slice(0, 60) } : {}) }];
  }).slice(0, MAX_PHRASES), storage);
}

export function savePhrases(phrases: readonly Phrase[], storage: KeyValueStorage | null = defaultStorage()): boolean {
  try {
    storage?.setItem(LIBRARY_KEYS.phrases, JSON.stringify(phrases.slice(0, MAX_PHRASES)));
    // Chi salva la libreria l'ha già vista com'è: le frasi di partenza nuove non devono ricomparire dopo una cancellazione.
    storage?.setItem(LIBRARY_KEYS.seedVersion, String(SEED_VERSION));
    return Boolean(storage);
  } catch { return false; }
}

export function addPhrase(phrases: readonly Phrase[], text: string, group = "Le mie", styleName?: string): Phrase[] {
  const clean = text.trim();
  if (!clean || phrases.length >= MAX_PHRASES) return [...phrases];
  if (phrases.some((phrase) => phrase.text === clean && phrase.group === group)) return [...phrases];
  return [...phrases, { id: newId("ph"), text: clean.slice(0, TEXT_LIMITS.textLength), group: group.trim().slice(0, 40) || "Le mie", ...(styleName ? { styleName } : {}) }];
}

export function updatePhrase(phrases: readonly Phrase[], id: string, patch: Partial<Pick<Phrase, "text" | "group" | "styleName">>): Phrase[] {
  return phrases.map((phrase) => {
    if (phrase.id !== id) return phrase;
    const text = patch.text !== undefined ? patch.text.trim().slice(0, TEXT_LIMITS.textLength) : phrase.text;
    return { ...phrase, text: text || phrase.text, group: patch.group !== undefined ? patch.group.trim().slice(0, 40) || phrase.group : phrase.group, ...(patch.styleName !== undefined ? { styleName: patch.styleName || undefined } : {}) };
  });
}

export const removePhrase = (phrases: readonly Phrase[], id: string): Phrase[] => phrases.filter((phrase) => phrase.id !== id);

export function phraseGroups(phrases: readonly Phrase[]): string[] {
  return [...new Set(phrases.map((phrase) => phrase.group))].sort((a, b) => a.localeCompare(b, "it"));
}

export function loadSavedStyles(storage: KeyValueStorage | null = defaultStorage()): SavedTextStyle[] {
  const stored = storage ? readJson<unknown>(storage, LIBRARY_KEYS.styles) : null;
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((entry): SavedTextStyle[] => {
    const value = entry as Partial<SavedTextStyle> | null;
    if (!value || typeof value.id !== "string" || typeof value.name !== "string" || !value.name.trim() || !value.style) return [];
    return [{ id: value.id, name: value.name.trim().slice(0, 60), style: sanitizeTextStyle(value.style) }];
  }).slice(0, MAX_SAVED_STYLES);
}

export function saveSavedStyles(styles: readonly SavedTextStyle[], storage: KeyValueStorage | null = defaultStorage()): boolean {
  try { storage?.setItem(LIBRARY_KEYS.styles, JSON.stringify(styles.slice(0, MAX_SAVED_STYLES))); return Boolean(storage); } catch { return false; }
}

/** Salva uno stile con un nome; con lo stesso nome lo sostituisce. */
export function upsertSavedStyle(styles: readonly SavedTextStyle[], name: string, style: TextStyleSpec): SavedTextStyle[] {
  const clean = name.trim().slice(0, 60);
  if (!clean) return [...styles];
  const entry: SavedTextStyle = { id: styles.find((candidate) => candidate.name.toLowerCase() === clean.toLowerCase())?.id ?? newId("st"), name: clean, style: sanitizeTextStyle(style) };
  const others = styles.filter((candidate) => candidate.id !== entry.id);
  return [...others, entry].slice(0, MAX_SAVED_STYLES);
}

export const removeSavedStyle = (styles: readonly SavedTextStyle[], id: string): SavedTextStyle[] => styles.filter((style) => style.id !== id);
