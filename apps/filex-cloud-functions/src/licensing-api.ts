import { randomBytes } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
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
import { derivePayPalCustomerEmailHash, derivePayPalLicenseKey, normalizeCustomerEmail, parsePayPalEvent } from "./paypal-adapter.js";

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
  ownerUid?: string;
  customerEmailHash?: string;
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

interface LicensingSecrets {
  lemonSqueezyWebhookSecret?: string;
  paypalClientSecret?: string;
  paypalLicenseKeySecret?: string;
  signingPrivateKey?: string;
}

interface CommerceConfiguration {
  enforcement: "observe" | "warn" | "enforce";
  provider: "paypal" | "lemonsqueezy" | null;
  allowedVariantIds: string[];
  checkoutMonthlyUrl: string | null;
  checkoutAnnualUrl: string | null;
  paypal: {
    enabled: boolean;
    environment: "sandbox" | "live";
    clientId: string | null;
    webhookId: string | null;
    monthlyPlanId: string | null;
    annualPlanId: string | null;
  };
}

export async function handleLicensingRequest(db: Firestore, request: Request, response: HttpResponse, secrets: LicensingSecrets = {}): Promise<unknown> {
  const rawPath = request.path.replace(/\/+$/, "").replace(/^\/api(?=\/|$)/, "") || "/";
  const path = rawPath.replace(/^\/licensing/, "") || "/";
  if (request.method === "GET" && path === "/health") {
    const config = await readPublicConfiguration(db);
    return json(response, 200, { ok: true, service: "FileX Licensing", ...config });
  }
  if (request.method === "POST" && path === "/webhooks/lemonsqueezy") return lemonSqueezyWebhook(db, request, response, secrets.lemonSqueezyWebhookSecret ?? "");
  if (request.method === "POST" && path === "/webhooks/paypal") return paypalWebhook(db, request, response, secrets);
  if (request.method === "POST" && path === "/paypal/license") return claimPayPalLicense(db, request, response, secrets);
  if (request.method === "POST" && path === "/account/link") return claimPayPalLicense(db, request, response, secrets);
  if (request.method === "GET" && path === "/account") return accountOverview(db, request, response, secrets);
  if (request.method === "POST" && path === "/account/devices/deactivate") return deactivateAccountDevice(db, request, response);
  if (request.method === "POST" && path === "/activate") return activate(db, request, response, secrets.signingPrivateKey ?? "");
  if (request.method === "POST" && path === "/validate") return validate(db, request, response, secrets.signingPrivateKey ?? "");
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

async function paypalWebhook(db: Firestore, request: Request, response: HttpResponse, secrets: LicensingSecrets) {
  const configuration = await readConfiguration(db);
  const paypal = configuration.paypal;
  const clientSecret = secrets.paypalClientSecret ?? "";
  const licenseKeySecret = secrets.paypalLicenseKeySecret ?? "";
  if (!paypal.enabled || !paypal.clientId || !paypal.webhookId || !clientSecret || !licenseKeySecret) {
    return json(response, 503, { error: "Webhook PayPal non configurato." });
  }
  const accessToken = await verifyPayPalWebhook(request, paypal, clientSecret);
  if (!accessToken) return json(response, 401, { error: "Firma webhook PayPal non valida." });

  const event = parsePayPalEvent(request.body);
  if (!event?.subscriptionId) return json(response, 202, { ok: true, ignored: true });
  const eventRef = db.collection("licenseWebhookEvents").doc(hashLicenseSecret(`paypal:${event.eventId}`));
  const subscriptionRef = db.collection("licenseSubscriptions").doc(event.subscriptionId);
  if ((await eventRef.get()).exists) return json(response, 200, { ok: true, duplicate: true });

  const existingSubscription = await subscriptionRef.get();
  const shouldRefreshSubscription = !event.planId
    || Boolean(event.commercial && ["active", "cancelled"].includes(event.commercial.status) && event.commercial.currentPeriodEnd == null);
  const paypalSubscription = shouldRefreshSubscription
    ? await fetchPayPalSubscription(paypal, accessToken, event.subscriptionId)
    : null;
  if (shouldRefreshSubscription && !paypalSubscription) return json(response, 503, { error: "Stato PayPal temporaneamente non disponibile." });
  const knownPlanId = event.planId ?? stringValue(paypalSubscription?.plan_id) ?? stringValue(existingSubscription.data()?.planId);
  const allowedPlans = new Set(configuration.allowedVariantIds);
  if (!knownPlanId || !allowedPlans.has(knownPlanId)) return json(response, 202, { ok: true, ignored: true });

  const update: Record<string, unknown> = {
    provider: "paypal",
    providerSubscriptionId: event.subscriptionId,
    entitlement: "filex-all-access",
    licenseKeyHash: hashLicenseSecret(derivePayPalLicenseKey(event.subscriptionId, licenseKeySecret)),
    planId: knownPlanId,
    updatedAt: Timestamp.now(),
    lastProviderEventAt: Timestamp.fromMillis(event.occurredAt),
  };
  const customerId = event.customerId ?? stringValue(paypalSubscription?.subscriber?.payer_id);
  if (customerId) update.providerCustomerId = customerId;
  const customerEmailHash = derivePayPalCustomerEmailHash(
    event.customerEmail ?? paypalSubscription?.subscriber?.email_address,
    licenseKeySecret,
  );
  if (customerEmailHash) update.customerEmailHash = customerEmailHash;
  if (event.commercial) {
    const commercial = { ...event.commercial };
    const refreshedPeriodEnd = parseTimestamp(paypalSubscription?.billing_info?.next_billing_time);
    if (commercial.currentPeriodEnd == null && refreshedPeriodEnd !== null) commercial.currentPeriodEnd = refreshedPeriodEnd;
    Object.assign(update, commercial);
  }

  await db.runTransaction(async (transaction) => {
    const [existingEvent, freshSubscription] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(subscriptionRef),
    ]);
    if (existingEvent.exists) return;
    const lastProviderEventAt = (freshSubscription.data() as SubscriptionRecord | undefined)?.lastProviderEventAt;
    const stale = lastProviderEventAt instanceof Timestamp && lastProviderEventAt.toMillis() > event.occurredAt;
    if (!stale) transaction.set(subscriptionRef, update, { merge: true });
    transaction.set(eventRef, {
      provider: "paypal",
      type: event.eventName,
      receivedAt: Timestamp.now(),
      processedAt: Timestamp.now(),
      payloadHash: hashLicenseSecret(JSON.stringify(request.body)),
      status: stale ? "ignored_stale" : "processed",
      expiresAt: Timestamp.fromMillis(Date.now() + 90 * 24 * 60 * 60 * 1000),
    });
  });
  return json(response, 200, { ok: true });
}

async function claimPayPalLicense(db: Firestore, request: Request, response: HttpResponse, secrets: LicensingSecrets) {
  const identity = await verifiedAccountIdentity(request);
  if (!identity) return json(response, 401, { error: "Accedi con un indirizzo email verificato per recuperare la licenza." });
  const subscriptionId = stringValue(request.body?.subscriptionId);
  if (!subscriptionId || !/^[A-Z0-9-]{8,80}$/i.test(subscriptionId)) return json(response, 400, { error: "Abbonamento PayPal non valido." });
  if (!(await consumePayPalClaimAttempt(db, request))) return json(response, 429, { error: "Troppi tentativi. Attendi dieci minuti e riprova." });

  const configuration = await readConfiguration(db);
  const paypal = configuration.paypal;
  const clientSecret = secrets.paypalClientSecret ?? "";
  const licenseKeySecret = secrets.paypalLicenseKeySecret ?? "";
  if (!paypal.enabled || !paypal.clientId || !clientSecret || !licenseKeySecret) return json(response, 503, { error: "PayPal non configurato." });

  const accessToken = await paypalAccessToken(paypal, clientSecret);
  const subscription = await fetchPayPalSubscription(paypal, accessToken, subscriptionId);
  if (!subscription) return json(response, 404, { error: "PayPal non ha confermato l'abbonamento. Riprova tra poco." });
  const planId = stringValue(subscription.plan_id);
  if (!planId || !configuration.allowedVariantIds.includes(planId)) return json(response, 409, { error: "L'abbonamento PayPal non appartiene a FileX." });
  const paypalEmail = normalizeCustomerEmail(subscription.subscriber?.email_address);
  if (!paypalEmail) return json(response, 409, { error: "PayPal non ha restituito l'email dell'abbonamento." });
  if (paypalEmail !== identity.email) return json(response, 403, { error: "Accedi con la stessa email usata per il pagamento PayPal." });

  const existing = await db.collection("licenseSubscriptions").doc(subscriptionId).get();
  const existingOwner = stringValue(existing.data()?.ownerUid);
  if (existingOwner && existingOwner !== identity.uid) return json(response, 409, { error: "Questo abbonamento è già collegato a un altro account FileX." });

  const licenseKey = derivePayPalLicenseKey(subscriptionId, licenseKeySecret);
  const currentPeriodEnd = parseTimestamp(subscription.billing_info?.next_billing_time);
  const commercialStatus = commercialStatusFromPayPal(subscription.status);
  const update: Record<string, unknown> = {
    provider: "paypal",
    providerSubscriptionId: subscriptionId,
    entitlement: "filex-all-access",
    status: commercialStatus,
    paymentFailedAt: commercialStatus === "past_due" ? Timestamp.now().toMillis() : null,
    planId,
    licenseKeyHash: hashLicenseSecret(licenseKey),
    customerEmailHash: derivePayPalCustomerEmailHash(paypalEmail, licenseKeySecret),
    ownerUid: identity.uid,
    updatedAt: Timestamp.now(),
    lastProviderEventAt: Timestamp.now(),
  };
  if (currentPeriodEnd !== null) update.currentPeriodEnd = currentPeriodEnd;
  const payerId = stringValue(subscription.subscriber?.payer_id);
  if (payerId) update.providerCustomerId = payerId;
  await db.collection("licenseSubscriptions").doc(subscriptionId).set(update, { merge: true });
  return json(response, 200, { ok: true, licenseKey, subscriptionId, status: commercialStatus });
}

async function accountOverview(db: Firestore, request: Request, response: HttpResponse, secrets: LicensingSecrets) {
  const identity = await verifiedAccountIdentity(request);
  if (!identity) return json(response, 401, { error: "Accesso richiesto con email verificata." });
  const licenseKeySecret = secrets.paypalLicenseKeySecret ?? "";
  if (!licenseKeySecret) return json(response, 503, { error: "Area cliente temporaneamente non disponibile." });

  let subscriptions = await db.collection("licenseSubscriptions").where("ownerUid", "==", identity.uid).limit(20).get();
  if (subscriptions.empty) {
    const emailHash = derivePayPalCustomerEmailHash(identity.email, licenseKeySecret);
    if (emailHash) {
      const candidates = await db.collection("licenseSubscriptions").where("customerEmailHash", "==", emailHash).limit(20).get();
      const linkable = candidates.docs.filter((doc) => {
        const ownerUid = stringValue(doc.data().ownerUid);
        return !ownerUid || ownerUid === identity.uid;
      });
      if (linkable.length) {
        const batch = db.batch();
        linkable.forEach((doc) => batch.set(doc.ref, { ownerUid: identity.uid, updatedAt: Timestamp.now() }, { merge: true }));
        await batch.commit();
        subscriptions = await db.collection("licenseSubscriptions").where("ownerUid", "==", identity.uid).limit(20).get();
      }
    }
  }

  const configuration = await readConfiguration(db);
  const items = await Promise.all(subscriptions.docs
    .filter((doc) => doc.data().provider === "paypal")
    .map(async (doc) => {
      const data = doc.data() as SubscriptionRecord & { planId?: string };
      const activations = await db.collection("licenseActivations").where("subscriptionId", "==", doc.id).where("deactivatedAt", "==", null).get();
      return {
        subscriptionId: doc.id,
        plan: data.planId === configuration.paypal.annualPlanId ? "annual" : data.planId === configuration.paypal.monthlyPlanId ? "monthly" : "unknown",
        status: data.status,
        currentPeriodEnd: timestampMillis(data.currentPeriodEnd),
        licenseKey: derivePayPalLicenseKey(doc.id, licenseKeySecret),
        activation: { current: activations.size, limit: 2 },
        devices: activations.docs.map((activation) => {
          const device = activation.data() as ActivationRecord;
          return {
            id: activation.id,
            label: device.deviceLabel,
            appVersion: device.appVersion,
            activatedAt: timestampMillis(device.activatedAt),
            lastValidatedAt: timestampMillis(device.lastValidatedAt),
          };
        }),
      };
    }));
  items.sort((a, b) => (b.currentPeriodEnd ?? 0) - (a.currentPeriodEnd ?? 0));
  return json(response, 200, { ok: true, email: identity.email, subscriptions: items });
}

async function deactivateAccountDevice(db: Firestore, request: Request, response: HttpResponse) {
  const identity = await verifiedAccountIdentity(request);
  if (!identity) return json(response, 401, { error: "Accesso richiesto con email verificata." });
  const activationId = stringValue(request.body?.activationId);
  if (!activationId || !/^[a-f0-9]{64}$/i.test(activationId)) return json(response, 400, { error: "Dispositivo non valido." });
  const activationRef = db.collection("licenseActivations").doc(activationId);
  const activation = await activationRef.get();
  if (!activation.exists) return json(response, 404, { error: "Dispositivo non trovato." });
  const activationData = activation.data() as ActivationRecord;
  const subscription = await db.collection("licenseSubscriptions").doc(activationData.subscriptionId).get();
  if (!subscription.exists || subscription.data()?.ownerUid !== identity.uid) return json(response, 403, { error: "Dispositivo non autorizzato." });
  await activationRef.update({ deactivatedAt: Timestamp.now(), tokenHash: FieldValue.delete() });
  return json(response, 200, { ok: true });
}

async function verifyPayPalWebhook(request: Request, paypal: CommerceConfiguration["paypal"], clientSecret: string): Promise<string | null> {
  const requiredHeaders = {
    transmission_id: request.get("paypal-transmission-id"),
    transmission_time: request.get("paypal-transmission-time"),
    cert_url: request.get("paypal-cert-url"),
    auth_algo: request.get("paypal-auth-algo"),
    transmission_sig: request.get("paypal-transmission-sig"),
  };
  if (Object.values(requiredHeaders).some((value) => !value)) return null;
  const accessToken = await paypalAccessToken(paypal, clientSecret);
  const verification = await fetch(`${paypalApiBase(paypal.environment)}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ ...requiredHeaders, webhook_id: paypal.webhookId, webhook_event: request.body }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!verification.ok) return null;
  const result = await verification.json() as { verification_status?: unknown };
  return result.verification_status === "SUCCESS" ? accessToken : null;
}

async function fetchPayPalSubscription(paypal: CommerceConfiguration["paypal"], accessToken: string, subscriptionId: string): Promise<Record<string, any> | null> {
  const response = await fetch(`${paypalApiBase(paypal.environment)}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  return response.ok ? response.json() as Promise<Record<string, any>> : null;
}

async function paypalAccessToken(paypal: CommerceConfiguration["paypal"], clientSecret: string): Promise<string> {
  if (!paypal.clientId) throw new Error("PayPal client ID missing");
  const credentials = Buffer.from(`${paypal.clientId}:${clientSecret}`, "utf8").toString("base64");
  const tokenResponse = await fetch(`${paypalApiBase(paypal.environment)}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok) throw new Error(`PayPal OAuth rejected the request (${tokenResponse.status})`);
  const payload = await tokenResponse.json() as { access_token?: unknown };
  const token = stringValue(payload.access_token);
  if (!token) throw new Error("PayPal OAuth returned no access token");
  return token;
}

function paypalApiBase(environment: "sandbox" | "live"): string {
  return environment === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
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

async function consumePayPalClaimAttempt(db: Firestore, request: Request): Promise<boolean> {
  const rawIp = String(request.ip || request.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  const bucket = Math.floor(Date.now() / (10 * 60 * 1000));
  const ref = db.collection("licenseRateLimits").doc(hashLicenseSecret(`paypal-claim:${rawIp}:${bucket}`));
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const count = Number(snapshot.data()?.count ?? 0);
    if (count >= 20) return false;
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

async function readConfiguration(db: Firestore): Promise<CommerceConfiguration> {
  const snapshot = await db.collection("licenseConfiguration").doc("public").get();
  const data = snapshot.data() ?? {};
  const remoteEnforcement = data.enforcement === "observe" || data.enforcement === "warn" || data.enforcement === "enforce" ? data.enforcement : null;
  const enforcement = data.enforcementOverride === true && remoteEnforcement ? remoteEnforcement : FILEX_COMMERCE_DEFAULTS.enforcement;
  const environment = data.paypalEnvironment === "live" || data.paypalEnvironment === "sandbox"
    ? data.paypalEnvironment
    : FILEX_COMMERCE_DEFAULTS.paypalEnvironment;
  const clientId = stringValue(data.paypalClientId) ?? FILEX_COMMERCE_DEFAULTS.paypalClientId;
  const webhookId = stringValue(data.paypalWebhookId) ?? FILEX_COMMERCE_DEFAULTS.paypalWebhookId;
  const monthlyPlanId = stringValue(data.paypalMonthlyPlanId) ?? FILEX_COMMERCE_DEFAULTS.paypalMonthlyPlanId;
  const annualPlanId = stringValue(data.paypalAnnualPlanId) ?? FILEX_COMMERCE_DEFAULTS.paypalAnnualPlanId;
  const allowedVariantIds = [monthlyPlanId, annualPlanId].filter((value): value is string => Boolean(value));
  const enabled = Boolean(clientId && webhookId && monthlyPlanId && annualPlanId);
  const websiteBase = "https://filex-suite.web.app/";
  return {
    enforcement,
    provider: enabled ? "paypal" : null,
    allowedVariantIds,
    checkoutMonthlyUrl: enabled ? `${websiteBase}?billing=monthly#prezzi` : null,
    checkoutAnnualUrl: enabled ? `${websiteBase}?billing=annual#prezzi` : null,
    paypal: { enabled, environment, clientId, webhookId, monthlyPlanId, annualPlanId },
  };
}

async function readPublicConfiguration(db: Firestore) {
  const configuration = await readConfiguration(db);
  return {
    enforcement: configuration.enforcement,
    provider: configuration.provider,
    checkout: { monthly: configuration.checkoutMonthlyUrl, annual: configuration.checkoutAnnualUrl },
    paypal: {
      enabled: configuration.paypal.enabled,
      environment: configuration.paypal.environment,
      clientId: configuration.paypal.clientId,
      plans: { monthly: configuration.paypal.monthlyPlanId, annual: configuration.paypal.annualPlanId },
    },
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function commercialStatusFromPayPal(value: unknown): CommercialLicenseState["status"] {
  if (value === "ACTIVE") return "active";
  if (value === "SUSPENDED") return "past_due";
  if (value === "CANCELLED") return "cancelled";
  return "expired";
}

function timestampMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function verifiedAccountIdentity(request: Request): Promise<{ uid: string; email: string } | null> {
  const token = String(request.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  try {
    const decoded = await getAuth().verifyIdToken(token);
    const email = normalizeCustomerEmail(decoded.email);
    return decoded.email_verified === true && email ? { uid: decoded.uid, email } : null;
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
