import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { StudioFlowStore, type ImportSessionRecord } from "./studioflow-store.js";

function session(id: string, status: ImportSessionRecord["status"]): ImportSessionRecord {
  return {
    id, cardSnapshotId:null, jobId:null, archiveId:"archive", sourceRoot:"S:/", destinationRoot:"D:/archive/job",
    destinationRelativePath:"job", status, startedAt:1, updatedAt:1, completedAt:null, verifiedAt:null,
    totalFiles:1, plannedFiles:1, importedFiles:0, verifiedFiles:0, duplicateFiles:0, skippedFiles:0,
    failedFiles:0, totalBytes:10, importedBytes:0, syncStatus:"PENDING", errorCode:null, errorMessage:null,
  };
}

test("persiste sessioni, prove e recovery senza sovrascrivere la cronologia", async () => {
  const root = await mkdtemp(join(tmpdir(), "studioflow-store-"));
  let store: StudioFlowStore | null = new StudioFlowStore(root);
  try {
    store.upsertArchive("archive", "D:/archive", { jobLevel: 3 });
    store.createSession(session("one", "COMPLETED"));
    store.updateSession("one", { verifiedAt: 2, importedFiles: 1, verifiedFiles: 1, completedAt: 2 });
    store.upsertImportFile({
      sessionId:"one", sourceRelativePath:"a.jpg", sourceSize:10, sourceMtimeMs:1, fastFingerprint:"fast",
      fullHash:null, destinationPath:"D:/archive/job/a.jpg", destinationSize:10, destinationFingerprint:"fast",
      status:"VERIFIED", errorMessage:null, updatedAt:2,
    });
    store.createSession(session("two", "IMPORTING"));
    store.saveSessionPayload("two", { resume: true });
    store.upsertImportFile({
      sessionId:"two", sourceRelativePath:"untrusted.jpg", sourceSize:10, sourceMtimeMs:1, fastFingerprint:"untrusted",
      fullHash:null, destinationPath:"D:/archive/job/untrusted.jpg", destinationSize:10, destinationFingerprint:"untrusted",
      status:"VERIFIED", errorMessage:null, updatedAt:2,
    });
    assert.equal(store.listSessions().length, 2);
    assert.equal(store.findSafeEvidence(10, "fast").length, 1);
    assert.equal(store.findSafeEvidence(10, "untrusted").length, 0);
    assert.deepEqual(store.getSessionPayload("two"), { resume: true });
    store.enqueueOutbox("session", "one", "IMPORT_COMPLETED", { id: "one" });
    assert.equal(store.health().pendingOutbox, 1);
    const pending = store.listPendingOutbox();
    store.markOutboxRetry([pending[0]!.id], "offline");
    assert.equal(store.listPendingOutbox().length, 0);
    store.markOutboxSynced([pending[0]!.id]);
    assert.equal(store.health().pendingOutbox, 0);
    assert.equal(existsSync(store.backup()), true);
    store.close();
    store = new StudioFlowStore(root);
    assert.equal(store.listSessions().find((item) => item.id === "two")?.status, "INTERRUPTED");
    assert.equal(store.health().integrity, "ok");
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("recupera un database corrotto conservandone una copia diagnostica", async () => {
  const root = await mkdtemp(join(tmpdir(), "studioflow-corrupt-"));
  try {
    await writeFile(join(root, "studioflow.sqlite"), "not-a-sqlite-database", "utf8");
    const store = new StudioFlowStore(root);
    assert.equal(store.health().integrity, "ok");
    store.close();
    assert.ok((await readdir(root)).some((name) => name.startsWith("studioflow.sqlite.corrupt-")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("migra in avanti un database schema 1 senza perdere le tabelle esistenti", async () => {
  const root = await mkdtemp(join(tmpdir(), "studioflow-migrate-"));
  try {
    let store = new StudioFlowStore(root);
    const databasePath = store.databasePath;
    store.close();
    const legacy = new DatabaseSync(databasePath);
    legacy.exec("DELETE FROM schema_migrations WHERE version > 1; DROP TABLE IF EXISTS session_payloads; DROP TABLE IF EXISTS app_meta; DROP TABLE IF EXISTS app_settings; DROP TABLE IF EXISTS jobs;");
    legacy.close();
    store = new StudioFlowStore(root);
    store.setSettings({ migrated:true });
    assert.deepEqual(store.getSettings(), { migrated:true });
    assert.equal(store.health().schemaVersion, 3);
    store.close();
  } finally {
    await rm(root, { recursive:true, force:true });
  }
});
