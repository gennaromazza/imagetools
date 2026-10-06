import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { summarizeFrameDeltas } from "./perf-diagnostics";

test("senza frame le statistiche sono a zero", () => {
  assert.deepEqual(summarizeFrameDeltas([]), {
    frames: 0, jankFrames: 0, freezeFrames: 0, maxFrameMs: 0, p95FrameMs: 0,
  });
});

test("distingue frame lenti da blocchi e calcola massimo e p95", () => {
  const deltas = [...Array.from({ length: 18 }, () => 16), 70, 400];
  const stats = summarizeFrameDeltas(deltas);
  assert.equal(stats.frames, 20);
  assert.equal(stats.jankFrames, 2);
  assert.equal(stats.freezeFrames, 1);
  assert.equal(stats.maxFrameMs, 400);
  assert.equal(stats.p95FrameMs, 70);
});

test("il registro è solo locale e non contiene percorsi né rete", () => {
  const code = readFileSync(resolve(process.cwd(), "apps/photo-selector-app/src/services/perf-diagnostics.ts"), "utf8");
  assert.doesNotMatch(code, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket|ipcRenderer/);
  assert.doesNotMatch(code, /\.fileName|absolutePath|sourceFolderPath|asset\./);
});

test("la griglia alimenta il registro e le impostazioni offrono interruttore ed esportazione", () => {
  const selector = readFileSync(resolve(process.cwd(), "apps/photo-selector-app/src/components/PhotoSelector.tsx"), "utf8");
  assert.match(selector, /notePerfScrollEvent\(\);/);
  assert.match(selector, /Esporta diagnostica/);
  assert.match(selector, /solo in locale/);
  const main = readFileSync(resolve(process.cwd(), "apps/photo-selector-app/src/main.tsx"), "utf8");
  assert.match(main, /startPerfDiagnostics\(\);/);
});
