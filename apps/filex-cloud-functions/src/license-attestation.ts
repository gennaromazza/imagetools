import { sign, verify } from "node:crypto";
import type { LicenseEntitlement } from "./licensing-core.js";

export interface LicenseAttestationPayload {
  version: 1;
  installationIdHash: string;
  entitlement: LicenseEntitlement;
  issuedAt: number;
}

export function createLicenseAttestation(payload: LicenseAttestationPayload, privateKeyPem: string): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = sign(null, Buffer.from(encoded, "utf8"), privateKeyPem).toString("base64url");
  return `${encoded}.${signature}`;
}

export function verifyLicenseAttestation(attestation: string, publicKeyPem: string): LicenseAttestationPayload | null {
  const [encoded, signature, extra] = attestation.split(".");
  if (!encoded || !signature || extra) return null;
  try {
    if (!verify(null, Buffer.from(encoded, "utf8"), publicKeyPem, Buffer.from(signature, "base64url"))) return null;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as LicenseAttestationPayload;
    return payload.version === 1 ? payload : null;
  } catch {
    return null;
  }
}

