import { STORY_LIBRARY, type StoryTone, type StoryUnit } from "../model/storyLibrary";
import { balance, normalizeText } from "./kit";
import type { SetId, SlideTemplate } from "./types";

/**
 * Suggerimenti di testo per i campi dei modelli, dalla stessa libreria editoriale che suggerisce i testi nei fotolibri
 * (originali, mai le citazioni d'autore con fonte da verificare). A ogni richiesta ne esce uno nuovo, mai uguale al testo di adesso
 * né a quelli già usati nel carosello.
 */

export type SuggestKind = "title" | "word" | "line" | "body";

const KIND_BY_KEY: Readonly<Record<string, SuggestKind>> = {
  title: "title", heading: "title", text: "title",
  script: "word", label: "word", top: "word", bottom: "word", word: "word",
  subtitle: "line", caption: "line", quote: "line", line: "line",
  body: "body",
};

/** Che genere di testo ci sta in quel campo; `null` per i campi personali (nomi, date, luoghi, pulsanti, elenchi). */
export function suggestKindOf(key: string): SuggestKind | null {
  return KIND_BY_KEY[key] ?? null;
}

const PREFERRED_TONES: Readonly<Record<SetId, readonly StoryTone[]>> = {
  editoriale: ["cinematic", "editorial", "elegant"],
  galleria: ["elegant", "poetic", "intimate"],
  moda: ["editorial", "minimal", "celebratory"],
  cinema: ["cinematic", "reflective", "poetic"],
};

interface Candidate { text: string; tone: StoryTone }
const pools = new Map<SuggestKind, Candidate[]>();

const words = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;
const flat = (value: string) => value.replace(/\s*\n+\s*/g, " ").trim();

function build(kind: SuggestKind): Candidate[] {
  const usable = STORY_LIBRARY.filter((unit: StoryUnit) => unit.original && !unit.needsSourceCheck);
  const out: Candidate[] = [];
  for (const unit of usable) {
    if (kind === "title" && unit.title && words(unit.title) >= 2 && words(unit.title) <= 4 && unit.title.length <= 30) out.push({ text: unit.title, tone: unit.tone });
    if (kind === "word") {
      if (unit.type === "microcopy" && unit.text && unit.text.length <= 18 && words(unit.text) <= 2) out.push({ text: unit.text, tone: unit.tone });
      else if (unit.title && words(unit.title) <= 2 && unit.title.length <= 18) out.push({ text: unit.title, tone: unit.tone });
    }
    if (kind === "line" && unit.type === "short" && unit.text) {
      const text = flat(unit.text);
      if (text.length >= 28 && text.length <= 96) out.push({ text, tone: unit.tone });
    }
    if (kind === "body" && (unit.type === "short" || unit.type === "medium") && unit.text) {
      const text = flat(unit.text);
      if (text.length >= 90 && text.length <= 230) out.push({ text, tone: unit.tone });
    }
  }
  const seen = new Set<string>();
  return out.filter((candidate) => (seen.has(normalizeText(candidate.text)) ? false : (seen.add(normalizeText(candidate.text)), true)));
}

function poolOf(kind: SuggestKind): Candidate[] {
  let pool = pools.get(kind);
  if (!pool) { pool = build(kind); pools.set(kind, pool); }
  return pool;
}

function hash(value: string): number {
  let h = 2166136261;
  for (let index = 0; index < value.length; index += 1) { h ^= value.charCodeAt(index); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export interface SuggestOptions {
  /** Dà un punto di partenza diverso a ogni campo (di solito l'id della slide e il campo). */
  seed: string;
  /** Quante proposte sono già state date: ogni clic su «Suggerisci» passa alla successiva. */
  attempt: number;
  current?: string;
  /** Testi (anche non normalizzati) già usati altrove nel carosello. */
  avoid?: ReadonlySet<string>;
  setId?: SetId;
  /** Il campo sta su più righe: un titolo si divide in due righe bilanciate. */
  multiline?: boolean;
}

export function suggestText(kind: SuggestKind, options: SuggestOptions): string | null {
  const pool = poolOf(kind);
  if (pool.length === 0) return null;
  const liked = new Set<StoryTone>(options.setId ? PREFERRED_TONES[options.setId] : []);
  const ordered = [...pool.filter((candidate) => liked.has(candidate.tone)), ...pool.filter((candidate) => !liked.has(candidate.tone))];
  const current = options.current ? normalizeText(options.current) : "";
  const taken = new Set([...(options.avoid ?? [])].map(normalizeText));
  const start = hash(options.seed) % ordered.length;
  for (let step = 0; step < ordered.length; step += 1) {
    const candidate = ordered[(start + options.attempt + step) % ordered.length];
    const key = normalizeText(candidate.text);
    if (key === current || taken.has(key)) continue;
    return kind === "title" && options.multiline ? balance(candidate.text, 11) : candidate.text;
  }
  return null;
}

/** Proposte per tutti i campi suggeribili di una slide, ciascuna diversa dalle altre e da ciò che c'è già nel carosello. */
export function suggestForTemplate(template: SlideTemplate, options: Omit<SuggestOptions, "seed" | "current" | "multiline"> & { slideId: string; texts: Readonly<Record<string, string>> }): Record<string, string> {
  const result: Record<string, string> = {};
  const avoid = new Set(options.avoid ?? []);
  for (const field of template.fields) {
    const kind = suggestKindOf(field.key);
    if (!kind) continue;
    const text = suggestText(kind, { seed: `${options.slideId}:${field.key}`, attempt: options.attempt, current: options.texts[field.key], avoid, setId: options.setId, multiline: field.multiline });
    if (!text) continue;
    result[field.key] = text;
    avoid.add(text);
  }
  return result;
}
