import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import { uniqueArchiveNames, writeZipArchive } from "./archive.js";

test("rinomina i duplicati senza sovrascrivere nomi gia presenti", () => {
  assert.deepEqual(
    uniqueArchiveNames(["clip.mov", "clip.mov", "clip (1).mov"]),
    ["clip.mov", "clip (2).mov", "clip (1).mov"],
  );
});

test("genera uno ZIP in streaming senza accumulare i file sorgente", async () => {
  const chunks: Buffer[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });

  await writeZipArchive([
    { name: "video.mov", size: 5, createReadStream: () => Readable.from(Buffer.from("video")) },
    { name: "foto.jpg", size: 4, createReadStream: () => Readable.from(Buffer.from("foto")) },
  ], destination);

  const archive = Buffer.concat(chunks);
  assert.equal(archive.subarray(0, 2).toString("ascii"), "PK");
  assert.equal(archive.includes(Buffer.from("video.mov")), true);
  assert.equal(archive.includes(Buffer.from("foto.jpg")), true);
});
