import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const LICENSE_ACTIVATION_LIMIT = 2;
export const LICENSE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
export const LICENSE_OFFLINE_MS = 14 * 24 * 60 * 60 * 1000;
export const LICENSE_WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

export type LicenseStatus = "active" | "grace" | "expired" | "revoked" | "unlicensed";

export interface CommercialLicenseState {
  status: "active" | "past_due" | "cancelled" | "expired" | "refunded" | "chargeback";
  currentPeriodEnd?: number | null;
  paymentFailedAt?: number | null;
}

export interface LicenseEntitlement {
  schemaVersion: 1;
  entitlement: "filex-all-access";
  status: LicenseStatus;
  validUntil: number | null;
  offlineUntil: number | null;
  activation: { current: number; limit: number };
}

export function hashLicenseSecret(value: string): string {
  return createHash("sha256").update(value.trim(), "utf8").digest("hex");
}

export function normalizeLicenseKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z0-9_-]{16,160}$/.test(normalized)) return null;
  return normalized;
}

export function resolveLicenseStatus(state: CommercialLicenseState, now = Date.now()): LicenseStatus {
  if (state.status === "refunded" || state.status === "chargeback") return "revoked";
  if (state.status === "active") return "active";
  if (state.status === "cancelled") {
    return typeof state.currentPeriodEnd === "number" && state.currentPeriodEnd > now ? "active" : "expired";
  }
  if (state.status === "past_due") {
    const failedAt = state.paymentFailedAt ?? now;
    return failedAt + LICENSE_GRACE_MS > now ? "grace" : "expired";
  }
  return "expired";
}

export function createEntitlement(
  commercial: CommercialLicenseState,
  activeInstallations: number,
  now = Date.now(),
): LicenseEntitlement {
  const status = resolveLicenseStatus(commercial, now);
  const periodEnd = typeof commercial.currentPeriodEnd === "number" ? commercial.currentPeriodEnd : null;
  const validUntil = status === "active"
    ? periodEnd
    : status === "grace"
      ? (commercial.paymentFailedAt ?? now) + LICENSE_GRACE_MS
      : null;
  const offlineUntil = status === "active" || status === "grace"
    ? Math.min(now + LICENSE_OFFLINE_MS, validUntil ?? now + LICENSE_OFFLINE_MS)
    : null;
  return {
    schemaVersion: 1,
    entitlement: "filex-all-access",
    status,
    validUntil,
    offlineUntil,
    activation: { current: Math.max(0, activeInstallations), limit: LICENSE_ACTIVATION_LIMIT },
  };
}

export function canActivate(activeInstallationHashes: readonly string[], requestedInstallationHash: string): boolean {
  return activeInstallationHashes.includes(requestedInstallationHash)
    || activeInstallationHashes.length < LICENSE_ACTIVATION_LIMIT;
}

export function verifySignedWebhook(
  rawBody: Uint8Array,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !secret) return false;
  const supplied = signature.trim().replace(/^sha256=/i, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(supplied)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const actual = Buffer.from(supplied, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function webhookTimestampAccepted(timestamp: unknown, now = Date.now()): boolean {
  const parsed = typeof timestamp === "number" ? timestamp : Number(timestamp);
  if (!Number.isFinite(parsed)) return false;
  const timestampMs = parsed < 10_000_000_000 ? parsed * 1000 : parsed;
  return Math.abs(now - timestampMs) <= LICENSE_WEBHOOK_TOLERANCE_MS;
}

