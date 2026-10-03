import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { isConsoleRequest, registerSupportRoutes } from "./support.js";

test("only the console page itself may read support messages", () => {
  assert.equal(isConsoleRequest(undefined, "127.0.0.1:4390", 4390), true);
  assert.equal(isConsoleRequest("http://127.0.0.1:4390", "127.0.0.1:4390", 4390), true);
  assert.equal(isConsoleRequest("http://localhost:4390", "localhost:4390", 4390), true);
  assert.equal(isConsoleRequest("https://sito-malevolo.example", "127.0.0.1:4390", 4390), false);
  assert.equal(isConsoleRequest("http://127.0.0.1:9999", "127.0.0.1:4390", 4390), false);
  assert.equal(isConsoleRequest(undefined, "sito-malevolo.example:4390", 4390), false, "DNS rebinding");
  assert.equal(isConsoleRequest(undefined, undefined, 4390), false);
});

async function withServer<T>(run: (base: string, port: number) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  registerSupportRoutes(app, port);
  try { return await run(`http://127.0.0.1:${port}`, port); }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}

test("foreign origins and malformed requests are rejected before any Firestore access", async () => {
  await withServer(async (base) => {
    const foreign = await fetch(`${base}/api/support/messages`, { headers: { origin: "https://sito-malevolo.example" } });
    assert.equal(foreign.status, 403);
    const badFilter = await fetch(`${base}/api/support/messages?status=../../x`);
    assert.equal(badFilter.status, 400);
    const badId = await fetch(`${base}/api/support/messages/non-un-id/export`);
    assert.equal(badId.status, 400);
    const badStatus = await fetch(`${base}/api/support/messages/SUP-ABCD2345/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "cancellato" }) });
    assert.equal(badStatus.status, 400);
    const foreignWrite = await fetch(`${base}/api/support/messages/SUP-ABCD2345/status`, { method: "POST", headers: { "content-type": "application/json", origin: "https://sito-malevolo.example" }, body: JSON.stringify({ status: "read" }) });
    assert.equal(foreignWrite.status, 403);
  });
});
