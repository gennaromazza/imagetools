import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { createLicenseAttestation, verifyLicenseAttestation } from "./license-attestation.js";

test("signs attestations and rejects local tampering", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const payload = {
    version: 1 as const,
    installationIdHash: "installation",
    entitlement: { schemaVersion: 1 as const, entitlement: "filex-all-access" as const, status: "active" as const, validUntil: 10, offlineUntil: 10, activation: { current: 1, limit: 2 } },
    issuedAt: 1,
  };
  const attestation = createLicenseAttestation(payload, privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  assert.deepEqual(verifyLicenseAttestation(attestation, publicPem), payload);
  const [body, signature] = attestation.split(".");
  const tampered = `${body.slice(0, -1)}A.${signature}`;
  assert.equal(verifyLicenseAttestation(tampered, publicPem), null);
});

