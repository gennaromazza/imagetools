import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileSendService } from "./file-send-service.js";

test("crea una sessione, riceve un file e la invalida alla chiusura", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "filex-send-"));
  const service = new FileSendService({ outputRoot, host: "127.0.0.1", publicAddress: "127.0.0.1" });
  try {
    await service.start();
    const started = await service.startSession("Cliente Test");
    assert.ok(started.session);
    const pageResponse = await fetch(started.session.uploadUrl);
    assert.equal(pageResponse.status, 200);
    const page = await pageResponse.text();
    assert.match(page, /Scegli dalla galleria/);
    assert.match(page, /id="mediaFiles"[^>]+accept="image\/\*,video\/\*"[^>]+multiple/);
    assert.match(page, /Sfoglia altri file/);
    assert.match(page, /id="otherFiles"[^>]+multiple/);
    assert.match(page, /id="previews"/);

    const payload = new TextEncoder().encode("file di prova");
    const uploadResponse = await fetch(`${started.session.uploadUrl.replace(/\/s\/[^/]+$/, "")}/api/session/${new URL(started.session.uploadUrl).pathname.split("/").pop()}/files`, {
      method: "PUT",
      headers: { "X-File-Name": encodeURIComponent("foto.jpg"), "Content-Length": String(payload.byteLength) },
      body: payload,
    });
    assert.equal(uploadResponse.status, 201);
    const snapshot = service.snapshot();
    assert.equal(snapshot.session?.receivedFiles.length, 1);
    assert.equal(await readFile(join(snapshot.session!.folderPath, "foto.jpg"), "utf8"), "file di prova");

    service.closeSession();
    assert.equal((await fetch(started.session.uploadUrl)).status, 410);
  } finally {
    await service.stop();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("rinomina in sicurezza file duplicati", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "filex-send-"));
  const service = new FileSendService({ outputRoot, host: "127.0.0.1", publicAddress: "127.0.0.1" });
  try {
    await service.start();
    const session = (await service.startSession()).session!;
    const token = new URL(session.uploadUrl).pathname.split("/").pop();
    const endpoint = `${session.uploadUrl.replace(/\/s\/[^/]+$/, "")}/api/session/${token}/files`;
    for (const value of ["uno", "due"]) {
      const bytes = new TextEncoder().encode(value);
      assert.equal((await fetch(endpoint, { method: "PUT", headers: { "X-File-Name": "IMG_0001.JPG", "Content-Length": String(bytes.length) }, body: bytes })).status, 201);
    }
    assert.deepEqual(service.snapshot().session?.receivedFiles.map((file) => file.name), ["IMG_0001.JPG", "IMG_0001 (2).JPG"]);
  } finally {
    await service.stop();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("condivide file dal PC tramite un link locale protetto", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "filex-send-share-"));
  const source = join(outputRoot, "listino estate.pdf");
  await writeFile(source, "contenuto da consegnare", "utf8");
  const service = new FileSendService({ outputRoot, host: "127.0.0.1", publicAddress: "127.0.0.1" });
  try {
    await service.start();
    const session = (await service.startSendSession([source], "Cliente Test")).session!;
    assert.equal(session.direction, "send");
    assert.equal(session.receivedFiles.length, 1);
    const page = await (await fetch(session.uploadUrl)).text();
    assert.match(page, /File pronti per te/);
    assert.match(page, /listino estate\.pdf/);
    const token = new URL(session.uploadUrl).pathname.split("/").pop();
    const base = session.uploadUrl.replace(/\/s\/[^/]+$/, "");
    const response = await fetch(`${base}/api/session/${token}/downloads/${session.receivedFiles[0].id}`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "contenuto da consegnare");
    assert.match(response.headers.get("content-disposition") ?? "", /attachment/);
  } finally {
    await service.stop();
    await rm(outputRoot, { recursive: true, force: true });
  }
});
