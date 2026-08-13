import { randomBytes } from "node:crypto";
import {
  LICENSE_ACTIVATION_LIMIT,
  canActivate,
  createEntitlement,
  hashLicenseSecret,
  normalizeLicenseKey,
  type CommercialLicenseState,
  type LicenseEntitlement,
} from "./licensing-core.js";

export interface LicenseSubscription extends CommercialLicenseState {
  id: string;
  entitlement: "filex-all-access";
  licenseKeyHash: string;
}

export interface LicenseActivation {
  id: string;
  subscriptionId: string;
  installationIdHash: string;
  tokenHash: string;
  deactivated: boolean;
}

export interface LicenseRepository {
  findSubscriptionByKeyHash(keyHash: string): Promise<LicenseSubscription | null>;
  getSubscription(id: string): Promise<LicenseSubscription | null>;
  listActiveActivations(subscriptionId: string): Promise<LicenseActivation[]>;
  findActiveActivationByTokenHash(tokenHash: string): Promise<LicenseActivation | null>;
  saveActivation(activation: LicenseActivation): Promise<void>;
  deactivateActivation(id: string): Promise<void>;
}

export type LicenseServiceResult =
  | { ok: true; activationToken?: string; entitlement?: LicenseEntitlement }
  | { ok: false; code: "invalid" | "not_found" | "limit" | "unauthorized" };

export async function activateWithRepository(
  repository: LicenseRepository,
  rawLicenseKey: unknown,
  installationId: string,
): Promise<LicenseServiceResult> {
  const licenseKey = normalizeLicenseKey(rawLicenseKey);
  if (!licenseKey || !installationId) return { ok: false, code: "invalid" };
  const subscription = await repository.findSubscriptionByKeyHash(hashLicenseSecret(licenseKey));
  if (!subscription) return { ok: false, code: "not_found" };
  const installationIdHash = hashLicenseSecret(installationId);
  const active = await repository.listActiveActivations(subscription.id);
  if (!canActivate(active.map((item) => item.installationIdHash), installationIdHash)) return { ok: false, code: "limit" };
  const existing = active.find((item) => item.installationIdHash === installationIdHash);
  const token = randomBytes(32).toString("base64url");
  await repository.saveActivation({
    id: existing?.id ?? randomBytes(16).toString("hex"),
    subscriptionId: subscription.id,
    installationIdHash,
    tokenHash: hashLicenseSecret(token),
    deactivated: false,
  });
  return {
    ok: true,
    activationToken: token,
    entitlement: createEntitlement(subscription, existing ? active.length : active.length + 1),
  };
}

export async function validateWithRepository(
  repository: LicenseRepository,
  token: string,
  installationId: string,
): Promise<LicenseServiceResult> {
  const activation = await repository.findActiveActivationByTokenHash(hashLicenseSecret(token));
  if (!activation || activation.installationIdHash !== hashLicenseSecret(installationId)) return { ok: false, code: "unauthorized" };
  const subscription = await repository.getSubscription(activation.subscriptionId);
  if (!subscription) return { ok: false, code: "unauthorized" };
  const active = await repository.listActiveActivations(subscription.id);
  return { ok: true, entitlement: createEntitlement(subscription, active.length) };
}

export async function deactivateWithRepository(repository: LicenseRepository, token: string, installationId: string): Promise<LicenseServiceResult> {
  const activation = await repository.findActiveActivationByTokenHash(hashLicenseSecret(token));
  if (!activation || activation.installationIdHash !== hashLicenseSecret(installationId)) return { ok: false, code: "unauthorized" };
  await repository.deactivateActivation(activation.id);
  return { ok: true };
}

export { LICENSE_ACTIVATION_LIMIT };

