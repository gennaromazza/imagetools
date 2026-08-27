import assert from "node:assert/strict";
import test from "node:test";
import {
  UPLOAD_CHUNK_SIZE,
  UPLOAD_MAX_RETRIES,
  UPLOAD_REQUEST_TIMEOUT_MS,
  chunkCount,
  chunkEnd,
  isRetryableStatus,
  nextOffset,
  offsetFromRange,
  retryDelay,
  totalBytes,
} from "./public/upload-protocol.js";

test("usa blocchi da 16 MB", () => assert.equal(UPLOAD_CHUNK_SIZE, 16 * 1024 * 1024));
test("limita i retry automatici a cinque tentativi", () => assert.equal(UPLOAD_MAX_RETRIES, 5));
test("applica un timeout per richiesta", () => assert.equal(UPLOAD_REQUEST_TIMEOUT_MS, 120_000));
test("calcola la fine del primo blocco", () => assert.equal(chunkEnd(0, 40), 39));
test("calcola la fine di un blocco intermedio", () => assert.equal(chunkEnd(16, 100, 16), 31));
test("non supera la dimensione totale nell'ultimo blocco", () => assert.equal(chunkEnd(96, 100, 16), 99));
test("legge l'offset dal Range Firebase", () => assert.equal(offsetFromRange("bytes=0-1048575"), 1048576));
test("gestisce Range assente mantenendo il fallback", () => assert.equal(offsetFromRange(""), null));
test("riconosce la risposta parziale 308", () => assert.equal(nextOffset(308, "bytes=0-15", 32), 16));
test("riparte da zero quando Firebase non restituisce Range", () => assert.equal(nextOffset(308, "", 32), 0));
test("riconosce il completamento del blocco", () => assert.equal(nextOffset(201, "", 32), 32));
test("considera riprovabili timeout, rate limit e errori server", () => assert.ok([0, 408, 429, 500, 503].every(isRetryableStatus)));
test("mantiene non riprovabili gli errori client", () => assert.equal(isRetryableStatus(400), false));
test("usa backoff esponenziale con tetto massimo", () => assert.deepEqual([0, 1, 2, 5].map(retryDelay), [500, 1000, 2000, 8000]));
test("somma correttamente un invio distribuito su piu file", () => assert.equal(totalBytes([{ size: 7 * 1024 ** 3 }, { size: 7 * 1024 ** 3 }, { size: 6 * 1024 ** 3 }]), 20 * 1024 ** 3));
test("mantiene separati i blocchi dei file ma copre tutto il totale", () => assert.equal([7, 7, 6].reduce((sum, gigabytes) => sum + chunkCount(gigabytes * 1024 ** 3), 0), 1280));
