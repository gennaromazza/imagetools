import assert from "node:assert/strict";
import test from "node:test";
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

test("does not disclose a PayPal-derived license key without a verified account", async () => {
  const recorder = responseRecorder();
  await handleLicensingRequest({} as Firestore, request("/licensing/paypal/license", "POST"), recorder.response);
  assert.equal(recorder.result().status, 401);
  assert.deepEqual(recorder.result().payload, { error: "Accedi con un indirizzo email verificato per recuperare la licenza." });
});
