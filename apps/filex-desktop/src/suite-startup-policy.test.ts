import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveSuiteDockEnabled,
  resolveSuiteStartupPolicy,
} from "./suite-startup-policy.js";

test("l'avvio automatico mantiene nascosta la Suite ma crea la Dock", () => {
  assert.deepEqual(
    resolveSuiteStartupPolicy({ startsInBackground: true, dockEnabled: true }),
    { createMainWindow: false, createDock: true },
  );
});

test("l'avvio manuale apre Suite e Dock quando la preferenza e' attiva", () => {
  assert.deepEqual(
    resolveSuiteStartupPolicy({ startsInBackground: false, dockEnabled: true }),
    { createMainWindow: true, createDock: true },
  );
});

test("la preferenza disattivata impedisce la Dock senza bloccare la Suite", () => {
  assert.deepEqual(
    resolveSuiteStartupPolicy({ startsInBackground: false, dockEnabled: false }),
    { createMainWindow: true, createDock: false },
  );
  assert.deepEqual(
    resolveSuiteStartupPolicy({ startsInBackground: true, dockEnabled: false }),
    { createMainWindow: false, createDock: false },
  );
});

test("i profili precedenti alla preferenza mantengono la Dock attiva", () => {
  assert.equal(resolveSuiteDockEnabled(undefined), true);
  assert.equal(resolveSuiteDockEnabled({}), true);
  assert.equal(resolveSuiteDockEnabled({ enabled: true }), true);
  assert.equal(resolveSuiteDockEnabled({ enabled: false }), false);
});
