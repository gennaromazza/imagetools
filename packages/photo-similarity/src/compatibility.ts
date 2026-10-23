import { colorDistance, isMonochrome } from "./fingerprint";
import type { SimilarityPhoto } from "./types";

export interface CompatibilityContext {
  /** Foto già presenti sullo spread. */
  spreadPhotos: readonly SimilarityPhoto[];
  /** Momento di ogni foto (id della foto → id del momento). */
  momentOf: ReadonlyMap<string, string>;
}

export interface Suggestion {
  id: string;
  score: number;
  /** Motivi in parole semplici, dal più importante. */
  reasons: string[];
}

const NEAR_MS = 10 * 60_000;
const SAME_PART_MS = 60 * 60_000;
/** Sotto questa differenza di colore medio (ΔE) i toni si considerano simili. */
export const SIMILAR_TONES = 15;

/**
 * Ordina le foto candidate per quanto stanno bene con quelle già sullo spread: stesso momento, momento vicino,
 * bianco e nero o colore come lo spread, toni simili e, a parità, più stelle. Senza foto sullo spread non c'è contesto: elenco vuoto.
 */
export function rankForSpread(candidates: readonly SimilarityPhoto[], context: CompatibilityContext, limit = 24): Suggestion[] {
  const placed = context.spreadPhotos;
  if (placed.length === 0) return [];
  const moments = new Set(placed.map((photo) => context.momentOf.get(photo.id)).filter((id): id is string => Boolean(id)));
  const times = placed.map((photo) => photo.captureTimeMs).filter((time): time is number => typeof time === "number" && Number.isFinite(time));
  const looks = placed.map((photo) => photo.fingerprint).filter((look): look is NonNullable<typeof look> => Boolean(look));
  const allMono = looks.length > 0 && looks.every(isMonochrome);
  const allColor = looks.length > 0 && looks.every((look) => !isMonochrome(look));

  const scored = candidates.map((photo, position) => {
    let score = 0;
    const reasons: string[] = [];
    const moment = context.momentOf.get(photo.id);
    const nearest = typeof photo.captureTimeMs === "number" && times.length ? Math.min(...times.map((time) => Math.abs(time - photo.captureTimeMs!))) : null;
    if (moment && moments.has(moment)) { score += 4; reasons.push("stesso momento"); }
    else if (nearest !== null && nearest <= NEAR_MS) { score += 2; reasons.push("momento vicino"); }
    else if (nearest !== null && nearest <= SAME_PART_MS) score += 1;
    const look = photo.fingerprint;
    if (look && looks.length) {
      const mono = isMonochrome(look);
      if (mono && allMono) { score += 1; reasons.push("bianco e nero come lo spread"); }
      else if ((mono && allColor) || (!mono && allMono)) score -= 1.5;
      else if (!mono && Math.min(...looks.map((other) => colorDistance(look, other))) <= SIMILAR_TONES) { score += 1; reasons.push("toni simili"); }
    }
    const stars = photo.rating ?? 0;
    score += stars * 0.25;
    if (stars >= 4) reasons.push(`${stars} stelle`);
    return { id: photo.id, score, reasons, nearest: nearest ?? Number.POSITIVE_INFINITY, position };
  });
  scored.sort((a, b) => b.score - a.score || a.nearest - b.nearest || a.position - b.position);
  return scored.slice(0, Math.max(0, limit)).map(({ id, score, reasons }) => ({ id, score, reasons }));
}
