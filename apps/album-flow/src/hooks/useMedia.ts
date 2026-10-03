import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getMedia, mediaVersion, subscribeMedia } from "../model/mediaStore";

const urlCache = new Map<string, string>();

/** Data URL delle immagini della libreria citate da uno spread; si completa man mano che si caricano. */
export function useMediaUrls(ids: readonly string[]): ReadonlyMap<string, string> {
  const version = useSyncExternalStore(subscribeMedia, mediaVersion);
  const key = [...new Set(ids)].sort().join("|");
  const [loaded, setLoaded] = useState(0);
  useEffect(() => {
    let alive = true;
    const missing = key ? key.split("|").filter((id) => !urlCache.has(id)) : [];
    if (!missing.length) return;
    void Promise.all(missing.map(async (id) => { const record = await getMedia(id); if (record) urlCache.set(id, record.dataUrl); })).then(() => { if (alive) setLoaded((value) => value + 1); });
    return () => { alive = false; };
  }, [key, version]);
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const id of key ? key.split("|") : []) { const url = urlCache.get(id); if (url) map.set(id, url); }
    return map;
    // `loaded` e `version` fanno rileggere la cache quando arrivano nuove immagini.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loaded, version]);
}

/** Dimentica un'immagine rimossa dalla libreria. */
export const forgetMediaUrl = (id: string) => { urlCache.delete(id); };
