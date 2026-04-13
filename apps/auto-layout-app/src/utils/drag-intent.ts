export type DragKind = "asset" | "slot";

export interface DragStateLike {
  kind: DragKind;
  imageId: string;
  sourcePageId?: string;
  sourceSlotId?: string;
}

export type SlotDropIntent = "add" | "replace" | "move" | "swap" | "blocked" | "self";
export type PageDropIntent = "add-to-page" | "rebalance-page";

interface ResolveSlotDropIntentInput {
  dragState: DragStateLike | null;
  targetHasAssignment: boolean;
  targetLocked: boolean;
  sourcePageId: string;
  sourceSlotId: string;
}

export function resolveSlotDropIntent({
  dragState,
  targetHasAssignment,
  targetLocked,
  sourcePageId,
  sourceSlotId,
}: ResolveSlotDropIntentInput): SlotDropIntent | null {
  if (!dragState) return null;
  if (
    dragState.kind === "slot" &&
    dragState.sourcePageId === sourcePageId &&
    dragState.sourceSlotId === sourceSlotId
  ) {
    return "self";
  }
  if (targetLocked) return "blocked";
  if (dragState.kind === "slot") {
    return targetHasAssignment ? "swap" : "move";
  }
  return targetHasAssignment ? "replace" : "add";
}

export function getSlotIntentLabel(intent: SlotDropIntent | null): string {
  switch (intent) {
    case "add":
      return "Rilascia per inserire la foto in questo slot";
    case "replace":
      return "Rilascia per sostituire la foto in questo slot";
    case "move":
      return "Rilascia per spostare la foto in questo slot";
    case "swap":
      return "Rilascia per scambiare le due foto";
    case "blocked":
      return "Slot bloccato: sbloccalo per sostituire o scambiare la foto.";
    default:
      return "Scegli uno slot (vuoto = aggiungi, pieno = sostituisci/scambia) oppure parcheggia la foto per spostarla su un altro foglio.";
  }
}

export function getSlotIntentSymbol(intent: SlotDropIntent | null): string {
  switch (intent) {
    case "add":
      return "+";
    case "replace":
      return "↺";
    case "move":
      return "→";
    case "swap":
      return "⇄";
    case "blocked":
      return "!";
    default:
      return "+";
  }
}

export function getSlotIntentClassName(intent: SlotDropIntent | null): string {
  switch (intent) {
    case "swap":
      return "sheet-slot__drop-indicator--swap";
    case "replace":
      return "sheet-slot__drop-indicator--replace";
    case "blocked":
      return "sheet-slot__drop-indicator--blocked";
    default:
      return "sheet-slot__drop-indicator--add";
  }
}

export function resolvePageDropIntent(
  dragState: DragStateLike | null,
  targetPageId: string
): PageDropIntent {
  if (dragState?.kind === "slot" && dragState.sourcePageId === targetPageId) {
    return "rebalance-page";
  }
  return "add-to-page";
}

export function getPageDropIntentLabel(intent: PageDropIntent, pageNumber: number): string {
  return intent === "rebalance-page"
    ? `Riadatta foglio ${pageNumber}`
    : `Aggiungi a foglio ${pageNumber}`;
}
