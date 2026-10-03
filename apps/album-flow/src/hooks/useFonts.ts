import { useEffect, useState } from "react";
import { loadFonts } from "../render/fonts";

/** Cambia (di un contatore) quando i font indicati sono pronti: i testi vanno impaginati di nuovo con le misure vere. */
export function useFontsReady(fontIds: readonly string[]): number {
  const key = [...new Set(fontIds)].sort().join("|");
  const [ready, setReady] = useState(0);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void loadFonts(key.split("|")).then(() => { if (alive) setReady((value) => value + 1); });
    return () => { alive = false; };
  }, [key]);
  return ready;
}
