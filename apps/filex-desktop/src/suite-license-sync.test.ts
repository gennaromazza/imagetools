import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
// @ts-expect-error modulo JavaScript del renderer, senza dichiarazioni di tipo
import { pruneResolvedLicenseDismissals, subscribeLicenseChanges, trialDaysLeft } from "../suite-launcher-src/license-sync.js";

test("il rifiuto della notifica licenza viene dimenticato quando la licenza torna valida", () => {
  const dismissed = new Set(["license:revoked", "update:tool:1.0.0", "suite:ready:2"]);
  assert.equal(pruneResolvedLicenseDismissals(dismissed, { canUseTools: false, status: "revoked" }), false);
  assert.ok(dismissed.has("license:revoked"), "con licenza ancora non valida il rifiuto resta");
  assert.equal(pruneResolvedLicenseDismissals(dismissed, { canUseTools: true, status: "active" }), true);
  assert.deepEqual([...dismissed].sort(), ["suite:ready:2", "update:tool:1.0.0"]);
  assert.equal(pruneResolvedLicenseDismissals(dismissed, null), false);
});

test("i giorni di prova rimasti seguono il tempo e non vanno sotto zero", () => {
  const day = 86400000;
  assert.equal(trialDaysLeft({ validUntil: 10 * day }, 7 * day + 1), 3);
  assert.equal(trialDaysLeft({ validUntil: 10 * day }, 12 * day), 0);
  assert.equal(trialDaysLeft({ validUntil: null }, 0), 0);
});

test("l'ascolto degli eventi licenza inoltra gli stati e si puo' annullare", () => {
  const received: unknown[] = [];
  let listener: ((state: unknown) => void) | null = null;
  const off = subscribeLicenseChanges({ onLicenseState: (cb: (state: unknown) => void) => { listener = cb; return () => { listener = null; }; } }, (s: unknown) => received.push(s));
  listener!({ status: "active" });
  assert.deepEqual(received, [{ status: "active" }]);
  off();
  assert.equal(listener, null);
  assert.equal(typeof subscribeLicenseChanges({}, () => {}), "function");
});

test("dashboard e dock usano davvero gli eventi licenza e la pulizia dei rifiuti", () => {
  const app = readFileSync(new URL("../suite-launcher-src/app.js", import.meta.url), "utf8");
  const dock = readFileSync(new URL("../suite-launcher-src/launcher.js", import.meta.url), "utf8");
  assert.match(app, /subscribeLicenseChanges\(api,\s*renderLicense\)/);
  assert.match(app, /trialDaysLeft\(/);
  assert.match(app, /setInterval\(\(\) => \{ if \(licenseState\) renderLicense\(licenseState\);/);
  assert.match(dock, /subscribeLicenseChanges\(api,/);
  assert.match(dock, /pruneResolvedLicenseDismissals\(dismissed,\s*license\)/);
});

test("il processo principale pubblica l'evento e invia a dashboard e dock", () => {
  const main = readFileSync(new URL("./suite-main.ts", import.meta.url), "utf8");
  const preload = readFileSync(new URL("./suite-preload.ts", import.meta.url), "utf8");
  assert.match(main, /createLicenseWatcher\(/);
  assert.match(main, /LICENSE_STATE_CHANGED_CHANNEL/);
  assert.match(main, /licenseWatcher\.notify\(/);
  assert.match(preload, /onLicenseState/);
});

test("i moduli importati dal main della Suite sono nella whitelist del pacchetto", () => {
  const builder = readFileSync(new URL("../electron-builder.config.mjs", import.meta.url), "utf8");
  const listed = new Set([...builder.matchAll(/"\.output\/electron\/([\w-]+)\.js"/g)].map((match) => match[1]));
  const queue = ["suite-main"];
  const visited = new Set<string>();
  while (queue.length) {
    const name = queue.shift()!;
    if (visited.has(name)) continue;
    visited.add(name);
    assert.ok(listed.has(name), `${name}.js manca da files in electron-builder.config.mjs`);
    const source = readFileSync(new URL(`./${name}.ts`, import.meta.url), "utf8");
    for (const match of source.matchAll(/from\s+"\.\/([\w-]+)\.js"/g)) queue.push(match[1]);
  }
  assert.ok(visited.has("license-watcher") && visited.has("single-flight"));
});
