let counter = 0;
const session = Date.now().toString(36);

/** Identificativi unici nel progetto e tra sessioni (data di avvio + contatore + parte casuale). */
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}-${session}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}
