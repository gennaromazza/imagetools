import { useEffect, useMemo, useRef, useState } from "react";
import { findSimilarGroups, type PhotoFingerprint, type SimilarGroup, type SimilarityPhoto } from "@photo-tools/photo-similarity";
import type { ImageAsset } from "@photo-tools/shared-types";
import { createPerformanceWorkKey, schedulePerformanceWork } from "../services/performance-work-coordinator";
import type { CaptureTimeInfo } from "../services/photo-sort-cache";
import { fingerprintCacheKey, fingerprintFromThumbnailUrl } from "../services/similar-fingerprints";
import {
  buildSimilarPhotosView,
  isSameGroupingInput,
  toSimilarityPhotos,
  type SessionSimilarityOverrides,
  type SimilarPhotosView,
} from "../services/similar-photos";
import { getThumbnailView } from "../services/thumbnail-view-store";

/** Le impronte restano in memoria per la sessione: riaprire la stessa cartella non le ricalcola. */
const fingerprintCache = new Map<string, PhotoFingerprint>();
/** Tentativi falliti per foto: una miniatura sostituita nel frattempo (URL blob revocato) si riprova al giro dopo. */
const fingerprintFailures = new Map<string, number>();
const MAX_FINGERPRINT_ATTEMPTS = 3;
const FINGERPRINT_CACHE_MAX = 40_000;
/** Priorità più bassa del coordinatore: miniature e anteprime passano sempre prima. */
const FINGERPRINT_WORK_PRIORITY = 4;
const START_DELAY_MS = 900;
const PUBLISH_EVERY_MS = 700;

function rememberFingerprint(key: string, fingerprint: PhotoFingerprint) {
  fingerprintCache.set(key, fingerprint);
  while (fingerprintCache.size > FINGERPRINT_CACHE_MAX) {
    const oldest = fingerprintCache.keys().next().value;
    if (oldest === undefined) break;
    fingerprintCache.delete(oldest);
  }
}

const waitForIdle = () => new Promise<void>((resolve) => {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => resolve(), { timeout: 1_000 });
  } else {
    window.setTimeout(resolve, 16);
  }
});

interface UseSimilarPhotosOptions {
  photos: ImageAsset[];
  captureById: ReadonlyMap<string, CaptureTimeInfo>;
  overrides: SessionSimilarityOverrides;
  isThumbnailLoading: boolean;
}

export interface SimilarPhotosState extends SimilarPhotosView {
  /** Foto con l'impronta visiva pronta, su quelle presenti. */
  analyzedCount: number;
  isAnalyzing: boolean;
}

/**
 * Raffiche e foto quasi uguali della cartella aperta. Le impronte si calcolano dalle miniature già
 * caricate, a griglia ferma e nei momenti liberi; i gruppi si aggiornano man mano. Le stelle cambiano
 * solo la foto consigliata, senza ricalcolare i gruppi.
 */
export function useSimilarPhotos({ photos, captureById, overrides, isThumbnailLoading }: UseSimilarPhotosOptions): SimilarPhotosState {
  const [fingerprintRevision, setFingerprintRevision] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const workerRef = useRef({ running: false, dirty: false, disposed: false, timer: null as number | null });

  useEffect(() => {
    const worker = workerRef.current;
    worker.disposed = false;
    return () => {
      worker.disposed = true;
      if (worker.timer !== null) window.clearTimeout(worker.timer);
      worker.timer = null;
    };
  }, []);

  useEffect(() => {
    const worker = workerRef.current;
    if (isThumbnailLoading || typeof createImageBitmap !== "function") return;
    if (worker.running) {
      worker.dirty = true;
      return;
    }
    if (worker.timer !== null) return;

    const run = async () => {
      worker.timer = null;
      worker.running = true;
      worker.dirty = false;
      let lastPublish = performance.now();
      let pendingPublish = false;
      try {
        const missing = photosRef.current.filter((photo) => {
          const key = fingerprintCacheKey(photo.id, photo.sourceFileKey);
          return !fingerprintCache.has(key) && (fingerprintFailures.get(key) ?? 0) < MAX_FINGERPRINT_ATTEMPTS;
        });
        if (missing.length > 0) setIsAnalyzing(true);
        for (const photo of missing) {
          if (worker.disposed) return;
          const url = getThumbnailView(photo.id)?.thumbnailUrl ?? photo.thumbnailUrl;
          if (!url) continue;
          const key = fingerprintCacheKey(photo.id, photo.sourceFileKey);
          await waitForIdle();
          try {
            const fingerprint = await schedulePerformanceWork(
              createPerformanceWorkKey(`similar-fingerprint:${photo.id}`),
              FINGERPRINT_WORK_PRIORITY,
              () => fingerprintFromThumbnailUrl(url),
            );
            rememberFingerprint(key, fingerprint);
            pendingPublish = true;
          } catch {
            // Miniatura non leggibile: intanto la foto resta raggruppabile solo per ora di scatto.
            fingerprintFailures.set(key, (fingerprintFailures.get(key) ?? 0) + 1);
          }
          if (pendingPublish && performance.now() - lastPublish > PUBLISH_EVERY_MS && !worker.disposed) {
            setFingerprintRevision((value) => value + 1);
            lastPublish = performance.now();
            pendingPublish = false;
          }
        }
      } finally {
        worker.running = false;
        if (!worker.disposed) {
          if (pendingPublish) setFingerprintRevision((value) => value + 1);
          setIsAnalyzing(false);
          // Nel frattempo sono arrivate altre foto o miniature: un altro giro prende solo quelle nuove.
          if (worker.dirty) worker.timer = window.setTimeout(() => void run(), START_DELAY_MS);
        }
      }
    };

    worker.timer = window.setTimeout(() => void run(), START_DELAY_MS);
  }, [isThumbnailLoading, photos]);

  const similarityPhotos = useMemo(
    () => toSimilarityPhotos(photos, captureById, (asset) => fingerprintCache.get(fingerprintCacheKey(asset.id, asset.sourceFileKey))),
    // fingerprintRevision segnala nuove impronte nella cache di modulo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [photos, captureById, fingerprintRevision],
  );

  const groupingRef = useRef<{ input: SimilarityPhoto[]; overrides: SessionSimilarityOverrides; groups: SimilarGroup[] } | null>(null);
  const groups = useMemo(() => {
    const previous = groupingRef.current;
    if (previous && previous.overrides === overrides && isSameGroupingInput(previous.input, similarityPhotos)) {
      return previous.groups;
    }
    const next = findSimilarGroups(similarityPhotos, overrides);
    groupingRef.current = { input: similarityPhotos, overrides, groups: next };
    return next;
  }, [overrides, similarityPhotos]);

  const view = useMemo(() => buildSimilarPhotosView(groups, similarityPhotos), [groups, similarityPhotos]);
  const analyzedCount = useMemo(
    () => similarityPhotos.reduce((count, photo) => count + (photo.fingerprint ? 1 : 0), 0),
    [similarityPhotos],
  );

  return { ...view, analyzedCount, isAnalyzing };
}
