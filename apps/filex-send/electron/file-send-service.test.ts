import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inflateRawSync } from "node:zlib";
import { FileSendService } from "./file-send-service.js";
import { FileSendRemoteClient, type PersistedRemoteSession } from "./remote-client-service.js";

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
    assert.match(page, /id="mediaFiles"[^>]+accept="\*\/\*"[^>]+multiple/);
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

    service.closeSession(started.session.id);
    assert.equal((await fetch(started.session.uploadUrl)).status, 410);
  } finally {
    await service.stop();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("mantiene più sessioni locali e separa le cartelle anche per lo stesso cliente", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "filex-send-multi-"));
  const service = new FileSendService({ outputRoot, host: "127.0.0.1", publicAddress: "127.0.0.1" });
  try {
    await service.start();
    const first = (await service.startSession("Cliente Ripetuto")).session!;
    const second = (await service.startSession("Cliente Ripetuto")).session!;

    assert.equal(service.getSessions().length, 2);
    assert.notEqual(first.folderPath, second.folderPath);
    assert.equal((await fetch(first.uploadUrl)).status, 200);
    assert.equal((await fetch(second.uploadUrl)).status, 200);

    service.closeSession(first.id);
    assert.equal((await fetch(first.uploadUrl)).status, 410);
    assert.equal((await fetch(second.uploadUrl)).status, 200);
  } finally {
    await service.stop();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("ripristina e gestisce più sessioni Internet senza sovrascriverle", async () => {
  const makeSession = (id: string, label: string): PersistedRemoteSession => ({
    id, label, desktopToken: `token-${id}`, direction: "receive", uploadUrl: `https://example.test/r/${id}`,
    folderPath: `C:\\FileX\\${id}`, createdAt: Date.now(), receivedBytes: 0, receivedFiles: [],
    activeUploads: 0, activeUploadBytes: 0, clientCompleted: false,
  });
  const client = new FileSendRemoteClient({
    baseUrl: "http://127.0.0.1:1", firebaseApiKey: "test-key", outputRoot: "C:\\FileX",
    restoredSessions: [makeSession("uno", "Cliente Uno"), makeSession("due", "Cliente Due")],
  });

  assert.deepEqual(client.getSessions().map((session) => session.id), ["uno", "due"]);
  await client.closeSession("uno");
  assert.deepEqual(client.getSessions().map((session) => session.id), ["due"]);
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
  const additionalSource = join(outputRoot, "catalogo autunno.pdf");
  await writeFile(source, "contenuto da consegnare", "utf8");
  await writeFile(additionalSource, "secondo contenuto", "utf8");
  const service = new FileSendService({ outputRoot, host: "127.0.0.1", publicAddress: "127.0.0.1" });
  try {
    await service.start();
    const session = (await service.startSendSession([source], "Cliente Test")).session!;
    assert.equal(session.direction, "send");
    assert.equal(session.receivedFiles.length, 1);
    const page = await (await fetch(session.uploadUrl)).text();
    assert.match(page, /File pronti per te/);
    assert.match(page, /Scarica tutti/);
    assert.match(page, /listino estate\.pdf/);
    await service.addSendFiles(session.id, [additionalSource]);
    assert.equal(service.getSession(session.id)?.receivedFiles.length, 2);
    assert.equal(service.getSession(session.id)?.receivedFiles.find((file) => file.name === "catalogo autunno.pdf")?.size, Buffer.byteLength("secondo contenuto"));
    const token = new URL(session.uploadUrl).pathname.split("/").pop();
    const base = session.uploadUrl.replace(/\/s\/[^/]+$/, "");
    const sharedFiles = service.getSession(session.id)!.receivedFiles;
    const responses = await Promise.all(sharedFiles.map((file) => fetch(`${base}/api/session/${token}/downloads/${file.id}`)));
    assert.deepEqual(responses.map((response) => response.status), [200, 200]);
    assert.equal(responses[0]?.headers.get("content-type"), "application/pdf");
    assert.equal(responses[1]?.headers.get("content-type"), "application/pdf");
    assert.deepEqual(await Promise.all(responses.map((response) => response.text())), ["contenuto da consegnare", "secondo contenuto"]);
    assert.ok(responses.every((response) => /attachment/.test(response.headers.get("content-disposition") ?? "")));
  } finally {
    await service.stop();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("l'endpoint ZIP restituisce file integri e rinomina correttamente i duplicati", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "filex-send-zip-"));
  const sourceNames = ["foto.jpg", "foto.jpg", "foto (1).jpg"];
  const sources = await Promise.all(["a", "b", "c"].map(async (folder, index) => {
    const directory = join(outputRoot, folder);
    await mkdir(directory);
    const source = join(directory, sourceNames[index]);
    await writeFile(source, `contenuto-${index + 1}`, "utf8");
    return source;
  }));
  const service = new FileSendService({ outputRoot, host: "127.0.0.1", publicAddress: "127.0.0.1" });
  try {
    await service.start();
    const session = (await service.startSendSession(sources, "Cliente ZIP")).session!;
    assert.equal(session.receivedFiles.length, 3);
    const token = new URL(session.uploadUrl).pathname.split("/").pop();
    const base = session.uploadUrl.replace(/\/s\/[^/]+$/, "");

    const zipResponse = await fetch(`${base}/api/session/${token}/zip`);
    assert.equal(zipResponse.status, 200);
    assert.equal(zipResponse.headers.get("content-type"), "application/zip");
    assert.match(zipResponse.headers.get("content-disposition") ?? "", /filex-send\.zip/);

    const zipEntries = readZipEntries(Buffer.from(await zipResponse.arrayBuffer()));
    assert.deepEqual([...zipEntries.keys()], ["foto.jpg", "foto (2).jpg", "foto (1).jpg"]);
    assert.deepEqual([...zipEntries.values()].map((content) => content.toString("utf8")), ["contenuto-1", "contenuto-2", "contenuto-3"]);

    const page = await (await fetch(session.uploadUrl)).text();
    assert.match(page, /Scarica ZIP/);
    assert.match(page, /tutti i file insieme/);
  } finally {
    await service.stop();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("un file rimosso durante la preparazione dello ZIP non arresta il servizio", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "filex-send-zip-missing-"));
  const source = join(outputRoot, "temporaneo.jpg");
  await writeFile(source, "contenuto temporaneo", "utf8");
  const service = new FileSendService({ outputRoot, host: "127.0.0.1", publicAddress: "127.0.0.1" });
  try {
    await service.start();
    const session = (await service.startSendSession([source], "Cliente ZIP interrotto")).session!;
    const token = new URL(session.uploadUrl).pathname.split("/").pop();
    const base = session.uploadUrl.replace(/\/s\/[^/]+$/, "");
    await rm(source, { force: true });

    await assert.rejects(async () => {
      const response = await fetch(`${base}/api/session/${token}/zip`);
      await response.arrayBuffer();
    });
    assert.equal((await fetch(session.uploadUrl)).status, 200);
  } finally {
    await service.stop();
    await rm(outputRoot, { recursive: true, force: true });
  }
});

function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  const endSignature = 0x06054b50;
  let endOffset = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === endSignature) { endOffset = offset; break; }
  }
  assert.notEqual(endOffset, -1, "Directory centrale ZIP assente");
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  let centralOffset = buffer.readUInt32LE(endOffset + 16);
  const entries = new Map<string, Buffer>();

  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(buffer.readUInt32LE(centralOffset), 0x02014b50, "Entry centrale ZIP non valida");
    const method = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const fileNameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localOffset = buffer.readUInt32LE(centralOffset + 42);
    const fileName = buffer.subarray(centralOffset + 46, centralOffset + 46 + fileNameLength).toString("utf8");
    assert.equal(buffer.readUInt32LE(localOffset), 0x04034b50, "Header locale ZIP non valido");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    const content = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : assert.fail(`Metodo ZIP non supportato nel test: ${method}`);
    entries.set(fileName, content);
    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}
