import assert from "node:assert/strict";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import type { Request } from "firebase-functions/v2/https";
import { handleLicensingRequest } from "./licensing-api.js";
import { createSupportRecord, createTicketId, parseSupportMessage, SupportInputError, SUPPORT_RETENTION_DAYS } from "./support-service.js";

const valid = { kind: "problem", toolId: "album-flow", email: " Cliente@Example.TEST ", name: "Anna", message: "Il tool si chiude quando esporto l'album." };

test("normalizes a valid support message", () => {
  const parsed = parseSupportMessage({ ...valid, diagnostics: { suiteVersion: "0.5.1", system: "Windows 11 (10.0.26200)", licenseStatus: "ACTIVE", locale: "it-IT" } });
  assert.equal(parsed.email, "cliente@example.test");
  assert.equal(parsed.toolId, "album-flow");
  assert.equal(parsed.diagnostics?.licenseStatus, "active");
});

test("rejects missing kind, bad email and too short or too long messages", () => {
  assert.throws(() => parseSupportMessage({ ...valid, kind: "spam" }), SupportInputError);
  assert.throws(() => parseSupportMessage({ ...valid, email: "non-una-email" }), SupportInputError);
  assert.throws(() => parseSupportMessage({ ...valid, message: "ciao" }), SupportInputError);
  assert.throws(() => parseSupportMessage({ ...valid, message: "x".repeat(4001) }), SupportInputError);
  assert.throws(() => parseSupportMessage(null), SupportInputError);
});

test("strips control characters and falls back to a generic tool id", () => {
  const parsed = parseSupportMessage({ ...valid, toolId: "../../etc", message: "Riga uno\u0000 con controllo\nRiga due valida" });
  assert.equal(parsed.toolId, "generale");
  assert.equal(parsed.message, "Riga uno con controllo\nRiga due valida");
});

test("drops unknown license statuses and omits diagnostics when not provided", () => {
  assert.equal(parseSupportMessage(valid).diagnostics, null);
  const parsed = parseSupportMessage({ ...valid, diagnostics: { licenseStatus: "<script>" } });
  assert.equal(parsed.diagnostics?.licenseStatus, "sconosciuto");
});

test("creates readable ticket ids without ambiguous characters", () => {
  for (let index = 0; index < 50; index += 1) assert.match(createTicketId(), /^SUP-[A-HJKMNP-Z2-9]{8}$/);
});

test("support records expire after the retention period and mark verified activations", () => {
  const record = createSupportRecord(parseSupportMessage(valid), { verifiedSubscriptionId: "sub-1", now: 1_000 });
  assert.equal(record.verifiedActivation, true);
  assert.equal(record.subscriptionId, "sub-1");
  assert.equal(record.retentionExpiresAtMs - record.createdAtMs, SUPPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  assert.equal(createSupportRecord(parseSupportMessage(valid), { verifiedSubscriptionId: null }).verifiedActivation, false);
});

function fakeFirestore() {
  const store = new Map<string, Record<string, unknown>>();
  const key = (collection: string, id: string) => `${collection}/${id}`;
  const ref = (collection: string, id: string) => ({
    collection, id,
    get: async () => ({ exists: store.has(key(collection, id)), data: () => store.get(key(collection, id)) }),
    create: async (data: Record<string, unknown>) => {
      if (store.has(key(collection, id))) throw new Error("already exists");
      store.set(key(collection, id), data);
    },
  });
  const db = {
    collection: (collection: string) => ({
      doc: (id: string) => ref(collection, id),
      where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
    }),
    runTransaction: async (work: (transaction: unknown) => Promise<boolean>) => work({
      get: (target: ReturnType<typeof ref>) => target.get(),
      set: (target: ReturnType<typeof ref>, data: Record<string, unknown>) => {
        store.set(key(target.collection, target.id), { ...(store.get(key(target.collection, target.id)) ?? {}), ...data });
      },
    }),
  };
  return { db: db as unknown as Firestore, store };
}

function post(body: unknown, ip = "203.0.113.5"): Request {
  return { path: "/licensing/support/message", method: "POST", headers: {}, body, ip, get: () => undefined } as unknown as Request;
}

function recorder() {
  let status = 0;
  let payload: unknown;
  return { response: { status(code: number) { status = code; return { json(value: unknown) { payload = value; } }; } }, result: () => ({ status, payload: payload as Record<string, unknown> }) };
}

test("stores a support message with a ticket id and no secrets", async () => {
  const { db, store } = fakeFirestore();
  const out = recorder();
  await handleLicensingRequest(db, post({ ...valid, diagnostics: { suiteVersion: "0.5.1" }, activationToken: "non-valido" }), out.response);
  assert.equal(out.result().status, 201);
  const ticketId = String(out.result().payload.ticketId);
  assert.match(ticketId, /^SUP-/);
  const saved = store.get(`supportMessages/${ticketId}`)!;
  assert.equal(saved.contactEmail, "cliente@example.test");
  assert.equal(saved.status, "new");
  assert.equal(saved.verifiedActivation, false);
  assert.equal(saved.readAt, null);
  assert.equal(JSON.stringify(saved).includes("non-valido"), false);
});

test("returns a clear error for invalid input without storing anything", async () => {
  const { db, store } = fakeFirestore();
  const out = recorder();
  await handleLicensingRequest(db, post({ ...valid, email: "x" }), out.response);
  assert.equal(out.result().status, 400);
  assert.equal([...store.keys()].some((name) => name.startsWith("supportMessages/")), false);
});

test("limits repeated messages from the same address", async () => {
  const { db } = fakeFirestore();
  const statuses: number[] = [];
  for (let index = 0; index < 7; index += 1) {
    const out = recorder();
    await handleLicensingRequest(db, post(valid), out.response);
    statuses.push(out.result().status);
  }
  assert.deepEqual(statuses, [201, 201, 201, 201, 201, 429, 429]);
});
