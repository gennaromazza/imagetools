import type { DesktopSuiteUpdateState } from "@photo-tools/desktop-contracts";

type SuiteUpdateStatus = DesktopSuiteUpdateState["status"];

/** La Suite resta aperta per giorni in background: serve un controllo periodico, come per i tool. */
export const SUITE_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function shouldCheckSuiteUpdate(status: SuiteUpdateStatus): boolean {
  return !["checking", "downloading", "ready", "installing", "disabled"].includes(status);
}

/** Durante l'installazione un tool riaperto manterrebbe file bloccati e fermerebbe l'installer. */
export function isSuiteInstallInProgress(status: SuiteUpdateStatus): boolean {
  return status === "installing";
}

/** Avvisa una sola volta per versione quando l'aggiornamento e' pronto e la dashboard non e' aperta. */
export function shouldNotifySuiteReady(input: {
  status: SuiteUpdateStatus;
  version: string | null;
  lastNotifiedVersion: string | null;
  dashboardVisible: boolean;
}): boolean {
  return input.status === "ready" && !input.dashboardVisible
    && Boolean(input.version) && input.version !== input.lastNotifiedVersion;
}
