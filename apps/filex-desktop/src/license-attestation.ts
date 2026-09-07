import { createHash, verify } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DesktopLicenseState } from "./license-service.js";
import { FILEX_LICENSE_PUBLIC_KEY } from "./license-public-key.js";

interface AttestationPayload {
  version: 1;
  installationIdHash: string;
  entitlement: {
    trial?: boolean;
    trialDeviceIdHash?: string;
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

export async function trialDeviceHash(): Promise<string> {
  if (process.platform !== "win32") throw new Error("La prova automatica richiede Windows.");
  const { stdout } = await promisify(execFile)("reg.exe", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid", "/reg:64"], { windowsHide: true, timeout: 5000 });
  const guid = stdout.match(/MachineGuid\s+REG_SZ\s+([0-9a-f-]{36})/i)?.[1];
  if (!guid) throw new Error("Impossibile identificare questo PC per la prova.");
  return createHash("sha256").update(`filex-trial-v1:${guid.toLowerCase()}`).digest("hex");
}

export function verifyOfflineAttestation(attestation: string | undefined, installationId: string, now = Date.now(), deviceIdHash?: string): AttestationPayload | null {
  if (!attestation) return null;
  const [encoded, signature, extra] = attestation.split(".");
  if (!encoded || !signature || extra) return null;
  try {
    if (!verify(null, Buffer.from(encoded, "utf8"), FILEX_LICENSE_PUBLIC_KEY, Buffer.from(signature, "base64url"))) return null;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as AttestationPayload;
    if (payload.version !== 1 || payload.installationIdHash !== installationHash(installationId)) return null;
    if (payload.entitlement.schemaVersion !== 1 || payload.entitlement.entitlement !== "filex-all-access") return null;
    if (!Number.isFinite(payload.entitlement.offlineUntil)) return null;
    if (payload.entitlement.validUntil !== null && !Number.isFinite(payload.entitlement.validUntil)) return null;
    if (!Number.isFinite(payload.issuedAt) || payload.issuedAt > now + 5 * 60 * 1000) return null;
    if (payload.entitlement.trial && (!deviceIdHash || payload.entitlement.trialDeviceIdHash !== deviceIdHash)) return null;
    if (payload.entitlement.trial && (typeof payload.entitlement.validUntil !== "number" || payload.entitlement.offlineUntil! > payload.issuedAt + 86400000)) return null;
    if (typeof payload.entitlement.validUntil === "number" && payload.entitlement.validUntil <= now) return null;
    if (!payload.entitlement.offlineUntil || payload.entitlement.offlineUntil <= now) return null;
    if (payload.entitlement.status !== "active" && payload.entitlement.status !== "grace") return null;
    return payload;
  } catch {
    return null;
  }
}

