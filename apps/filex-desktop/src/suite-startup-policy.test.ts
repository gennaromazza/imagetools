import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveSuiteDockEnabled,
  resolveSuiteStartupPolicy,
  resolveSuiteLauncherBounds,
} from "./suite-startup-policy.js";

test("la dock resta centrata sul clic anche quando si espandono i comandi", () => {
  const area = { x: 0, y: 0, width: 1920, height: 1032 };
  for (const width of [316, 468]) {
    const bounds = resolveSuiteLauncherBounds(area, width, 116, 1359);
    assert.equal(bounds.x + bounds.width / 2, 1359);
    assert.equal(bounds.y + bounds.height, 1024);
  }
});

test("la dock resta nel monitor con taskbar laterale, coordinate negative e poco spazio", () => {
  const area = { x: -1920, y: 30, width: 1880, height: 1000 };
  assert.equal(resolveSuiteLauncherBounds(area, 468, 116, -1910).x, -1920);
  assert.equal(resolveSuiteLauncherBounds(area, 468, 116, -50).x, -508);
  assert.deepEqual(resolveSuiteLauncherBounds({ x: 0, y: 0, width: 200, height: 100 }, 468, 116, 150),
    { x: 0, y: 0, width: 200, height: 100 });
});

test("l'avvio automatico non apre la gestione e prepara il launcher", () => {
  assert.deepEqual(
    resolveSuiteStartupPolicy({ startsInBackground: true, dockEnabled: true }),
    { createMainWindow: false, createDock: true },
  );
});

test("l'avvio manuale apre solo il launcher quando la preferenza e' attiva", () => {
  assert.deepEqual(
    resolveSuiteStartupPolicy({ startsInBackground: false, dockEnabled: true }),
    { createMainWindow: false, createDock: true },
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
