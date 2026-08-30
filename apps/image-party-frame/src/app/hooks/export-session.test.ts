import assert from "node:assert/strict";
import test from "node:test";
import { isExportJobSnapshot, normalizeExportSession, type ExportJobSnapshot } from "../lib/exportSession";

const snapshot: ExportJobSnapshot = {
  id: "job-1",
  status: "running",
  createdAt: "2026-08-30T10:00:00.000Z",
  updatedAt: "2026-08-30T10:00:01.000Z",
  progress: {
    phase: "rendering",
    completed: 1,
    total: 2,
    percent: 50,
    currentItemId: "image-2",
  },
};

function validSession() {
  return {
    version: 1,
    intentId: "intent-1",
    idempotencyKey: "partyframe.intent-1",
    projectId: "project-1",
    itemIds: ["image-1", "image-2"],
    itemNames: {
      "image-1": "foto-1.jpg",
      "image-2": "foto-2.jpg",
      injected: "non deve sopravvivere",
    },
    createdAt: "2026-08-30T10:00:00.000Z",
    updatedAt: "2026-08-30T10:00:01.000Z",
    status: "running",
    jobId: "job-1",
    snapshot,
  };
}

test("accepts a bounded export session and removes unrelated display names", () => {
  const normalized = normalizeExportSession(validSession());
  assert.ok(normalized);
  assert.deepEqual(normalized.itemNames, {
    "image-1": "foto-1.jpg",
    "image-2": "foto-2.jpg",
  });
  assert.equal(normalized.snapshot?.id, normalized.jobId);
});

test("rejects invalid statuses, duplicate item ids and snapshot/job mismatches", () => {
  assert.equal(normalizeExportSession({ ...validSession(), status: "surprise" }), null);
  assert.equal(normalizeExportSession({ ...validSession(), itemIds: ["image-1", "image-1"] }), null);
  assert.equal(normalizeExportSession({ ...validSession(), jobId: "another-job" }), null);
});

test("rejects oversized export intents before they can be rendered", () => {
  const itemIds = Array.from({ length: 501 }, (_, index) => `image-${index}`);
  assert.equal(normalizeExportSession({ ...validSession(), itemIds }), null);
});

test("deep-validates persisted job progress and result entries", () => {
  assert.equal(isExportJobSnapshot(snapshot), true);
  assert.equal(isExportJobSnapshot({
    ...snapshot,
    progress: { ...snapshot.progress, completed: 3 },
  }), false);
  assert.equal(isExportJobSnapshot({
    ...snapshot,
    status: "completed",
    progress: { ...snapshot.progress, phase: "completed", completed: 2, percent: 100 },
    result: {
      success: [{ id: "image-1", filename: "ok.jpg", size: Number.NaN }],
      failed: [],
      totalTime: 100,
      outputDir: "C:\\output",
    },
  }), false);
});
