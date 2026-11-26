import { cropFor, effectiveDpi, LOW_DPI, PRINT_DPI } from "./geometry";
import type { OrderGroup, OrderPhoto } from "./model";

export type QualityLevel = "ottima" | "buona" | "accettabile" | "scarsa";

export interface PrintQuality {
  /** Pixel della foto originale per pollice di stampa, dopo il ritaglio. */
  dpi: number;
  /** Da 0 a 100: 100 significa almeno 300 DPI. */
  score: number;
  level: QualityLevel;
  verdict: string;
  /** Parte della foto che resta fuori dalla stampa, in percentuale. */
  cutPercent: number;
}

/** Oltre questa percentuale di taglio conviene guardare bene, o allargare lo sfondo. */
export const STRONG_CUT_PERCENT = 20;

const VERDICTS: Record<QualityLevel, string> = {
  ottima: "Viene benissimo",
  buona: "Viene bene",
  accettabile: "Accettabile",
  scarsa: "Non viene bene",
};

export function assessQuality(group: OrderGroup, photo: OrderPhoto): PrintQuality {
  const dpi = effectiveDpi(group, photo);
  const level: QualityLevel = dpi >= 280 ? "ottima" : dpi >= 240 ? "buona" : dpi >= LOW_DPI ? "accettabile" : "scarsa";
  const crop = cropFor(group, photo);
  const cutPercent = group.fitMode === "cover" ? Math.round((1 - crop.cropWidth * crop.cropHeight) * 100) : 0;
  return {
    dpi,
    score: Math.max(0, Math.min(100, Math.round((dpi / PRINT_DPI) * 100))),
    level,
    verdict: VERDICTS[level],
    cutPercent,
  };
}

export interface PhotoDetails {
  pixels: string;
  megapixels: string;
  /** Misura più grande a 300 DPI, senza ritagli. */
  largestPrint: string;
  fileSize: string | null;
}

export function describePhoto(photo: Pick<OrderPhoto, "width" | "height" | "size">): PhotoDetails {
  const cm = (pixels: number) => Math.floor((pixels / PRINT_DPI) * 2.54);
  const decimal = (value: number) => value.toFixed(1).replace(".", ",");
  return {
    pixels: `${photo.width} × ${photo.height} pixel`,
    megapixels: `${decimal((photo.width * photo.height) / 1_000_000)} MP`,
    largestPrint: `${cm(photo.width)} × ${cm(photo.height)} cm`,
    fileSize: photo.size ? (photo.size >= 1_048_576 ? `${decimal(photo.size / 1_048_576)} MB` : `${Math.round(photo.size / 1024)} KB`) : null,
  };
}
