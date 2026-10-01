import { test } from "node:test";
import assert from "node:assert/strict";
import type { DesktopLicenseState } from "@photo-tools/desktop-contracts";
import { licenseNotice } from "./license";

const NOW = Date.UTC(2026, 9, 1);
const base: DesktopLicenseState = { schemaVersion: 1, status: "active", enforcement: "enforce", entitlement: "filex-all-access", validUntil: NOW + 90 * 86_400_000, offlineUntil: null, activation: { current: 1, limit: 2 }, lastCheckedAt: NOW, message: "", canUseTools: true };

test("licenza attiva o app fuori da FileX: nessun avviso", () => {
  assert.equal(licenseNotice(null, NOW), null);
  assert.equal(licenseNotice(undefined, NOW), null);
  assert.equal(licenseNotice(base, NOW), null);
});

test("licenza non più valida: avviso di errore che rassicura sul lavoro salvato", () => {
  for (const status of ["expired", "revoked", "unlicensed"] as const) {
    const notice = licenseNotice({ ...base, status, canUseTools: false }, NOW);
    assert.equal(notice?.level, "error", status);
    assert.match(notice!.text, /salvato/);
    assert.match(notice!.text, /FileX Suite/);
  }
});

test("periodo di tolleranza: avviso con la data limite", () => {
  const notice = licenseNotice({ ...base, status: "grace", validUntil: Date.UTC(2026, 9, 10) }, NOW);
  assert.equal(notice?.level, "warn");
  assert.match(notice!.text, /10 ottobre 2026/);
  assert.equal(licenseNotice({ ...base, status: "grace", validUntil: null, offlineUntil: null }, NOW)?.level, "warn");
});

test("prova gratuita: avviso solo nell'ultima settimana", () => {
  assert.equal(licenseNotice({ ...base, trial: true, validUntil: NOW + 20 * 86_400_000 }, NOW), null);
  assert.match(licenseNotice({ ...base, trial: true, validUntil: NOW + 3 * 86_400_000 }, NOW)!.text, /tra 3 giorni/);
  assert.match(licenseNotice({ ...base, trial: true, validUntil: NOW + 86_400_000 }, NOW)!.text, /domani/);
  assert.match(licenseNotice({ ...base, trial: true, validUntil: NOW - 1000 }, NOW)!.text, /oggi/);
  assert.equal(licenseNotice({ ...base, trial: false, validUntil: NOW + 3 * 86_400_000 }, NOW), null, "un abbonamento attivo non è una prova");
});
