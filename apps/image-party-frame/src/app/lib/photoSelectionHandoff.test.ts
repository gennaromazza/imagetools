import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopPhotoToolHandoff } from "@photo-tools/desktop-contracts";
import {
  onPhotoSelectionHandoff,
  publishPhotoSelectionHandoff,
} from "./photoSelectionHandoff.js";

function makeHandoff(id: string): DesktopPhotoToolHandoff {
  return {
    schemaVersion: 1,
    handoffId: id,
    sourceToolId: "archivio-flow",
    targetToolId: "image-party-frame",
    sourceRoot: "C:\\scheda",
    files: [],
    createdAt: "2026-08-31T00:00:00.000Z",
    expiresAt: "2026-08-31T00:10:00.000Z",
  };
}

test("conserva gli handoff arrivati prima del mount e li completa in ordine FIFO", async () => {
  const completed: string[] = [];
  const first = publishPhotoSelectionHandoff(makeHandoff("first"));
  const second = publishPhotoSelectionHandoff(makeHandoff("second"));

  const unsubscribe = onPhotoSelectionHandoff(async (handoff) => {
    await Promise.resolve();
    completed.push(handoff.handoffId);
  });
  try {
    await Promise.all([first, second]);
    assert.deepEqual(completed, ["first", "second"]);
  } finally {
    unsubscribe();
  }
});

test("non avvia il secondo handoff finché il primo non è terminato", async () => {
  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const unsubscribe = onPhotoSelectionHandoff(async (handoff) => {
    events.push(`start:${handoff.handoffId}`);
    if (handoff.handoffId === "one") await firstGate;
    events.push(`end:${handoff.handoffId}`);
  });
  try {
    const first = publishPhotoSelectionHandoff(makeHandoff("one"));
    const second = publishPhotoSelectionHandoff(makeHandoff("two"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(events, ["start:one"]);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(events, ["start:one", "end:one", "start:two", "end:two"]);
  } finally {
    unsubscribe();
  }
});

test("propaga l'errore al mittente e prosegue con la richiesta successiva", async () => {
  const completed: string[] = [];
  const unsubscribe = onPhotoSelectionHandoff(async (handoff) => {
    if (handoff.handoffId === "broken") throw new Error("import fallito");
    completed.push(handoff.handoffId);
  });
  try {
    const broken = publishPhotoSelectionHandoff(makeHandoff("broken"));
    const valid = publishPhotoSelectionHandoff(makeHandoff("valid"));
    await assert.rejects(broken, /import fallito/);
    await valid;
    assert.deepEqual(completed, ["valid"]);
  } finally {
    unsubscribe();
  }
});
