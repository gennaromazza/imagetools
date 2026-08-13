import assert from "node:assert/strict";
import test from "node:test";
import { parseLemonSqueezyEvent } from "./lemonsqueezy-adapter.js";

test("maps subscription webhooks to the FileX commercial model", () => {
  const payload = {
    meta: { event_name: "subscription_cancelled" },
    data: { type: "subscriptions", id: "sub_42", attributes: { customer_id: 7, variant_id: 12, status: "cancelled", ends_at: "2026-09-01T10:00:00Z", updated_at: "2026-08-20T10:00:00Z" } },
  };
  const event = parseLemonSqueezyEvent(payload, Buffer.from(JSON.stringify(payload)));
  assert.equal(event?.subscriptionId, "sub_42");
  assert.equal(event?.variantId, "12");
  assert.equal(event?.commercial?.status, "cancelled");
  assert.equal(event?.commercial?.currentPeriodEnd, Date.parse("2026-09-01T10:00:00Z"));
  assert.equal(event?.occurredAt, Date.parse("2026-08-20T10:00:00Z"));
});

test("extracts provider license keys without logging or transforming them", () => {
  const payload = {
    meta: { event_name: "license_key_created" },
    data: {
      id: "key_1",
      attributes: { key: "FILEX-ABCD-EFGH-IJKL", variant_id: 12 },
      relationships: { subscription: { data: { id: "sub_42" } } },
    },
  };
  const event = parseLemonSqueezyEvent(payload, Buffer.from(JSON.stringify(payload)));
  assert.equal(event?.subscriptionId, "sub_42");
  assert.equal(event?.licenseKey, "FILEX-ABCD-EFGH-IJKL");
  assert.equal(event?.commercial, null);
});

test("maps the official subscription refund event and its subscription relationship", () => {
  const payload = {
    meta: { event_name: "subscription_payment_refunded" },
    data: {
      id: "invoice_9",
      attributes: { status: "refunded", refunded: true, updated_at: "2026-08-21T10:00:00Z" },
      relationships: { subscription: { data: { id: "sub_42" } } },
    },
  };
  const event = parseLemonSqueezyEvent(payload, Buffer.from(JSON.stringify(payload)));
  assert.equal(event?.subscriptionId, "sub_42");
  assert.equal(event?.commercial?.status, "refunded");
});

test("does not revoke a license for a partial invoice refund", () => {
  const payload = {
    meta: { event_name: "subscription_payment_refunded" },
    data: {
      type: "subscription-invoices",
      id: "invoice_10",
      attributes: { subscription_id: 42, status: "partial_refund", refunded: false, updated_at: "2026-08-21T11:00:00Z" },
    },
  };
  const event = parseLemonSqueezyEvent(payload, Buffer.from(JSON.stringify(payload)));
  assert.equal(event?.subscriptionId, "42");
  assert.equal(event?.commercial, null);
});
