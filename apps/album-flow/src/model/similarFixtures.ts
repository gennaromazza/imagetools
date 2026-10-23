import type { AlbumAssetV2 } from "@photo-tools/shared-types";
import type { PhotoFingerprint } from "@photo-tools/photo-similarity";
import { makeAsset } from "./fixtures";
import { createEmptyProject, type Project } from "./project";
import type { PhotoSignals } from "./similar";

/** Album di prova con raffiche e momenti per i test delle foto simili (non usato dall'app). */

export const T0 = Date.UTC(2026, 5, 5, 13, 0, 0);

export function shot(id: string, seconds: number, overrides: Partial<AlbumAssetV2> = {}): AlbumAssetV2 {
  return makeAsset(0, {
    id, fileName: `${id}.jpg`, path: `${id}.jpg`, absolutePath: undefined,
    width: 6000, height: 4000, aspectRatio: 1.5, orientation: "horizontal",
    rating: 3, captureTimeMs: T0 + Math.round(seconds * 1000), ...overrides,
  });
}

/**
 * Tre momenti separati da pause lunghe:
 * - cerimonia (13:00): c0 c1, raffica b1 b2 b3 (b2 ha 5 stelle), c2 c3;
 * - torta (15:00): k0 k1, raffica t1 t2 (t1 ha 4 stelle), k2;
 * - balli (16:00): d0…d5 ogni 20 secondi.
 */
export function weddingAssets(): AlbumAssetV2[] {
  return [
    shot("c0", 0), shot("c1", 30), shot("b1", 60), shot("b2", 60.5, { rating: 5 }), shot("b3", 61), shot("c2", 90), shot("c3", 120),
    shot("k0", 7200), shot("k1", 7230), shot("t1", 7260, { rating: 4 }), shot("t2", 7260.4), shot("k2", 7290),
    ...Array.from({ length: 6 }, (_, index) => shot(`d${index}`, 10800 + index * 20)),
  ];
}

export function weddingProject(overrides: Partial<Project> = {}): Project {
  return { ...createEmptyProject("Matrimonio con raffiche"), assets: weddingAssets(), ...overrides };
}

export const CEREMONY = ["c0", "c1", "b1", "b2", "b3", "c2", "c3"];
export const CAKE = ["k0", "k1", "t1", "t2", "k2"];
export const DANCE = ["d0", "d1", "d2", "d3", "d4", "d5"];

/** Impronta finta: `chroma` sotto 6 = bianco e nero. */
export function look(overrides: Partial<PhotoFingerprint> = {}): PhotoFingerprint {
  return { hash: "0f0f0f0f0f0f0f0f", lab: [55, 10, 20], chroma: 25, sharpness: 300, clipHigh: 0, clipLow: 0, ...overrides };
}

export function signals(fingerprints: Record<string, PhotoFingerprint> = {}, cameras: Record<string, string> = {}): PhotoSignals {
  return { fingerprints: new Map(Object.entries(fingerprints)), cameras: new Map(Object.entries(cameras)) };
}

/** Id delle foto messe negli spread, spread per spread e pagina per pagina. */
export const pagesOf = (project: Project) => project.spreads.flatMap((spread) => spread.areas.map((area) => area.items.map((item) => item.assetId)));
