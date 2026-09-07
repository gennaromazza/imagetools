import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { approveTrial, pollTrial, startTrialSession, TRIAL_DURATION_MS } from "./trial-service.js";
import { createEntitlement, hashLicenseSecret } from "./licensing-core.js";
import { verifyLicenseAttestation } from "./license-attestation.js";

const keys = generateKeyPairSync("ed25519");
const signingKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const identity = { uid: "verified-user", email: "verified@example.test" };

// Models atomic transaction commits and read-before-write, without credentials or production writes.
function memoryFirestore() {
  const rows = new Map<string, any>();
  const ref = (path: string): any => ({ path,
    get: async () => ({ exists: rows.has(path), data: () => rows.get(path) }),
    set: async (value: unknown) => { rows.set(path, value); },
  });
  let tail: Promise<unknown> = Promise.resolve();
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: (callback: (transaction: any) => Promise<unknown>) => {
      const operation = tail.then(async () => {
        const writes: (() => void)[] = [];
        const result = await callback({
          get: (reference: any) => { assert.equal(writes.length, 0, "Firestore requires all reads before writes"); return reference.get(); },
          set: (reference: any, value: unknown) => writes.push(() => rows.set(reference.path, value)),
          update: (reference: any, value: unknown) => writes.push(() => rows.set(reference.path, { ...rows.get(reference.path), ...value as object })),
        });
        writes.forEach(write => write());
        return result;
      });
      tail = operation.catch(() => {});
      return operation;
    },
  } as unknown as Firestore;
  return { db, rows };
}

async function session(db: Firestore, device = "a".repeat(64)) {
  const pollSecret = randomBytes(32).toString("base64url");
  const installationId = randomUUID();
  const result = await startTrialSession(db, { installationId, deviceIdHash: device, pollSecret });
  return { ...result, pollSecret, installationId };
}

test("starts only after approval and returns a signed 30-day entitlement, with 24h offline", async () => {
  const { db } = memoryFirestore();
  const pairing = await session(db);
  assert.deepEqual(await pollTrial(db, pairing, signingKey), { pending: true });
  const before = Date.now();
  const approved = await approveTrial(db, pairing.code, identity, signingKey);
  assert.ok(approved.validUntil! >= before + TRIAL_DURATION_MS);
  assert.ok(approved.validUntil! <= Date.now() + TRIAL_DURATION_MS);
  const result = await pollTrial(db, pairing, signingKey);
  assert.equal(result.pending, false);
  if (result.pending) return;
  const signed = verifyLicenseAttestation(result.attestation!, publicKey)!;
  assert.equal(signed.entitlement.trial, true);
  assert.equal(signed.entitlement.status, "active");
  assert.equal(signed.entitlement.activation.limit, 1);
  assert.equal(signed.installationIdHash, hashLicenseSecret(pairing.installationId));
  assert.ok(signed.entitlement.offlineUntil! <= Date.now() + 86400000);
  assert.equal((await pollTrial(db, pairing, signingKey)).activationToken, result.activationToken);
});

test("reinstalling on the same PC recovers remaining time and invalidates the older activation", async () => {
  const { db } = memoryFirestore();
  const first = await session(db);
  const approved = await approveTrial(db, first.code, identity, signingKey);
  const second = await session(db);
  const recovered = await approveTrial(db, second.code, identity, signingKey);
  assert.equal(recovered.validUntil, approved.validUntil);
  await assert.rejects(pollTrial(db, first, signingKey), /non piu'/);
  assert.equal((await pollTrial(db, second, signingKey)).pending, false);
});

test("parallel claims cannot grant a second trial on the same device", async () => {
  const { db, rows } = memoryFirestore();
  const a = await session(db);
  const b = await session(db);
  const results = await Promise.allSettled([
    approveTrial(db, a.code, identity, signingKey),
    approveTrial(db, b.code, { uid: "other", email: "other@example.test" }, signingKey),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal([...rows.keys()].filter(key => key.startsWith("licenseSubscriptions/")).length, 1);
});

test("an account cannot restart on another PC or by recreating the same email", async () => {
  const { db } = memoryFirestore();
  const first = await session(db);
  await approveTrial(db, first.code, identity, signingKey);
  const second = await session(db, "b".repeat(64));
  await assert.rejects(approveTrial(db, second.code, identity, signingKey), /altro PC/);
  await assert.rejects(approveTrial(db, second.code, { ...identity, uid: "recreated" }, signingKey), /gia'/);
});

test("expired and revoked trials cannot restart; expiry has no payment grace", async () => {
  for (const status of ["cancelled", "refunded"] as const) {
    const { db, rows } = memoryFirestore();
    const first = await session(db);
    await approveTrial(db, first.code, identity, signingKey);
    const record = rows.get(`licenseSubscriptions/trial-${hashLicenseSecret(identity.uid)}`);
    record.currentPeriodEnd = Date.now() - 1;
    record.status = status;
    const second = await session(db);
    await assert.rejects(approveTrial(db, second.code, identity, signingKey), /terminata/);
    const entitlement = createEntitlement(record, 1);
    assert.equal(entitlement.status, status === "cancelled" ? "expired" : "revoked");
    assert.equal(entitlement.offlineUntil, null);
  }
});

test("expired sessions and wrong polling secrets cannot retrieve credentials", async () => {
  const { db, rows } = memoryFirestore();
  const pairing = await session(db);
  await assert.rejects(pollTrial(db, { ...pairing, pollSecret: randomBytes(32).toString("base64url") }, signingKey), /non autorizzata/);
  rows.get(`licenseTrialSessions/${hashLicenseSecret(pairing.code)}`).expiresAt = Date.now() - 1;
  await assert.rejects(approveTrial(db, pairing.code, identity, signingKey), /scaduto/);
  await assert.rejects(pollTrial(db, pairing, signingKey), /scaduto/);
});

test("replaying approval cannot undo a device deactivation", async () => {
  const { db, rows } = memoryFirestore();
  const pairing = await session(db);
  await approveTrial(db, pairing.code, identity, signingKey);
  const activation = [...rows.entries()].find(([key]) => key.startsWith("licenseActivations/"))![1];
  activation.deactivatedAt = Date.now();
  await approveTrial(db, pairing.code, identity, signingKey);
  await assert.rejects(pollTrial(db, pairing, signingKey), /non piu'/);
});

test("lost subscription data cannot reset a previously consumed trial", async () => {
  const { db, rows } = memoryFirestore();
  const pairing = await session(db);
  await approveTrial(db, pairing.code, identity, signingKey);
  rows.delete(`licenseSubscriptions/trial-${hashLicenseSecret(identity.uid)}`);
  const retry = await session(db);
  await assert.rejects(approveTrial(db, retry.code, identity, signingKey), /gia' registrata/);
});

test("reusing a client polling secret does not reuse the activation token", async () => {
  const { db } = memoryFirestore();
  const pollSecret = randomBytes(32).toString("base64url");
  const one = await startTrialSession(db, { installationId: randomUUID(), deviceIdHash: "a".repeat(64), pollSecret });
  await approveTrial(db, one.code, identity, signingKey);
  const first = await pollTrial(db, { ...one, pollSecret }, signingKey);
  const two = await startTrialSession(db, { installationId: randomUUID(), deviceIdHash: "a".repeat(64), pollSecret });
  await approveTrial(db, two.code, identity, signingKey);
  const second = await pollTrial(db, { ...two, pollSecret }, signingKey);
  assert.notEqual(first.activationToken, second.activationToken);
  await assert.rejects(pollTrial(db, { ...one, pollSecret }, signingKey), /non piu'/);
});
