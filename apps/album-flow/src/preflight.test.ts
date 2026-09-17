import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAlbumPreflight } from "./preflight";

const project = (overrides = {}) => ({ settings: { sheet: { widthCm: 30, heightCm: 30, dpi: 300, marginCm: 1, gapCm: .3, bleedCm: .3 } }, assets: [{ selected: true }], pages: [{}], ...overrides } as any);
test("preflight accetta progetto valido", () => assert.deepEqual(validateAlbumPreflight(project()), []));
test("preflight segnala foto, pagine e formato mancanti", () => {
  const errors = validateAlbumPreflight(project({ assets: [], pages: [], settings: { sheet: { widthCm: 0, heightCm: -1, dpi: 40, marginCm: 20, gapCm: -1, bleedCm: -1 } } }));
  assert.equal(errors.length, 6);
});
