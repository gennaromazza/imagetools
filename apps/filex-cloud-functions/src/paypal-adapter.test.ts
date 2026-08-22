import assert from "node:assert/strict";
import test from "node:test";
import { derivePayPalCustomerEmailHash, derivePayPalLicenseKey, normalizeCustomerEmail, parsePayPalEvent } from "./paypal-adapter.js";

test("maps PayPal subscription activation to the FileX commercial model", () => {
  const event = parsePayPalEvent({
    id: "WH-activation-1",
    event_type: "BILLING.SUBSCRIPTION.ACTIVATED",
    create_time: "2026-08-22T10:00:00Z",
    resource: {
      id: "I-SUBSCRIPTION42",
      plan_id: "P-MONTHLY",
      subscriber: { payer_id: "PAYER42", email_address: " Cliente@Example.com " },
      billing_info: { next_billing_time: "2026-09-22T10:00:00Z" },
    },
  });
  assert.equal(event?.subscriptionId, "I-SUBSCRIPTION42");
  assert.equal(event?.planId, "P-MONTHLY");
  assert.equal(event?.commercial?.status, "active");
  assert.equal(event?.commercial?.currentPeriodEnd, Date.parse("2026-09-22T10:00:00Z"));
  assert.equal(event?.customerEmail, "cliente@example.com");
});

test("normalizes and protects the PayPal email used for account lookup", () => {
  assert.equal(normalizeCustomerEmail(" Cliente@Example.COM "), "cliente@example.com");
  assert.equal(normalizeCustomerEmail("not-an-email"), null);
  const first = derivePayPalCustomerEmailHash("Cliente@example.com", "test-secret");
  const second = derivePayPalCustomerEmailHash(" cliente@EXAMPLE.com ", "test-secret");
  assert.equal(first, second);
  assert.match(first ?? "", /^[a-f0-9]{64}$/);
  assert.notEqual(first, derivePayPalCustomerEmailHash("altro@example.com", "test-secret"));
});

test("maps failed payments and recoveries", () => {
  const failed = parsePayPalEvent({
    id: "WH-failed-1",
    event_type: "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
    create_time: "2026-08-22T11:00:00Z",
    resource: { id: "I-SUBSCRIPTION42" },
  });
  const recovered = parsePayPalEvent({
    id: "WH-sale-1",
    event_type: "PAYMENT.SALE.COMPLETED",
    create_time: "2026-08-23T11:00:00Z",
    resource: { id: "SALE-1", billing_agreement_id: "I-SUBSCRIPTION42" },
  });
  assert.equal(failed?.commercial?.status, "past_due");
  assert.equal(failed?.commercial?.paymentFailedAt, Date.parse("2026-08-22T11:00:00Z"));
  assert.equal(recovered?.commercial?.status, "active");
  assert.equal(recovered?.commercial?.paymentFailedAt, null);
});

test("does not revoke a license for a partial PayPal refund", () => {
  const partial = parsePayPalEvent({ id: "WH-refund-1", event_type: "PAYMENT.SALE.REFUNDED", resource: { state: "partially_refunded", billing_agreement_id: "I-SUBSCRIPTION42" } });
  const full = parsePayPalEvent({ id: "WH-refund-2", event_type: "PAYMENT.SALE.REFUNDED", resource: { state: "refunded", billing_agreement_id: "I-SUBSCRIPTION42" } });
  assert.equal(partial?.commercial, null);
  assert.equal(full?.commercial?.status, "refunded");
});

test("derives a stable non-guessable FileX key without storing it in clear text", () => {
  const first = derivePayPalLicenseKey("I-SUBSCRIPTION42", "test-secret");
  const second = derivePayPalLicenseKey("I-SUBSCRIPTION42", "test-secret");
  assert.equal(first, second);
  assert.match(first, /^FILEX(?:-[A-F0-9]{4}){6}$/);
  assert.notEqual(first, derivePayPalLicenseKey("I-OTHER", "test-secret"));
});
