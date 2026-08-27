import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileXSendRemoteServer } from "./server.js";

test("crea una sessione, riceve e consegna un file una sola volta", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "filex-send-remote-"));
  const server = new FileXSendRemoteServer({ dataDir, host: "127.0.0.1", port: 0, createToken: "test-token", ttlMs: 60_000 });
  try {
    const baseUrl = await server.start();
    const createdResponse = await fetch(`${baseUrl}/api/sessions`, { method: "POST", headers: { authorization: "Bearer test-token", "content-type": "application/json" }, body: JSON.stringify({ label: "Cliente remoto" }) });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as { sessionId: string; desktopToken: string; uploadUrl: string };
    assert.equal((await fetch(created.uploadUrl)).status, 200);
    const publicToken = new URL(created.uploadUrl).pathname.split("/").pop();
    const bytes = new TextEncoder().encode("foto remota");
    const uploaded = await fetch(`${baseUrl}/api/public/${publicToken}/files`, {
      method: "PUT",
      headers: {
        "content-type": "application/custom-file",
        "x-file-name": encodeURIComponent("vacanza.jpg"),
        "content-length": String(bytes.length),
      },
      body: bytes,
    });
    assert.equal(uploaded.status, 201);

    const auth = { authorization: `Bearer ${created.desktopToken}` };
    const status = await (await fetch(`${baseUrl}/api/desktop/${created.sessionId}`, { headers: auth })).json() as { files: Array<{ id: string; name: string }> };
    assert.equal(status.files[0]?.name, "vacanza.jpg");
    const fileResponse = await fetch(`${baseUrl}/api/desktop/${created.sessionId}/files/${status.files[0].id}`, { headers: auth });
    assert.equal(fileResponse.headers.get("content-type"), "application/custom-file");
    assert.ok(/vacanza\.jpg/.test(fileResponse.headers.get("content-disposition") ?? ""));
    assert.equal(await fileResponse.text(), "foto remota");
    assert.equal((await fetch(`${baseUrl}/api/desktop/${created.sessionId}/files/${status.files[0].id}`, { method: "DELETE", headers: auth })).status, 200);
    const afterDelete = await (await fetch(`${baseUrl}/api/desktop/${created.sessionId}`, { headers: auth })).json() as { files: unknown[] };
    assert.equal(afterDelete.files.length, 0);
  } finally {
    await server.stop();
    await rm(dataDir, { recursive: true, force: true });
  }
});
