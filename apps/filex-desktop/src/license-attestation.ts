import { createHash, verify } from "node:crypto";
import type { DesktopLicenseState } from "./license-service.js";
import { FILEX_LICENSE_PUBLIC_KEY } from "./license-public-key.js";

interface AttestationPayload {
  version: 1;
  installationIdHash: string;
  entitlement: {
    schemaVersion: 1;
    entitlement: "filex-all-access";
    status: DesktopLicenseState["status"];
    validUntil: number | null;
    offlineUntil: number | null;
    activation: { current: number; limit: number };
  };
  issuedAt: number;
}

export function installationHash(installationId: string): string {
  return createHash("sha256").update(installationId.trim(), "utf8").digest("hex");
}

export function verifyOfflineAttestation(attestation: string | undefined, installationId: string, now = Date.now()): AttestationPayload | null {
  if (!attestation) return null;
  const [encoded, signature, extra] = attestation.split(".");
  if (!encoded || !signature || extra) return null;
  try {
    if (!verify(null, Buffer.from(encoded, "utf8"), FILEX_LICENSE_PUBLIC_KEY, Buffer.from(signature, "base64url"))) return null;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as AttestationPayload;
    if (payload.version !== 1 || payload.installationIdHash !== installationHash(installationId)) return null;
    if (!payload.entitlement.offlineUntil || payload.entitlement.offlineUntil <= now) return null;
    if (payload.entitlement.status !== "active" && payload.entitlement.status !== "grace") return null;
    return payload;
  } catch {
    return null;
  }
}

