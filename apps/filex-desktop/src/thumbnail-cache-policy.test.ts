import assert from "node:assert/strict";
import test from "node:test";
import {
  AsyncReadWriteGate,
  getDiskCacheBudgetBytes,
  normalizeDiskCacheBudgetPreset,
  selectDiskCacheEntriesToPrune,
} from "./thumbnail-cache-policy.js";

test("normalizza i preset e mantiene unlimited senza limite", () => {
  assert.equal(normalizeDiskCacheBudgetPreset("performance"), "performance");
  assert.equal(normalizeDiskCacheBudgetPreset("sconosciuto"), "balanced");
  assert.equal(getDiskCacheBudgetBytes("compact"), 2 * 1024 * 1024 * 1024);
  assert.equal(getDiskCacheBudgetBytes("unlimited"), null);
});

test("il pruning elimina prima le entry meno recenti e lascia margine al budget", () => {
  const selected = selectDiskCacheEntriesToPrune([
    { name: "new.thumb", size: 40, mtimeMs: 30 },
    { name: "old.thumb", size: 40, mtimeMs: 10 },
    { name: "middle.preview", size: 40, mtimeMs: 20 },
  ], 100, 0.9);

  assert.deepEqual(selected.map((entry) => entry.name), ["old.thumb"]);
  assert.deepEqual(selectDiskCacheEntriesToPrune(selected, null), []);
});

test("un'operazione esclusiva attende le scritture attive e blocca quelle successive", async () => {
  const gate = new AsyncReadWriteGate();
  const events: string[] = [];
  let releaseFirstWrite = () => {};
  const firstWriteCanFinish = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve;
  });

  const firstWrite = gate.runShared(async () => {
    events.push("shared-1-start");
    await firstWriteCanFinish;
    events.push("shared-1-end");
  });
  await Promise.resolve();

  const exclusive = gate.runExclusive(async () => {
    events.push("exclusive");
  });
  const secondWrite = gate.runShared(async () => {
    events.push("shared-2");
  });

  releaseFirstWrite();
  await Promise.all([firstWrite, exclusive, secondWrite]);
  assert.deepEqual(events, ["shared-1-start", "shared-1-end", "exclusive", "shared-2"]);
});
