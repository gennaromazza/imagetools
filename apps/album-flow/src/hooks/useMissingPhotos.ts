import { useCallback, useEffect, useMemo, useState } from "react";
import type { AlbumAssetV2 } from "@photo-tools/shared-types";
import { getDesktop } from "../desktop/api";

const CHUNK = 400;

/**
 * Foto dell'album il cui file non si trova più sul disco (computer diverso, cartella spostata o rinominata).
 * Solo nell'app desktop e solo per le foto con un percorso; nel browser non c'è nulla da controllare.
 */
export function useMissingPhotos(assets: readonly AlbumAssetV2[]): { missingIds: ReadonlySet<string>; checking: boolean; recheck: () => void } {
  const [missingIds, setMissingIds] = useState<ReadonlySet<string>>(new Set());
  const [checking, setChecking] = useState(false);
  const [tick, setTick] = useState(0);
  const signature = useMemo(() => assets.map((asset) => asset.absolutePath ?? "").join("|"), [assets]);

  useEffect(() => {
    const api = getDesktop();
    const withPath = assets.filter((asset) => asset.absolutePath);
    if (!api?.statFiles || withPath.length === 0) { setMissingIds(new Set()); return; }
    let alive = true;
    setChecking(true);
    void (async () => {
      const present = new Set<string>();
      try {
        for (let start = 0; start < withPath.length; start += CHUNK) {
          const stats = await api.statFiles(withPath.slice(start, start + CHUNK).map((asset) => asset.absolutePath!));
          for (const stat of stats) present.add(stat.absolutePath);
        }
        if (alive) setMissingIds(new Set(withPath.filter((asset) => !present.has(asset.absolutePath!)).map((asset) => asset.id)));
      } catch {
        // Se il controllo fallisce non si segnala nulla: meglio nessun avviso che un avviso falso.
        if (alive) setMissingIds(new Set());
      } finally {
        if (alive) setChecking(false);
      }
    })();
    return () => { alive = false; };
    // La firma dei percorsi (non l'array) decide quando ricontrollare.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, tick]);

  const recheck = useCallback(() => setTick((value) => value + 1), []);
  return { missingIds, checking, recheck };
}
