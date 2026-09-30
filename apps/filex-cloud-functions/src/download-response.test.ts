import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough, Readable } from "node:stream";
import type { ServerResponse } from "node:http";
import { sendDownloadRange } from "./download-response.js";

function fakeResponse() {
  const stream = new PassThrough();
  const headers = new Map<string, string>();
  Object.assign(stream, {
    headers,
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value); },
  });
  return { stream, headers };
}

test("invia un intervallo parziale sotto il limite cloud", async () => {
  const { stream, headers } = fakeResponse();
  const chunks: Buffer[] = [];
  stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  await sendDownloadRange(
    { name: "foto.jpg", size: 10, contentType: "image/jpeg" },
    "bytes=2-5",
    stream as unknown as ServerResponse,
    ({ start, end }) => Readable.from(Buffer.from(`chunk-${start}-${end}`)),
  );
  assert.equal((stream as unknown as ServerResponse).statusCode, 206);
  assert.equal(headers.get("content-range"), "bytes 2-5/10");
  assert.equal(headers.get("content-length"), "4");
  assert.equal(headers.get("content-type"), "image/jpeg");
  assert.equal(Buffer.concat(chunks).toString(), "chunk-2-5");
});

test("rifiuta un download completo sopra il limite", async () => {
  const { stream, headers } = fakeResponse();
  const chunks: Buffer[] = [];
  stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  await sendDownloadRange(
    { name: "video.mp4", size: 4 * 1024 * 1024 + 1 },
    undefined,
    stream as unknown as ServerResponse,
    () => { throw new Error("non deve aprire lo stream"); },
  );
  assert.equal((stream as unknown as ServerResponse).statusCode, 416);
  assert.equal(headers.get("content-range"), "bytes */4194305");
  assert.match(Buffer.concat(chunks).toString(), /download a blocchi/);
});

