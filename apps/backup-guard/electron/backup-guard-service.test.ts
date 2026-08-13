import assert from "node:assert/strict";
import test from "node:test";
import { buildDifferencePlan, testSnapshot } from "./backup-guard-service.js";

const file = (bytes: number, mtimeMs = 1) => testSnapshot("file", bytes, mtimeMs);

test("classifica un nuovo file master come copia verso clone", () => {
  const result = buildDifferencePlan(new Map([["A.raw", file(10)]]), new Map(), null);
  assert.equal(result[0]?.kind, "copy-to-clone");
});

test("classifica un nuovo file clone come importazione", () => {
  const result = buildDifferencePlan(new Map(), new Map([["Viaggio/A.raw", file(10)]]), null);
  assert.equal(result[0]?.kind, "import-from-clone");
});

test("propaga una cancellazione master soltanto con baseline", () => {
  const baseline = new Map([["Cliente/A.raw", file(10)]]);
  const result = buildDifferencePlan(new Map(), new Map([["Cliente/A.raw", file(10)]]), baseline);
  assert.equal(result[0]?.kind, "delete-from-clone");
});

test("ripristina un file eliminato soltanto dal clone", () => {
  const baseline = new Map([["Cliente/A.raw", file(10)]]);
  const result = buildDifferencePlan(new Map([["Cliente/A.raw", file(10)]]), new Map(), baseline);
  assert.equal(result[0]?.kind, "restore-to-clone");
});

test("blocca come conflitto le modifiche simultanee", () => {
  const baseline = new Map([["Catalogo.lrcat", file(10, 1)]]);
  const result = buildDifferencePlan(new Map([["Catalogo.lrcat", file(12, 2)]]), new Map([["Catalogo.lrcat", file(14, 3)]]), baseline);
  assert.equal(result[0]?.kind, "conflict");
});
