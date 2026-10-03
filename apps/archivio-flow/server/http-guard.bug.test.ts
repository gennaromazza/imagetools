import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import cors from "cors";
import express from "express";
import { corsOptions, createLocalOnlyGuard, isAllowedOrigin, isLoopbackHost } from "./http-guard.js";

function request(port: number, headers: Record<string, string>): Promise<{ status: number; allowOrigin?: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/api/ping", method: "GET", headers }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode ?? 0, allowOrigin: res.headers["access-control-allow-origin"] as string | undefined }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("bug hunt: accetta solo host locali, anche con porta e IPv6", () => {
  for (const host of ["localhost", "localhost:3003", "127.0.0.1:4175", "[::1]:3003", "LOCALHOST"]) assert.equal(isLoopbackHost(host), true, host);
  for (const host of ["evil.example", "localhost.evil.example", "127.0.0.1.evil.example:80", "192.168.1.10:3003", "", undefined]) assert.equal(isLoopbackHost(host), false, String(host));
});

test("bug hunt: accetta solo origini locali o assenti", () => {
  for (const origin of [undefined, "http://localhost:4175", "http://127.0.0.1:4175", "http://[::1]:4175"]) assert.equal(isAllowedOrigin(origin), true, String(origin));
  for (const origin of ["https://evil.example", "http://localhost.evil.example", "null", "file://", "not a url", "http://192.168.1.10:4175"]) assert.equal(isAllowedOrigin(origin), false, origin);
});

test("bug hunt: il server HTTP respinge Host e Origin esterni (DNS rebinding e pagine web)", async () => {
  const app = express();
  app.use(createLocalOnlyGuard());
  app.use(cors(corsOptions));
  app.get("/api/ping", (_req, res) => res.json({ ok: true }));
  const server = await new Promise<http.Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const { port } = server.address() as AddressInfo;

  try {
    assert.equal((await request(port, {})).status, 200, "client non-browser");
    const local = await request(port, { Origin: `http://127.0.0.1:${port}` });
    assert.equal(local.status, 200);
    assert.equal(local.allowOrigin, `http://127.0.0.1:${port}`);
    assert.equal((await request(port, { Origin: "https://evil.example" })).status, 403, "pagina web esterna");
    assert.equal((await request(port, { Host: "evil.example" })).status, 403, "DNS rebinding");
    assert.equal((await request(port, { Origin: "null" })).status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("bug hunt: il server reale resta su 127.0.0.1 e non compone comandi di shell con percorsi", () => {
  const source = fs.readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(source, /app\.listen\(PORT, "127\.0\.0\.1"/);
  assert.match(source, /app\.use\(createLocalOnlyGuard\(\)\)/);
  assert.doesNotMatch(source, /execSync\(/, "execSync bloccherebbe l'event loop e interpreterebbe i percorsi");
  assert.match(source, /execFile\("explorer\.exe", \[normalized\]/);
});
