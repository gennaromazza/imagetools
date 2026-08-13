import { app, safeStorage } from "electron";
import { createHash, verify } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const API = "https://gen-lang-client-0321087169.web.app/api/licensing";
const PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAT3qdjphJLO/lc1II7KhriM/GIVD4oeyuLv9UYmLVrhc=\n-----END PUBLIC KEY-----\n";
interface Store { installationId?: string; activationTokenEncrypted?: string; attestation?: string; state?: { enforcement?: string } }
export async function directToolLicenseAllowed(): Promise<boolean> {
  if (!app.isPackaged) return true;
  const directory = join(app.getPath("appData"), "FileX"); const path = join(directory, "filex-license.json"); let store: Store = {};
  try { store = JSON.parse(await readFile(path, "utf8")) as Store; } catch { /* not activated */ }
  const fallback = store.state?.enforcement ?? "observe"; let mode = fallback;
  try { const response = await fetch(`${API}/health`); if (response.ok) mode = (await response.json() as { enforcement?: string }).enforcement ?? fallback; } catch { /* offline */ }
  if (mode !== "enforce") return true;
  if (valid(store)) return true;
  const token = decrypt(store.activationTokenEncrypted); if (!token || !store.installationId) return false;
  try { const response = await fetch(`${API}/validate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ activationToken: token, installationId: store.installationId, appVersion: app.getVersion() }) }); if (!response.ok) return false; const payload = await response.json() as { attestation?: string; enforcement?: string }; store = { ...store, attestation: payload.attestation, state: { ...store.state, enforcement: payload.enforcement } }; await mkdir(directory, { recursive: true }); await writeFile(path, `${JSON.stringify(store, null, 2)}\n`, "utf8"); return valid(store); } catch { return false; }
}
function decrypt(value?: string) { try { return value && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(value, "base64")) : null; } catch { return null; } }
function valid(store: Store) { if (!store.attestation || !store.installationId) return false; const [body, signature, extra] = store.attestation.split("."); if (!body || !signature || extra) return false; try { if (!verify(null, Buffer.from(body), PUBLIC_KEY, Buffer.from(signature, "base64url"))) return false; const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { installationIdHash?: string; entitlement?: { status?: string; offlineUntil?: number } }; return payload.installationIdHash === createHash("sha256").update(store.installationId).digest("hex") && ["active", "grace"].includes(payload.entitlement?.status ?? "") && Number(payload.entitlement?.offlineUntil) > Date.now(); } catch { return false; } }
