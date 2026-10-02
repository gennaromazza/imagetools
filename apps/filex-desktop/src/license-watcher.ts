import type { DesktopLicenseState } from "@photo-tools/desktop-contracts";

export const LICENSE_STATE_CHANGED_CHANNEL = "filex:license-state-changed";

/** Firma dei soli campi visibili all'utente: lastCheckedAt cambia a ogni verifica e va ignorato. */
export function licenseSignature(state: DesktopLicenseState): string {
  return JSON.stringify([
    state.status, state.canUseTools, state.enforcement, state.trial === true,
    state.validUntil, state.offlineUntil, state.activation.current, state.activation.limit, state.message,
  ]);
}

export interface LicenseWatcherOptions {
  read: (refresh: boolean) => Promise<DesktopLicenseState>;
  publish: (state: DesktopLicenseState) => void;
  /** Intervallo del controllo locale (nessuna rete se la cache e' valida). */
  intervalMs: number;
  /** Ogni quanto forzare la validazione col server, cosi' una revoca non resta invisibile per 24 ore. */
  revalidateEveryMs: number;
  now?: () => number;
}

export interface LicenseWatcher {
  /** Registra uno stato appena ottenuto da attivazione, disattivazione o prova. */
  notify: (state: DesktopLicenseState) => void;
  check: (refresh?: boolean) => Promise<void>;
  start: () => void;
  stop: () => void;
}

export function createLicenseWatcher(options: LicenseWatcherOptions): LicenseWatcher {
  const now = options.now ?? Date.now;
  let lastSignature: string | null = null;
  let lastRevalidation = now();
  let timer: ReturnType<typeof setInterval> | null = null;
  let busy = false;

  const notify = (state: DesktopLicenseState): void => {
    const signature = licenseSignature(state);
    if (signature === lastSignature) return;
    lastSignature = signature;
    options.publish(state);
  };

  const check = async (refresh = false): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      notify(await options.read(refresh));
    } catch {
      // Un errore transitorio non deve fermare il controllo successivo.
    } finally {
      busy = false;
    }
  };

  return {
    notify,
    check,
    start() {
      if (timer) return;
      timer = setInterval(() => {
        const due = now() - lastRevalidation >= options.revalidateEveryMs;
        if (due) lastRevalidation = now();
        void check(due);
      }, options.intervalMs);
      timer.unref?.();
      void check(false);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
