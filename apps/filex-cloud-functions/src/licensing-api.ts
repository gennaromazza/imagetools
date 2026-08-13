import { randomBytes } from "node:crypto";
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import type { Request } from "firebase-functions/v2/https";
import {
  createEntitlement,
  hashLicenseSecret,
  normalizeLicenseKey,
  type CommercialLicenseState,
  verifySignedWebhook,
} from "./licensing-core.js";
import { parseLemonSqueezyEvent } from "./lemonsqueezy-adapter.js";
import { createLicenseAttestation } from "./license-attestation.js";
import { FILEX_COMMERCE_DEFAULTS } from "./commerce-config.generated.js";

interface HttpResponse {
  status(code: number): { json(value: unknown): unknown };
}

interface SubscriptionRecord extends CommercialLicenseState {
  entitlement: "filex-all-access";
  licenseKeyHash?: string;
  provider: string;
  providerSubscriptionId: string;
  updatedAt: Timestamp;
  lastProviderEventAt?: Timestamp;
}

interface ActivationRecord {
  subscriptionId: string;
  installationIdHash: string;
  tokenHash: string;
  deviceLabel: string;
  appVersion: string;
  activatedAt: Timestamp;
  lastValidatedAt: Timestamp;
  deactivatedAt?: Timestamp | null;
  termsVersion?: string;
  licenseVersion?: string;
  privacyVersion?: string;
  acceptedAt?: Timestamp;
}

export async function handleLicensingRequest(db: Firestore, request: Request, response: HttpResponse, webhookSecret = "", signingPrivateKey = ""): Promise<unknown> {
  const rawPath = request.path.replace(/\/+$/, "").replace(/^\/api(?=\/|$)/, "") || "/";
  const path = rawPath.replace(/^\/licensing/, "") || "/";
  if (request.method === "GET" && path === "/health") {
    const config = await readPublicConfiguration(db);
    return json(response, 200, { ok: true, service: "FileX Licensing", ...config });
  }
  if (request.method === "POST" && path === "/webhooks/lemonsqueezy") return lemonSqueezyWebhook(db, request, response, webhookSecret);
  if (request.method === "POST" && path === "/activate") return activate(db, request, response, signingPrivateKey);
  if (request.method === "POST" && path === "/validate") return validate(db, request, response, signingPrivateKey);
  if (request.method === "POST" && path === "/deactivate") return deactivate(db, request, response);
  return json(response, 404, { error: "Risorsa licenze non trovata." });
}


async function lemonSqueezyWebhook(db: Firestore, request: Request, response: HttpResponse, secret: string) {
  const rawBody = request.rawBody;
  if (!secret) return json(response, 503, { error: "Webhook non configurato." });
  if (!verifySignedWebhook(rawBody, request.get("x-signature"), secret)) return json(response, 401, { error: "Firma webhook non valida." });
  const event = parseLemonSqueezyEvent(request.body, rawBody);
  if (!event?.subscriptionId) return json(response, 202, { ok: true, ignored: true });
  const configuration = await readConfiguration(db);
  const allowedVariants = new Set(configuration.allowedVariantIds);
  if (!allowedVariants.size) return json(response, 503, { error: "Varianti FileX non configurate." });
  if (event.variantId && !allowedVariants.has(event.variantId)) return json(response, 202, { ok: true, ignored: true });
  const eventRef = db.collection("licenseWebhookEvents").doc(event.eventId);
  if ((await eventRef.get()).exists) return json(response, 200, { ok: true, duplicate: true });
  const subscriptionRef = db.collection("licenseSubscriptions").doc(event.subscriptionId);
  const update: Record<string, unknown> = {
    provider: "lemonsqueezy",
    providerSubscriptionId: event.subscriptionId,
    entitlement: "filex-all-access",
    updatedAt: Timestamp.now(),
    lastProviderEventAt: Timestamp.fromMillis(event.occurredAt),
  };
  if (event.customerId) update.providerCustomerId = event.customerId;
  if (event.variantId) update.variantId = event.variantId;
  if (event.licenseKey) update.licenseKeyHash = hashLicenseSecret(event.licenseKey);
  if (event.commercial) Object.assign(update, event.commercial);
  await db.runTransaction(async (transaction) => {
    const [existingEvent, existingSubscription] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(subscriptionRef),
    ]);
    if (existingEvent.exists) return;
    const lastProviderEventAt = (existingSubscription.data() as SubscriptionRecord | undefined)?.lastProviderEventAt;
    const stale = lastProviderEventAt instanceof Timestamp && lastProviderEventAt.toMillis() > event.occurredAt;
    if (!stale) transaction.set(subscriptionRef, update, { merge: true });
    transaction.set(eventRef, {
      provider: "lemonsqueezy",
      type: event.eventName,
      receivedAt: Timestamp.now(),
      processedAt: Timestamp.now(),
      payloadHash: event.eventId,
      status: stale ? "ignored_stale" : "processed",
      expiresAt: Timestamp.fromMillis(Date.now() + 90 * 24 * 60 * 60 * 1000),
    });
  });
  return json(response, 200, { ok: true });
}

async function activate(db: Firestore, request: Request, response: HttpResponse, signingPrivateKey: string) {
  const licenseKey = normalizeLicenseKey(request.body?.licenseKey);
  const installationId = normalizeInstallationId(request.body?.installationId);
  if (!licenseKey || !installationId) return json(response, 400, { error: "Chiave licenza o installazione non valida." });
  if (!(await consumeActivationAttempt(db, request))) return json(response, 429, { error: "Troppi tentativi di attivazione. Attendi dieci minuti e riprova." });
  const keyHash = hashLicenseSecret(licenseKey);
  const subscriptions = await db.collection("licenseSubscriptions").where("licenseKeyHash", "==", keyHash).limit(1).get();
  if (subscriptions.empty) return json(response, 401, { error: "Chiave licenza non riconosciuta." });
  const subscription = subscriptions.docs[0];
  const installationHash = hashLicenseSecret(installationId);
  const activationToken = randomBytes(32).toString("base64url");
  const now = Timestamp.now();
  const activationRef = db.collection("licenseActivations").doc(hashLicenseSecret(`${subscription.id}:${installationHash}`));
  const result = await db.runTransaction(async (transaction) => {
    const activeQuery = db.collection("licenseActivations")
      .where("subscriptionId", "==", subscription.id)
      .where("deactivatedAt", "==", null);
    const [freshSubscription, existingActivation, active] = await Promise.all([
      transaction.get(subscription.ref),
      transaction.get(activationRef),
      transaction.get(activeQuery),
    ]);
    if (!freshSubscription.exists) return { allowed: false as const, reason: "missing" as const };
    const existingData = existingActivation.data() as ActivationRecord | undefined;
    const isAlreadyActive = Boolean(existingData && !existingData.deactivatedAt);
    if (!isAlreadyActive && active.size >= 2) return { allowed: false as const, reason: "limit" as const };
    transaction.set(activationRef, {
      subscriptionId: subscription.id,
      installationIdHash: installationHash,
      tokenHash: hashLicenseSecret(activationToken),
      deviceLabel: normalizeLabel(request.body?.deviceLabel),
      appVersion: normalizeVersion(request.body?.appVersion),
      activatedAt: existingData?.activatedAt ?? now,
      lastValidatedAt: now,
      deactivatedAt: null,
      termsVersion: normalizePolicyVersion(request.body?.termsVersion),
      licenseVersion: normalizePolicyVersion(request.body?.licenseVersion),
      privacyVersion: normalizePolicyVersion(request.body?.privacyVersion),
      acceptedAt: normalizeAcceptanceTime(request.body?.acceptedAt) ?? now,
    } satisfies ActivationRecord, { merge: true });
    return { allowed: true as const, count: isAlreadyActive ? active.size : active.size + 1, data: freshSubscription.data() as SubscriptionRecord };
  });
  if (!result.allowed) {
    const message = result.reason === "limit" ? "Hai gia' attivato i due PC inclusi. Disattiva un dispositivo e riprova." : "Licenza non disponibile.";
    return json(response, result.reason === "limit" ? 409 : 401, { error: message });
  }
  const data = result.data;
  const count = result.count;
  const entitlement = createEntitlement(data, count);
  return json(response, 200, { activationToken, entitlement, attestation: attest(entitlement, installationHash, signingPrivateKey), enforcement: (await readPublicConfiguration(db)).enforcement });
}

async function consumeActivationAttempt(db: Firestore, request: Request): Promise<boolean> {
  const rawIp = String(request.ip || request.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  const bucket = Math.floor(Date.now() / (10 * 60 * 1000));
  const ref = db.collection("licenseRateLimits").doc(hashLicenseSecret(`activate:${rawIp}:${bucket}`));
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const count = Number(snapshot.data()?.count ?? 0);
    if (count >= 10) return false;
    transaction.set(ref, {
      count: count + 1,
      expiresAt: Timestamp.fromMillis((bucket + 2) * 10 * 60 * 1000),
      updatedAt: Timestamp.now(),
    }, { merge: true });
    return true;
  });
}

async function validate(db: Firestore, request: Request, response: HttpResponse, signingPrivateKey: string) {
  const authorized = await authorizeActivation(db, request.body?.activationToken, request.body?.installationId);
  if (!authorized) return json(response, 401, { error: "Attivazione non valida o disattivata." });
  const subscription = await db.collection("licenseSubscriptions").doc(authorized.data.subscriptionId).get();
  if (!subscription.exists) return json(response, 401, { error: "Licenza non disponibile." });
  await authorized.ref.update({ lastValidatedAt: Timestamp.now(), appVersion: normalizeVersion(request.body?.appVersion) });
  const active = await db.collection("licenseActivations").where("subscriptionId", "==", subscription.id).where("deactivatedAt", "==", null).get();
  const entitlement = createEntitlement(subscription.data() as SubscriptionRecord, active.size);
  return json(response, 200, { entitlement, attestation: attest(entitlement, authorized.data.installationIdHash, signingPrivateKey), enforcement: (await readPublicConfiguration(db)).enforcement });
}

async function deactivate(db: Firestore, request: Request, response: HttpResponse) {
  const authorized = await authorizeActivation(db, request.body?.activationToken, request.body?.installationId);
  if (!authorized) return json(response, 401, { error: "Attivazione non valida o gia' disattivata." });
  await authorized.ref.update({ deactivatedAt: Timestamp.now(), tokenHash: FieldValue.delete() });
  return json(response, 200, { ok: true });
}

async function authorizeActivation(db: Firestore, rawToken: unknown, rawInstallationId: unknown) {
  const token = typeof rawToken === "string" ? rawToken.trim() : "";
  const installationId = normalizeInstallationId(rawInstallationId);
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token) || !installationId) return null;
  const matches = await db.collection("licenseActivations").where("tokenHash", "==", hashLicenseSecret(token)).limit(1).get();
  if (matches.empty) return null;
  const ref = matches.docs[0];
  const data = ref.data() as ActivationRecord;
  if (data.deactivatedAt || data.installationIdHash !== hashLicenseSecret(installationId)) return null;
  return { ref: ref.ref, data };
}

function normalizeInstallationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f-]{36}$/.test(normalized) ? normalized : null;
}

function normalizeLabel(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/[\u0000-\u001f]/g, "").slice(0, 80) || "PC FileX" : "PC FileX";
}

function normalizeVersion(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 32) : "unknown";
}

function normalizePolicyVersion(value: unknown): string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "unknown";
}

function normalizeAcceptanceTime(value: unknown): Timestamp | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && Math.abs(Date.now() - parsed) <= 24 * 60 * 60 * 1000 ? Timestamp.fromMillis(parsed) : null;
}

async function readConfiguration(db: Firestore): Promise<{ enforcement: "observe" | "warn" | "enforce"; allowedVariantIds: string[]; checkoutMonthlyUrl: string | null; checkoutAnnualUrl: string | null }> {
  const snapshot = await db.collection("licenseConfiguration").doc("public").get();
  const data = snapshot.data() ?? {};
  const remoteEnforcement = data.enforcement === "observe" || data.enforcement === "warn" || data.enforcement === "enforce" ? data.enforcement : null;
  const enforcement = data.enforcementOverride === true && remoteEnforcement ? remoteEnforcement : FILEX_COMMERCE_DEFAULTS.enforcement;
  const remoteVariants = Array.isArray(data.allowedVariantIds) ? data.allowedVariantIds.filter((value): value is string => typeof value === "string") : [];
  return {
    enforcement,
    allowedVariantIds: remoteVariants.length ? remoteVariants : FILEX_COMMERCE_DEFAULTS.allowedVariantIds,
    checkoutMonthlyUrl: safeCheckoutUrl(data.checkoutMonthlyUrl) ?? safeCheckoutUrl(FILEX_COMMERCE_DEFAULTS.checkoutMonthlyUrl),
    checkoutAnnualUrl: safeCheckoutUrl(data.checkoutAnnualUrl) ?? safeCheckoutUrl(FILEX_COMMERCE_DEFAULTS.checkoutAnnualUrl),
  };
}

async function readPublicConfiguration(db: Firestore) {
  const configuration = await readConfiguration(db);
  return {
    enforcement: configuration.enforcement,
    checkout: { monthly: configuration.checkoutMonthlyUrl, annual: configuration.checkoutAnnualUrl },
  };
}

function safeCheckoutUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "lemonsqueezy.com" || url.hostname.endsWith(".lemonsqueezy.com")) ? url.toString() : null;
  } catch {
    return null;
  }
}

function attest(entitlement: ReturnType<typeof createEntitlement>, installationIdHash: string, privateKey: string): string | null {
  return privateKey ? createLicenseAttestation({ version: 1, installationIdHash, entitlement, issuedAt: Date.now() }, privateKey) : null;
}

function json(response: HttpResponse, status: number, value: unknown) {
  return response.status(status).json(value);
}
