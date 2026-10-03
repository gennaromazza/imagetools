import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { buildMailto, buildSupportText, SUPPORT_EMAIL, supportSubject, validateSupportForm } from "../apps/filex-desktop/suite-launcher-src/support.js";

const base = { kind: "problem", toolId: "album-flow", email: "cliente@example.test", name: "Anna", message: "Il tool si chiude quando esporto l'album.", includeDiagnostics: true };
const environment = { suiteVersion: "0.5.1", system: "Windows 11 (10.0.26200)", licenseStatus: "active" };

test("validates kind, email and message length like the server", () => {
  assert.equal(validateSupportForm(base), "");
  assert.match(validateSupportForm({ ...base, kind: "x" }), /tipo/);
  assert.match(validateSupportForm({ ...base, email: "nope" }), /email/);
  assert.match(validateSupportForm({ ...base, message: "corto" }), /almeno/);
  assert.match(validateSupportForm({ ...base, message: "x".repeat(4001) }), /troppo lungo/);
});

test("the copied text carries the request and, only when allowed, the technical info", () => {
  const withInfo = buildSupportText(base, environment, "Album Flow");
  assert.match(withInfo, /Tool: Album Flow/);
  assert.match(withInfo, /Email per la risposta: cliente@example.test/);
  assert.match(withInfo, /Versione Suite: 0\.5\.1/);
  const withoutInfo = buildSupportText({ ...base, includeDiagnostics: false }, environment, "");
  assert.doesNotMatch(withoutInfo, /Informazioni tecniche/);
  assert.match(withoutInfo, /Tutta la Suite/);
});

test("the email fallback goes to the support address with a readable subject", () => {
  const link = buildMailto(base, environment, "Album Flow");
  assert.ok(link.startsWith(`mailto:${SUPPORT_EMAIL}?subject=`));
  assert.equal(supportSubject(base, "Album Flow"), "FileX · Problema · Album Flow");
  assert.match(decodeURIComponent(link), /Il tool si chiude/);
});

test("every element support.js looks up exists in the Suite dashboard", () => {
  const script = readFileSync(resolve("apps/filex-desktop/suite-launcher-src/support.js"), "utf8");
  const html = readFileSync(resolve("apps/filex-desktop/suite-launcher-src/index.html"), "utf8");
  const ids = new Set([...script.matchAll(/(?:field|querySelector)\('#([\w-]+)'\)/g)].map((match) => match[1]));
  assert.ok(ids.size >= 15, "attesi almeno quindici elementi collegati");
  const missing = [...ids].filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, []);
  assert.ok(html.includes('href="./support.css"'));
});

test("the preload and main process expose the same support channels", () => {
  const preload = readFileSync(resolve("apps/filex-desktop/src/suite-preload.ts"), "utf8");
  const main = readFileSync(resolve("apps/filex-desktop/src/suite-main.ts"), "utf8");
  for (const channel of ["filex:send-support-message", "filex:get-support-environment"]) {
    assert.ok(preload.includes(`"${channel}"`), `preload senza ${channel}`);
    assert.ok(main.includes(`"${channel}"`), `main senza ${channel}`);
  }
});
