import type sharp from "sharp";

type SharpFactory = typeof sharp;

export interface OrientationTransform {
  /** Rotazione oraria da applicare (gradi), poi lo specchio orizzontale se richiesto. */
  rotate: 0 | 90 | 180 | 270;
  flop: boolean;
}

/**
 * Trasformazione che porta un'immagine salvata con orientamento EXIF 1-8 nel verso giusto.
 * sharp applica prima la rotazione e poi lo specchio: gli orientamenti 4, 5 e 7 (specchiati) sono scritti di conseguenza
 * e verificati contro la lettura del tag fatta da sharp stessa (vedi exif-orientation.test.ts).
 */
export function orientationTransform(orientation: number): OrientationTransform {
  switch (orientation) {
    case 2: return { rotate: 0, flop: true };
    case 3: return { rotate: 180, flop: false };
    case 4: return { rotate: 180, flop: true };
    case 5: return { rotate: 270, flop: true };
    case 6: return { rotate: 90, flop: false };
    case 7: return { rotate: 90, flop: true };
    case 8: return { rotate: 270, flop: false };
    default: return { rotate: 0, flop: false };
  }
}

/** Raddrizza una miniatura estratta dal file (priva di orientamento proprio). Con orientamento 1 restituisce l'originale. */
export async function applyExifOrientation(sharpFactory: SharpFactory, buffer: Buffer, orientation: number, quality = 85): Promise<Buffer> {
  const transform = orientationTransform(orientation);
  if (transform.rotate === 0 && !transform.flop) return buffer;
  let pipeline = sharpFactory(buffer, { failOn: "none" });
  if (transform.rotate !== 0) pipeline = pipeline.rotate(transform.rotate);
  if (transform.flop) pipeline = pipeline.flop();
  return await pipeline.jpeg({ quality }).toBuffer();
}
