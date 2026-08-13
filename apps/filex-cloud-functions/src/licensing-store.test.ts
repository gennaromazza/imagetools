import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { hashLicenseSecret } from "./licensing-core.js";
import {
  activateWithRepository,
  deactivateWithRepository,
  validateWithRepository,
  type LicenseActivation,
  type LicenseRepository,
  type LicenseSubscription,
} from "./licensing-store.js";

class MemoryLicenseRepository implements LicenseRepository {
  subscriptions = new Map<string, LicenseSubscription>();
  activations = new Map<string, LicenseActivation>();
  async findSubscriptionByKeyHash(hash: string) { return [...this.subscriptions.values()].find((item) => item.licenseKeyHash === hash) ?? null; }
  async getSubscription(id: string) { return this.subscriptions.get(id) ?? null; }
  async listActiveActivations(id: string) { return [...this.activations.values()].filter((item) => item.subscriptionId === id && !item.deactivated); }
  async findActiveActivationByTokenHash(hash: string) { return [...this.activations.values()].find((item) => item.tokenHash === hash && !item.deactivated) ?? null; }
  async saveActivation(value: LicenseActivation) { this.activations.set(value.id, value); }
  async deactivateActivation(id: string) { const value = this.activations.get(id); if (value) this.activations.set(id, { ...value, deactivated: true }); }
}

test("runs the full two-device activation lifecycle", async () => {
  const repository = new MemoryLicenseRepository();
  const key = "FILEX-E2E0-TEST-KEY0";
  repository.subscriptions.set("sub", {
    id: "sub", entitlement: "filex-all-access", licenseKeyHash: hashLicenseSecret(key), status: "active",
    currentPeriodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000,
  });
  const devices = [randomUUID(), randomUUID(), randomUUID()];
  const first = await activateWithRepository(repository, key, devices[0]);
  const second = await activateWithRepository(repository, key, devices[1]);
  assert.equal(first.ok && first.entitlement?.activation.current, 1);
  assert.equal(second.ok && second.entitlement?.activation.current, 2);
  assert.deepEqual(await activateWithRepository(repository, key, devices[2]), { ok: false, code: "limit" });
  assert.equal((await validateWithRepository(repository, first.ok ? first.activationToken! : "", devices[0])).ok, true);
  assert.equal((await validateWithRepository(repository, first.ok ? first.activationToken! : "", devices[1])).ok, false);
  assert.equal((await deactivateWithRepository(repository, first.ok ? first.activationToken! : "", devices[0])).ok, true);
  const replacement = await activateWithRepository(repository, key, devices[2]);
  assert.equal(replacement.ok && replacement.entitlement?.activation.current, 2);
  assert.equal((await validateWithRepository(repository, first.ok ? first.activationToken! : "", devices[0])).ok, false);
});

