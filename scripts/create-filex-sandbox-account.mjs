import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const projectId = "gen-lang-client-0321087169";
const email = String(process.env.FILEX_TEST_EMAIL ?? "").trim().toLowerCase();
const password = String(process.env.FILEX_TEST_PASSWORD ?? "");
const generatedConfig = readFileSync(new URL("../apps/filex-cloud-functions/src/commerce-config.generated.ts", import.meta.url), "utf8");

if (!/"paypalEnvironment"\s*:\s*"sandbox"/u.test(generatedConfig)) {
  throw new Error("Il comando e' consentito soltanto quando PayPal e' configurato in sandbox.");
}
if (!/^[^\s@]+@(personal|business)\.example\.com$/u.test(email)) {
  throw new Error("FILEX_TEST_EMAIL deve essere l'email di un account PayPal Sandbox *.example.com.");
}
if (password.length < 12) {
  throw new Error("FILEX_TEST_PASSWORD deve contenere almeno 12 caratteri.");
}

const temporaryAdcDirectory = configureFirebaseCliAdc();
if (temporaryAdcDirectory) process.on("exit", () => rmSync(temporaryAdcDirectory, { recursive: true, force: true }));
if (!getApps().length) initializeApp({ projectId });
const auth = getAuth();
let user;
try {
  const existing = await auth.getUserByEmail(email);
  user = await auth.updateUser(existing.uid, { password, emailVerified: true, disabled: false });
} catch (cause) {
  if (cause?.code !== "auth/user-not-found") throw cause;
  user = await auth.createUser({ email, password, emailVerified: true });
}

console.log(JSON.stringify({ uid: user.uid, email: user.email, emailVerified: user.emailVerified, sandboxOnly: true }, null, 2));

function configureFirebaseCliAdc() {
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
  if (!refreshToken || !clientId) throw new Error("Firebase CLI non autenticata. Esegui prima firebase login.");

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
  const directory = mkdtempSync(join(tmpdir(), "filex-sandbox-account-"));
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
