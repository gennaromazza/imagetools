import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isNativeFolderImageFile } from "../apps/filex-desktop/src/native-folder-service.js";

describe("Batch Print Layout — policy immagini desktop", () => {
  it("mantiene compatibili formati standard e RAW", () => {
    assert.equal(isNativeFolderImageFile("foto.JPG"), true);
    assert.equal(isNativeFolderImageFile("scatto.CR3"), true);
  });

  it("abilita HEIC, HEIF e TIFF soltanto su richiesta esplicita", () => {
    for (const fileName of ["foto.HEIC", "foto.heif", "scan.TIF", "scan.tiff"]) {
      assert.equal(isNativeFolderImageFile(fileName), false, fileName);
      assert.equal(isNativeFolderImageFile(fileName, true), true, fileName);
    }
  });

  it("ignora sidecar AppleDouble e file non immagine", () => {
    assert.equal(isNativeFolderImageFile("._foto.HEIC", true), false);
    assert.equal(isNativeFolderImageFile("note.txt", true), false);
  });
});
