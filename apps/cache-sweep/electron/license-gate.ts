import { app, safeStorage, dialog } from "electron";
import { createHash, verify, randomUUID, createDecipheriv } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, rename, unlink, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";

const API = "https://gen-lang-client-0321087169.web.app/api/licensing";
const PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAT3qdjphJLO/lc1II7KhriM/GIVD4oeyuLv9UYmLVrhc=\n-----END PUBLIC KEY-----\n";
interface Store { installationId?: string; activationTokenEncrypted?: string; attestation?: string; state?: { enforcement?: string } }

const deniedCredentials = new Set<string | undefined>();

export async function directToolLicenseAllowed(refresh = false): Promise<boolean> {
  if (!app.isPackaged) return true;
  const directory = join(app.getPath("appData"), "FileX");
  const path = join(directory, "filex-license.json");
  let store: Store = {};
  try { store = JSON.parse(await readFile(path, "utf8")) as Store; } catch { /* Not activated. */ }
  // Packaged tools always enforce the signed entitlement, including during outages.
  if (!refresh && !deniedCredentials.has(store.activationTokenEncrypted) && await attestationValid(store, true)) return true;
  let token = await decryptToken(store.activationTokenEncrypted);
  if (token && store.activationTokenEncrypted && !store.activationTokenEncrypted.startsWith(SHARED_TOKEN_PREFIX)) {
    const previousCredential = store.activationTokenEncrypted;
    try {
      const migrated = encryptToken(token);
      store = await persistAttestation(store, store.attestation, migrated);
      if (deniedCredentials.has(previousCredential)) deniedCredentials.add(migrated);
      token = await decryptToken(store.activationTokenEncrypted);
    } catch { /* Keep validating the legacy token if migration cannot be persisted yet. */ }
  }
  if (!token || !store.installationId) return false;
  let denied = deniedCredentials.has(store.activationTokenEncrypted);
  try {
    const response = await fetch(`${API}/validate`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ activationToken: token, installationId: store.installationId, appVersion: app.getVersion() }),
      signal: AbortSignal.timeout(12000),
    });
    if (response.status === 401 || response.status === 403) {
      denied = true;
      deniedCredentials.add(store.activationTokenEncrypted);
      const updated = await persistAttestation(store, undefined);
      return attestationValid(updated);
    }
    if (!response.ok) return denied ? false : attestationValid(store);
    const payload = await response.json() as { attestation?: string };
    const valid = await attestationValid({ ...store, attestation: payload.attestation });
    if (!valid) { denied = true; deniedCredentials.add(store.activationTokenEncrypted); }
    const validatedCredential = store.activationTokenEncrypted;
    store = await persistAttestation(store, payload.attestation);
    if (valid) deniedCredentials.delete(validatedCredential);
    return deniedCredentials.has(store.activationTokenEncrypted) ? false : attestationValid(store);
  } catch { return denied ? false : attestationValid(store); }
}


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
      const allowed = await directToolLicenseAllowed().catch(() => false);
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

const SHARED_TOKEN_PREFIX = "dpapi-v1:";
let tokenCache: { encrypted: string; token: string } | undefined;

function windowsDataProtection(operation: "Protect" | "Unprotect", bytes: Buffer, entropy = true): Buffer {
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $data=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $entropy=${entropy ? "[Text.Encoding]::UTF8.GetBytes('FileX.AllAccess.Token.v1')" : "$null"}; $result=[Security.Cryptography.ProtectedData]::${operation}($data,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))`;
  const output = execFileSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", script], {
    input: bytes.toString("base64"), encoding: "utf8", windowsHide: true, timeout: 10000, maxBuffer: 65536, stdio: ["pipe", "pipe", "pipe"],
  });
  return Buffer.from(output.trim(), "base64");
}

function encryptToken(token: string): string {
  let encrypted: string;
  if (process.platform === "win32") {
    const bytes = Buffer.from(token, "utf8");
    try { encrypted = SHARED_TOKEN_PREFIX + windowsDataProtection("Protect", bytes).toString("base64"); }
    catch { throw new Error("Protezione credenziali Windows non disponibile."); }
    finally { bytes.fill(0); }
  } else {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Protezione credenziali non disponibile.");
    encrypted = safeStorage.encryptString(token).toString("base64");
  }
  tokenCache = { encrypted, token };
  return encrypted;
}

async function decryptToken(value: string | undefined): Promise<string | null> {
  if (!value || value.length > 16384) { tokenCache = undefined; return null; }
  if (tokenCache?.encrypted === value) return tokenCache.token;
  let token: string | null = null;
  if (value.startsWith(SHARED_TOKEN_PREFIX)) {
    if (process.platform !== "win32") return null;
    try {
      const bytes = windowsDataProtection("Unprotect", Buffer.from(value.slice(SHARED_TOKEN_PREFIX.length), "base64"));
      try { token = bytes.toString("utf8"); } finally { bytes.fill(0); }
    } catch { return null; }
  } else {
    try { if (safeStorage.isEncryptionAvailable()) token = safeStorage.decryptString(Buffer.from(value, "base64")); } catch { /* Try the old Suite profile below. */ }
    if (!token && process.platform === "win32") {
      const encrypted = Buffer.from(value, "base64");
      if (encrypted.length < 32 || encrypted.subarray(0, 3).toString() !== "v10") return null;
      // Legacy Chromium AES keys are scoped to the original Suite profile.
      // Only FileX profiles are read, and their keys remain protected by CurrentUser DPAPI.
      const profiles = [app.getPath("userData"), join(app.getPath("appData"), "FileX Suite"), join(app.getPath("appData"), "FileX-Suite")];
      for (const profile of new Set(profiles)) {
        let key: Buffer | undefined;
        try {
          const state = JSON.parse(await readFile(join(profile, "Local State"), "utf8")) as { os_crypt?: { encrypted_key?: string } };
          const wrapped = Buffer.from(state.os_crypt?.encrypted_key ?? "", "base64");
          if (wrapped.subarray(0, 5).toString() !== "DPAPI") continue;
          key = windowsDataProtection("Unprotect", wrapped.subarray(5), false);
          const decipher = createDecipheriv("aes-256-gcm", key, encrypted.subarray(3, 15));
          decipher.setAuthTag(encrypted.subarray(-16));
          const bytes = Buffer.concat([decipher.update(encrypted.subarray(15, -16)), decipher.final()]);
          try { token = bytes.toString("utf8"); } finally { bytes.fill(0); }
          break;
        } catch { /* Another known FileX profile may own the legacy credential. */ }
        finally { key?.fill(0); }
      }
    }
  }
  if (!token) return null;
  tokenCache = { encrypted: value, token };
  return token;
}

async function persistAttestation(previous: Store, attestation: string | undefined, activationTokenEncrypted = previous.activationTokenEncrypted): Promise<Store> {
  return withLicenseStoreLock(async () => {
    const path = join(app.getPath("appData"), "FileX", "filex-license.json");
    const latest = JSON.parse(await readFile(path, "utf8")) as Store;
    if (latest.activationTokenEncrypted !== previous.activationTokenEncrypted) return latest;
    const updated = { ...latest, attestation, activationTokenEncrypted, state: { ...latest.state, enforcement: "enforce" } };
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(updated, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, path);
    } finally { await unlink(temporary).catch(() => {}); }
    return updated;
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

async function attestationValid(store: Store, requireFresh = false): Promise<boolean> {
  if (!store.attestation || !store.installationId) return false;
  const [body, signature, extra] = store.attestation.split(".");
  if (!body || !signature || extra) return false;
  try {
    if (!verify(null, Buffer.from(body), PUBLIC_KEY, Buffer.from(signature, "base64url"))) return false;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      version?: number; issuedAt: number; installationIdHash?: string;
      entitlement?: { schemaVersion?: number; entitlement?: string; status?: string; offlineUntil?: number; validUntil?: number | null; trial?: boolean; trialDeviceIdHash?: string };
    };
    const now = Date.now();
    if (payload.version !== 1 || payload.entitlement?.schemaVersion !== 1 || payload.entitlement.entitlement !== "filex-all-access") return false;
    if (!Number.isFinite(payload.entitlement.offlineUntil)) return false;
    if (payload.entitlement.validUntil !== null && !Number.isFinite(payload.entitlement.validUntil)) return false;
    if (!Number.isFinite(payload.issuedAt) || payload.issuedAt > now + 300000) return false;
    if (requireFresh && payload.issuedAt + 86400000 <= now) return false;
    if (typeof payload.entitlement?.validUntil === "number" && payload.entitlement.validUntil <= now) return false;
    if (payload.entitlement?.trial) {
      if (typeof payload.entitlement.validUntil !== "number" || payload.entitlement.offlineUntil! > payload.issuedAt + 86400000) return false;
      if (process.platform !== "win32") return false;
      const { stdout } = await promisify(execFile)("reg.exe", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid", "/reg:64"], { windowsHide: true, timeout: 5000 });
      const guid = stdout.match(/MachineGuid\s+REG_SZ\s+([0-9a-f-]{36})/i)?.[1];
      if (!guid || createHash("sha256").update(`filex-trial-v1:${guid.toLowerCase()}`).digest("hex") !== payload.entitlement.trialDeviceIdHash) return false;
    }
    return payload.installationIdHash === createHash("sha256").update(store.installationId).digest("hex")
      && ["active", "grace"].includes(payload.entitlement?.status ?? "")
      && Number(payload.entitlement?.offlineUntil) > now;
  } catch { return false; }
}
