import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createIdPhotoPrintHtml, printIdPhotoPagesDesktop, validateIdPhotoPrintRequest } from "./id-photo-print-service.js";

const request = {
  title: "Mario & CIE",
  sheetWidthMm: 100,
  sheetHeightMm: 150,
  pages: [{ jpegBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) }],
};

test("crea un documento fisico 10x15 senza adattamento pagina", () => {
  const html = createIdPhotoPrintHtml(request);
  assert.match(html, /@page \{ size: 100mm 150mm; margin: 0; \}/u);
  assert.match(html, /Mario &amp; CIE/u);
  assert.match(html, /data:image\/jpeg;base64,/u);
});

test("apre il pannello nativo in modalità non silenziosa", async () => {
  const printOptions: Array<Record<string, unknown>> = [];
  const loadedUrls: string[] = [];
  let loadedHtml = "";
  let destroyed = false;
  const result = await printIdPhotoPagesDesktop(request, () => ({
    loadURL: async (url) => {
      loadedUrls.push(url);
      loadedHtml = await readFile(fileURLToPath(url), "utf8");
    },
    isDestroyed: () => destroyed,
    destroy: () => { destroyed = true; },
    webContents: {
      print: (options, callback) => {
        printOptions.push(options);
        callback(true, "");
      },
    },
  }));
  assert.deepEqual(result, { status: "submitted" });
  assert.match(loadedUrls[0] ?? "", /^file:\/\//u);
  assert.doesNotMatch(loadedUrls[0] ?? "", /^data:/u);
  assert.match(loadedHtml, /data:image\/jpeg;base64/u);
  await assert.rejects(stat(fileURLToPath(loadedUrls[0]!)));
  assert.equal(printOptions[0]?.silent, false);
  assert.deepEqual(printOptions[0]?.pageSize, { width: 100_000, height: 150_000 });
  assert.equal(destroyed, true);
});

test("stampa direttamente sulla stampante scelta mantenendo formato e copie", async () => {
  let printOptions: Record<string, unknown> | null = null;
  let destroyed = false;
  const result = await printIdPhotoPagesDesktop({
    ...request,
    showDialog: false,
    deviceName: "DS-RX1",
    copies: 2,
  }, () => ({
    loadURL: async () => undefined,
    isDestroyed: () => destroyed,
    destroy: () => { destroyed = true; },
    webContents: {
      print: (options, callback) => {
        printOptions = options;
        callback(true, "");
      },
    },
  }));
  assert.deepEqual(result, { status: "submitted" });
  const submittedOptions = printOptions as Record<string, unknown> | null;
  assert.ok(submittedOptions);
  assert.equal(submittedOptions.silent, true);
  assert.equal(submittedOptions.deviceName, "DS-RX1");
  assert.equal(submittedOptions.copies, 2);
  assert.deepEqual(submittedOptions.pageSize, { width: 100_000, height: 150_000 });
  assert.equal(destroyed, true);
});

test("rifiuta richieste vuote o fogli fuori limite", () => {
  assert.throws(() => validateIdPhotoPrintRequest({ ...request, pages: [] }), /da 1 a 48 fogli/u);
  assert.throws(() => validateIdPhotoPrintRequest({ ...request, sheetWidthMm: 0 }), /fuori dai limiti/u);
  assert.throws(() => validateIdPhotoPrintRequest({ ...request, showDialog: false }), /Seleziona una stampante/u);
  assert.throws(() => validateIdPhotoPrintRequest({ ...request, copies: 100 }), /Numero di copie/u);
});
