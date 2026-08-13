import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const apiKey = process.env.LEMONSQUEEZY_API_KEY?.trim();
if (!apiKey) throw new Error("Set LEMONSQUEEZY_API_KEY in the current terminal session.");
const apiBase = "https://api.lemonsqueezy.com/v1";
const headers = {
  Accept: "application/vnd.api+json",
  "Content-Type": "application/vnd.api+json",
  Authorization: `Bearer ${apiKey}`,
};

async function request(path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

async function create(type, attributes, relationships = {}) {
  const payload = await request(`/${type}`, {
    method: "POST",
    body: JSON.stringify({ data: { type, attributes, relationships } }),
  });
  return payload.data;
}

async function update(type, id, attributes) {
  const payload = await request(`/${type}/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ data: { type, id, attributes } }),
  });
  return payload.data;
}

function firebaseCommand(args, options = {}) {
  const executable = process.platform === "win32" ? "firebase.cmd" : "firebase";
  return spawnSync(executable, args, {
    encoding: options.input ? undefined : "utf8",
    input: options.input,
    stdio: options.input ? ["pipe", "inherit", "inherit"] : undefined,
    shell: process.platform === "win32",
  });
}

const stores = (await request("/stores")).data ?? [];
const requestedStoreId = process.env.LEMONSQUEEZY_STORE_ID?.trim();
const store = requestedStoreId ? stores.find((item) => item.id === requestedStoreId) : stores.length === 1 ? stores[0] : null;
if (!store) throw new Error(`Set LEMONSQUEEZY_STORE_ID. Available stores: ${stores.map((item) => `${item.id}:${item.attributes?.name}`).join(", ") || "none"}`);
if (store.attributes?.status && store.attributes.status !== "approved") throw new Error(`Store ${store.id} is not approved (status: ${store.attributes.status}). Finish the mandatory identity/tax/bank onboarding first.`);
if (store.attributes?.domain !== "xsuite.lemonsqueezy.com") {
  throw new Error(`Unexpected store domain ${store.attributes?.domain ?? "missing"}; expected xsuite.lemonsqueezy.com.`);
}

const storeRelationship = { store: { data: { type: "stores", id: store.id } } };
const products = (await request(`/products?filter[store-id]=${encodeURIComponent(store.id)}`)).data ?? [];
const requestedProductId = process.env.LEMONSQUEEZY_PRODUCT_ID?.trim();
const product = requestedProductId
  ? products.find((item) => item.id === requestedProductId)
  : products.find((item) => item.attributes?.name === "FileX All Access");
if (!product) {
  throw new Error("Create the FileX All Access product and its monthly/annual variants during store onboarding, then set LEMONSQUEEZY_PRODUCT_ID. Lemon Squeezy exposes products and variants as read-only API resources.");
}
const variants = (await request(`/variants?filter[product-id]=${encodeURIComponent(product.id)}`)).data ?? [];
const requestedMonthlyId = process.env.LEMONSQUEEZY_MONTHLY_VARIANT_ID?.trim();
const requestedAnnualId = process.env.LEMONSQUEEZY_ANNUAL_VARIANT_ID?.trim();
const monthly = requestedMonthlyId
  ? variants.find((item) => item.id === requestedMonthlyId)
  : variants.find((item) => /mensile|monthly/i.test(item.attributes?.name ?? ""));
const annual = requestedAnnualId
  ? variants.find((item) => item.id === requestedAnnualId)
  : variants.find((item) => /annuale|annual|yearly/i.test(item.attributes?.name ?? ""));
if (!monthly || !annual) {
  throw new Error(`Monthly/annual variants not found. Available: ${variants.map((item) => `${item.id}:${item.attributes?.name}`).join(", ") || "none"}`);
}

function validateVariant(variant, expectedInterval, expectedPrice) {
  const attributes = variant.attributes ?? {};
  const errors = [];
  if (attributes.status !== "published") errors.push(`status=${attributes.status ?? "missing"}`);
  if (attributes.has_license_keys !== true) errors.push("license keys disabled");
  if (attributes.is_license_limit_unlimited === true || Number(attributes.license_activation_limit) !== 2) {
    errors.push(`activation limit=${attributes.is_license_limit_unlimited ? "unlimited" : attributes.license_activation_limit ?? "missing"}`);
  }
  if (attributes.is_subscription !== true) errors.push("not a subscription");
  if (attributes.interval !== expectedInterval || Number(attributes.interval_count) !== 1) {
    errors.push(`billing interval=${attributes.interval_count ?? "?"} ${attributes.interval ?? "missing"}`);
  }
  if (Number(attributes.price) !== expectedPrice) errors.push(`price=${attributes.price ?? "missing"} cents`);
  if (attributes.test_mode === true) errors.push("test-mode variant");
  if (errors.length) {
    throw new Error(`Variant ${variant.id} (${attributes.name ?? "unnamed"}) is not ready: ${errors.join(", ")}. Configure it in Lemon Squeezy before accepting payments.`);
  }
}

validateVariant(monthly, "month", 1200);
validateVariant(annual, "year", 10000);

function checkoutAttributes(variant) {
  return {
    product_options: {
      redirect_url: "https://filex-suite.web.app/acquisto/",
      receipt_button_text: "Attiva FileX",
      receipt_link_url: "https://filex-suite.web.app/acquisto/",
      receipt_thank_you_note: "La chiave FileX è inclusa in questa ricevuta. Apri FileX Suite e attivala su un massimo di 2 PC.",
      enabled_variants: [Number(variant.id)],
    },
    checkout_options: { embed: false, media: false, logo: true, locale: "it" },
  };
}

async function findOrCreateCheckout(variant) {
  const existing = (await request(`/checkouts?filter[store_id]=${encodeURIComponent(store.id)}&filter[variant_id]=${encodeURIComponent(variant.id)}&page[size]=100`)).data ?? [];
  const expected = checkoutAttributes(variant);
  const matching = existing.find((item) => {
    const attributes = item.attributes ?? {};
    return attributes.test_mode === false
      && attributes.expires_at == null
      && attributes.product_options?.redirect_url === expected.product_options.redirect_url
      && attributes.product_options?.receipt_link_url === expected.product_options.receipt_link_url
      && Array.isArray(attributes.product_options?.enabled_variants)
      && attributes.product_options.enabled_variants.map(Number).includes(Number(variant.id));
  });
  return matching ?? create("checkouts", expected, {
    store: { data: { type: "stores", id: store.id } },
    variant: { data: { type: "variants", id: variant.id } },
  });
}

const checkoutMonthly = await findOrCreateCheckout(monthly);
const checkoutAnnual = await findOrCreateCheckout(annual);

const webhooks = (await request(`/webhooks?filter[store-id]=${encodeURIComponent(store.id)}`)).data ?? [];
const callbackUrl = "https://filex-suite.web.app/api/licensing/webhooks/lemonsqueezy";
let webhook = webhooks.find((item) => item.attributes?.url === callbackUrl);
let webhookSecret;
if (webhook) {
  const existingSecret = firebaseCommand(["functions:secrets:access", "LEMONSQUEEZY_WEBHOOK_SECRET", "--project", "gen-lang-client-0321087169"]);
  if (existingSecret.status !== 0 || !existingSecret.stdout?.trim()) {
    throw new Error("The FileX webhook already exists but its Firebase secret cannot be read. Rotate it using the documented recovery procedure.");
  }
  webhookSecret = existingSecret.stdout.trim();
} else {
  webhookSecret = randomBytes(30).toString("base64url");
}
const webhookAttributes = {
  url: callbackUrl,
  events: [
    "subscription_created", "subscription_updated", "subscription_cancelled", "subscription_resumed",
    "subscription_expired", "subscription_paused", "subscription_unpaused",
    "subscription_payment_success", "subscription_payment_failed", "subscription_payment_recovered",
    "subscription_payment_refunded",
    "license_key_created", "license_key_updated",
  ],
  secret: webhookSecret,
  test_mode: false,
};
if (!webhook) {
  webhook = await create("webhooks", webhookAttributes, storeRelationship);
  const secretResult = firebaseCommand(["functions:secrets:set", "LEMONSQUEEZY_WEBHOOK_SECRET", "--project", "gen-lang-client-0321087169", "--force"], { input: webhookSecret });
  if (secretResult.status !== 0) process.exit(secretResult.status ?? 1);
} else {
  webhook = await update("webhooks", webhook.id, webhookAttributes);
}

const monthlyUrl = checkoutMonthly.attributes?.url;
const annualUrl = checkoutAnnual.attributes?.url;
if (!monthlyUrl || !annualUrl) throw new Error("Checkout API did not return hosted URLs.");
const generatedConfigPath = resolve("apps/filex-cloud-functions/src/commerce-config.generated.ts");
writeFileSync(generatedConfigPath, `// Generated by scripts/bootstrap-filex-commerce.mjs after merchant onboarding.\n// Public identifiers and hosted checkout URLs only; never place secrets here.\nexport const FILEX_COMMERCE_DEFAULTS = ${JSON.stringify({
  enforcement: "observe",
  allowedVariantIds: [monthly.id, annual.id],
  checkoutMonthlyUrl: monthlyUrl,
  checkoutAnnualUrl: annualUrl,
}, null, 2)};\n`, "utf8");

const deploy = firebaseCommand(["deploy", "--project", "gen-lang-client-0321087169", "--only", "functions:filex-cloud:api,hosting:filex-website"]);
if (deploy.stdout) process.stdout.write(deploy.stdout);
if (deploy.stderr) process.stderr.write(deploy.stderr);
if (deploy.status !== 0) process.exit(deploy.status ?? 1);

const health = await fetch("https://filex-suite.web.app/api/licensing/health").then((response) => response.json());
if (health.checkout?.monthly !== monthlyUrl || health.checkout?.annual !== annualUrl || health.enforcement !== "observe") {
  throw new Error(`Deployed commerce configuration did not pass health verification: ${JSON.stringify(health)}`);
}
console.log(JSON.stringify({
  storeId: store.id,
  productId: product.id,
  monthlyVariantId: monthly.id,
  annualVariantId: annual.id,
  checkoutMonthlyUrl: monthlyUrl,
  checkoutAnnualUrl: annualUrl,
  webhookId: webhook.id,
  deploymentVerified: true,
}, null, 2));
