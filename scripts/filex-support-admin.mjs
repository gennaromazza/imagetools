import { rmSync } from "node:fs";
import { getApps, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { configureFirebaseCliAdc } from "./lib/firebase-cli-adc.mjs";
import { messageStatus, summarizeMessage, toClaudeMarkdown } from "./lib/support-format.mjs";

// Lettura dei messaggi di assistenza: list [all|new|read|resolved], export <id>, mark <id> <new|read|resolved>, purge.
const [command, ...args] = process.argv.slice(2);
const projectId = process.env.GCLOUD_PROJECT || "gen-lang-client-0321087169";
const TICKET_ID = /^SUP-[A-Z0-9]{8}$/;

if (!["list", "export", "mark", "purge"].includes(command)) {
  console.error("Uso: filex-support-admin.mjs list [all|new|read|resolved] | export <id> | mark <id> <new|read|resolved> | purge");
  process.exit(2);
}

const temporaryAdcDirectory = configureFirebaseCliAdc(projectId);
if (temporaryAdcDirectory) process.on("exit", () => rmSync(temporaryAdcDirectory, { recursive: true, force: true }));
if (!getApps().length) initializeApp({ projectId });
const db = getFirestore();
const collection = db.collection("supportMessages");

function requireTicket(value) {
  if (!TICKET_ID.test(String(value ?? ""))) {
    console.error("Numero richiesta non valido (formato SUP-XXXXXXXX).");
    process.exit(2);
  }
  return value;
}

if (command === "list") {
  const filter = args[0] ?? "all";
  if (!["all", "new", "read", "resolved"].includes(filter)) { console.error("Filtro non valido."); process.exit(2); }
  const snapshot = await collection.orderBy("createdAt", "desc").limit(200).get();
  const items = snapshot.docs.map((doc) => summarizeMessage(doc.id, doc.data())).filter((item) => filter === "all" || item.status === filter);
  console.log(JSON.stringify({ total: items.length, newCount: items.filter((item) => item.status === "new").length, items }, null, 2));
} else if (command === "export") {
  const id = requireTicket(args[0]);
  const doc = await collection.doc(id).get();
  if (!doc.exists) { console.error("Messaggio non trovato."); process.exit(1); }
  console.log(toClaudeMarkdown(id, doc.data()));
} else if (command === "mark") {
  const id = requireTicket(args[0]);
  const status = args[1];
  if (!["new", "read", "resolved"].includes(status)) { console.error("Stato non valido."); process.exit(2); }
  const ref = collection.doc(id);
  const doc = await ref.get();
  if (!doc.exists) { console.error("Messaggio non trovato."); process.exit(1); }
  const now = Timestamp.now();
  const previous = messageStatus(doc.data());
  await ref.update(status === "new"
    ? { readAt: null, resolvedAt: null }
    : status === "read" ? { readAt: doc.data().readAt ?? now, resolvedAt: null }
      : { readAt: doc.data().readAt ?? now, resolvedAt: now });
  console.log(JSON.stringify({ id, from: previous, to: status }));
} else {
  const expired = await collection.where("retentionExpiresAt", "<=", Timestamp.now()).limit(400).get();
  const batch = db.batch();
  expired.docs.forEach((doc) => batch.delete(doc.ref));
  if (!expired.empty) await batch.commit();
  console.log(JSON.stringify({ deleted: expired.size }));
}
