import { useCallback, useState } from "react";
import { markFeatureSeen, seenFeatures } from "../model/whatsNew";

/** `isNew` resta vero (il pulsante porta «Nuovo») finché la funzione non viene aperta una volta. */
export function useNewFeature(id: string): { isNew: boolean; markSeen: () => void } {
  const [seen, setSeen] = useState(() => seenFeatures().includes(id));
  const markSeen = useCallback(() => { setSeen(true); markFeatureSeen(id); }, [id]);
  return { isNew: !seen, markSeen };
}
