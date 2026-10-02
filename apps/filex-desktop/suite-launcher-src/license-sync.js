// Logica pura condivisa da dashboard (app.js) e dock (launcher.js) per la licenza.

export function isLicenseNoticeId(id) {
  return typeof id === 'string' && id.startsWith('license:');
}

// Una notifica "Licenza" rimossa dall'utente deve poter tornare se la licenza
// viene ripristinata e poi si perde di nuovo: appena l'accesso e' valido
// dimentichiamo i rifiuti delle notifiche di licenza.
export function pruneResolvedLicenseDismissals(dismissed, license) {
  if (!license || license.canUseTools !== true) return false;
  let changed = false;
  for (const id of [...dismissed]) {
    if (isLicenseNoticeId(id)) { dismissed.delete(id); changed = true; }
  }
  return changed;
}

export function trialDaysLeft(state, now = Date.now()) {
  if (!state || typeof state.validUntil !== 'number') return 0;
  return Math.max(0, Math.ceil((state.validUntil - now) / 86400000));
}

// Registra l'ascolto degli eventi di cambio licenza dal processo principale.
export function subscribeLicenseChanges(api, onState) {
  if (typeof api?.onLicenseState !== 'function') return () => {};
  return api.onLicenseState(onState);
}
