import { createHash } from "node:crypto";
import type { CommercialLicenseState } from "./licensing-core.js";

export interface LemonSqueezyEvent {
  eventId: string;
  eventName: string;
  subscriptionId: string | null;
  customerId: string | null;
  variantId: string | null;
  licenseKey: string | null;
  commercial: CommercialLicenseState | null;
  occurredAt: number;
}

export function parseLemonSqueezyEvent(payload: unknown, rawBody: Uint8Array): LemonSqueezyEvent | null {
  const root = payload as Record<string, any> | null;
  const data = root?.data;
  const attributes = data?.attributes ?? {};
  const relationships = data?.relationships ?? {};
  const meta = root?.meta ?? {};
  const eventName = string(meta.event_name);
  if (!eventName || !data?.id) return null;
  const subscriptionId = string(relationships.subscription?.data?.id)
    ?? string(attributes.subscription_id)
    ?? (eventName.startsWith("subscription_") && data.type === "subscriptions" ? string(data.id) : null);
  const status = mapStatus(eventName, string(attributes.status), attributes.refunded === true);
  const currentPeriodEnd = timestamp(attributes.ends_at ?? attributes.renews_at);
  const paymentFailedAt = eventName === "subscription_payment_failed"
    ? timestamp(attributes.updated_at) ?? Date.now()
    : null;
  const key = eventName.startsWith("license_key_") ? string(attributes.key) : null;
  return {
    eventId: createHash("sha256").update(rawBody).digest("hex"),
    eventName,
    subscriptionId,
    customerId: string(attributes.customer_id) ?? string(relationships.customer?.data?.id),
    variantId: string(attributes.variant_id) ?? string(relationships.variant?.data?.id),
    licenseKey: key,
    commercial: status ? { status, currentPeriodEnd, paymentFailedAt } : null,
    occurredAt: timestamp(attributes.updated_at ?? attributes.created_at) ?? Date.now(),
  };
}

function mapStatus(eventName: string, providerStatus: string | null, fullyRefunded: boolean): CommercialLicenseState["status"] | null {
  if (eventName === "subscription_payment_failed" || providerStatus === "past_due" || providerStatus === "unpaid") return "past_due";
  if (eventName === "subscription_cancelled" || providerStatus === "cancelled") return "cancelled";
  if (eventName === "subscription_expired" || providerStatus === "expired") return "expired";
  if (eventName === "order_refunded" || eventName === "subscription_payment_refunded") {
    return fullyRefunded || providerStatus === "refunded" ? "refunded" : null;
  }
  if (eventName.includes("chargeback")) return "chargeback";
  if (["subscription_created", "subscription_updated", "subscription_resumed", "subscription_unpaused", "subscription_payment_success", "subscription_payment_recovered"].includes(eventName)) return "active";
  if (providerStatus === "active" || providerStatus === "on_trial" || providerStatus === "paused") return "active";
  return null;
}

function string(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
