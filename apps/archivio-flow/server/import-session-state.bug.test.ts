import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertImportSessionTransition } from "./import-session-state.js";
import { StudioFlowStore, type ImportSessionRecord } from "./studioflow-store.js";

test("bug hunt: consente soltanto il percorso nominale della sessione import", () => {
  const route = ["CREATED", "ANALYZING", "READY", "IMPORTING", "VERIFYING", "COMPLETED"] as const;
  for (let index = 0; index < route.length - 1; index += 1) {
    assert.doesNotThrow(() => assertImportSessionTransition(route[index]!, route[index + 1]!));
  }
});

test("bug hunt: blocca salti di stato e riapertura degli stati terminali", () => {
  for (const [from, to] of [
    ["CREATED", "COMPLETED"],
    ["READY", "COMPLETED"],
    ["COMPLETED", "IMPORTING"],
    ["CANCELLED", "ANALYZING"],
    ["FAILED", "COMPLETED"],
  ] as const) {
    assert.throws(
      () => assertImportSessionTransition(from, to),
      new RegExp(`${from} -> ${to}`),
    );
  }
});

test("bug hunt: lo store SQLite rifiuta davvero una transizione vietata", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "studioflow-state-bug-"));
  const store = new StudioFlowStore(dataDir);
  const session: ImportSessionRecord = {
    id: "state-guard",
    cardSnapshotId: null,
    jobId: null,
    archiveId: "main",
    sourceRoot: "S:/",
    destinationRoot: "D:/Archivio/Lavoro",
    destinationRelativePath: "Lavoro",
    status: "READY",
    startedAt: 1,
    updatedAt: 1,
    completedAt: null,
    verifiedAt: null,
    totalFiles: 1,
    plannedFiles: 1,
    importedFiles: 0,
    verifiedFiles: 0,
    duplicateFiles: 0,
    skippedFiles: 0,
    failedFiles: 0,
    totalBytes: 10,
    importedBytes: 0,
    syncStatus: "PENDING",
    errorCode: null,
    errorMessage: null,
  };
  try {
    store.createSession(session);
    assert.throws(() => store.updateSession(session.id, { status: "COMPLETED" }), /READY -> COMPLETED/u);
    assert.equal(store.listSessions().find((item) => item.id === session.id)?.status, "READY");
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
