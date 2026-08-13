import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { getApps, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";

const [command, ...args] = process.argv.slice(2);
const projectId = process.env.GCLOUD_PROJECT || "gen-lang-client-0321087169";
if (!getApps().length) initializeApp({ projectId });
const db = getFirestore();
const hash = (value) => createHash("sha256").update(value.trim()).digest("hex");

function firebaseCliAccessToken() {
  const executable = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "firebase";
  const cliArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", "firebase.cmd login:list --json"]
    : ["login:list", "--json"];
  const response = JSON.parse(execFileSync(executable, cliArgs, {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
  }));
  const token = response?.result?.[0]?.tokens?.access_token;
  if (!token) throw new Error("Firebase CLI is not logged in. Run firebase login first.");
  return token;
}

async function createSupportLicenseDocument(id, value) {
  const token = firebaseCliAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/licenseSubscriptions/${encodeURIComponent(id)}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: {
      provider: { stringValue: value.provider },
      providerSubscriptionId: { stringValue: value.providerSubscriptionId },
      entitlement: { stringValue: value.entitlement },
      status: { stringValue: value.status },
      currentPeriodEnd: { integerValue: String(value.currentPeriodEnd) },
      paymentFailedAt: { nullValue: null },
      licenseKeyHash: { stringValue: value.licenseKeyHash },
      supportLabel: { stringValue: value.supportLabel },
      updatedAt: { timestampValue: new Date().toISOString() },
    } }),
  });
  if (!response.ok) throw new Error(`Firestore rejected the support license (${response.status}): ${await response.text()}`);
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
  await createSupportLicenseDocument(id, {
    provider: "filex-support",
    providerSubscriptionId: id,
    entitlement: "filex-all-access",
    status: "active",
    currentPeriodEnd: Date.now() + days * 24 * 60 * 60 * 1000,
    paymentFailedAt: null,
    licenseKeyHash: hash(key),
    supportLabel: label,
  });
  console.log(`Support license (${days} days): ${key}`);
} else {
  throw new Error("Use: status | enforcement <mode> | configure-commerce <monthlyVariant> <annualVariant> <monthlyUrl> <annualUrl> | create-support-license <days> <label>");
}
