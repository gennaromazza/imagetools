import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "gen-lang-client-0321087169";
const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.ok(host, "FIRESTORE_EMULATOR_HOST must be provided by Firebase Emulator Suite");
if (!getApps().length) initializeApp({ projectId });
const db = getFirestore();
const baseUrl = `http://127.0.0.1:5001/${projectId}/europe-west1/api/licensing`;
const licenseKey = "FILEX-E2E0-TEST-KEY0";
const hash = (value) => createHash("sha256").update(value.trim()).digest("hex");

await db.collection("licenseSubscriptions").doc("e2e-subscription").set({
  provider: "e2e",
  providerSubscriptionId: "e2e-subscription",
  entitlement: "filex-all-access",
  status: "active",
  currentPeriodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000,
  paymentFailedAt: null,
  licenseKeyHash: hash(licenseKey),
  updatedAt: Timestamp.now(),
});

async function post(path, body, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  assert.equal(response.status, expectedStatus, `${path}: ${JSON.stringify(payload)}`);
  return payload;
}

const installations = [randomUUID(), randomUUID(), randomUUID()];
const first = await post("/activate", { licenseKey, installationId: installations[0], deviceLabel: "Studio", appVersion: "e2e" });
assert.equal(first.entitlement.status, "active");
assert.equal(first.entitlement.activation.current, 1);

const second = await post("/activate", { licenseKey, installationId: installations[1], deviceLabel: "Portatile", appVersion: "e2e" });
assert.equal(second.entitlement.activation.current, 2);

await post("/activate", { licenseKey, installationId: installations[2], deviceLabel: "Terzo", appVersion: "e2e" }, 409);
const validated = await post("/validate", { activationToken: first.activationToken, installationId: installations[0], appVersion: "e2e-validate" });
assert.equal(validated.entitlement.activation.current, 2);
await post("/deactivate", { activationToken: first.activationToken, installationId: installations[0] });
const third = await post("/activate", { licenseKey, installationId: installations[2], deviceLabel: "Terzo", appVersion: "e2e" });
assert.equal(third.entitlement.activation.current, 2);
await post("/validate", { activationToken: first.activationToken, installationId: installations[0] }, 401);

console.log("FileX licensing E2E passed: activation, 2-device limit, validation, deactivation and replacement.");

