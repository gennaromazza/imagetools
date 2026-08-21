import assert from "node:assert/strict";
import test from "node:test";
import { parseFileNameInput } from "../apps/image-file-finder/src/input-parser.js";

test("bug hunt: conserva virgole e separatori racchiusi tra virgolette", () => {
  const parsed = parseFileNameInput('"Mario, Anna 01.jpg"; "Luca; Sara.jpg"');
  assert.deepEqual(parsed.names, ["Mario, Anna 01.jpg", "Luca; Sara.jpg"]);
});

test("bug hunt: estrae il basename e deduplica senza distinguere maiuscole", () => {
  const parsed = parseFileNameInput('C:\\Foto\\SCATTO.JPG\n"D:/Altro/scatto.jpg"\nritratto.raw');
  assert.deepEqual(parsed.names, ["SCATTO.JPG", "ritratto.raw"]);
  assert.deepEqual(parsed.ignoredDuplicates, ["scatto.jpg"]);
});

test("bug hunt: input vuoti o composti da separatori non producono nomi fantasma", () => {
  assert.deepEqual(parseFileNameInput("  \n,;\t  "), { names: [], ignoredDuplicates: [] });
});
