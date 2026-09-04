import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findLikelyDuplicateGroups } from "./duplicate-groups.js";

function asset(id: string, fileName: string, size: number, width: number, height: number) {
  return { id, fileName, size, width, height };
}

describe("findLikelyDuplicateGroups", () => {
  it("raggruppa solo peso e dimensioni identici", () => {
    const groups = findLikelyDuplicateGroups([
      asset("a", "IMG_001.JPG", 1000, 100, 80),
      asset("b", "copia.JPG", 1000, 100, 80),
      asset("c", "altra.JPG", 1001, 100, 80),
      asset("d", "stretta.JPG", 1000, 90, 80),
    ]);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0]?.assetIds, ["a", "b"]);
  });

  it("ignora file senza dimensioni o peso noti", () => {
    const groups = findLikelyDuplicateGroups([
      asset("a", "IMG_001.JPG", 0, 100, 80),
      asset("b", "IMG_002.JPG", 1000, 0, 80),
      asset("c", "IMG_003.JPG", 1000, 100, 80),
    ]);
    assert.equal(groups.length, 0);
  });

  it("ordina per numerosità decrescente", () => {
    const groups = findLikelyDuplicateGroups([
      asset("a", "x1.JPG", 10, 10, 10),
      asset("b", "x2.JPG", 10, 10, 10),
      asset("c", "y1.JPG", 20, 20, 20),
      asset("d", "y2.JPG", 20, 20, 20),
      asset("e", "y3.JPG", 20, 20, 20),
    ]);
    assert.deepEqual(groups.map((group) => group.assetIds.length), [3, 2]);
  });
});
