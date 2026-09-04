import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseExifDateTime } from "./capture-time-parser.js";

const WALL = Date.UTC(2024, 4, 12, 14, 33, 2);

describe("parseExifDateTime", () => {
  it("legge data EXIF base senza fuso", () => {
    assert.equal(parseExifDateTime("2024:05:12 14:33:02")?.timeMs, WALL);
  });

  it("applica subsecondi e offset separati", () => {
    const parsed = parseExifDateTime("2024:05:12 14:33:02", "123", "+02:00");
    assert.equal(parsed?.timeMs, WALL - 2 * 3_600_000 + 123);
    assert.equal(parsed?.hasSubSeconds, true);
    assert.equal(parsed?.offsetApplied, true);
  });

  it("legge decimali e zona inline", () => {
    const parsed = parseExifDateTime("2024:05:12 14:33:02.5+02:00");
    assert.equal(parsed?.timeMs, WALL - 2 * 3_600_000 + 500);
  });

  it("accetta Date, numeri e oggetti con toMillis", () => {
    assert.equal(parseExifDateTime(new Date(WALL))?.timeMs, WALL);
    assert.equal(parseExifDateTime(WALL)?.timeMs, WALL);
    assert.equal(parseExifDateTime({ toMillis: () => WALL + 7 })?.timeMs, WALL + 7);
  });

  it("rifiuta spazzatura senza eccezioni", () => {
    for (const bad of [null, undefined, {}, [], "", "ieri", "2024-13-99 99:99:99", { toMillis: () => { throw new Error("x"); } }]) {
      assert.equal(parseExifDateTime(bad), null);
    }
  });
});
