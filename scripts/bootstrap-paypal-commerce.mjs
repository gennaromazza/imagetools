import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();
const environment = process.env.PAYPAL_ENVIRONMENT === "live" ? "live" : "sandbox";
if (!clientId || !clientSecret) throw new Error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in the current terminal session.");
const apiBase = environment === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

async function accessToken() {
  const response = await fetch(`${apiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error(`PayPal OAuth failed (${response.status}).`);
  return payload.access_token;
}

const token = await accessToken();
async function request(path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json", ...(init.method === "POST" ? { "PayPal-Request-Id": randomUUID() } : {}), ...init.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

const requestedProductId = process.env.PAYPAL_PRODUCT_ID?.trim();
let productId = requestedProductId;
if (!productId) {
  const products = (await request("/v1/catalogs/products?page_size=20&page=1&total_required=true")).products ?? [];
  productId = products.find((product) => product.name === "FileX All Access")?.id;
}
if (!productId) {
  const product = await request("/v1/catalogs/products", {
    method: "POST",
    body: JSON.stringify({ name: "FileX All Access", description: "Accesso a tutti gli strumenti FileX su due PC.", type: "SERVICE", category: "SOFTWARE" }),
  });
  productId = product.id;
}
if (!productId) throw new Error("PayPal did not return a product ID.");

const existingPlans = (await request(`/v1/billing/plans?product_id=${encodeURIComponent(productId)}&page_size=20&page=1&total_required=true`)).plans ?? [];
async function findOrCreatePlan(name, intervalUnit, value, requestedId) {
  const existing = requestedId
    ? existingPlans.find((plan) => plan.id === requestedId)
    : existingPlans.find((plan) => plan.name === name && plan.status === "ACTIVE");
  if (existing) return existing;
  return request("/v1/billing/plans", {
    method: "POST",
    body: JSON.stringify({
      product_id: productId,
      name,
      description: "FileX All Access per due PC",
      status: "ACTIVE",
      billing_cycles: [{ frequency: { interval_unit: intervalUnit, interval_count: 1 }, tenure_type: "REGULAR", sequence: 1, total_cycles: 0, pricing_scheme: { fixed_price: { value, currency_code: "EUR" } } }],
      payment_preferences: { auto_bill_outstanding: true, setup_fee: { value: "0", currency_code: "EUR" }, setup_fee_failure_action: "CONTINUE", payment_failure_threshold: 3 },
    }),
  });
}

const monthly = await findOrCreatePlan("FileX All Access mensile", "MONTH", "12.00", process.env.PAYPAL_MONTHLY_PLAN_ID?.trim());
const annual = await findOrCreatePlan("FileX All Access annuale", "YEAR", "100.00", process.env.PAYPAL_ANNUAL_PLAN_ID?.trim());
if (!monthly.id || !annual.id) throw new Error("PayPal did not return both billing plan IDs.");

const webhookUrl = "https://filex-suite.web.app/api/licensing/webhooks/paypal";
const webhooks = (await request("/v1/notifications/webhooks")).webhooks ?? [];
let webhook = webhooks.find((item) => item.url === webhookUrl);
if (!webhook) {
  webhook = await request("/v1/notifications/webhooks", {
    method: "POST",
    body: JSON.stringify({
      url: webhookUrl,
      event_types: [
        "BILLING.SUBSCRIPTION.ACTIVATED",
        "BILLING.SUBSCRIPTION.CANCELLED",
        "BILLING.SUBSCRIPTION.EXPIRED",
        "BILLING.SUBSCRIPTION.SUSPENDED",
        "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
        "PAYMENT.SALE.COMPLETED",
        "PAYMENT.SALE.REFUNDED",
        "PAYMENT.SALE.REVERSED",
      ].map((name) => ({ name })),
    }),
  });
}
if (!webhook.id) throw new Error("PayPal did not return a webhook ID.");

function firebaseCommand(args, input) {
  const firebaseCli = resolve("node_modules/firebase-tools/lib/bin/firebase.js");
  return spawnSync(process.execPath, [firebaseCli, ...args], {
    encoding: "utf8",
    input,
    stdio: input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "inherit", "inherit"],
    windowsHide: true,
  });
}

const project = "gen-lang-client-0321087169";
const paypalSecretResult = firebaseCommand(["functions:secrets:set", "PAYPAL_CLIENT_SECRET", "--project", project, "--force"], clientSecret);
if (paypalSecretResult.status !== 0) process.exit(paypalSecretResult.status ?? 1);

let licenseKeySecret = process.env.PAYPAL_LICENSE_KEY_SECRET?.trim();
if (!licenseKeySecret) {
  const existing = firebaseCommand(["functions:secrets:access", "PAYPAL_LICENSE_KEY_SECRET", "--project", project]);
  licenseKeySecret = existing.status === 0 ? existing.stdout?.trim() : "";
}
if (!licenseKeySecret) licenseKeySecret = randomBytes(32).toString("base64url");
const licenseSecretResult = firebaseCommand(["functions:secrets:set", "PAYPAL_LICENSE_KEY_SECRET", "--project", project, "--force"], licenseKeySecret);
if (licenseSecretResult.status !== 0) process.exit(licenseSecretResult.status ?? 1);

const generatedConfigPath = resolve("apps/filex-cloud-functions/src/commerce-config.generated.ts");
writeFileSync(generatedConfigPath, `// Generated by scripts/bootstrap-paypal-commerce.mjs after PayPal onboarding.\n// Public PayPal identifiers only; never place secrets here.\nexport const FILEX_COMMERCE_DEFAULTS = ${JSON.stringify({
  enforcement: "observe",
  paypalEnvironment: environment,
  paypalClientId: clientId,
  paypalWebhookId: webhook.id,
  paypalMonthlyPlanId: monthly.id,
  paypalAnnualPlanId: annual.id,
}, null, 2)} as const;\n`, "utf8");

console.log(JSON.stringify({ environment, productId, monthlyPlanId: monthly.id, annualPlanId: annual.id, webhookId: webhook.id, secretsConfigured: true, next: "Run npm run build:filex-cloud, then deploy only after reviewing the sandbox configuration." }, null, 2));
