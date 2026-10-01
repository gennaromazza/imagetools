import { useMemo, useRef } from "react";

/**
 * Funzioni con identità stabile che chiamano sempre l'ultima versione passata.
 * Permette di usare `memo` su componenti con molti figli (libreria con centinaia di miniature) senza chiusure vecchie:
 * le proprietà dei dati decidono se ridisegnare, i gestori no.
 */
export function useStableCallbacks<T extends { [key: string]: (...args: never[]) => unknown }>(handlers: T): T {
  const latest = useRef(handlers);
  latest.current = handlers;
  // Le chiavi sono fisse per tutta la vita del componente: i wrapper si creano una volta sola.
  return useMemo(() => {
    const stable: Record<string, unknown> = {};
    for (const key of Object.keys(handlers)) stable[key] = (...args: unknown[]) => (latest.current[key] as (...inner: unknown[]) => unknown)(...args);
    return stable as T;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
