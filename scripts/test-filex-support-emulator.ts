import assert from "node:assert/strict";
import { createServer } from "node:http";
import { initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import type { Request } from "firebase-functions/v2/https";
import { handleLicensingRequest } from "../apps/filex-cloud-functions/src/licensing-api.js";
import { hashLicenseSecret } from "../apps/filex-cloud-functions/src/licensing-core.js";
import { purgeExpiredSupportMessages } from "../apps/filex-cloud-functions/src/support-service.js";
import { messageStatus, summarizeMessage, toClaudeMarkdown } from "./lib/support-format.mjs";

assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^127\.0\.0\.1:\d+$/, "FIRESTORE_EMULATOR_HOST: emulator locale obbligatorio");
const db = getFirestore(initializeApp({ projectId: "demo-filex-license-audit" }));

const server = createServer(async (request, response) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    await handleLicensingRequest(db, { path: request.url, method: request.method, headers: request.headers, body, ip: request.headers["x-test-ip"] || "127.0.0.1", get: (key: string) => request.headers[key] } as unknown as Request,
      { status: (status: number) => ({ json: (payload: unknown) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(payload)); } }) }, {});
  } catch (error) { response.writeHead(500); response.end(JSON.stringify({ error: String(error) })); }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/licensing/support/message`;

async function send(body: Record<string, unknown>, ip: string) {
  const response = await fetch(base, { method: "POST", headers: { "content-type": "application/json", "x-test-ip": ip }, body: JSON.stringify(body) });
  return { status: response.status, payload: await response.json() as Record<string, unknown> };
}
const valid = { kind: "problem", toolId: "album-flow", email: "Cliente@Example.test", name: "Anna", message: "Il tool si chiude quando esporto l'album.", diagnostics: { suiteVersion: "0.5.1", system: "Windows 11", licenseStatus: "active", locale: "it-IT" } };

try {
  // 1) Salvataggio reale: documento con id = numero richiesta, date come Timestamp, scadenza a un anno.
  const first = await send(valid, "ip-1");
  assert.equal(first.status, 201);
  const ticketId = String(first.payload.ticketId);
  const stored = (await db.collection("supportMessages").doc(ticketId).get()).data()!;
  assert.equal(stored.contactEmail, "cliente@example.test");
  assert.equal(stored.status, "new");
  assert.equal(stored.verifiedActivation, false);
  assert.ok(stored.createdAt instanceof Timestamp);
  const retentionDays = (stored.retentionExpiresAt.toMillis() - stored.createdAt.toMillis()) / 86_400_000;
  assert.equal(Math.round(retentionDays), 365);
  assert.equal(stored.readAt, null);

  // 2) Licenza verificata: token di attivazione e installazione corretti -> collegato all'abbonamento.
  const token = "T".repeat(40);
  const installationId = "11111111-2222-3333-4444-555555555555";
  await db.collection("licenseActivations").doc("activation-1").set({
    subscriptionId: "sub-1", installationIdHash: hashLicenseSecret(installationId), tokenHash: hashLicenseSecret(token), deactivatedAt: null,
  });
  const verified = await send({ ...valid, installationId, activationToken: token }, "ip-2");
  assert.equal(verified.status, 201);
  const verifiedDoc = (await db.collection("supportMessages").doc(String(verified.payload.ticketId)).get()).data()!;
  assert.equal(verifiedDoc.verifiedActivation, true);
  assert.equal(verifiedDoc.subscriptionId, "sub-1");
  assert.equal(JSON.stringify(verifiedDoc).includes(token), false, "il token non deve finire nel messaggio");

  // 3) Token sbagliato o installazione diversa: il messaggio passa ma non e' marcato verificato.
  const wrong = await send({ ...valid, installationId: "99999999-2222-3333-4444-555555555555", activationToken: token }, "ip-3");
  assert.equal(wrong.status, 201);
  assert.equal((await db.collection("supportMessages").doc(String(wrong.payload.ticketId)).get()).data()!.verifiedActivation, false);

  // 4) Dati non validi: 400 e nessun documento in piu'.
  const before = (await db.collection("supportMessages").count().get()).data().count;
  assert.equal((await send({ ...valid, email: "x" }, "ip-4")).status, 400);
  assert.equal((await db.collection("supportMessages").count().get()).data().count, before);

  // 5) Limite per rete con richieste simultanee: le transazioni reali ne lasciano passare esattamente cinque.
  const burst = await Promise.all(Array.from({ length: 8 }, () => send(valid, "ip-burst")));
  assert.equal(burst.filter((item) => item.status === 201).length, 5);
  assert.equal(burst.filter((item) => item.status === 429).length, 3);

  // 6) Limite giornaliero per installazione: dal PC stesso, anche cambiando rete, dopo dieci messaggi si ferma.
  const same = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const results: number[] = [];
  for (let index = 0; index < 11; index += 1) results.push((await send({ ...valid, installationId: same }, `ip-install-${index}`)).status);
  assert.deepEqual(results, [...Array(10).fill(201), 429]);

  // 7) La lettura della Dev Console funziona sui documenti veri (Timestamp inclusi).
  const snapshot = await db.collection("supportMessages").orderBy("createdAt", "desc").limit(200).get();
  assert.equal(snapshot.size, 18, "1 base + 1 verificato + 1 non verificato + 5 del burst + 10 della stessa installazione");
  const summary = summarizeMessage(ticketId, stored);
  assert.equal(summary.status, "new");
  assert.equal(typeof summary.createdAt, "number");
  assert.match(toClaudeMarkdown(ticketId, stored), /Suite 0\.5\.1 · Windows 11/);
  await db.collection("supportMessages").doc(ticketId).update({ readAt: Timestamp.now() });
  assert.equal(messageStatus((await db.collection("supportMessages").doc(ticketId).get()).data()!), "read");
  // 8) Conservazione: la pulizia pianificata toglie solo i messaggi scaduti e lascia gli altri.
  await db.collection("supportMessages").doc("SUP-SCADUTO1").set({ ...stored, retentionExpiresAt: Timestamp.fromMillis(Date.now() - 1000) });
  assert.equal(await purgeExpiredSupportMessages(db), 1);
  assert.equal((await db.collection("supportMessages").doc("SUP-SCADUTO1").get()).exists, false);
  assert.equal((await db.collection("supportMessages").doc(ticketId).get()).exists, true);
  assert.equal(await purgeExpiredSupportMessages(db), 0);
  console.log("FileX support emulator: PASS");
} finally {
  server.close();
}
process.exit(0);
