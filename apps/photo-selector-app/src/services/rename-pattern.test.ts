import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildBatchRenamePreview, sanitizeFileName } from "./rename-pattern.js";

const SCATTO = Date.UTC(2026, 8, 4, 13, 24, 18);

describe("buildBatchRenamePreview", () => {
  it("compone data_ora_originale come da esempio", () => {
    const [item] = buildBatchRenamePreview(
      [{ id: "a", fileName: "DSCF4821.jpg", captureTimeMs: SCATTO }],
      { mode: "datetime" },
    );
    assert.equal(item?.to, "20260904_132418_DSCF4821.jpg");
    assert.equal(item?.adjusted, false);
  });

  it("disambigua i secondi identici con sequenza", () => {
    const items = buildBatchRenamePreview(
      [
        { id: "a", fileName: "A.jpg", captureTimeMs: SCATTO },
        { id: "b", fileName: "A.jpg", captureTimeMs: SCATTO },
      ],
      { mode: "datetime" },
    );
    assert.notEqual(items[0]?.to, items[1]?.to);
    assert.equal(items[0]?.adjusted, true);
  });

  it("custom con prefisso e numerazione", () => {
    const items = buildBatchRenamePreview(
      [
        { id: "a", fileName: "x.RAF", captureTimeMs: null },
        { id: "b", fileName: "y.RAF", captureTimeMs: null },
      ],
      { mode: "custom", customText: "Matrimonio", keepOriginalName: false, startNumber: 7, padWidth: 3 },
    );
    assert.deepEqual(items.map((item) => item.to), ["Matrimonio_007.RAF", "Matrimonio_008.RAF"]);
  });

  it("sanifica i caratteri vietati da Windows", () => {
    assert.equal(sanitizeFileName('a<b>:"c".jpg'), "a_b___c_.jpg");
    const [item] = buildBatchRenamePreview(
      [{ id: "a", fileName: "ok.jpg", captureTimeMs: null }],
      { mode: "custom", customText: "a/b", keepOriginalName: false },
    );
    assert.equal(item?.to, "a_b_0001.jpg");
  });
});
