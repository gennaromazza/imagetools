import assert from "node:assert/strict";
import test from "node:test";
import { bloomMayContain, createBloomFilter } from "./bloom-filter.js";

test("Bloom filter non produce falsi negativi per fingerprint registrati", () => {
  const values = ["10:abc", "20:def", "30:ghi"];
  const filter = createBloomFilter(values, 1024, 4);
  for (const value of values) assert.equal(bloomMayContain(filter, value), true);
  assert.equal(filter.itemCount, values.length);
});
