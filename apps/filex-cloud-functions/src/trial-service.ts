import { createHmac, randomBytes } from "node:crypto";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { createEntitlement, hashLicenseSecret, type CommercialLicenseState } from "./licensing-core.js";
import { createLicenseAttestation } from "./license-attestation.js";

export const TRIAL_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_MS = 20 * 60 * 1000;
const secretValid = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
export class TrialError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
interface TrialSession {
  installationIdHash: string;
  deviceIdHash: string;
  pollHash: string;
  expiresAt: number;
  deviceLabel: string;
  subscriptionId?: string;
}
interface TrialRecord extends CommercialLicenseState {
  ownerUid: string;
  trialDeviceIdHash: string;
  trial: true;
}

export function trialCanResume(record: TrialRecord, uid: string, device: string, now: number): boolean {
  return record.ownerUid === uid && record.trialDeviceIdHash === device
    && record.status === "cancelled" && typeof record.currentPeriodEnd === "number" && record.currentPeriodEnd > now;
}

export async function startTrialSession(db: Firestore, body: Record<string, unknown>) {
  if (typeof body.installationId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.installationId)
    || typeof body.deviceIdHash !== "string" || !/^[a-f0-9]{64}$/.test(body.deviceIdHash)
    || !secretValid(body.pollSecret)) throw new TrialError(400, "Dispositivo non valido.");
  const code = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + SESSION_MS;
  await db.collection("licenseTrialSessions").doc(hashLicenseSecret(code)).set({
    installationIdHash: hashLicenseSecret(body.installationId.toLowerCase()),
    deviceIdHash: body.deviceIdHash,
    pollHash: hashLicenseSecret(body.pollSecret),
    deviceLabel: typeof body.deviceLabel === "string" ? body.deviceLabel.slice(0, 80) : "PC FileX",
    expiresAt,
    cleanupAt: Timestamp.fromMillis(expiresAt),
  } satisfies TrialSession & { cleanupAt: Timestamp });
  return { code, expiresAt };
}

function activationToken(pollHash: string, signingKey: string, sessionHash: string): string {
  return createHmac("sha256", signingKey).update(`filex-trial:${sessionHash}:${pollHash}`).digest("base64url");
}

export async function approveTrial(db: Firestore, code: unknown, identity: { uid: string; email: string }, signingKey: string) {
  if (!secretValid(code)) throw new TrialError(400, "Collegamento di prova non valido.");
  const sessionRef = db.collection("licenseTrialSessions").doc(hashLicenseSecret(code));
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(sessionRef);
    const session = snapshot.data() as TrialSession | undefined;
    const now = Date.now();
    if (!session || session.expiresAt <= now) throw new TrialError(410, "Collegamento scaduto. Riavvia la prova dalla Suite.");
    const claims = [ `uid:${identity.uid}`, `email:${identity.email.toLowerCase()}`, `device:${session.deviceIdHash}` ]
      .map(key => db.collection("licenseTrialClaims").doc(hashLicenseSecret(key)));
    const previous = await Promise.all(claims.map(ref => transaction.get(ref)));
    const subscriptionId = `trial-${hashLicenseSecret(identity.uid)}`;
    if (previous.some(item => item.exists && item.data()?.subscriptionId !== subscriptionId)) {
      throw new TrialError(409, "Questo account o PC ha gia' usufruito della prova gratuita.");
    }
    const subscriptionRef = db.collection("licenseSubscriptions").doc(subscriptionId);
    const existing = await transaction.get(subscriptionRef);
    const record = existing.data() as TrialRecord | undefined;
    if (!record && previous.some(item => item.exists)) throw new TrialError(409, "Prova gia' registrata. Contatta l'assistenza per recuperarla.");
    if (record && !trialCanResume(record, identity.uid, session.deviceIdHash, now)) {
      throw new TrialError(409, "Prova terminata o associata a un altro PC. Scegli un abbonamento per continuare.");
    }
    const activationRef = db.collection("licenseActivations").doc(hashLicenseSecret(`${subscriptionId}:trial`));
    const priorActivation = await transaction.get(activationRef);
    // An approval is single-use. Polling may retry delivery, but cannot reactivate a revoked device.
    if (session.subscriptionId) return { ok: true, validUntil: record?.currentPeriodEnd };
    const validUntil = record?.currentPeriodEnd ?? now + TRIAL_DURATION_MS;
    if (!record) transaction.set(subscriptionRef, {
      provider: "trial", providerSubscriptionId: subscriptionId, entitlement: "filex-all-access",
      ownerUid: identity.uid, trial: true, trialDeviceIdHash: session.deviceIdHash,
      status: "cancelled", currentPeriodEnd: validUntil, startedAt: now, updatedAt: Timestamp.fromMillis(now),
    });
    claims.forEach(ref => transaction.set(ref, { subscriptionId }));
    transaction.set(activationRef, {
      subscriptionId, installationIdHash: session.installationIdHash,
      tokenHash: hashLicenseSecret(activationToken(session.pollHash, signingKey, hashLicenseSecret(code))),
      deviceLabel: session.deviceLabel, appVersion: "trial",
      activatedAt: priorActivation.data()?.activatedAt ?? Timestamp.fromMillis(now),
      lastValidatedAt: Timestamp.fromMillis(now), deactivatedAt: null,
      termsVersion: "2026-09-07", privacyVersion: "2026-09-07", licenseVersion: "2026-09-07",
      acceptedAt: Timestamp.fromMillis(now),
    });
    transaction.update(sessionRef, { subscriptionId });
    return { ok: true, validUntil };
  });
}

export async function pollTrial(db: Firestore, body: Record<string, unknown>, signingKey: string) {
  if (!secretValid(body.code) || !secretValid(body.pollSecret)) throw new TrialError(400, "Sessione non valida.");
  const snapshot = await db.collection("licenseTrialSessions").doc(hashLicenseSecret(body.code)).get();
  const session = snapshot.data() as TrialSession | undefined;
  if (!session || session.pollHash !== hashLicenseSecret(body.pollSecret)) throw new TrialError(401, "Sessione non autorizzata.");
  if (session.expiresAt <= Date.now()) throw new TrialError(410, "Collegamento scaduto. Riavvia la prova dalla Suite.");
  if (!session.subscriptionId) return { pending: true };
  const [subscription, activation] = await Promise.all([
    db.collection("licenseSubscriptions").doc(session.subscriptionId).get(),
    db.collection("licenseActivations").doc(hashLicenseSecret(`${session.subscriptionId}:trial`)).get(),
  ]);
  const token = activationToken(session.pollHash, signingKey, hashLicenseSecret(body.code));
  if (!subscription.exists || !activation.exists || activation.data()?.deactivatedAt
    || activation.data()?.tokenHash !== hashLicenseSecret(token)) throw new TrialError(401, "Attivazione non piu' disponibile.");
  const entitlement = createEntitlement(subscription.data() as TrialRecord, 1);
  return { pending: false, activationToken: token, entitlement, enforcement: "enforce",
    attestation: createLicenseAttestation({ version: 1, installationIdHash: session.installationIdHash, entitlement, issuedAt: Date.now() }, signingKey) };
}
