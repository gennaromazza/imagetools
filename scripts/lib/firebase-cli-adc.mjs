import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Riusa il login della Firebase CLI come credenziale temporanea: nessuna chiave di servizio su disco.
// Restituisce la cartella temporanea da cancellare all'uscita (null se esiste gia' GOOGLE_APPLICATION_CREDENTIALS).
export function configureFirebaseCliAdc(projectId) {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return null;
  const executable = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "npx";
  const cliArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", "npx --no-install firebase login:list --json"]
    : ["--no-install", "firebase", "login:list", "--json"];
  const response = JSON.parse(execFileSync(executable, cliArgs, {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
  }));
  const login = response?.result?.[0];
  const refreshToken = login?.tokens?.refresh_token;
  const clientId = login?.user?.azp;
  if (!refreshToken || !clientId) throw new Error("Firebase CLI is not logged in. Run firebase login first.");

  const npmRootArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm.cmd root -g"]
    : ["root", "-g"];
  const npmExecutable = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "npm";
  const globalModules = execFileSync(npmExecutable, npmRootArgs, {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const require = createRequire(import.meta.url);
  const firebaseApi = require(join(globalModules, "firebase-tools", "lib", "api.js"));
  const directory = mkdtempSync(join(tmpdir(), "filex-license-admin-"));
  const credentialPath = join(directory, "application-default-credentials.json");
  writeFileSync(credentialPath, JSON.stringify({
    type: "authorized_user",
    client_id: clientId,
    client_secret: firebaseApi.clientSecret(),
    refresh_token: refreshToken,
    quota_project_id: projectId,
  }), { encoding: "utf8", mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath;
  return directory;
}
