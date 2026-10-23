import { isMonochrome, type SimilarityPhoto } from "@photo-tools/photo-similarity";

/**
 * Cosa dicono i numeri di ogni gruppo di foto simili, in modo onesto: quanto è nitida ogni variante rispetto
 * alla più nitida, dove luci e ombre sono sacrificate e se nel gruppo ci sono scatti mossi o fuori fuoco.
 *
 * Le impronte vengono da miniature di 200 px e dicono solo la tecnica. Sulle foto reali di prova (una selezione
 * di matrimonio) quasi tutti i gruppi sono pose o espressioni diverse con nitidezza praticamente uguale (rapporto
 * tra le prime due mediamente 1,08): lì la nitidezza non può scegliere, e il modulo lo dice invece di fingere
 * una consigliata «sicura». Occhi chiusi o sorrisi non si leggono da qui: si guardano, con la lente.
 */

export type TechnicalVerdict =
  /** Meno di due foto o impronte non ancora pronte. */
  | "unknown"
  /** Foto a colori e in bianco e nero insieme: la nitidezza non è confrontabile (il contrasto del B/N la gonfia). */
  | "mixed-tone"
  /** Almeno una variante è nettamente più morbida della più nitida: mossa o fuori fuoco. */
  | "soft"
  /** Nessuna differenza tecnica che conti: si decide a occhio. */
  | "minimal";

export interface PhotoInsight {
  /** Nitidezza rispetto alla più nitida del gruppo, 0-100; null senza impronta. */
  sharpnessPct: number | null;
  /** Luci bruciate e ombre chiuse in percentuale dell'immagine; null senza impronta. */
  clipHighPct: number | null;
  clipLowPct: number | null;
  /** Nettamente più morbida della più nitida del gruppo. */
  soft: boolean;
}

export interface GroupInsights {
  verdict: TechnicalVerdict;
  /** Una riga per il fotografo. */
  note: string;
  byPhoto: ReadonlyMap<string, PhotoInsight>;
  /** Varianti nettamente più morbide, quelle che si possono scartare con un clic. */
  softIds: string[];
}

/** Sotto il 70% della nitidezza della più nitida una variante è mossa o fuori fuoco. */
export const SOFT_RATIO = 0.7;
/** Sotto questa nitidezza (varianza del laplaciano su 200 px) la scena è troppo piatta per giudicare. */
export const MIN_MEANINGFUL_SHARPNESS = 40;
/** Luci bruciate o ombre chiuse da segnalare, in percentuale dell'immagine. */
export const CLIP_HIGH_WARN_PCT = 2;
export const CLIP_LOW_WARN_PCT = 10;

const percent = (value: number) => Math.round(value * 1000) / 10;

export function computeGroupInsights(members: readonly SimilarityPhoto[]): GroupInsights {
  const sharpest = Math.max(0, ...members.map((photo) => photo.fingerprint?.sharpness ?? 0));
  const measured = members.every((photo) => photo.fingerprint) && sharpest >= MIN_MEANINGFUL_SHARPNESS;
  const mixedTone = members.some((photo) => photo.fingerprint && isMonochrome(photo.fingerprint))
    && members.some((photo) => photo.fingerprint && !isMonochrome(photo.fingerprint));
  const byPhoto = new Map<string, PhotoInsight>(members.map((photo) => {
    const ratio = photo.fingerprint && sharpest > 0 ? photo.fingerprint.sharpness / sharpest : null;
    return [photo.id, {
      // Colore e bianco e nero non si confrontano: il contrasto del B/N gonfia il numero, meglio non mostrarlo.
      sharpnessPct: ratio === null || mixedTone ? null : Math.round(ratio * 100),
      clipHighPct: photo.fingerprint ? percent(photo.fingerprint.clipHigh) : null,
      clipLowPct: photo.fingerprint ? percent(photo.fingerprint.clipLow) : null,
      soft: measured && !mixedTone && ratio !== null && ratio < SOFT_RATIO,
    }];
  }));
  const softIds = members.filter((photo) => byPhoto.get(photo.id)?.soft).map((photo) => photo.id);
  const verdict = (kind: TechnicalVerdict, note: string): GroupInsights => ({ verdict: kind, note, byPhoto, softIds: kind === "soft" ? softIds : [] });

  if (members.length < 2 || members.some((photo) => !photo.fingerprint)) return verdict("unknown", "");
  if (mixedTone) return verdict("mixed-tone", "colore e bianco e nero insieme: confronta a occhio, spesso si tengono entrambe");
  if (!measured) return verdict("minimal", "scena troppo piatta per giudicare la nitidezza: decidi a occhio");
  if (softIds.length > 0) {
    return verdict("soft", softIds.length === 1 ? "una variante è più morbida (mossa o fuori fuoco)" : `${softIds.length} varianti sono più morbide (mosse o fuori fuoco)`);
  }
  return verdict("minimal", "nitidezza e luci quasi uguali: decidi guardando espressioni e occhi");
}

type PickStatusOf = (id: string) => "picked" | "rejected" | "unmarked" | undefined;

/** «Chiudi il gruppo»: si tengono i Pick già dati e si scartano le varianti ancora neutre (le già scartate restano com'erano). */
export function planCloseGroup(photoIds: readonly string[], pickStatusOf: PickStatusOf): { keep: string[]; reject: string[] } {
  const keep = photoIds.filter((id) => pickStatusOf(id) === "picked");
  const reject = photoIds.filter((id) => (pickStatusOf(id) ?? "unmarked") === "unmarked");
  return { keep, reject };
}

/** Le sfocate si scartano da sole, senza decidere il gruppo: solo quelle ancora neutre. */
export function planDiscardSoft(softIds: readonly string[], pickStatusOf: PickStatusOf): string[] {
  return softIds.filter((id) => (pickStatusOf(id) ?? "unmarked") === "unmarked");
}
