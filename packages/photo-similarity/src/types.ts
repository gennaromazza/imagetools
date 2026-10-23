/**
 * Tipi del riconoscimento di momenti e foto simili, condiviso da Image Select Pro e Album Flow.
 * Tutto è puro (niente DOM né file): chi usa il pacchetto passa i dati delle foto e, se li ha, i pixel di una miniatura.
 */

/** Impronta visiva di una foto, ricavata da una miniatura (bastano 256 px sul lato lungo). */
export interface PhotoFingerprint {
  /** Impronta percettiva (dHash a 64 bit) in 16 cifre esadecimali: due foto quasi uguali differiscono di pochi bit. */
  hash: string;
  /** Colore medio in Lab (L 0-100, a e b circa -128…127). */
  lab: [number, number, number];
  /** Saturazione media (croma Lab per pixel): sotto `MONOCHROME_CHROMA` la foto è in bianco e nero. */
  chroma: number;
  /** Nitidezza: varianza del laplaciano sulla luminanza. Si confronta solo tra foto della stessa scena. */
  sharpness: number;
  /** Frazione di pixel bruciati (luci) e chiusi (ombre), 0-1. */
  clipHigh: number;
  clipLow: number;
}

/** Ciò che serve sapere di una foto per raggrupparla. */
export interface SimilarityPhoto {
  id: string;
  fileName?: string;
  /** Ora di scatto in millisecondi, al millisecondo se la fotocamera lo scrive. */
  captureTimeMs?: number;
  /** Modello della fotocamera: due corpi diversi non fanno una raffica insieme. */
  cameraModel?: string;
  /** Larghezza / altezza come appare (rotazione inclusa). */
  aspect: number;
  /** Stelle 0-5 date dal fotografo. */
  rating?: number;
  fingerprint?: PhotoFingerprint;
}

/** Correzioni del fotografo ai gruppi automatici. */
export interface SimilarityOverrides {
  /** Coppie dichiarate «non simili»: non finiscono mai nello stesso gruppo. */
  apart?: ReadonlyArray<readonly [string, string]>;
  /** Gruppi uniti a mano: le foto stanno sempre insieme. */
  together?: ReadonlyArray<readonly string[]>;
}

/** Un momento: scatti consecutivi senza pause lunghe (l'arrivo in chiesa, il taglio della torta). */
export interface Moment {
  id: string;
  /** Foto in ordine di scatto. */
  photoIds: string[];
  startMs: number;
  endMs: number;
}

/** «burst»: raffica (scatti a meno di un paio di secondi); «similar»: stessa inquadratura scattata poco dopo; «manual»: unito a mano. */
export type SimilarGroupKind = "burst" | "similar" | "manual";

/** Varianti dello stesso scatto: di solito se ne sceglie una. */
export interface SimilarGroup {
  id: string;
  /** Foto in ordine di scatto. */
  photoIds: string[];
  kind: SimilarGroupKind;
}
