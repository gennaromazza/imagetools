import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getApps, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";

const [command, ...args] = process.argv.slice(2);
const projectId = process.env.GCLOUD_PROJECT || "gen-lang-client-0321087169";
const temporaryAdcDirectory = configureFirebaseCliAdc();
if (temporaryAdcDirectory) {
  process.on("exit", () => rmSync(temporaryAdcDirectory, { recursive: true, force: true }));
}
if (!getApps().length) initializeApp({ projectId });
const db = getFirestore();
const hash = (value) => createHash("sha256").update(value.trim()).digest("hex");

function configureFirebaseCliAdc() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return null;
  const executable = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "firebase";
  const cliArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", "firebase.cmd login:list --json"]
    : ["login:list", "--json"];
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

if (command === "status") {
  const config = await db.collection("licenseConfiguration").doc("public").get();
  const subscriptions = await db.collection("licenseSubscriptions").count().get();
  const activations = await db.collection("licenseActivations").where("deactivatedAt", "==", null).count().get();
  console.log(JSON.stringify({
    enforcement: config.data()?.enforcement ?? "observe",
    subscriptions: subscriptions.data().count,
    activeDevices: activations.data().count,
  }, null, 2));
} else if (command === "enforcement") {
  const mode = args[0];
  if (!["observe", "warn", "enforce"].includes(mode)) throw new Error("Use: enforcement observe|warn|enforce");
  await db.collection("licenseConfiguration").doc("public").set({ enforcement: mode, updatedAt: Timestamp.now() }, { merge: true });
  console.log(`FileX licensing enforcement: ${mode}`);
} else if (command === "configure-commerce") {
  const [monthlyVariantId, annualVariantId, monthlyUrl, annualUrl] = args;
  if (![monthlyVariantId, annualVariantId].every((value) => /^\d+$/.test(value ?? ""))) throw new Error("Variant IDs must be numeric");
  for (const value of [monthlyUrl, annualUrl]) {
    const url = new URL(value);
    if (url.protocol !== "https:" || !(url.hostname === "lemonsqueezy.com" || url.hostname.endsWith(".lemonsqueezy.com"))) throw new Error("Checkout URLs must be HTTPS Lemon Squeezy URLs");
  }
  await db.collection("licenseConfiguration").doc("public").set({
    allowedVariantIds: [monthlyVariantId, annualVariantId],
    checkoutMonthlyUrl: monthlyUrl,
    checkoutAnnualUrl: annualUrl,
    enforcement: "observe",
    commerceConfiguredAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  }, { merge: true });
  console.log("FileX commerce configured in observe mode.");
} else if (command === "create-support-license") {
  const days = Number(args[0] ?? 30);
  const label = String(args[1] ?? "support").replace(/[^a-z0-9_-]/gi, "-").slice(0, 40);
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error("Days must be between 1 and 366");
  const key = `FILEX-${randomBytes(4).toString("hex")}-${randomBytes(4).toString("hex")}-${randomBytes(4).toString("hex")}`.toUpperCase();
  const id = `support-${Date.now()}-${label}`;
  await db.collection("licenseSubscriptions").doc(id).set({
    provider: "filex-support",
    providerSubscriptionId: id,
    entitlement: "filex-all-access",
    status: "active",
    currentPeriodEnd: Date.now() + days * 24 * 60 * 60 * 1000,
    paymentFailedAt: null,
    licenseKeyHash: hash(key),
    supportLabel: label,
    updatedAt: Timestamp.now(),
  });
  console.log(`Support license (${days} days): ${key}`);
} else {
  throw new Error("Use: status | enforcement <mode> | configure-commerce <monthlyVariant> <annualVariant> <monthlyUrl> <annualUrl> | create-support-license <days> <label>");
}
