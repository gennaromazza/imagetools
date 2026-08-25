import assert from "node:assert/strict";
import test from "node:test";
import { ProcessSnapshotCache } from "./process-snapshot-cache.js";

test("condivide il fetch mentre tasklist è ancora in volo", async () => {
  const cache = new ProcessSnapshotCache(5);
  let calls = 0;
  let resolveFetch!: (value: Set<string>) => void;
  const fetchSnapshot = () => {
    calls += 1;
    return new Promise<Set<string>>((resolve) => { resolveFetch = resolve; });
  };

  const first = cache.get(fetchSnapshot);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = cache.get(fetchSnapshot);
  assert.equal(calls, 1);
  resolveFetch(new Set(["filex-tool"]));
  assert.deepEqual(await first, new Set(["filex-tool"]));
  assert.deepEqual(await second, new Set(["filex-tool"]));

  await new Promise((resolve) => setTimeout(resolve, 15));
  await cache.get(async () => { calls += 1; return new Set(); });
  assert.equal(calls, 2);
});
