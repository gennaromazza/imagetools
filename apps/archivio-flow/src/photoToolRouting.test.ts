import assert from "node:assert/strict";
import test from "node:test";
import type { PreviewMediaFile } from "./previewPolicy.js";
import {
  PHOTO_TOOL_SELECTION_LIMIT,
  addVisibleCompatiblePhotos,
  isPhotoToolCompatible,
  togglePhotoSelection,
  validatePhotoToolSelection,
} from "./photoToolRouting.js";

function file(filePath: string, ext = ".jpg", mediaType: PreviewMediaFile["mediaType"] = "photo"): PreviewMediaFile {
  return {
    filePath,
    fileName: filePath.split(/[\\/]/).pop() ?? filePath,
    mtimeMs: 1,
    size: 100,
    ext,
    isJpg: ext === ".jpg" || ext === ".jpeg",
    mediaType,
  };
}

test("rende selezionabili soltanto foto nei formati condivisi dai tre tool", () => {
  for (const ext of [".jpg", ".JPEG", "png", ".webp", ".tif", ".tiff", ".heic", ".heif"]) {
    assert.equal(isPhotoToolCompatible(file(`D:\\DCIM\\foto${ext}`, ext)), true, ext);
  }
  assert.equal(isPhotoToolCompatible(file("D:\\DCIM\\clip.mp4", ".mp4", "video")), false);
  assert.equal(isPhotoToolCompatible(file("D:\\DCIM\\scatto.cr3", ".cr3")), false);
  assert.equal(isPhotoToolCompatible(file("D:\\DCIM\\nota.txt", ".txt", "other")), false);
});

test("toggle conserva la selezione e non supera il limite", () => {
  const initial = new Set(["a.jpg"]);
  const added = togglePhotoSelection(initial, "b.jpg", 2);
  assert.deepEqual([...added.selectedPaths], ["a.jpg", "b.jpg"]);
  assert.equal(added.limitReached, false);
  assert.deepEqual([...initial], ["a.jpg"], "la funzione non deve mutare lo stato React precedente");

  const blocked = togglePhotoSelection(added.selectedPaths, "c.jpg", 2);
  assert.deepEqual([...blocked.selectedPaths], ["a.jpg", "b.jpg"]);
  assert.equal(blocked.limitReached, true);

  const removed = togglePhotoSelection(blocked.selectedPaths, "a.jpg", 2);
  assert.deepEqual([...removed.selectedPaths], ["b.jpg"]);
});

test("seleziona visibili aggiunge solo compatibili, evita duplicati e conserva le foto fuori filtro", () => {
  const hiddenSelection = new Set(["D:\\DCIM\\ieri.jpg"]);
  const result = addVisibleCompatiblePhotos(hiddenSelection, [
    file("D:\\DCIM\\oggi-1.jpg"),
    file("D:\\DCIM\\oggi-2.jpg"),
    file("D:\\DCIM\\clip.mov", ".mov", "video"),
    file("D:\\DCIM\\oggi-1.jpg"),
  ]);
  assert.deepEqual([...result.selectedPaths], [
    "D:\\DCIM\\ieri.jpg",
    "D:\\DCIM\\oggi-1.jpg",
    "D:\\DCIM\\oggi-2.jpg",
  ]);
  assert.equal(result.addedCount, 2);
  assert.equal(result.limitReached, false);
});

test("seleziona visibili segnala il taglio al limite di 500", () => {
  const files = Array.from({ length: PHOTO_TOOL_SELECTION_LIMIT + 10 }, (_, index) => file(`foto-${index}.jpg`));
  const result = addVisibleCompatiblePhotos(new Set(), files);
  assert.equal(result.selectedPaths.size, PHOTO_TOOL_SELECTION_LIMIT);
  assert.equal(result.limitReached, true);
});

test("Party Frame e Batch Layout accettano la selezione multipla; Photo ID esattamente una", () => {
  assert.deepEqual(validatePhotoToolSelection("image-party-frame", 12), { valid: true });
  assert.deepEqual(validatePhotoToolSelection("batch-print-layout", 500), { valid: true });
  assert.deepEqual(validatePhotoToolSelection("id-photo", 1), { valid: true });
  assert.equal(validatePhotoToolSelection("id-photo", 2).valid, false);
  assert.equal(validatePhotoToolSelection("batch-print-layout", 0).valid, false);
  assert.equal(validatePhotoToolSelection("image-party-frame", 501).valid, false);
});
