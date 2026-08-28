import assert from "node:assert/strict";
import test from "node:test";
import { IndexedPriorityQueue } from "./indexed-priority-queue";
import { PerformanceWorkCoordinator } from "./performance-work-coordinator";

test("la coda indicizzata mantiene FIFO e aggiorna la priorita", () => {
  const queue = new IndexedPriorityQueue<{ id: string }>();
  queue.set("background-a", { id: "background-a" }, 3);
  queue.set("background-b", { id: "background-b" }, 3);
  queue.set("visible", { id: "visible" }, 0);
  queue.updatePriority("background-b", 1);
  assert.deepEqual(
    [queue.dequeue()?.id, queue.dequeue()?.id, queue.dequeue()?.id],
    ["visible", "background-b", "background-a"],
  );
});

test("il coordinatore riserva uno slot ai lavori interattivi", async () => {
  const coordinator = new PerformanceWorkCoordinator(2, 1);
  const events: string[] = [];
  let releaseBackground = () => {};
  const backgroundCanFinish = new Promise<void>((resolve) => { releaseBackground = resolve; });
  const first = coordinator.run("bg-1", 3, async () => {
    events.push("bg-1-start");
    await backgroundCanFinish;
    events.push("bg-1-end");
  });
  const second = coordinator.run("bg-2", 3, () => { events.push("bg-2"); });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(coordinator.getSnapshot().activeBackground, 1);
  assert.equal(coordinator.getSnapshot().queued, 1);

  await coordinator.run("visible", 0, () => { events.push("visible"); });
  assert.deepEqual(events.slice(0, 2), ["bg-1-start", "visible"]);
  releaseBackground();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["bg-1-start", "visible", "bg-1-end", "bg-2"]);
});

test("un lavoro accodato puo essere promosso", async () => {
  const coordinator = new PerformanceWorkCoordinator(1, 0);
  const events: string[] = [];
  let releaseActive = () => {};
  const activeCanFinish = new Promise<void>((resolve) => { releaseActive = resolve; });
  const active = coordinator.run("active", 0, () => activeCanFinish);
  const low = coordinator.run("low", 4, () => { events.push("low"); });
  const promoted = coordinator.run("promoted", 3, () => { events.push("promoted"); });
  assert.equal(coordinator.reprioritize("promoted", 0), true);
  releaseActive();
  await Promise.all([active, low, promoted]);
  assert.deepEqual(events, ["promoted", "low"]);
});

test("la coda gestisce 50.000 elementi e promozioni sparse senza perdere entry", () => {
  const queue = new IndexedPriorityQueue<{ id: number }>();
  for (let index = 0; index < 50_000; index += 1) {
    queue.set(String(index), { id: index }, 4);
  }
  for (let index = 0; index < 50_000; index += 50) {
    queue.updatePriority(String(index), 0);
  }

  for (let index = 0; index < 1_000; index += 1) {
    assert.equal(queue.dequeue()?.id, index * 50);
  }
  let remaining = 0;
  while (queue.dequeue()) remaining += 1;
  assert.equal(remaining, 49_000);
  assert.equal(queue.size, 0);
});
