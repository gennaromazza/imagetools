import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { StudioFlowStore } from "./studioflow-store.js";

test("indice SQLite gestisce dataset da 1.000, 5.000 e 20.000 file", async () => {
  const root = await mkdtemp(join(tmpdir(), "studioflow-perf-"));
  const store = new StudioFlowStore(root);
  try {
    store.upsertArchive("perf", "D:/archive", { jobLevel: 3 });
    for (const datasetSize of [1_000, 5_000, 20_000]) {
      const entries = Array.from({ length: datasetSize }, (_, index) => ({
        relativePath: `2026/job-${Math.floor(index / 500)}/file-${index}.jpg`,
        entryType: "file" as const,
        size: index + 1,
        mtimeMs: index,
      }));
      const reconciliationStarted = performance.now();
      store.replaceArchiveEntries("perf", entries);
      const reconciliationMs = performance.now() - reconciliationStarted;

      const queryStarted = performance.now();
      const status = store.getArchiveStatus("perf");
      const queryMs = performance.now() - queryStarted;

      assert.equal(status.fileCount, datasetSize);
      assert.ok(
        reconciliationMs < 5_000,
        `Reconciliation ${datasetSize} file troppo lenta: ${reconciliationMs.toFixed(0)} ms`,
      );
      assert.ok(queryMs < 250, `Query indice troppo lenta: ${queryMs.toFixed(0)} ms`);
    }
  } finally {
    store.close();
    await rm(root, { recursive:true, force:true });
  }
});
