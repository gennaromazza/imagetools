import assert from "node:assert/strict";
import test from "node:test";
import { describeSystem, getSupportEnvironment, sendSupportMessage, SupportSendError, type SupportDependencies } from "./support-message.js";

const input = { kind: "problem" as const, toolId: "album-flow", email: "cliente@example.test", name: "Anna", message: "Il tool si chiude quando esporto.", includeDiagnostics: true };

function dependencies(overrides: Partial<SupportDependencies> = {}) {
  const calls: Record<string, unknown>[] = [];
  const deps: SupportDependencies = {
    appVersion: "0.5.1", platform: "win32", osRelease: "10.0.26200", locale: "it-IT",
    transportAllowed: () => true,
    getIdentity: async () => ({ installationId: "11111111-2222-3333-4444-555555555555", activationToken: "token-segreto" }),
    getLicenseStatus: async () => "active",
    post: async (body) => { calls.push(body); return { ok: true, ticketId: "SUP-ABCD2345" }; },
    ...overrides,
  };
  return { deps, calls };
}

test("describes Windows 10 and Windows 11 from the build number", () => {
  assert.equal(describeSystem("win32", "10.0.26200"), "Windows 11 (10.0.26200)");
  assert.equal(describeSystem("win32", "10.0.19045"), "Windows 10 (10.0.19045)");
  assert.equal(describeSystem("darwin", "24.1.0"), "macOS (Darwin 24.1.0)");
});

test("sends the message with identity and diagnostics, and returns the ticket id", async () => {
  const { deps, calls } = dependencies();
  assert.deepEqual(await sendSupportMessage(input, deps), { ticketId: "SUP-ABCD2345" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].activationToken, "token-segreto");
  assert.deepEqual(calls[0].diagnostics, { suiteVersion: "0.5.1", system: "Windows 11 (10.0.26200)", licenseStatus: "active", locale: "it-IT" });
});

test("omits diagnostics when the user turns them off and works without a license", async () => {
  const { deps, calls } = dependencies({ getIdentity: async () => ({ installationId: "11111111-2222-3333-4444-555555555555", activationToken: null }) });
  await sendSupportMessage({ ...input, includeDiagnostics: false }, deps);
  assert.equal("diagnostics" in calls[0], false);
  assert.equal("activationToken" in calls[0], false);
});

test("rejects invalid input locally without calling the server", async () => {
  const { deps, calls } = dependencies();
  await assert.rejects(sendSupportMessage({ ...input, email: "nope" }, deps), SupportSendError);
  await assert.rejects(sendSupportMessage({ ...input, message: "corto" }, deps), SupportSendError);
  await assert.rejects(sendSupportMessage({ ...input, kind: "altro" as never }, deps), SupportSendError);
  assert.equal(calls.length, 0);
});

test("a development build never posts to the production service", async () => {
  const { deps, calls } = dependencies({ transportAllowed: () => false });
  await assert.rejects(sendSupportMessage(input, deps), /sviluppo/);
  assert.equal(calls.length, 0);
});

test("explains network failures and keeps server messages for rejections", async () => {
  const offline = dependencies({ post: async () => { throw new TypeError("fetch failed"); } });
  await assert.rejects(sendSupportMessage(input, offline.deps), (error: unknown) => error instanceof SupportSendError && error.retryable && /connessione/.test(error.message));
  const limited = dependencies({ post: async () => { throw Object.assign(new Error("Hai inviato troppi messaggi."), { status: 429 }); } });
  await assert.rejects(sendSupportMessage(input, limited.deps), (error: unknown) => error instanceof SupportSendError && !error.retryable && /troppi/.test(error.message));
});

test("environment degrades to unavailable when the license cannot be read", async () => {
  const { deps } = dependencies({ getLicenseStatus: async () => { throw new Error("boom"); } });
  assert.equal((await getSupportEnvironment(deps)).licenseStatus, "unavailable");
});
