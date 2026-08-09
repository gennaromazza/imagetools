import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export const DEFAULT_LINK_TTL_MS = 24 * 60 * 60 * 1000;
export const MIN_LINK_TTL_MS = 15 * 60 * 1000;
export const MAX_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const DOWNLOADED_RETENTION_MS = 60 * 60 * 1000;
export const MAX_FILE_BYTES = 25 * 1024 * 1024 * 1024;

export function createToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function tokensEqual(value: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashToken(value), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function normalizeLinkExpiry(value: unknown, now = Date.now()): number {
  const requested = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(requested)) return now + DEFAULT_LINK_TTL_MS;
  return Math.min(Math.max(Math.trunc(requested), now + MIN_LINK_TTL_MS), now + MAX_LINK_TTL_MS);
}

export function createSessionIdentity(now = Date.now(), requestedExpiresAt?: unknown) {
  const id = randomUUID();
  const publicToken = createToken();
  const desktopToken = createToken();
  const expiresAt = normalizeLinkExpiry(requestedExpiresAt, now);
  return {
    id,
    publicToken,
    desktopToken,
    publicTokenHash: hashToken(publicToken),
    desktopTokenHash: hashToken(desktopToken),
    createdAt: now,
    expiresAt,
    retentionExpiresAt: expiresAt + DOWNLOADED_RETENTION_MS,
  };
}

export function downloadedFileExpired(downloadedAt: number | null | undefined, now = Date.now()): boolean {
  return typeof downloadedAt === "number" && downloadedAt + DOWNLOADED_RETENTION_MS <= now;
}

export function publicUploadAllowed(session: { expiresAt: number; clientCompleted?: boolean }, now = Date.now()): boolean {
  return session.expiresAt > now;
}

export function sanitizeLabel(value: unknown): string {
  if (typeof value !== "string") return "FileX Send";
  return value.trim().replace(/[\u0000-\u001f]/g, "").slice(0, 80) || "FileX Send";
}

export function sanitizeFileName(value: unknown): string {
  if (typeof value !== "string") return "foto";
  const leaf = value.split(/[\\/]/).pop() ?? "foto";
  const clean = leaf.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").trim();
  return clean.slice(0, 180) || "foto";
}

export function sessionCredential(value: string): { id: string; token: string } | null {
  const separator = value.indexOf(".");
  if (separator < 1) return null;
  const id = value.slice(0, separator);
  const token = value.slice(separator + 1);
  return /^[0-9a-f-]{36}$/i.test(id) && /^[A-Za-z0-9_-]{32,}$/.test(token) ? { id, token } : null;
}
