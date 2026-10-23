import { useEffect, useMemo, useRef, useState } from "react";
import type { AlbumProjectV2 } from "@photo-tools/shared-types";
import { fingerprintAsset, readCameraModels } from "../desktop/fingerprints";
import { analyzeLibrary, type LibraryAnalysis } from "../model/similar";
import { loadSignalStore, missingFingerprints, saveSignalStore, signalKey, signalsFor, type SignalStore } from "../model/signalsStore";

export interface SimilarityState {
  analysis: LibraryAnalysis;
  /** Lettura delle miniature in corso (per l'indicatore nella libreria); null a lavoro finito. */
  progress: { done: number; total: number } | null;
}

/** Quante miniature si leggono insieme: poche, così le miniature visibili della libreria restano prioritarie. */
const LANES = 2;
/** Ogni quante impronte nuove l'analisi si aggiorna (non a ogni foto: la libreria si ridisegnerebbe di continuo). */
const PUBLISH_EVERY = 24;

/**
 * Momenti e foto simili della libreria. L'analisi parte subito dai dati di scatto; in sottofondo legge le miniature
 * (impronta visiva) e il modello della fotocamera, li ricorda sul computer e aggiorna i gruppi man mano.
 */
export function useSimilarity(project: AlbumProjectV2): SimilarityState {
  const storeRef = useRef<{ projectId: string; store: SignalStore } | null>(null);
  if (!storeRef.current || storeRef.current.projectId !== project.projectId) storeRef.current = { projectId: project.projectId, store: loadSignalStore(project.projectId) };
  const [revision, setRevision] = useState(0);
  const [progress, setProgress] = useState<SimilarityState["progress"]>(null);
  const triedCameras = useRef(new Set<string>());
  const failed = useRef(new Set<string>());

  const assets = project.assets;
  // Le foto da leggere cambiano solo se cambia l'elenco dei file, non a ogni stella o etichetta.
  const filesKey = useMemo(() => assets.map((asset) => `${asset.id}=${signalKey(asset)}`).join("\n"), [assets]);

  useEffect(() => {
    const holder = storeRef.current!;
    const { store, projectId } = holder;
    let cancelled = false;
    const todo = missingFingerprints(store, assets).filter((asset) => !failed.current.has(signalKey(asset)));
    const cameraTodo = assets.filter((asset) => asset.absolutePath && !store.cameras.has(asset.id) && !triedCameras.current.has(asset.id));
    if (todo.length === 0 && cameraTodo.length === 0) { setProgress(null); return undefined; }

    const run = async () => {
      if (cameraTodo.length) {
        cameraTodo.forEach((asset) => triedCameras.current.add(asset.id));
        const models = await readCameraModels(cameraTodo);
        if (cancelled) return;
        if (models.size) { models.forEach((model, id) => store.cameras.set(id, model)); saveSignalStore(projectId, store); setRevision((value) => value + 1); }
      }
      let done = 0;
      let fresh = 0;
      setProgress(todo.length ? { done: 0, total: todo.length } : null);
      const queue = [...todo];
      const lane = async () => {
        while (!cancelled && queue.length) {
          const asset = queue.shift()!;
          const fingerprint = await fingerprintAsset(asset);
          if (cancelled) return;
          if (fingerprint) { store.fingerprints.set(asset.id, { key: signalKey(asset), value: fingerprint }); fresh += 1; }
          else failed.current.add(signalKey(asset));
          done += 1;
          if (fresh >= PUBLISH_EVERY) { fresh = 0; saveSignalStore(projectId, store); setRevision((value) => value + 1); }
          if (done % 8 === 0 || done === todo.length) setProgress({ done, total: todo.length });
        }
      };
      await Promise.all(Array.from({ length: Math.min(LANES, todo.length) }, lane));
      if (cancelled) return;
      saveSignalStore(projectId, store);
      setRevision((value) => value + 1);
      setProgress(null);
    };
    void run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.projectId, filesKey]);

  const signals = useMemo(() => signalsFor(storeRef.current!.store, assets),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assets, revision, project.projectId]);
  const analysis = useMemo(() => analyzeLibrary({ assets, similarity: project.similarity }, signals), [assets, project.similarity, signals]);
  return { analysis, progress };
}
