import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  LICENSE_GRACE_MS,
  LICENSE_OFFLINE_MS,
  canActivate,
  createEntitlement,
  hashLicenseSecret,
  normalizeLicenseKey,
  resolveLicenseStatus,
  verifySignedWebhook,
  webhookTimestampAccepted,
} from "./licensing-core.js";

test("normalizes and hashes license keys without retaining plaintext", () => {
  assert.equal(normalizeLicenseKey(" filex-abcd_1234-efgh "), "FILEX-ABCD_1234-EFGH");
  assert.equal(normalizeLicenseKey("short"), null);
  assert.equal(hashLicenseSecret(" KEY "), hashLicenseSecret("KEY"));
});

test("maps commercial states to canonical FileX states", () => {
  const now = 1_000_000;
  assert.equal(resolveLicenseStatus({ status: "active" }, now), "active");
  assert.equal(resolveLicenseStatus({ status: "cancelled", currentPeriodEnd: now + 1 }, now), "active");
  assert.equal(resolveLicenseStatus({ status: "cancelled", currentPeriodEnd: now }, now), "expired");
  assert.equal(resolveLicenseStatus({ status: "past_due", paymentFailedAt: now - LICENSE_GRACE_MS + 1 }, now), "grace");
  assert.equal(resolveLicenseStatus({ status: "past_due", paymentFailedAt: now - LICENSE_GRACE_MS }, now), "expired");
  assert.equal(resolveLicenseStatus({ status: "refunded" }, now), "revoked");
  assert.equal(resolveLicenseStatus({ status: "chargeback" }, now), "revoked");
});

test("limits activation to two distinct installations", () => {
  assert.equal(canActivate([], "a"), true);
  assert.equal(canActivate(["a", "b"], "a"), true);
  assert.equal(canActivate(["a", "b"], "c"), false);
});

test("creates a bounded offline entitlement", () => {
  const now = 10_000;
  const entitlement = createEntitlement({ status: "active", currentPeriodEnd: now + 30 * 24 * 60 * 60 * 1000 }, 1, now);
  assert.equal(entitlement.status, "active");
  assert.equal(entitlement.offlineUntil, now + LICENSE_OFFLINE_MS);
  assert.deepEqual(entitlement.activation, { current: 1, limit: 2 });
});

test("verifies HMAC signatures without unsafe string comparison", () => {
  const body = Buffer.from('{"event":"subscription_created"}');
  const secret = "test-secret";
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifySignedWebhook(body, signature, secret), true);
  assert.equal(verifySignedWebhook(body, `sha256=${signature}`, secret), true);
  assert.equal(verifySignedWebhook(body, "0".repeat(64), secret), false);
});

test("rejects stale webhook timestamps", () => {
  const now = 1_800_000_000_000;
  assert.equal(webhookTimestampAccepted(now / 1000, now), true);
  assert.equal(webhookTimestampAccepted(now - 6 * 60 * 1000, now), false);
});

