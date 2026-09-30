import assert from "node:assert/strict";
import test from "node:test";
import { DOWNLOAD_CHUNK_BYTES, DOWNLOAD_START_DELAY_MS, downloadFilesSequentially, saveFilesToDirectory, uniqueDownloadName } from "./public/download-protocol.js";
import { UPLOAD_CHUNK_SIZE, UPLOAD_MAX_RETRIES, UPLOAD_REQUEST_TIMEOUT_MS, chunkCount, chunkEnd, isRetryableStatus, nextOffset, offsetFromRange, retryDelay, totalBytes } from "./public/upload-protocol.js";

test("usa blocchi da 16 MB", () => assert.equal(UPLOAD_CHUNK_SIZE, 16 * 1024 * 1024));
test("limita i retry automatici a cinque tentativi", () => assert.equal(UPLOAD_MAX_RETRIES, 5));
test("applica un timeout per richiesta", () => assert.equal(UPLOAD_REQUEST_TIMEOUT_MS, 120_000));
test("calcola la fine del primo blocco", () => assert.equal(chunkEnd(0, 40), 39));
test("calcola la fine di un blocco intermedio", () => assert.equal(chunkEnd(16, 100, 16), 31));
test("non supera la dimensione totale nell'ultimo blocco", () => assert.equal(chunkEnd(96, 100, 16), 99));
test("legge l'offset dal Range Firebase", () => assert.equal(offsetFromRange("bytes=0-1048575"), 1048576));
test("gestisce Range assente mantenendo il fallback", () => assert.equal(offsetFromRange(""), null));
test("riconosce la risposta parziale 308", () => assert.equal(nextOffset(308, "bytes=0-15", 32), 16));
test("considera riprovabili timeout, rate limit e errori server", () => assert.ok([0, 408, 429, 500, 503].every(isRetryableStatus)));
test("mantiene non riprovabili gli errori client", () => assert.equal(isRetryableStatus(400), false));
test("usa backoff esponenziale con tetto massimo", () => { assert.deepEqual([0, 1, 2, 5].map(retryDelay), [500, 1000, 2000, 8000]); });
test("somma correttamente un invio distribuito su più file", () => assert.equal(totalBytes([{ size: 7 * 1024 ** 3 }, { size: 7 * 1024 ** 3 }, { size: 6 * 1024 ** 3 }]), 20 * 1024 ** 3));
test("mantiene separati i blocchi dei file ma copre tutto il totale", () => assert.equal([7, 7, 6].reduce((sum, gigabytes) => sum + chunkCount(gigabytes * 1024 ** 3), 0), 1280));
test("mantiene nomi distinti nella cartella di destinazione", () => {
  const used = new Set();
  assert.deepEqual([uniqueDownloadName("foto.jpg", used), uniqueDownloadName("foto.jpg", used), uniqueDownloadName("foto.jpg", used)], ["foto.jpg", "foto (2).jpg", "foto (3).jpg"]);
});

test("salva i file in una cartella con una sola autorizzazione e blocchi verificati", async () => {
  const requested = [];
  const ranges = [];
  const written = [];
  const directory = { getFileHandle: async (name) => {
    requested.push(name);
    return { createWritable: async () => ({
      write: async (bytes) => written.push({ name, size: bytes.byteLength }),
      close: async () => {},
      abort: async () => {},
    }) };
  } };
  const files = [
    { name: "uno.jpg", size: DOWNLOAD_CHUNK_BYTES + 2, downloadProxyUrl: "/api/public/token/files/uno" },
    { name: "uno.jpg", size: 3, downloadProxyUrl: "/api/public/token/files/due" },
  ];
  await saveFilesToDirectory(files, directory, async (url, options) => {
    const [start, end] = /bytes=(\d+)-(\d+)/.exec(options.headers.Range).slice(1).map(Number);
    ranges.push({ url, start, end });
    return {
      status: 206,
      headers: new Headers({ "content-range": `bytes ${start}-${end}/${files.find((file) => file.downloadProxyUrl === url.split("?")[0]).size}` }),
      arrayBuffer: async () => new Uint8Array(end - start + 1).buffer,
    };
  });
  assert.deepEqual(requested, ["uno.jpg", "uno (2).jpg"]);
  assert.deepEqual(ranges, [
    { url: `/api/public/token/files/uno?start=0&end=${DOWNLOAD_CHUNK_BYTES - 1}`, start: 0, end: DOWNLOAD_CHUNK_BYTES - 1 },
    { url: `/api/public/token/files/uno?start=${DOWNLOAD_CHUNK_BYTES}&end=${DOWNLOAD_CHUNK_BYTES + 1}`, start: DOWNLOAD_CHUNK_BYTES, end: DOWNLOAD_CHUNK_BYTES + 1 },
    { url: "/api/public/token/files/due?start=0&end=2", start: 0, end: 2 },
  ]);
  assert.deepEqual(written.map(({ name, size }) => ({ name, size })), [
    { name: "uno.jpg", size: DOWNLOAD_CHUNK_BYTES },
    { name: "uno.jpg", size: 2 },
    { name: "uno (2).jpg", size: 3 },
  ]);
});

test("avvia i download separati in sequenza", async () => {
  const started = [];
  const delays = [];
  await downloadFilesSequentially(
    [{ name: "uno.jpg" }, { name: "due.jpg" }, { name: "tre.jpg" }],
    (file, index, total) => started.push({ name: file.name, index, total }),
    async (milliseconds) => { delays.push(milliseconds); },
  );
  assert.deepEqual(started, [
    { name: "uno.jpg", index: 0, total: 3 },
    { name: "due.jpg", index: 1, total: 3 },
    { name: "tre.jpg", index: 2, total: 3 },
  ]);
  assert.deepEqual(delays, [DOWNLOAD_START_DELAY_MS, DOWNLOAD_START_DELAY_MS]);
});
