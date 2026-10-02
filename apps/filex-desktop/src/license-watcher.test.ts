import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopLicenseState } from "@photo-tools/desktop-contracts";
import { createLicenseWatcher, licenseSignature } from "./license-watcher.js";

function state(overrides: Partial<DesktopLicenseState> = {}): DesktopLicenseState {
  return {
    schemaVersion: 1, status: "active", enforcement: "enforce", entitlement: "filex-all-access",
    validUntil: 1000, offlineUntil: 2000, activation: { current: 1, limit: 2 },
    lastCheckedAt: 1, message: "FileX All Access attivo.", canUseTools: true, ...overrides,
  };
}

test("la firma ignora lastCheckedAt ma vede revoca e scadenza", () => {
  assert.equal(licenseSignature(state()), licenseSignature(state({ lastCheckedAt: 999 })));
  assert.notEqual(licenseSignature(state()), licenseSignature(state({ status: "revoked", canUseTools: false })));
  assert.notEqual(licenseSignature(state()), licenseSignature(state({ validUntil: 5 })));
});

test("pubblica solo quando lo stato cambia davvero", async () => {
  const published: DesktopLicenseState[] = [];
  let current = state();
  const watcher = createLicenseWatcher({ read: async () => current, publish: (s) => published.push(s), intervalMs: 1000, revalidateEveryMs: 5000 });
  await watcher.check();
  await watcher.check();
  current = state({ lastCheckedAt: 50 });
  await watcher.check();
  assert.equal(published.length, 1);
  current = state({ status: "revoked", canUseTools: false, message: "Licenza revocata." });
  await watcher.check();
  assert.equal(published.length, 2);
  assert.equal(published[1].status, "revoked");
});

test("notify da attivazione o disattivazione propaga subito lo stato e non duplica", () => {
  const published: DesktopLicenseState[] = [];
  const watcher = createLicenseWatcher({ read: async () => state(), publish: (s) => published.push(s), intervalMs: 1000, revalidateEveryMs: 5000 });
  watcher.notify(state());
  watcher.notify(state());
  watcher.notify(state({ status: "unlicensed", canUseTools: false, entitlement: null }));
  assert.deepEqual(published.map((s) => s.status), ["active", "unlicensed"]);
});

test("un errore di lettura non interrompe i controlli successivi", async () => {
  const published: DesktopLicenseState[] = [];
  let fail = true;
  const watcher = createLicenseWatcher({
    read: async () => { if (fail) throw new Error("rete"); return state(); },
    publish: (s) => published.push(s), intervalMs: 1000, revalidateEveryMs: 5000,
  });
  await watcher.check();
  assert.equal(published.length, 0);
  fail = false;
  await watcher.check();
  assert.equal(published.length, 1);
});

test("il timer forza la validazione col server solo alla scadenza dell'intervallo lungo", async () => {
  const refreshFlags: boolean[] = [];
  let clock = 0;
  const watcher = createLicenseWatcher({
    read: async (refresh) => { refreshFlags.push(refresh); return state(); },
    publish: () => {}, intervalMs: 10, revalidateEveryMs: 30, now: () => clock,
  });
  watcher.start();
  await new Promise((r) => setTimeout(r, 5));
  clock = 10; await new Promise((r) => setTimeout(r, 15));
  clock = 40; await new Promise((r) => setTimeout(r, 15));
  watcher.stop();
  assert.equal(refreshFlags[0], false);
  assert.ok(refreshFlags.slice(1).some((flag) => flag === true), "serve almeno una validazione forzata");
  assert.equal(refreshFlags.filter((flag) => flag).length >= 1, true);
});
