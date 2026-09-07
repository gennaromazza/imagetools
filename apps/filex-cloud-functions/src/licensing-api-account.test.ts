import assert from "node:assert/strict";
import test from "node:test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import type { Request } from "firebase-functions/v2/https";
import { handleLicensingRequest } from "./licensing-api.js";

function responseRecorder() {
  let status = 0;
  let payload: unknown;
  return {
    response: {
      status(code: number) {
        status = code;
        return { json(value: unknown) { payload = value; } };
      },
    },
    result: () => ({ status, payload }),
  };
}

function request(path: string, method: "GET" | "POST"): Request {
  return {
    path,
    method,
    headers: {},
    body: {},
  } as unknown as Request;
}

test("rejects anonymous access to the FileX customer area before reading Firestore", async () => {
  const recorder = responseRecorder();
  await handleLicensingRequest({} as Firestore, request("/licensing/account", "GET"), recorder.response);
  assert.equal(recorder.result().status, 401);
  assert.deepEqual(recorder.result().payload, { error: "Accesso richiesto con email verificata." });
});

test("trial approval requires a verified account before any Firestore access", async () => {
  const recorder = responseRecorder();
  await handleLicensingRequest({} as Firestore, request("/licensing/trial/approve", "POST"), recorder.response);
  assert.equal(recorder.result().status, 401);
});

test("trial approval rejects unverified email and requests revoked-token checking", async (t) => {
  if (!getApps().length) initializeApp({ projectId: "filex-trial-unit-test" });
  const verify = t.mock.method(getAuth(), "verifyIdToken", async (_token: string, checkRevoked: boolean) => {
    assert.equal(checkRevoked, true);
    return { uid: "user", email: "test@example.test", email_verified: false };
  });
  const input = request("/licensing/trial/approve", "POST");
  input.headers.authorization = "Bearer test-token";
  const recorder = responseRecorder();
  await handleLicensingRequest({} as Firestore, input, recorder.response);
  assert.equal(verify.mock.callCount(), 1);
  assert.equal(recorder.result().status, 401);
});

test("does not disclose a PayPal-derived license key without a verified account", async () => {
  const recorder = responseRecorder();
  await handleLicensingRequest({} as Firestore, request("/licensing/paypal/license", "POST"), recorder.response);
  assert.equal(recorder.result().status, 401);
  assert.deepEqual(recorder.result().payload, { error: "Accedi con un indirizzo email verificato per recuperare la licenza." });
});

test("a trial account still discovers its later PayPal purchase and never receives a trial license key", async (t) => {
  if (!getApps().length) initializeApp({ projectId: "filex-trial-unit-test" });
  t.mock.method(getAuth(), "verifyIdToken", async () => ({ uid: "user", email: "test@example.test", email_verified: true }));
  const trial = { id: "trial-user", ref: { id: "trial-user" }, data: () => ({ provider: "trial", trial: true, ownerUid: "user", status: "cancelled", currentPeriodEnd: Date.now() + 86400000 }) };
  const paid = { id: "I-TESTPAID", ref: { id: "I-TESTPAID" }, data: () => ({ provider: "paypal", status: "active", currentPeriodEnd: Date.now() + 86400000 }) };
  let linked = false;
  const db = {
    collection: (name: string) => ({
      doc: () => ({ get: async () => ({ exists: false, data: () => undefined }) }),
      where: (field: string) => {
        const query = {
          where: () => query, limit: () => query,
          get: async () => {
            const docs = name === "licenseActivations" ? [] : field === "customerEmailHash" ? [paid] : linked ? [trial, paid] : [trial];
            return { docs, empty: docs.length === 0, size: docs.length };
          },
        };
        return query;
      },
    }),
    runTransaction: async (operation: (transaction: unknown) => Promise<unknown>) => operation({ get: async () => ({ exists: true, data: paid.data }), set: (ref: {id:string}) => { assert.equal(ref.id, paid.id); linked = true; } }),
  } as unknown as Firestore;
  const input = request("/licensing/account", "GET"); input.headers.authorization = "Bearer test-token";
  const recorder = responseRecorder();
  await handleLicensingRequest(db, input, recorder.response, { paypalLicenseKeySecret: "unit-test-secret" });
  assert.equal(recorder.result().status, 200);
  assert.equal(linked, true);
  const items = (recorder.result().payload as { subscriptions: { plan: string; licenseKey: string | null }[] }).subscriptions;
  assert.equal(items.length, 2);
  assert.equal(items.find(item => item.plan === "trial")?.licenseKey, null);
  assert.ok(items.some(item => item.licenseKey?.startsWith("FILEX-")));
});
