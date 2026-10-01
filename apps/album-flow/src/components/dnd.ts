/** Trascinamento tra libreria, spread, filmstrip e schede dei capitoli. Il carico resta in memoria: durante dragover il browser non lo espone. */
export type DragPayload =
  | { kind: "assets"; assetIds: string[] }
  | { kind: "item"; itemId: string }
  | { kind: "spread"; index: number };

let current: DragPayload | null = null;

export function beginDrag(event: { dataTransfer: DataTransfer }, payload: DragPayload): void {
  current = payload;
  event.dataTransfer.effectAllowed = "copyMove";
  // Alcuni browser richiedono almeno un dato per avviare il trascinamento.
  event.dataTransfer.setData("text/plain", payload.kind);
}

export function currentDrag(): DragPayload | null {
  return current;
}

export function endDrag(): void {
  current = null;
}

/** Il trascinamento arriva dal sistema operativo (file o cartelle) e non da un elemento dell'app. */
export function isExternalFileDrag(event: { dataTransfer: DataTransfer | null }): boolean {
  return current === null && Boolean(event.dataTransfer?.types?.includes("Files"));
}
