import { app, safeStorage, dialog } from "electron";
import { createHash, verify, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
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
  const token = decryptToken(store.activationTokenEncrypted);
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
    store = await persistAttestation(store, payload.attestation);
    if (valid) deniedCredentials.delete(store.activationTokenEncrypted);
    return attestationValid(store);
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

function decryptToken(value?: string): string | null {
  try { return value && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(value, "base64")) : null; }
  catch { return null; }
}

async function persistAttestation(previous: Store, attestation: string | undefined): Promise<Store> {
  return withLicenseStoreLock(async () => {
    const path = join(app.getPath("appData"), "FileX", "filex-license.json");
    const latest = JSON.parse(await readFile(path, "utf8")) as Store;
    if (latest.activationTokenEncrypted !== previous.activationTokenEncrypted) return latest;
    const updated = { ...latest, attestation, state: { ...latest.state, enforcement: "enforce" } };
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
