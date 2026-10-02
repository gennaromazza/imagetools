import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { COOPERATIVE_SIGNAL_TIMEOUT_MS, sendSignalWithRetry } from "./cooperative-process-signal.js";
import {
  COOPERATIVE_SIGNAL_ATTEMPTS,
  TOOL_COOPERATIVE_SHUTDOWN_TIMEOUT_MS,
  TOOL_GRACEFUL_SHUTDOWN_TIMEOUT_MS,
  TOOL_NATIVE_SHUTDOWN_BUDGET_MS,
  usesWindowCloseFallback,
} from "./update-shutdown-policy.js";
import {
  isSuiteInstallInProgress,
  shouldCheckSuiteUpdate,
  shouldNotifySuiteReady,
  SUITE_UPDATE_CHECK_INTERVAL_MS,
} from "./suite-update-policy.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("l'attesa cooperativa supera il budget di chiusura nativa dei tool", () => {
  assert.ok(TOOL_COOPERATIVE_SHUTDOWN_TIMEOUT_MS > TOOL_NATIVE_SHUTDOWN_BUDGET_MS + 2_000);
  const main = read("./main.ts");
  const nativeBudget = Number(/NATIVE_SHUTDOWN_TIMEOUT_MS\s*=\s*([\d_]+)/.exec(main)?.[1].replaceAll("_", ""));
  assert.equal(nativeBudget, TOOL_NATIVE_SHUTDOWN_BUDGET_MS, "il budget in main.ts e' cambiato: aggiorna la policy");
  assert.ok(TOOL_GRACEFUL_SHUTDOWN_TIMEOUT_MS >= 4_000);
});

test("il segnale cooperativo ha piu' tempo e viene ritentato prima del fallback", async () => {
  assert.ok(COOPERATIVE_SIGNAL_TIMEOUT_MS >= 5_000);
  assert.ok(COOPERATIVE_SIGNAL_ATTEMPTS >= 2);
  let calls = 0;
  await sendSignalWithRetry("tool.exe", ["--filex-update-shutdown"], 2, async () => { calls += 1; if (calls === 1) throw new Error("ETIMEDOUT"); });
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(sendSignalWithRetry("tool.exe", [], 2, async () => { calls += 1; throw new Error("ETIMEDOUT"); }), /ETIMEDOUT/);
  assert.equal(calls, 2);
});

test("i tool che si nascondono alla chiusura saltano il WM_CLOSE inutile", () => {
  assert.equal(usesWindowCloseFallback("archivio-flow"), false);
  assert.equal(usesWindowCloseFallback("photo-selector-app"), true);
  const coordinator = read("./filex-process-coordinator.ts");
  assert.match(coordinator, /usesWindowCloseFallback\(toolId\)/);
  assert.match(coordinator, /sendSignalWithRetry\(/);
  assert.match(coordinator, /finestra di salvataggio/);
  assert.match(coordinator, /Forza chiusura/);
});

test("la Suite controlla periodicamente le nuove versioni senza sovrapporsi", () => {
  assert.ok(SUITE_UPDATE_CHECK_INTERVAL_MS <= 6 * 60 * 60 * 1000);
  for (const status of ["checking", "downloading", "ready", "installing", "disabled"] as const) assert.equal(shouldCheckSuiteUpdate(status), false, status);
  for (const status of ["idle", "up-to-date", "error", "available"] as const) assert.equal(shouldCheckSuiteUpdate(status), true, status);
  const main = read("./suite-main.ts");
  assert.match(main, /setInterval\(\(\) => \{\s*if \(shouldCheckSuiteUpdate\(/);
  assert.match(main, /clearInterval\(suiteUpdateTimer\)/);
});

test("l'avviso di aggiornamento pronto compare una sola volta per versione e solo a dashboard chiusa", () => {
  const base = { status: "ready" as const, version: "0.2.0", lastNotifiedVersion: null, dashboardVisible: false };
  assert.equal(shouldNotifySuiteReady(base), true);
  assert.equal(shouldNotifySuiteReady({ ...base, dashboardVisible: true }), false);
  assert.equal(shouldNotifySuiteReady({ ...base, lastNotifiedVersion: "0.2.0" }), false);
  assert.equal(shouldNotifySuiteReady({ ...base, status: "downloading" }), false);
  assert.equal(shouldNotifySuiteReady({ ...base, version: null }), false);
});

test("durante l'installazione della Suite non si possono aprire tool", () => {
  assert.equal(isSuiteInstallInProgress("installing"), true);
  assert.equal(isSuiteInstallInProgress("ready"), false);
  const main = read("./suite-main.ts");
  assert.equal(main.match(/isSuiteInstallInProgress\(getSuiteUpdateState\(\)\.status\)/g)?.length, 2, "tray e IPC devono entrambi bloccare");
});

test("la dashboard non installa piu' da sola dopo 10 secondi e il testo e' coerente", () => {
  const app = read("../suite-launcher-src/app.js");
  assert.doesNotMatch(app, /startSuiteInstallCountdown/);
  assert.doesNotMatch(app, /partirà automaticamente/);
  assert.match(app, /Salva il lavoro nei tool aperti/);
  assert.match(app, /suiteUpdateInstall\.hidden = false/);
});
