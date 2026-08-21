import assert from "node:assert/strict";
import test from "node:test";
import { bloomMayContain, createBloomFilter } from "./bloom-filter.js";

function generatedValues(seed: number, count: number): string[] {
  let state = seed >>> 0;
  return Array.from({ length: count }, (_, index) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return `${index}:${state.toString(16)}:${(state ^ (index * 2654435761)).toString(36)}`;
  });
}

test("bug hunt: Bloom filter non perde elementi su dataset generati", () => {
  for (const seed of [1, 7, 42, 20260820]) {
    for (const count of [1, 31, 257, 2048]) {
      const values = generatedValues(seed, count);
      const filter = createBloomFilter(values, Math.max(256, count * 12), 7);
      for (const value of values) {
        assert.equal(bloomMayContain(filter, value), true, `falso negativo con seed=${seed}, count=${count}`);
      }
    }
  }
});
