import type { DesktopToolId } from "@photo-tools/desktop-contracts";

/** before-quit dei tool puo' durare fino a 10 s (NATIVE_SHUTDOWN_TIMEOUT_MS in main.ts). */
export const TOOL_NATIVE_SHUTDOWN_BUDGET_MS = 10_000;
/** Deve superare il budget nativo, altrimenti una chiusura lenta ma corretta viene dichiarata fallita. */
export const TOOL_COOPERATIVE_SHUTDOWN_TIMEOUT_MS = 15_000;
export const TOOL_GRACEFUL_SHUTDOWN_TIMEOUT_MS = 4_000;
export const COOPERATIVE_SIGNAL_ATTEMPTS = 2;

/** Tool che alla chiusura della finestra si nascondono: WM_CLOSE non li fa uscire mai. */
const HIDE_ON_CLOSE_TOOLS: ReadonlySet<DesktopToolId> = new Set<DesktopToolId>(["archivio-flow"]);

export function usesWindowCloseFallback(toolId: DesktopToolId): boolean {
  return !HIDE_ON_CLOSE_TOOLS.has(toolId);
}
