/**
 * Condivide la stessa promessa fra chiamate concorrenti con la stessa chiave,
 * cosi' dock, dashboard e tool non lanciano richieste identiche in parallelo.
 */
export function singleFlight<K, T>(operation: (key: K) => Promise<T>): (key: K) => Promise<T> {
  const inFlight = new Map<K, Promise<T>>();
  return (key) => {
    const running = inFlight.get(key);
    if (running) return running;
    const started = operation(key).finally(() => { inFlight.delete(key); });
    inFlight.set(key, started);
    return started;
  };
}
