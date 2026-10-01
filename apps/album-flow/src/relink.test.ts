import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAlbumAssetPath } from "./relink";

test("risolve asset relativi dentro la radice Windows", () => {
  assert.equal(resolveAlbumAssetPath("C:/Album", "chapters\\a.jpg"), "C:\\Album\\chapters\\a.jpg");
  assert.equal(resolveAlbumAssetPath("C:/Album", "C:/Album/a.jpg"), "C:\\Album\\a.jpg");
  assert.equal(resolveAlbumAssetPath("c:\\Album\\", "c:\\album\\b\\..\\a.jpg"), "C:\\album\\a.jpg");
});
test("risolve asset relativi e assoluti dentro la radice macOS/Linux", () => {
  assert.equal(resolveAlbumAssetPath("/Users/anna/Album", "cap 1/a.jpg"), "/Users/anna/Album/cap 1/a.jpg");
  assert.equal(resolveAlbumAssetPath("/Users/anna/Album/", "/Users/anna/Album/a.jpg"), "/Users/anna/Album/a.jpg");
  assert.equal(resolveAlbumAssetPath("/Volumes/Foto", "./x/../a.jpg"), "/Volumes/Foto/a.jpg");
});
test("risolve percorsi UNC di rete", () => {
  assert.equal(resolveAlbumAssetPath("\\\\nas\\foto", "a\\b.jpg"), "\\\\nas\\foto\\a\\b.jpg");
});
test("rifiuta traversal, radici vuote e file esterni", () => {
  assert.throws(() => resolveAlbumAssetPath("C:/Album", "../secret.jpg"));
  assert.throws(() => resolveAlbumAssetPath("", "a.jpg"));
  assert.throws(() => resolveAlbumAssetPath("C:/Album", "D:/Other/a.jpg"));
  assert.throws(() => resolveAlbumAssetPath("C:/Album", "C:/AlbumX/a.jpg"));
  assert.throws(() => resolveAlbumAssetPath("/Users/anna/Album", "../secret.jpg"));
  assert.throws(() => resolveAlbumAssetPath("/Users/anna/Album", "/Users/anna/AlbumX/a.jpg"));
  assert.throws(() => resolveAlbumAssetPath("/Users/anna/Album", "/etc/passwd"));
  assert.throws(() => resolveAlbumAssetPath("/Users/anna/Album", "C:\\x\\a.jpg"));
});
