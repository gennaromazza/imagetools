import assert from "node:assert/strict";
import test from "node:test";
import { singleFlight } from "./single-flight.js";

test("chiamate concorrenti con la stessa chiave eseguono una sola operazione", async () => {
  let calls = 0;
  const run = singleFlight(async (key: boolean) => { calls += 1; await new Promise((r) => setTimeout(r, 10)); return key; });
  const results = await Promise.all([run(true), run(true), run(true)]);
  assert.deepEqual(results, [true, true, true]);
  assert.equal(calls, 1);
});

test("chiavi diverse non si bloccano e dopo la fine si riparte", async () => {
  let calls = 0;
  const run = singleFlight(async (key: boolean) => { calls += 1; return key; });
  await Promise.all([run(true), run(false)]);
  assert.equal(calls, 2);
  await run(true);
  assert.equal(calls, 3);
});

test("un errore non resta in cache e viene propagato a tutti", async () => {
  let calls = 0;
  const run = singleFlight(async (_key: boolean) => { calls += 1; if (calls === 1) throw new Error("rete"); return "ok"; });
  const failed = await Promise.allSettled([run(true), run(true)]);
  assert.ok(failed.every((item) => item.status === "rejected"));
  assert.equal(await run(true), "ok");
});
