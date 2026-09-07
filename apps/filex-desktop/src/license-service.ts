import * as electron from "electron";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, rename, rmdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type {
  DesktopCheckoutConfiguration,
  DesktopLicenseEnforcement,
  DesktopLicenseState,
  DesktopLicenseStatus,
} from "@photo-tools/desktop-contracts";
import { trialDeviceHash, verifyOfflineAttestation } from "./license-attestation.js";

const { app, safeStorage, dialog } = electron;
const DEFAULT_API_URL = "https://gen-lang-client-0321087169.web.app/api/licensing";
const REQUEST_TIMEOUT_MS = 12_000;

class LicenseRequestError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function apiUrl(): string {
  return app.isPackaged ? DEFAULT_API_URL : process.env.FILEX_LICENSE_API_URL ?? DEFAULT_API_URL;
}

export type { DesktopLicenseEnforcement, DesktopLicenseState, DesktopLicenseStatus };

interface StoredLicense {
  schemaVersion: 1;
  installationId: string;
  activationTokenEncrypted?: string;
  attestation?: string;
  state?: DesktopLicenseState;
}

interface ApiEntitlement {
  trial?: boolean;
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
  try {
    const parsed = JSON.parse(await readFile(licensePath(), "utf8")) as StoredLicense;
    if (parsed.schemaVersion === 1 && /^[0-9a-f-]{36}$/i.test(parsed.installationId)) {
      cachedStore = parsed;
      return parsed;
    }
  } catch {
    // First run or invalid local cache: replace it with a fresh installation identity.
  }
  return withLicenseStoreLock(async () => {
    try {
      const existing = JSON.parse(await readFile(licensePath(), "utf8")) as StoredLicense;
      if (existing.schemaVersion === 1 && /^[0-9a-f-]{36}$/i.test(existing.installationId)) return existing;
    } catch { /* Missing/corrupt store, checked again under the cross-process lock. */ }
    const created: StoredLicense = { schemaVersion: 1, installationId: randomUUID() };
    await writeStoreUnlocked(created);
    return created;
  });
}

async function writeStoreUnlocked(store: StoredLicense): Promise<void> {
  const temporary = `${licensePath()}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, licensePath());
    cachedStore = store;
  } finally { await unlink(temporary).catch(() => {}); }
}

async function saveStore(store: StoredLicense, expectedCredential?: string | null): Promise<boolean> {
  return withLicenseStoreLock(async () => {
    if (expectedCredential !== undefined) {
      const current = JSON.parse(await readFile(licensePath(), "utf8")) as StoredLicense;
      if ((current.activationTokenEncrypted ?? null) !== expectedCredential) return false;
    }
    await writeStoreUnlocked(store);
    return true;
  });
}

async function withLicenseStoreLock<T>(operation: () => Promise<T>): Promise<T> {
  const directory = join(app.getPath("appData"), "FileX");
  const lock = join(directory, "license-write.lock");
  await mkdir(directory, { recursive: true });
  const deadline = Date.now() + 5000;
  for (;;) {
    try { await mkdir(lock); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const age = await stat(lock).then(info => Date.now() - info.mtimeMs, () => 0);
      if (age > 60000) await rmdir(lock).catch(() => {});
      if (Date.now() >= deadline) throw new Error("Licenza in aggiornamento. Riprova tra poco.");
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  try { return await operation(); } finally { await rmdir(lock); }
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
    const response = await fetch(`${apiUrl()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": `FileX-Suite/${app.getVersion()}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new LicenseRequestError(response.status, typeof payload.error === "string" ? payload.error : `Servizio licenze non disponibile (${response.status}).`);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function readRemoteEnforcement(): Promise<DesktopLicenseEnforcement> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${apiUrl()}/health`, { signal: controller.signal });
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
    const response = await fetch(`${apiUrl()}/health`, { signal: controller.signal });
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
    trial: source.trial === true,
    enforcement: mode,
    entitlement: source.entitlement === "filex-all-access" ? source.entitlement : null,
    validUntil: typeof source.validUntil === "number" ? source.validUntil : null,
    offlineUntil: typeof source.offlineUntil === "number" ? source.offlineUntil : null,
    activation: {
      current: Number(source.activation?.current ?? 0),
      limit: Number(source.activation?.limit ?? 2),
    },
    lastCheckedAt: checkedAt,
    message: source.trial === true ? (status === "active" ? "Prova gratuita di FileX All Access attiva." : "Prova gratuita terminata. Scegli un abbonamento per continuare.")
      : status === "active" ? "FileX All Access attivo."
      : status === "grace" ? "Pagamento da aggiornare: FileX resta attivo nel periodo di cortesia."
        : status === "revoked" ? "Licenza revocata."
          : status === "expired" ? "Licenza scaduta."
            : "FileX non e' ancora attivato.",
    canUseTools: permitted || mode !== "enforce",
  };
}

async function usableOffline(store: StoredLicense, now = Date.now()): Promise<DesktopLicenseState | null> {
  let payload = verifyOfflineAttestation(store.attestation, store.installationId, now);
  if (!payload && store.attestation) {
    const device = await trialDeviceHash().catch(() => undefined);
    payload = verifyOfflineAttestation(store.attestation, store.installationId, now, device);
  }
  if (!payload) return null;
  const state = normalizeEntitlement(payload.entitlement, payload.issuedAt, store.state?.enforcement);
  return { ...state, canUseTools: true };
}

const deniedCredentials = new Set<string | undefined>();

export async function getLicenseState(refresh = false): Promise<DesktopLicenseState> {
  const developmentState = developmentLicenseState();
  if (developmentState) return developmentState;
  const store = await readStore();
  const token = decryptToken(store.activationTokenEncrypted);
  if (!token) {
    // Un token DPAPI puo' non essere leggibile dopo un ripristino del profilo
    // Windows, mentre l'attestazione firmata resta valida. In quel caso non
    // dobbiamo conservare uno stato "active" che blocca comunque i tool.
    const offline = await usableOffline(store);
    if (offline) return offline;
    const state = store.state ?? emptyState();
    if (!refresh && state.lastCheckedAt && Date.now() - state.lastCheckedAt < 24 * 60 * 60 * 1000) {
      if (state.status !== "active" && state.status !== "grace") return applyCurrentEnforcement(state);
    }
    const mode = await readRemoteEnforcement();
    const updated = {
      ...emptyState(
        store.activationTokenEncrypted ? "unavailable" : "unlicensed",
        "Apri FileX Suite per iniziare la prova gratuita di 30 giorni o attivare una licenza.",
      ),
      enforcement: mode,
      lastCheckedAt: Date.now(),
      canUseTools: mode !== "enforce",
    };
    if (!await saveStore({ ...store, state: updated }, store.activationTokenEncrypted ?? null)) return getLicenseState(true);
    return updated;
  }
  if (!refresh && !deniedCredentials.has(store.activationTokenEncrypted) && store.state?.lastCheckedAt && Date.now() - store.state.lastCheckedAt < 24 * 60 * 60 * 1000) {
    const offline = await usableOffline(store);
    if (offline) return offline;
  }
  try {
    const payload = await request("/validate", { activationToken: token, installationId: store.installationId, appVersion: app.getVersion() }) as LicenseApiResponse;
    const state = normalizeEntitlement(payload.entitlement, Date.now(), payload.enforcement);
    if (!state.canUseTools) deniedCredentials.add(store.activationTokenEncrypted);
    if (state.canUseTools && state.enforcement === "enforce" && !await usableOffline({ ...store, attestation: typeof payload.attestation === "string" ? payload.attestation : undefined })) {
      throw new Error("Attestazione della licenza non valida. Verifica data e connessione del PC.");
    }
    if (!await saveStore({ ...store, state, attestation: typeof payload.attestation === "string" ? payload.attestation : undefined }, store.activationTokenEncrypted ?? null)) return getLicenseState(true);
    if (state.canUseTools) deniedCredentials.delete(store.activationTokenEncrypted);
    return state;
  } catch (error) {
    if (error instanceof LicenseRequestError && (error.status === 401 || error.status === 403)) {
      deniedCredentials.add(store.activationTokenEncrypted);
      const state = emptyState("revoked", error.message);
      if (!await saveStore({ ...store, state, attestation: undefined, activationTokenEncrypted: undefined }, store.activationTokenEncrypted ?? null)) return getLicenseState(true);
      return state;
    }
    if (deniedCredentials.has(store.activationTokenEncrypted)) return emptyState("revoked", "Licenza rifiutata dal server. Riattivala dalla Suite.");
    const offline = await usableOffline(store);
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
    termsVersion: "2026-09-07",
    licenseVersion: "2026-09-07",
    privacyVersion: "2026-09-07",
    acceptedAt: new Date().toISOString(),
  });
  const token = typeof payload.activationToken === "string" ? payload.activationToken : "";
  if (!token) throw new Error("Il server non ha restituito il token di attivazione.");
  const candidate = { ...store, attestation: typeof payload.attestation === "string" ? payload.attestation : undefined };
  const state = await usableOffline(candidate);
  if (!state) throw new Error("La licenza ricevuta non ha un'attestazione valida o e' scaduta. La licenza precedente e' stata conservata.");
  if (!await saveStore({ ...store, activationTokenEncrypted: encryptToken(token), state, attestation: typeof payload.attestation === "string" ? payload.attestation : undefined }, store.activationTokenEncrypted ?? null)) throw new Error("La licenza e' stata modificata durante l'attivazione. Verifica lo stato e riprova.");
  return state;
}

export async function deactivateLicense(): Promise<DesktopLicenseState> {
  const developmentState = developmentLicenseState();
  if (developmentState) return developmentState;
  const store = await readStore();
  const token = decryptToken(store.activationTokenEncrypted);
  if (token) {
    try { await request("/deactivate", { activationToken: token, installationId: store.installationId }); }
    catch (error) { if (!(error instanceof LicenseRequestError) || ![401, 403].includes(error.status)) throw error; }
  }
  const state = emptyState();
  if (!await saveStore({ schemaVersion: 1, installationId: store.installationId, state }, store.activationTokenEncrypted ?? null)) return getLicenseState(true);
  return state;
}

let pendingTrial: { code: string; pollSecret: string; expiresAt: number; installationId: string } | null = null;

// Keeps the management Suite available; tools call this only after startup authorization.
export function startLicenseExpiryWatchdog(): () => void {
  if (!app.isPackaged) return () => {};
  let busy = false;
  let stopped = false;
  let closeAt = 0;
  const stop = () => { stopped = true; clearInterval(timer); };
  const check = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const allowed = await getLicenseState().then(state => state.canUseTools).catch(() => false);
      if (stopped) return;
      if (allowed) { closeAt = 0; return; }
      if (!closeAt) {
        closeAt = Date.now() + 60000;
        void dialog.showMessageBox({
          type: "warning", title: "FileX All Access",
          message: "La licenza non e' piu' valida. Il tool si chiudera' tra 60 secondi.",
          detail: "Premi Ho capito e salva subito il lavoro. Puoi riattivare la licenza da FileX Suite: se torna valida prima della chiusura, il tool rimane aperto.",
          buttons: ["Ho capito"], noLink: true,
        }).catch(() => {});
        return;
      }
      if (Date.now() >= closeAt) {
        stop();
        app.quit();
        // Do not allow a cancelled window-close handler to bypass the expired license.
        const finalExit = setTimeout(() => app.exit(0), 5000);
        finalExit.unref();
      }
    } finally { busy = false; }
  };
  const timer = setInterval(() => { void check(); }, 15000);
  timer.unref();
  app.once("before-quit", stop);
  return stop;
}


export async function startTrial(): Promise<void> {
  const store = await readStore();
  if (await usableOffline(store)) throw new Error("Questo PC ha gia' una licenza attiva.");
  const pollSecret = randomBytes(32).toString("base64url");
  const payload = await request("/trial/session", { installationId: store.installationId, deviceIdHash: await trialDeviceHash(), pollSecret, deviceLabel: "PC FileX" });
  if (typeof payload.code !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(payload.code) || typeof payload.expiresAt !== "number") throw new Error("Sessione prova non valida.");
  pendingTrial = { code: payload.code, pollSecret, expiresAt: payload.expiresAt, installationId: store.installationId };
  await electron.shell.openExternal(`https://filex-suite.web.app/account/#trial=${encodeURIComponent(payload.code)}`);
}

export async function finishTrial(): Promise<DesktopLicenseState | null> {
  const session = pendingTrial;
  if (!session || session.expiresAt <= Date.now()) { pendingTrial = null; throw new Error("Collegamento scaduto. Avvia di nuovo la prova."); }
  const payload = await request("/trial/poll", { code: session.code, pollSecret: session.pollSecret });
  if (payload.pending === true) return null;
  const store = await readStore();
  if (store.installationId !== session.installationId || pendingTrial !== session) throw new Error("Sessione sostituita. Avvia di nuovo la prova.");
  // Never overwrite a paid activation completed while the browser was open.
  const current = await usableOffline(store);
  if (current) { pendingTrial = null; return current; }
  if (typeof payload.activationToken !== "string" || typeof payload.attestation !== "string") throw new Error("Attivazione prova incompleta.");
  const updated = { ...store, attestation: payload.attestation };
  const state = await usableOffline(updated);
  if (!state || !state.trial) throw new Error("Prova non valida o scaduta. Verifica la data del PC.");
  if (!await saveStore({ ...updated, activationTokenEncrypted: encryptToken(payload.activationToken), state }, store.activationTokenEncrypted ?? null)) { pendingTrial = null; return getLicenseState(true); }
  pendingTrial = null;
  return state;
}
