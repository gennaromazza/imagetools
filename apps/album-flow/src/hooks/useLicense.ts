import { useEffect, useState } from "react";
import type { DesktopLicenseState } from "@photo-tools/desktop-contracts";
import { getDesktop } from "../desktop/api";
import { licenseNotice, type LicenseNotice } from "../desktop/license";

const POLL_MS = 60_000;

/** Controlla ogni minuto lo stato della licenza FileX (solo nell'app desktop) e restituisce l'avviso da mostrare. */
export function useLicenseNotice(): LicenseNotice | null {
  const [state, setState] = useState<DesktopLicenseState | null>(null);
  useEffect(() => {
    const desktop = getDesktop();
    if (!desktop?.getLicenseState) return undefined;
    let stopped = false;
    const check = () => { desktop.getLicenseState().then((next) => { if (!stopped) setState(next); }).catch(() => { /* senza risposta non si mostra nulla */ }); };
    check();
    const timer = window.setInterval(check, POLL_MS);
    return () => { stopped = true; window.clearInterval(timer); };
  }, []);
  return licenseNotice(state);
}
