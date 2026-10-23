import type { SimilarityPhoto } from "./types";

export interface RankedGroup {
  /** Dalla foto consigliata all'ultima. */
  order: string[];
  /** Perché la prima è consigliata, in poche parole («5 stelle», «più nitida»). */
  reason: string;
}

/** Penalità di esposizione: luci bruciate pesano il doppio delle ombre chiuse. */
const exposurePenalty = (photo: SimilarityPhoto) => (photo.fingerprint ? photo.fingerprint.clipHigh * 2 + photo.fingerprint.clipLow : 0);

/**
 * Ordina le varianti di uno scatto dalla migliore. Contano prima le stelle del fotografo (il suo giudizio vale più
 * di qualsiasi calcolo); a parità la nitidezza, relativa alla più nitida del gruppo, e l'esposizione; poi l'ordine di scatto.
 */
export function rankGroup(photos: readonly SimilarityPhoto[]): RankedGroup {
  if (photos.length === 0) return { order: [], reason: "" };
  const sharpest = Math.max(0, ...photos.map((photo) => photo.fingerprint?.sharpness ?? 0));
  const score = (photo: SimilarityPhoto) => {
    const stars = (photo.rating ?? 0) * 100;
    const sharp = sharpest > 0 && photo.fingerprint ? (photo.fingerprint.sharpness / sharpest) * 10 : 0;
    const exposure = -Math.min(3, exposurePenalty(photo) * 30);
    return stars + sharp + exposure;
  };
  const scored = photos.map((photo, position) => ({ photo, position, score: score(photo) }));
  scored.sort((a, b) => b.score - a.score
    || (a.photo.captureTimeMs ?? Number.POSITIVE_INFINITY) - (b.photo.captureTimeMs ?? Number.POSITIVE_INFINITY)
    || a.position - b.position);
  const best = scored[0].photo;
  const others = scored.slice(1).map((entry) => entry.photo);
  return { order: scored.map((entry) => entry.photo.id), reason: reasonFor(best, others) };
}

function reasonFor(best: SimilarityPhoto, others: readonly SimilarityPhoto[]): string {
  if (others.length === 0) return "";
  const stars = best.rating ?? 0;
  if (stars > 0 && others.every((photo) => (photo.rating ?? 0) < stars)) return stars === 1 ? "1 stella" : `${stars} stelle`;
  const sharp = best.fingerprint?.sharpness;
  if (sharp !== undefined && others.every((photo) => photo.fingerprint && photo.fingerprint.sharpness * 1.1 < sharp)) return "più nitida";
  if (best.fingerprint && others.every((photo) => exposurePenalty(photo) > exposurePenalty(best) + 0.01)) return "esposizione migliore";
  return "prima della serie";
}
