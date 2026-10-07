import { describe, expect, it } from "vitest";
import { clampCopies, copiesFor, expandAssetsByCopies, moveItem, totalPrintCount } from "./copies";

const photos = ["a", "b", "c", "d"].map((id) => ({ id }));

describe("copie per foto e ordine", () => {
  it("limita le copie a valori interi tra 1 e 99", () => {
    expect(clampCopies(0)).toBe(1);
    expect(clampCopies(-5)).toBe(1);
    expect(clampCopies(2.6)).toBe(3);
    expect(clampCopies(500)).toBe(99);
    expect(clampCopies(Number.NaN)).toBe(1);
  });

  it("usa la copia della singola foto, altrimenti quella generale", () => {
    expect(copiesFor("a", 2, {})).toBe(2);
    expect(copiesFor("a", 2, { a: 5 })).toBe(5);
    expect(copiesFor("a", 2, { b: 5 })).toBe(2);
  });

  it("espande le foto mantenendo le copie adiacenti e l'ordine", () => {
    const expanded = expandAssetsByCopies(photos, 1, { b: 3, d: 2 });
    expect(expanded.map((photo) => photo.id)).toEqual(["a", "b", "b", "b", "c", "d", "d"]);
    expect(totalPrintCount(photos, 1, { b: 3, d: 2 })).toBe(7);
    expect(totalPrintCount([], 4, {})).toBe(0);
  });

  it("sposta una foto al posto di un'altra in entrambe le direzioni", () => {
    expect(moveItem(photos, "a", "c").map((photo) => photo.id)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(photos, "d", "b").map((photo) => photo.id)).toEqual(["a", "d", "b", "c"]);
    expect(moveItem(photos, "a", "a")).toBe(photos);
    expect(moveItem(photos, "x", "a")).toBe(photos);
  });
});
