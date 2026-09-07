import assert from "node:assert/strict";
import { generateKeyPairSync, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createLicenseAttestation } from "../apps/filex-cloud-functions/src/license-attestation.js";

const require = createRequire(import.meta.url);
const keys = generateKeyPairSync("ed25519");
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const installationId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const guid = "11111111-2222-3333-4444-555555555555";
const deviceIdHash = createHash("sha256").update(`filex-trial-v1:${guid}`).digest("hex");
const issuedAt = 1800000000000;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function signed(trial = true, offlineMs = 86400000) {
  return createLicenseAttestation({ version: 1, installationIdHash: hash(installationId), issuedAt,
    entitlement: { schemaVersion: 1, entitlement: "filex-all-access", status: "active", validUntil: issuedAt + 30 * 86400000,
      offlineUntil: issuedAt + offlineMs, activation: { current: 1, limit: trial ? 1 : 2 },
      ...(trial ? { trial: true, trialDeviceIdHash: deviceIdHash } : {}) } }, privateKey);
}

function runtime(path: string, store: any, now = issuedAt + 1000, machine = guid, transport: typeof fetch = async () => { throw new Error("offline"); }, options: { failWrites?: boolean; packaged?: boolean } = {}) {
  const temporaryFiles = new Map<string, string>();
  const events = { warnings: 0, quits: 0, exits: 0 };
  let tick: (() => void) | undefined;
  let exitTimer: (() => void) | undefined;
  const timer = { unref() {} };
  const execFile = Object.assign(() => {}, { [promisify.custom]: async () => ({ stdout: `MachineGuid    REG_SZ    ${machine}` }) });
  const mocks: Record<string, unknown> = {
    electron: { app: { isPackaged: options.packaged ?? true, getPath: () => "/fake", getVersion: () => "test", once() {}, quit() { events.quits++; }, exit() { events.exits++; } }, dialog: { async showMessageBox() { events.warnings++; } }, safeStorage: { isEncryptionAvailable: () => true, decryptString: () => "token", encryptString: (value: string) => Buffer.from(value) } },
    "node:child_process": { execFile },
    "node:fs/promises": {
      readFile: async () => JSON.stringify(store),
      writeFile: async (path: string, value: string) => { if (options.failWrites) throw new Error("disk read only"); if (path.endsWith('.tmp')) temporaryFiles.set(path, value); else store = JSON.parse(value); },
      rename: async (path: string) => { store = JSON.parse(temporaryFiles.get(path)!); temporaryFiles.delete(path); },
      unlink: async () => {}, mkdir: async () => {}, rmdir: async () => {},
    },
    "./license-public-key.js": { FILEX_LICENSE_PUBLIC_KEY: publicKey },
  };
  function load(file: string): any {
    const source = readFileSync(file, "utf8").replace(/const PUBLIC_KEY = .*?;/, `const PUBLIC_KEY = ${JSON.stringify(publicKey)};`);
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    runInNewContext(compiled, {
      module, exports: module.exports, Buffer, AbortController, AbortSignal, clearTimeout,
      setTimeout: (callback: () => void, ms: number) => { if (ms === 5000) { exitTimer = callback; return timer; } return setTimeout(callback, ms); },
      setInterval: (callback: () => void) => { tick = callback; return timer; }, clearInterval: () => { tick = undefined; },
      process: { platform: "win32", env: {} },
      Date: class extends Date { static now() { return now; } },
      fetch: transport,
      require: (name: string) => name === "./license-attestation.js" ? load("apps/filex-desktop/src/license-attestation.ts") : mocks[name] ?? require(name),
    });
    return module.exports;
  }
  return Object.assign(load(path), { replaceTestStore: (next: unknown) => { store = next; }, events,
    advance: async (ms: number) => { now += ms; tick?.(); for (let i = 0; i < 100; i++) await new Promise<void>(resolve => setImmediate(resolve)); },
    finishExit: () => exitTimer?.(),
  });
}

for (const path of ["apps/filex-desktop/src/license-service.ts", ...["cache-sweep", "filex-send", "backup-guard"].map(tool => `apps/${tool}/electron/license-gate.ts`)]) {
  test(`${path}: expired license warns once, allows 60 seconds, then closes with forced fallback`, async () => {
    const api = runtime(path, { schemaVersion: 1, installationId, attestation: signed() });
    api.startLicenseExpiryWatchdog();
    await api.advance(0); assert.equal(api.events.warnings, 0);
    await api.advance(86400000); assert.equal(api.events.warnings, 1);
    await api.advance(59999); assert.equal(api.events.quits, 0); assert.equal(api.events.warnings, 1);
    await api.advance(1); assert.equal(api.events.quits, 1);
    api.finishExit(); assert.equal(api.events.exits, 1);
  });
  test(`${path}: renewed license cancels pending closure; development never starts enforcement timer`, async () => {
    const api = runtime(path, { schemaVersion: 1, installationId, attestation: signed() });
    const stop = api.startLicenseExpiryWatchdog();
    await api.advance(86400000); assert.equal(api.events.warnings, 1);
    api.replaceTestStore({ schemaVersion: 1, installationId, activationTokenEncrypted: "renewed", attestation: signed(false, 14 * 86400000) });
    await api.advance(60000); assert.equal(api.events.quits, 0);
    stop();
    const dev = runtime(path, {}, issuedAt, guid, undefined, { packaged: false });
    dev.startLicenseExpiryWatchdog(); await dev.advance(86400000); assert.equal(dev.events.warnings, 0);
  });
}

for (const tool of ["cache-sweep", "filex-send", "backup-guard"]) {
  test(`${tool}: server rejection cannot fall back to old proof when cache persistence fails`, async () => {
    const api = runtime(`apps/${tool}/electron/license-gate.ts`, { installationId, activationTokenEncrypted: "token", attestation: signed(false, 14 * 86400000) }, issuedAt + 2 * 86400000, guid,
      async () => new Response('{}', { status: 403 }), { failWrites: true });
    assert.equal(await api.directToolLicenseAllowed(), false);
  });
}

for (const path of ["apps/filex-desktop/src/license-service.ts", ...["cache-sweep", "filex-send", "backup-guard"].map(tool => `apps/${tool}/electron/license-gate.ts`)]) {
  test(`${path}: revoked response cannot reuse cached proof after a disk error and subsequent outage`, async () => {
    let calls = 0;
    const api = runtime(path, { schemaVersion: 1, installationId, activationTokenEncrypted: "old", attestation: signed(false, 14 * 86400000), state: { lastCheckedAt: issuedAt, status: "active" } }, issuedAt + 1000, guid,
      async () => calls++ === 0 ? new Response(JSON.stringify({ entitlement: { schemaVersion: 1, entitlement: "filex-all-access", status: "revoked" } }), { status: 200 }) : new Response('{}', { status: 503 }), { failWrites: true });
    const allowed = async (refresh: boolean) => api.getLicenseState ? (await api.getLicenseState(refresh)).canUseTools : api.directToolLicenseAllowed(refresh);
    assert.equal(await allowed(true), false);
    assert.equal(await allowed(false), false);
  });
}

for (const tool of ["cache-sweep", "filex-send", "backup-guard"]) {
  const path = `apps/${tool}/electron/license-gate.ts`;
  test(`${tool}: signed trial and paid licenses work offline; local observe cannot bypass enforcement`, async () => {
    for (const trial of [true, false]) assert.equal(await runtime(path, { installationId, attestation: signed(trial) }).directToolLicenseAllowed(), true);
    assert.equal(await runtime(path, { installationId, state: { enforcement: "observe" } }).directToolLicenseAllowed(), false);
  });
  test(`${tool}: rejects expiry, a copied trial, tampering and a clock moved before issuance`, async () => {
    const store = { installationId, attestation: signed() };
    assert.equal(await runtime(path, store, issuedAt + 86400000).directToolLicenseAllowed(), false);
    assert.equal(await runtime(path, store, issuedAt - 600000).directToolLicenseAllowed(), false);
    assert.equal(await runtime(path, store, issuedAt + 1000, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee").directToolLicenseAllowed(), false);
    assert.equal(await runtime(path, { ...store, attestation: `x${store.attestation}` }).directToolLicenseAllowed(), false);
  });
  test(`${tool}: paid offline tolerance survives outage but not a confirmed denial`, async () => {
    for (const status of [401, 403, 503]) {
      const api = runtime(path, { installationId, activationTokenEncrypted: "token", attestation: signed(false, 14 * 86400000) }, issuedAt + 2 * 86400000, guid,
        async () => new Response('{}', { status }));
      assert.equal(await api.directToolLicenseAllowed(), status === 503);
      assert.equal(await api.directToolLicenseAllowed(), status === 503);
    }
  });
}

test("a late validation denial cannot overwrite a newer paid activation", async () => {
  let release!: (value: Response) => void;
  let started!: () => void;
  const requested = new Promise<void>(resolve => { started = resolve; });
  let calls = 0;
  const api = runtime("apps/filex-desktop/src/license-service.ts", { schemaVersion: 1, installationId, activationTokenEncrypted: "old", attestation: signed() }, issuedAt + 1000, guid,
    async () => {
      if (calls++ === 0) { started(); return new Promise<Response>(resolve => { release = resolve; }); }
      return new Response(JSON.stringify({ entitlement: { schemaVersion: 1, status: "active", entitlement: "filex-all-access" }, attestation: signed(false) }), { status: 200 });
    });
  const checking = api.getLicenseState(true); await requested;
  api.replaceTestStore({ schemaVersion: 1, installationId, activationTokenEncrypted: "new", attestation: signed(false) });
  release(new Response('{}', { status: 401 }));
  const state = await checking;
  assert.equal(state.canUseTools, true);
  assert.equal(state.trial, false);
});

test("shared runtime ignores forged cached active state and respects signed offline expiry", async () => {
  const path = "apps/filex-desktop/src/license-service.ts";
  const store = { schemaVersion: 1, installationId, activationTokenEncrypted: "encrypted",
    state: { status: "active", canUseTools: true, lastCheckedAt: issuedAt, enforcement: "observe" } };
  assert.equal((await runtime(path, store).getLicenseState()).canUseTools, false);
  const signedStore = { ...store, attestation: signed() };
  const active = await runtime(path, signedStore).getLicenseState();
  assert.equal(active.canUseTools, true);
  assert.equal(active.trial, true);
  assert.equal((await runtime(path, signedStore, issuedAt + 86400000).getLicenseState()).canUseTools, false);
  assert.equal((await runtime(path, signedStore, issuedAt - 600000).getLicenseState()).canUseTools, false);
});

test("paid activation rejects unsigned credentials and preserves an existing signed license", async () => {
  const runtimeApi = runtime("apps/filex-desktop/src/license-service.ts", { schemaVersion: 1, installationId, attestation: signed() }, issuedAt + 1000, guid,
    async () => new Response(JSON.stringify({ activationToken: "forged", entitlement: { status: "active", entitlement: "filex-all-access" } }), { status: 200 }));
  await assert.rejects(runtimeApi.activateLicense("FILEX-FAKE-LICENSE"), /attestazione valida/);
  assert.equal((await runtimeApi.getLicenseState()).trial, true);
});

test("an explicit server denial clears offline proof, while an outage retains it", async () => {
  for (const status of [401, 403, 503]) {
    const runtimeApi = runtime("apps/filex-desktop/src/license-service.ts", { schemaVersion: 1, installationId, activationTokenEncrypted: "token", attestation: signed() }, issuedAt + 1000, guid,
      async () => new Response(JSON.stringify({ error: "server response" }), { status }));
    assert.equal((await runtimeApi.getLicenseState(true)).canUseTools, status === 503);
    assert.equal((await runtimeApi.getLicenseState()).canUseTools, status === 503);
  }
});

test("a device already deactivated remotely can be cleared locally", async () => {
  const runtimeApi = runtime("apps/filex-desktop/src/license-service.ts", { schemaVersion: 1, installationId, activationTokenEncrypted: "token", attestation: signed() }, issuedAt + 1000, guid,
    async () => new Response('{}', { status: 401 }));
  assert.equal((await runtimeApi.deactivateLicense()).canUseTools, false);
  assert.equal((await runtimeApi.getLicenseState()).canUseTools, false);
});
