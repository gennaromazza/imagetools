import type { DesktopLicenseState } from "@photo-tools/desktop-contracts";

export interface LicenseNotice {
  level: "info" | "warn" | "error";
  text: string;
}

const DAY_MS = 86_400_000;
const TRIAL_WARNING_DAYS = 7;

const dateLabel = (time: number) => new Date(time).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });

/**
 * Avviso da mostrare all'utente per lo stato della licenza FileX All Access, oppure null se va tutto bene (o se l'app gira
 * fuori da FileX, per esempio in un browser). Il blocco vero e proprio resta nel processo principale della shell: qui si
 * spiega solo cosa sta succedendo e che il lavoro è al sicuro.
 */
export function licenseNotice(state: DesktopLicenseState | null | undefined, now: number = Date.now()): LicenseNotice | null {
  if (!state) return null;
  if (!state.canUseTools) {
    return { level: "error", text: "La licenza FileX All Access non è più valida: Album Flow si chiuderà a breve. Il lavoro è già salvato in questo computer; riattiva la licenza da FileX Suite per continuare." };
  }
  if (state.status === "grace") {
    const until = state.validUntil ?? state.offlineUntil;
    return { level: "warn", text: `Il pagamento di FileX All Access va verificato${until ? `: puoi continuare a lavorare fino al ${dateLabel(until)}` : ""}. Apri FileX Suite per sistemarlo.` };
  }
  if (state.trial && state.validUntil) {
    const days = Math.ceil((state.validUntil - now) / DAY_MS);
    if (days <= TRIAL_WARNING_DAYS) {
      return { level: "info", text: days <= 0 ? "La prova gratuita di FileX termina oggi." : `La prova gratuita di FileX termina ${days === 1 ? "domani" : `tra ${days} giorni`} (${dateLabel(state.validUntil)}). Attiva FileX All Access da FileX Suite per non interrompere il lavoro.` };
    }
  }
  return null;
}
