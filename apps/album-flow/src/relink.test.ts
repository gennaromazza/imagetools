import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAlbumAssetPath } from "./relink";
test("risolve asset relativi dentro la radice", () => {
  assert.equal(resolveAlbumAssetPath("C:/Album", "chapters\\a.jpg"), "C:\\Album\\chapters\\a.jpg");
  assert.equal(resolveAlbumAssetPath("C:/Album", "C:/Album/a.jpg"), "C:\\Album\\a.jpg");
});
test("rifiuta traversal, radici vuote e file esterni", () => {
  assert.throws(() => resolveAlbumAssetPath("C:/Album", "../secret.jpg"));
  assert.throws(() => resolveAlbumAssetPath("", "a.jpg"));
  assert.throws(() => resolveAlbumAssetPath("C:/Album", "D:/Other/a.jpg"));
});
