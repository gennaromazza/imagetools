import * as electron from "electron";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  DesktopCheckoutConfiguration,
  DesktopLicenseEnforcement,
  DesktopLicenseState,
  DesktopLicenseStatus,
} from "@photo-tools/desktop-contracts";
import { verifyOfflineAttestation } from "./license-attestation.js";

const { app, safeStorage } = electron;
const DEFAULT_API_URL = "https://gen-lang-client-0321087169.web.app/api/licensing";
const REQUEST_TIMEOUT_MS = 12_000;

export type { DesktopLicenseEnforcement, DesktopLicenseState, DesktopLicenseStatus };

interface StoredLicense {
  schemaVersion: 1;
  installationId: string;
  activationTokenEncrypted?: string;
  attestation?: string;
  state?: DesktopLicenseState;
}

interface ApiEntitlement {
  schemaVersion: 1;
  entitlement: "filex-all-access";
  status: Exclude<DesktopLicenseStatus, "unavailable">;
  validUntil: number | null;
  offlineUntil: number | null;
  activation: { current: number; limit: number };
}

interface LicenseApiResponse extends Record<string, unknown> {
  enforcement?: DesktopLicenseEnforcement;
  attestation?: string;
}

let cachedStore: StoredLicense | null = null;

function developmentLicenseState(): DesktopLicenseState | null {
  // Una build installata non può mai usare questa licenza. L'override enforce
  // permette comunque di collaudare intenzionalmente il flusso reale in locale.
  if (app.isPackaged || process.env.FILEX_LICENSE_ENFORCEMENT === "enforce") return null;
  return {
    schemaVersion: 1,
    status: "active",
    enforcement: "observe",
    entitlement: "filex-all-access",
    validUntil: null,
    offlineUntil: null,
    activation: { current: 1, limit: 2 },
    lastCheckedAt: Date.now(),
    message: "Licenza sviluppo attiva automaticamente.",
    canUseTools: true,
  };
}

function localEnforcement(): DesktopLicenseEnforcement {
  // Una build distribuita non deve mai trasformare un errore di rete o una
  // risposta incompleta del servizio in un bypass della licenza. Le modalita
  // observe/warn restano strumenti esclusivamente di sviluppo.
  if (app.isPackaged) return "enforce";
  const requested = process.env.FILEX_LICENSE_ENFORCEMENT;
  return requested === "warn" || requested === "enforce" ? requested : "observe";
}

function resolveEnforcement(remoteEnforcement?: unknown): DesktopLicenseEnforcement {
  if (app.isPackaged) return "enforce";
  return remoteEnforcement === "warn" || remoteEnforcement === "enforce"
    ? remoteEnforcement
    : localEnforcement();
}

function applyCurrentEnforcement(state: DesktopLicenseState): DesktopLicenseState {
  const enforcement = resolveEnforcement(state.enforcement);
  const entitled = state.status === "active" || state.status === "grace";
  return {
    ...state,
    enforcement,
    canUseTools: entitled || enforcement !== "enforce",
  };
}

function licensePath(): string {
  return join(app.getPath("appData"), "FileX", "filex-license.json");
}

function emptyState(status: DesktopLicenseStatus = "unlicensed", message = "FileX non e' ancora attivato."): DesktopLicenseState {
  const mode = localEnforcement();
  return {
    schemaVersion: 1,
    status,
    enforcement: mode,
    entitlement: null,
    validUntil: null,
    offlineUntil: null,
    activation: { current: 0, limit: 2 },
    lastCheckedAt: null,
    message,
    canUseTools: mode !== "enforce",
  };
}

async function readStore(): Promise<StoredLicense> {
  if (cachedStore) return cachedStore;
  try {
    const parsed = JSON.parse(await readFile(licensePath(), "utf8")) as StoredLicense;
    if (parsed.schemaVersion === 1 && /^[0-9a-f-]{36}$/i.test(parsed.installationId)) {
      cachedStore = parsed;
      return parsed;
    }
  } catch {
    // First run or invalid local cache: replace it with a fresh installation identity.
  }
  cachedStore = { schemaVersion: 1, installationId: randomUUID() };
  await saveStore(cachedStore);
  return cachedStore;
}

async function saveStore(store: StoredLicense): Promise<void> {
  cachedStore = store;
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(app.getPath("appData"), "FileX"), { recursive: true });
  await writeFile(licensePath(), `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function encryptToken(token: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Protezione credenziali Windows non disponibile.");
  return safeStorage.encryptString(token).toString("base64");
}

function decryptToken(value: string | undefined): string | null {
  if (!value || !safeStorage.isEncryptionAvailable()) return null;
  try { return safeStorage.decryptString(Buffer.from(value, "base64")); }
  catch { return null; }
}

async function request(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${process.env.FILEX_LICENSE_API_URL ?? DEFAULT_API_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": `FileX-Suite/${app.getVersion()}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `Servizio licenze non disponibile (${response.status}).`);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function readRemoteEnforcement(): Promise<DesktopLicenseEnforcement> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${process.env.FILEX_LICENSE_API_URL ?? DEFAULT_API_URL}/health`, { signal: controller.signal });
    if (!response.ok) return localEnforcement();
    const payload = await response.json() as { enforcement?: unknown };
    return resolveEnforcement(payload.enforcement);
  } catch {
    return localEnforcement();
  } finally {
    clearTimeout(timeout);
  }
}

export async function getCheckoutConfiguration(): Promise<DesktopCheckoutConfiguration> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${process.env.FILEX_LICENSE_API_URL ?? DEFAULT_API_URL}/health`, { signal: controller.signal });
    if (!response.ok) return { monthly: null, annual: null };
    const payload = await response.json() as { checkout?: { monthly?: unknown; annual?: unknown } };
    return {
      monthly: typeof payload.checkout?.monthly === "string" ? payload.checkout.monthly : null,
      annual: typeof payload.checkout?.annual === "string" ? payload.checkout.annual : null,
    };
  } catch {
    return { monthly: null, annual: null };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeEntitlement(value: unknown, checkedAt = Date.now(), remoteEnforcement?: unknown): DesktopLicenseState {
  const source = value as Partial<ApiEntitlement> | null;
  const status = source?.status;
  if (!source || !["active", "grace", "expired", "revoked", "unlicensed"].includes(String(status))) {
    return emptyState("unavailable", "Risposta del servizio licenze non valida.");
  }
  const mode = resolveEnforcement(remoteEnforcement);
  const permitted = status === "active" || status === "grace";
  return {
    schemaVersion: 1,
    status: status as DesktopLicenseState["status"],
    enforcement: mode,
    entitlement: source.entitlement === "filex-all-access" ? source.entitlement : null,
    validUntil: typeof source.validUntil === "number" ? source.validUntil : null,
    offlineUntil: typeof source.offlineUntil === "number" ? source.offlineUntil : null,
    activation: {
      current: Number(source.activation?.current ?? 0),
      limit: Number(source.activation?.limit ?? 2),
    },
    lastCheckedAt: checkedAt,
    message: status === "active" ? "FileX All Access attivo."
      : status === "grace" ? "Pagamento da aggiornare: FileX resta attivo nel periodo di cortesia."
        : status === "revoked" ? "Licenza revocata."
          : status === "expired" ? "Licenza scaduta."
            : "FileX non e' ancora attivato.",
    canUseTools: permitted || mode !== "enforce",
  };
}

function usableOffline(store: StoredLicense, now = Date.now()): DesktopLicenseState | null {
  const payload = verifyOfflineAttestation(store.attestation, store.installationId, now);
  if (!payload) return null;
  const state = normalizeEntitlement(payload.entitlement, payload.issuedAt, store.state?.enforcement);
  return { ...state, canUseTools: true, message: "Licenza firmata verificata; modalita' offline attiva." };
}

export async function getLicenseState(refresh = false): Promise<DesktopLicenseState> {
  const developmentState = developmentLicenseState();
  if (developmentState) return developmentState;
  const store = await readStore();
  const token = decryptToken(store.activationTokenEncrypted);
  if (!token) {
    // Un token DPAPI puo' non essere leggibile dopo un ripristino del profilo
    // Windows, mentre l'attestazione firmata resta valida. In quel caso non
    // dobbiamo conservare uno stato "active" che blocca comunque i tool.
    const offline = usableOffline(store);
    if (offline) return offline;
    const state = store.state ?? emptyState();
    if (!refresh && state.lastCheckedAt && Date.now() - state.lastCheckedAt < 24 * 60 * 60 * 1000) {
      return applyCurrentEnforcement(state);
    }
    const mode = await readRemoteEnforcement();
    const updated = {
      ...emptyState(
        "unavailable",
        "Impossibile leggere la credenziale locale. Apri FileX Suite e verifica la licenza.",
      ),
      enforcement: mode,
      lastCheckedAt: Date.now(),
      canUseTools: mode !== "enforce",
    };
    await saveStore({ ...store, state: updated });
    return updated;
  }
  if (!refresh && store.state?.lastCheckedAt && Date.now() - store.state.lastCheckedAt < 24 * 60 * 60 * 1000) {
    return applyCurrentEnforcement(store.state);
  }
  try {
    const payload = await request("/validate", { activationToken: token, installationId: store.installationId, appVersion: app.getVersion() }) as LicenseApiResponse;
    const state = normalizeEntitlement(payload.entitlement, Date.now(), payload.enforcement);
    await saveStore({ ...store, state, attestation: typeof payload.attestation === "string" ? payload.attestation : undefined });
    return state;
  } catch (error) {
    const offline = usableOffline(store);
    if (offline) return offline;
    return emptyState("unavailable", error instanceof Error ? error.message : "Servizio licenze non disponibile.");
  }
}

export async function activateLicense(licenseKey: string, deviceLabel?: string): Promise<DesktopLicenseState> {
  const developmentState = developmentLicenseState();
  if (developmentState) return developmentState;
  const store = await readStore();
  const payload = await request("/activate", {
    licenseKey,
    installationId: store.installationId,
    deviceLabel: deviceLabel?.trim().slice(0, 80) || "PC FileX",
    appVersion: app.getVersion(),
    termsVersion: "2026-08-13",
    licenseVersion: "2026-08-13",
    privacyVersion: "2026-08-13",
    acceptedAt: new Date().toISOString(),
  });
  const token = typeof payload.activationToken === "string" ? payload.activationToken : "";
  if (!token) throw new Error("Il server non ha restituito il token di attivazione.");
  const state = normalizeEntitlement(payload.entitlement, Date.now(), payload.enforcement);
  await saveStore({ ...store, activationTokenEncrypted: encryptToken(token), state, attestation: typeof payload.attestation === "string" ? payload.attestation : undefined });
  return state;
}

export async function deactivateLicense(): Promise<DesktopLicenseState> {
  const developmentState = developmentLicenseState();
  if (developmentState) return developmentState;
  const store = await readStore();
  const token = decryptToken(store.activationTokenEncrypted);
  if (token) await request("/deactivate", { activationToken: token, installationId: store.installationId });
  const state = emptyState();
  await saveStore({ schemaVersion: 1, installationId: store.installationId, state });
  return state;
}
