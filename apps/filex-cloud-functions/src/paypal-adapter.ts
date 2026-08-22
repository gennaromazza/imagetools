import { createHmac } from "node:crypto";
import type { CommercialLicenseState } from "./licensing-core.js";

export interface PayPalEvent {
  eventId: string;
  eventName: string;
  subscriptionId: string | null;
  customerId: string | null;
  customerEmail: string | null;
  planId: string | null;
  commercial: CommercialLicenseState | null;
  occurredAt: number;
}

export function parsePayPalEvent(payload: unknown): PayPalEvent | null {
  const root = payload as Record<string, any> | null;
  const resource = root?.resource ?? {};
  const eventId = string(root?.id);
  const eventName = string(root?.event_type);
  if (!eventId || !eventName) return null;

  const isSubscriptionEvent = eventName.startsWith("BILLING.SUBSCRIPTION.");
  const subscriptionId = isSubscriptionEvent
    ? string(resource.id)
    : string(resource.billing_agreement_id) ?? string(resource.supplementary_data?.related_ids?.subscription_id);
  const planId = string(resource.plan_id);
  const occurredAt = timestamp(root?.create_time)
    ?? timestamp(resource.status_update_time)
    ?? timestamp(resource.create_time)
    ?? Date.now();
  const currentPeriodEnd = timestamp(resource.billing_info?.next_billing_time);
  const commercial = mapCommercialState(eventName, resource, occurredAt, currentPeriodEnd);

  return {
    eventId,
    eventName,
    subscriptionId,
    customerId: string(resource.subscriber?.payer_id) ?? string(resource.payer?.payer_info?.payer_id),
    customerEmail: normalizeCustomerEmail(resource.subscriber?.email_address ?? resource.payer?.payer_info?.email),
    planId,
    commercial,
    occurredAt,
  };
}

export function derivePayPalLicenseKey(subscriptionId: string, secret: string): string {
  const material = createHmac("sha256", secret).update(`filex-paypal:${subscriptionId}`, "utf8").digest("hex").toUpperCase().slice(0, 24);
  return `FILEX-${material.match(/.{1,4}/g)!.join("-")}`;
}

export function derivePayPalCustomerEmailHash(email: unknown, secret: string): string | null {
  const normalized = normalizeCustomerEmail(email);
  if (!normalized || !secret) return null;
  return createHmac("sha256", secret).update(`filex-paypal-email:${normalized}`, "utf8").digest("hex");
}

export function normalizeCustomerEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) && normalized.length <= 254 ? normalized : null;
}

function mapCommercialState(eventName: string, resource: Record<string, any>, occurredAt: number, currentPeriodEnd: number | null): CommercialLicenseState | null {
  let status: CommercialLicenseState["status"] | null = null;
  let paymentFailedAt: number | null | undefined;

  if (eventName === "BILLING.SUBSCRIPTION.ACTIVATED" || eventName === "PAYMENT.SALE.COMPLETED") status = "active";
  else if (eventName === "BILLING.SUBSCRIPTION.CANCELLED") status = "cancelled";
  else if (eventName === "BILLING.SUBSCRIPTION.EXPIRED") status = "expired";
  else if (eventName === "BILLING.SUBSCRIPTION.SUSPENDED" || eventName === "BILLING.SUBSCRIPTION.PAYMENT.FAILED") {
    status = "past_due";
    paymentFailedAt = occurredAt;
  } else if (eventName === "PAYMENT.SALE.REFUNDED" && string(resource.state)?.toLowerCase() === "refunded") status = "refunded";
  else if (eventName === "PAYMENT.SALE.REVERSED") status = "chargeback";

  if (!status) return null;
  const result: CommercialLicenseState = { status };
  if (currentPeriodEnd !== null) result.currentPeriodEnd = currentPeriodEnd;
  if (paymentFailedAt !== undefined) result.paymentFailedAt = paymentFailedAt;
  if (status === "active") result.paymentFailedAt = null;
  return result;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
