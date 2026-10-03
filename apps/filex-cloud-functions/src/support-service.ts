import { randomBytes } from "node:crypto";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

export const SUPPORT_KINDS = ["problem", "suggestion", "question"] as const;
export type SupportKind = (typeof SUPPORT_KINDS)[number];
export const SUPPORT_RETENTION_DAYS = 365;
export const SUPPORT_MESSAGE_MIN = 10;
export const SUPPORT_MESSAGE_MAX = 4000;

const LICENSE_STATUSES = ["active", "grace", "expired", "revoked", "unlicensed", "unavailable", "trial"] as const;
const TICKET_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export class SupportInputError extends Error {}

export interface SupportDiagnostics {
  suiteVersion: string;
  system: string;
  licenseStatus: string;
  locale: string;
}

export interface SupportMessageInput {
  kind: SupportKind;
  toolId: string;
  email: string;
  name: string;
  message: string;
  diagnostics: SupportDiagnostics | null;
}

export interface SupportRecord {
  kind: SupportKind;
  toolId: string;
  contactEmail: string;
  contactName: string;
  message: string;
  diagnostics: SupportDiagnostics | null;
  verifiedActivation: boolean;
  subscriptionId: string | null;
  status: "new";
  createdAtMs: number;
  retentionExpiresAtMs: number;
}

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
}

function singleLine(value: unknown, max: number): string {
  return clean(value, max).replace(/\s+/g, " ");
}

export function parseSupportMessage(body: unknown): SupportMessageInput {
  const source = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const kind = SUPPORT_KINDS.find((candidate) => candidate === source.kind);
  if (!kind) throw new SupportInputError("Scegli il tipo di messaggio.");

  const email = singleLine(source.email, 160).toLowerCase();
  if (!/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new SupportInputError("Inserisci un indirizzo email valido per ricevere la risposta.");

  const message = clean(source.message, SUPPORT_MESSAGE_MAX + 1);
  if (message.length < SUPPORT_MESSAGE_MIN) throw new SupportInputError("Descrivi meglio la richiesta: servono almeno 10 caratteri.");
  if (message.length > SUPPORT_MESSAGE_MAX) throw new SupportInputError(`Il messaggio e' troppo lungo: massimo ${SUPPORT_MESSAGE_MAX} caratteri.`);

  const rawTool = singleLine(source.toolId, 40).toLowerCase();
  const toolId = /^[a-z0-9-]{1,40}$/.test(rawTool) ? rawTool : "generale";

  return { kind, toolId, email, name: singleLine(source.name, 80), message, diagnostics: parseDiagnostics(source.diagnostics) };
}

function parseDiagnostics(value: unknown): SupportDiagnostics | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const licenseStatus = singleLine(source.licenseStatus, 20).toLowerCase();
  return {
    suiteVersion: singleLine(source.suiteVersion, 32) || "sconosciuta",
    system: singleLine(source.system, 80) || "sconosciuto",
    licenseStatus: (LICENSE_STATUSES as readonly string[]).includes(licenseStatus) ? licenseStatus : "sconosciuto",
    locale: singleLine(source.locale, 16),
  };
}

export function createTicketId(random: Buffer = randomBytes(8)): string {
  let id = "";
  for (let index = 0; index < 8; index += 1) id += TICKET_ALPHABET[random[index] % TICKET_ALPHABET.length];
  return `SUP-${id}`;
}

export function createSupportRecord(input: SupportMessageInput, context: { verifiedSubscriptionId: string | null; now?: number }): SupportRecord {
  const now = context.now ?? Date.now();
  return {
    kind: input.kind,
    toolId: input.toolId,
    contactEmail: input.email,
    contactName: input.name,
    message: input.message,
    diagnostics: input.diagnostics,
    verifiedActivation: context.verifiedSubscriptionId !== null,
    subscriptionId: context.verifiedSubscriptionId,
    status: "new",
    createdAtMs: now,
    retentionExpiresAtMs: now + SUPPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  };
}

/** Cancella i messaggi oltre il periodo di conservazione. Pensata per la funzione pianificata: non dipende dalla TTL di Firestore. */
export async function purgeExpiredSupportMessages(db: Firestore, now: Timestamp = Timestamp.now(), limit = 200): Promise<number> {
  const expired = await db.collection("supportMessages").where("retentionExpiresAt", "<=", now).limit(limit).get();
  if (expired.empty) return 0;
  const batch = db.batch();
  expired.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  return expired.size;
}
