import { randomUUID } from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { extname } from "node:path";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { onRequest, type Request } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { DOWNLOADED_RETENTION_MS, MAX_FILE_BYTES, createSessionIdentity, createToken, hashToken, normalizeLinkExpiry, publicUploadAllowed, sanitizeFileName, sanitizeLabel, sessionCredential, tokensEqual } from "./core.js";
import { handleLicensingRequest } from "./licensing-api.js";

if (!getApps().length) initializeApp({ storageBucket: "filex-cloud-391620173227-eu" });

const db = getFirestore();
const bucket = getStorage().bucket();
const publicBaseUrl = "https://gen-lang-client-0321087169.web.app";
const lemonSqueezyWebhookSecret = defineSecret("LEMONSQUEEZY_WEBHOOK_SECRET");
const paypalClientSecret = defineSecret("PAYPAL_CLIENT_SECRET");
const paypalLicenseKeySecret = defineSecret("PAYPAL_LICENSE_KEY_SECRET");
const licenseSigningPrivateKey = defineSecret("FILEX_LICENSE_SIGNING_PRIVATE_KEY");

interface SessionRecord {
  direction: "receive" | "send";
  ownerUid: string;
  label: string;
  publicTokenHash: string;
  desktopTokenHash: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  retentionExpiresAt: Timestamp;
  clientCompleted: boolean;
  activeUploads: number;
  receivedBytes: number;
  receivedFiles: number;
}

interface FileRecord {
  name: string;
  size: number;
  contentType?: string;
  objectPath: string;
  downloadToken: string;
  receivedAt: Timestamp;
  downloadedAt?: Timestamp;
}

interface HttpResponse {
  status(code: number): { json(value: unknown): unknown };
}

export const api = onRequest({ region: "europe-west1", timeoutSeconds: 60, memory: "256MiB", secrets: [lemonSqueezyWebhookSecret, paypalClientSecret, paypalLicenseKeySecret, licenseSigningPrivateKey] }, async (request, response) => {
  response.set("Cache-Control", "no-store");
  try {
    const rawPath = request.path.replace(/\/+$/, "") || "/";
    const path = rawPath.replace(/^\/api(?=\/|$)/, "") || "/";
    if (path === "/licensing" || path.startsWith("/licensing/")) {
      await handleLicensingRequest(db, request, response, {
        lemonSqueezyWebhookSecret: lemonSqueezyWebhookSecret.value(),
        paypalClientSecret: paypalClientSecret.value(),
        paypalLicenseKeySecret: paypalLicenseKeySecret.value(),
        signingPrivateKey: licenseSigningPrivateKey.value(),
      });
      return;
    }
    if (request.method === "GET" && path === "/health") return json(response, 200, { ok: true, service: "FileX Cloud" });
    if (request.method === "POST" && path === "/sessions") return createSession(request, response);
    if (request.method === "GET" && path === "/sessions") return listSessions(request, response);

    const restoreMatch = path.match(/^\/sessions\/([0-9a-f-]{36})\/restore$/i);
    if (request.method === "POST" && restoreMatch) return restoreSession(restoreMatch[1], request, response);

    const publicMatch = path.match(/^\/public\/([^/]+)$/);
    const uploadMatch = path.match(/^\/public\/([^/]+)\/uploads$/);
    const uploadCompleteMatch = path.match(/^\/public\/([^/]+)\/uploads\/([0-9a-f-]{36})\/complete$/i);
    const publicCompleteMatch = path.match(/^\/public\/([^/]+)\/complete$/);
    const desktopMatch = path.match(/^\/desktop\/([0-9a-f-]{36})$/i);
    const desktopFileMatch = path.match(/^\/desktop\/([0-9a-f-]{36})\/files\/([0-9a-f-]{36})$/i);

    if (request.method === "GET" && publicMatch) return publicSession(publicMatch[1], response);
    if (request.method === "POST" && uploadMatch) return beginUpload(uploadMatch[1], request, response);
    if (request.method === "POST" && uploadCompleteMatch) return finishUpload(uploadCompleteMatch[1], uploadCompleteMatch[2], request, response);
    if (request.method === "POST" && publicCompleteMatch) return finishSession(publicCompleteMatch[1], response);
    if (request.method === "GET" && desktopMatch) return desktopStatus(desktopMatch[1], request, response);
    if (request.method === "PATCH" && desktopMatch) return updateSessionExpiry(desktopMatch[1], request, response);
    if (request.method === "DELETE" && desktopMatch) return deleteSession(desktopMatch[1], request, response);
    if (request.method === "DELETE" && desktopFileMatch) return deleteFile(desktopFileMatch[1], desktopFileMatch[2], request, response);
    return json(response, 404, { error: "Risorsa non trovata." });
  } catch (cause) {
    logger.error("FileX Cloud API error", cause);
    return json(response, 500, { error: "Errore temporaneo del servizio." });
  }
});

async function createSession(request: Request, response: HttpResponse) {
  let ownerUid = "";
  const identityToken = bearer(request);
  try { ownerUid = await verifyInstallationToken(identityToken); }
  catch (cause) {
    const error = cause as { code?: string; message?: string };
    logger.warn("FileX anonymous identity rejected", { code: error.code ?? "unknown", message: error.message ?? "unknown" });
    return json(response, 401, { error: "Installazione FileX non autorizzata." });
  }
  const owned = await db.collection("filexSendSessions").where("ownerUid", "==", ownerUid).limit(10).get();
  const activeCount = owned.docs.filter((doc) => (doc.data() as SessionRecord).expiresAt.toMillis() > Date.now()).length;
  if (activeCount >= 3) return json(response, 429, { error: "Hai già tre invii cloud in attesa. Completa o archivia un invio prima di crearne un altro." });
  const identity = createSessionIdentity(Date.now(), request.body?.expiresAt);
  const label = sanitizeLabel(request.body?.label);
  const direction = request.body?.direction === "send" ? "send" : "receive";
  await db.collection("filexSendSessions").doc(identity.id).set({
    ownerUid,
    direction,
    label,
    publicTokenHash: identity.publicTokenHash,
    desktopTokenHash: identity.desktopTokenHash,
    createdAt: Timestamp.fromMillis(identity.createdAt),
    expiresAt: Timestamp.fromMillis(identity.expiresAt),
    retentionExpiresAt: Timestamp.fromMillis(identity.retentionExpiresAt),
    clientCompleted: false,
    activeUploads: 0,
    receivedBytes: 0,
    receivedFiles: 0,
  } satisfies SessionRecord);
  return json(response, 201, {
    sessionId: identity.id,
    desktopToken: identity.desktopToken,
    uploadUrl: `${publicBaseUrl}/r/${identity.id}.${identity.publicToken}`,
    expiresAt: identity.expiresAt,
    retentionExpiresAt: identity.retentionExpiresAt,
  });
}

async function publicSession(rawCredential: string, response: HttpResponse) {
  const authorized = await authorizePublic(rawCredential);
  if (!authorized) return json(response, 410, { error: "Sessione scaduta." });
  const direction = authorized.data.direction ?? "receive";
  const files = direction === "send" ? await authorized.ref.collection("files").orderBy("receivedAt").get() : null;
  return json(response, 200, {
    label: authorized.data.label,
    direction,
    expiresAt: authorized.data.expiresAt.toMillis(),
    files: files?.docs.map((doc) => {
      const file = doc.data() as FileRecord;
      return {
        id: doc.id,
        name: file.name,
        size: file.size,
        contentType: file.contentType ?? inferContentType(file.name),
        downloadUrl: `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(file.objectPath)}?alt=media&token=${encodeURIComponent(file.downloadToken)}`,
      };
    }) ?? [],
  });
}

async function beginUpload(rawCredential: string, request: Request, response: HttpResponse) {
  const authorized = await authorizePublic(rawCredential);
  if (!authorized || !publicUploadAllowed({ expiresAt: authorized.data.expiresAt.toMillis(), clientCompleted: authorized.data.clientCompleted })) return json(response, 410, { error: "Sessione chiusa o scaduta." });
  const size = Number(request.body?.size);
  const name = sanitizeFileName(request.body?.name);
  const contentType = typeof request.body?.contentType === "string" ? request.body.contentType.slice(0, 120) : "application/octet-stream";
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE_BYTES) return json(response, 413, { error: "Dimensione del file non valida." });
  const fileId = randomUUID();
  const downloadToken = createToken();
  const objectPath = `filex-send/${authorized.id}/${fileId}`;
  await authorized.ref.update({ clientCompleted: false, lastUploadStartedAt: Timestamp.now() });
  const [uploadUrl] = await bucket.file(objectPath).createResumableUpload({
    metadata: {
      contentType,
      metadata: { filexSessionId: authorized.id, originalName: name, expectedSize: String(size), firebaseStorageDownloadTokens: downloadToken },
    },
    origin: request.get("origin") || publicBaseUrl,
  });
  return json(response, 201, { fileId, uploadUrl });
}

async function finishUpload(rawCredential: string, fileId: string, request: Request, response: HttpResponse) {
  const authorized = await authorizePublic(rawCredential);
  if (!authorized || !publicUploadAllowed({ expiresAt: authorized.data.expiresAt.toMillis(), clientCompleted: authorized.data.clientCompleted })) return json(response, 410, { error: "Sessione chiusa o scaduta." });
  const objectPath = `filex-send/${authorized.id}/${fileId}`;
  const file = bucket.file(objectPath);
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size);
  const expectedSize = Number(metadata.metadata?.expectedSize);
  if (!Number.isSafeInteger(size) || size !== expectedSize || size > MAX_FILE_BYTES) {
    await file.delete({ ignoreNotFound: true });
    return json(response, 400, { error: "Upload incompleto." });
  }
  const record: FileRecord = {
    name: sanitizeFileName(metadata.metadata?.originalName),
    size,
    contentType: metadata.contentType ?? "application/octet-stream",
    objectPath,
    downloadToken: String(metadata.metadata?.firebaseStorageDownloadTokens ?? ""),
    receivedAt: Timestamp.now(),
  };
  const ref = authorized.ref.collection("files").doc(fileId);
  if (!(await ref.get()).exists) {
    await db.runTransaction(async (transaction) => {
      transaction.set(ref, record);
      transaction.update(authorized.ref, { receivedBytes: FieldValue.increment(size), receivedFiles: FieldValue.increment(1) });
    });
  }
  return json(response, 201, { ok: true, fileId });
}

async function finishSession(rawCredential: string, response: HttpResponse) {
  const authorized = await authorizePublic(rawCredential);
  if (!authorized) return json(response, 410, { error: "Sessione scaduta." });
  await authorized.ref.update({ clientCompleted: true });
  return json(response, 200, { ok: true });
}

async function desktopStatus(id: string, request: Request, response: HttpResponse) {
  const authorized = await authorizeDesktop(id, bearer(request));
  if (!authorized) return json(response, 401, { error: "Non autorizzato o sessione scaduta." });
  const files = await authorized.ref.collection("files").orderBy("receivedAt").get();
  return json(response, 200, {
    sessionId: id,
    direction: authorized.data.direction ?? "receive",
    label: authorized.data.label,
    expiresAt: authorized.data.expiresAt.toMillis(),
    retentionExpiresAt: (authorized.data.retentionExpiresAt ?? authorized.data.expiresAt).toMillis(),
    clientCompleted: authorized.data.clientCompleted,
    activeUploads: authorized.data.activeUploads,
    files: files.docs.filter((doc) => !(doc.data() as FileRecord).downloadedAt).map((doc) => {
      const file = doc.data() as FileRecord;
      return {
        id: doc.id,
        name: file.name,
        size: file.size,
        contentType: file.contentType ?? inferContentType(file.name),
        receivedAt: file.receivedAt.toMillis(),
        downloadUrl: `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(file.objectPath)}?alt=media&token=${encodeURIComponent(file.downloadToken)}`,
      };
    }),
  });
}

async function deleteFile(sessionId: string, fileId: string, request: Request, response: HttpResponse) {
  const authorized = await authorizeDesktop(sessionId, bearer(request));
  if (!authorized) return json(response, 401, { error: "Non autorizzato." });
  const ref = authorized.ref.collection("files").doc(fileId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return json(response, 200, { ok: true });
  const file = snapshot.data() as FileRecord;
  const downloadedAt = Timestamp.now();
  if (!file.downloadedAt) await ref.update({ downloadedAt });
  const files = await authorized.ref.collection("files").get();
  const hasUndownloaded = files.docs.some((candidate) => !(candidate.data() as FileRecord).downloadedAt && candidate.id !== fileId);
  const retentionExpiresAt = Timestamp.fromMillis(Math.max(Date.now(), authorized.data.expiresAt.toMillis()) + DOWNLOADED_RETENTION_MS);
  if (!hasUndownloaded) await authorized.ref.update({ retentionExpiresAt });
  return json(response, 200, { ok: true, deleteAfter: downloadedAt.toMillis() + DOWNLOADED_RETENTION_MS });
}

async function deleteSession(id: string, request: Request, response: HttpResponse) {
  const authorized = await authorizeDesktop(id, bearer(request));
  if (!authorized) return json(response, 401, { error: "Non autorizzato." });
  const now = Timestamp.now();
  const files = await authorized.ref.collection("files").get();
  const hasUndownloaded = files.docs.some((file) => !(file.data() as FileRecord).downloadedAt);
  const update: Record<string, unknown> = { clientCompleted: true, expiresAt: now, closedAt: now };
  if (!hasUndownloaded) update.retentionExpiresAt = Timestamp.fromMillis(Date.now() + DOWNLOADED_RETENTION_MS);
  await authorized.ref.update(update);
  return json(response, 200, { ok: true, retainedUntil: (update.retentionExpiresAt as Timestamp | undefined)?.toMillis() ?? authorized.data.retentionExpiresAt.toMillis() });
}

export const cleanupExpiredSessions = onSchedule({ schedule: "every 15 minutes", region: "europe-west1", timeZone: "Europe/Rome", timeoutSeconds: 540, memory: "256MiB" }, async () => {
  const now = Timestamp.now();
  const downloadedCutoff = Timestamp.fromMillis(now.toMillis() - DOWNLOADED_RETENTION_MS);
  const downloaded = await db.collectionGroup("files").where("downloadedAt", "<=", downloadedCutoff).limit(200).get();
  for (const fileSnapshot of downloaded.docs) {
    const file = fileSnapshot.data() as FileRecord;
    await bucket.file(file.objectPath).delete({ ignoreNotFound: true });
    await fileSnapshot.ref.delete();
  }
  const expired = await db.collection("filexSendSessions").where("retentionExpiresAt", "<=", now).limit(100).get();
  let expiredSessionsRemoved = 0;
  let pendingSessionsRetained = 0;
  for (const session of expired.docs) {
    const sessionData = session.data() as SessionRecord;
    const sessionFiles = await session.ref.collection("files").get();
    const hasUndownloaded = sessionFiles.docs.some((file) => !(file.data() as FileRecord).downloadedAt);
    if (hasUndownloaded && (sessionData.direction ?? "receive") === "receive") {
      await session.ref.update({ retentionExpiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000) });
      pendingSessionsRetained += 1;
      continue;
    }
    await purgeSession(session.id, session.ref);
    expiredSessionsRemoved += 1;
  }
  logger.info("FileX Send cleanup completed", { downloadedFilesRemoved: downloaded.size, expiredSessionsRemoved, pendingSessionsRetained });
});

async function purgeSession(id: string, ref: FirebaseFirestore.DocumentReference) {
  await bucket.deleteFiles({ prefix: `filex-send/${id}/`, force: true });
  const files = await ref.collection("files").get();
  const pendingUploads = await ref.collection("pendingUploads").get();
  const batch = db.batch();
  files.docs.forEach((file) => batch.delete(file.ref));
  pendingUploads.docs.forEach((file) => batch.delete(file.ref));
  batch.delete(ref);
  await batch.commit();
}

async function authorizePublic(rawCredential: string) {
  const credential = sessionCredential(rawCredential);
  if (!credential) return null;
  const ref = db.collection("filexSendSessions").doc(credential.id);
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() as SessionRecord;
  if (data.expiresAt.toMillis() <= Date.now() || !tokensEqual(credential.token, data.publicTokenHash)) return null;
  return { id: credential.id, ref, data };
}

async function authorizeDesktop(id: string, token: string) {
  const ref = db.collection("filexSendSessions").doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() as SessionRecord;
  if (!tokensEqual(token, data.desktopTokenHash)) return null;
  return { ref, data };
}

function bearer(request: Request): string {
  return String(request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
}

async function verifyInstallationToken(idToken: string): Promise<string> {
  if (!idToken) throw new Error("Missing installation token");
  const decoded = await getAuth().verifyIdToken(idToken);
  const uid = decoded.uid?.trim();
  if (!uid) throw new Error("Firebase Admin returned no installation identity");
  return uid;
}

async function updateSessionExpiry(id: string, request: Request, response: HttpResponse) {
  const authorized = await authorizeDesktop(id, bearer(request));
  if (!authorized) return json(response, 401, { error: "Non autorizzato." });
  const expiresAt = normalizeLinkExpiry(request.body?.expiresAt);
  const retentionExpiresAt = expiresAt + DOWNLOADED_RETENTION_MS;
  await authorized.ref.update({ expiresAt: Timestamp.fromMillis(expiresAt), retentionExpiresAt: Timestamp.fromMillis(retentionExpiresAt), clientCompleted: false });
  return json(response, 200, { expiresAt, retentionExpiresAt });
}

async function listSessions(request: Request, response: HttpResponse) {
  let ownerUid: string;
  try { ownerUid = await verifyInstallationToken(bearer(request)); }
  catch { return json(response, 401, { error: "Installazione FileX non autorizzata." }); }
  const snapshot = await db.collection("filexSendSessions").where("ownerUid", "==", ownerUid).limit(20).get();
  const sessions = snapshot.docs
    .map((doc) => ({ id: doc.id, data: doc.data() as SessionRecord }))
    .filter(({ data }) => data.expiresAt.toMillis() > Date.now())
    .sort((a, b) => b.data.createdAt.toMillis() - a.data.createdAt.toMillis())
    .map(({ id, data }) => ({
      sessionId: id,
      direction: data.direction ?? "receive",
      label: data.label,
      createdAt: data.createdAt.toMillis(),
      expiresAt: data.expiresAt.toMillis(),
      retentionExpiresAt: (data.retentionExpiresAt ?? data.expiresAt).toMillis(),
      clientCompleted: data.clientCompleted,
      activeUploads: data.activeUploads,
      receivedBytes: data.receivedBytes,
      receivedFiles: data.receivedFiles,
    }));
  return json(response, 200, { sessions });
}

async function restoreSession(id: string, request: Request, response: HttpResponse) {
  let ownerUid: string;
  try { ownerUid = await verifyInstallationToken(bearer(request)); }
  catch { return json(response, 401, { error: "Installazione FileX non autorizzata." }); }
  const ref = db.collection("filexSendSessions").doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists) return json(response, 404, { error: "Sessione non trovata." });
  const data = snapshot.data() as SessionRecord;
  if (data.ownerUid !== ownerUid || data.expiresAt.toMillis() <= Date.now()) return json(response, 404, { error: "Sessione non disponibile." });
  const desktopToken = createToken();
  await ref.update({ desktopTokenHash: hashToken(desktopToken) });
  return json(response, 200, {
    sessionId: id,
    desktopToken,
    direction: data.direction ?? "receive",
    label: data.label,
    createdAt: data.createdAt.toMillis(),
    expiresAt: data.expiresAt.toMillis(),
    retentionExpiresAt: (data.retentionExpiresAt ?? data.expiresAt).toMillis(),
    clientCompleted: data.clientCompleted,
    activeUploads: data.activeUploads,
    receivedBytes: data.receivedBytes,
    receivedFiles: data.receivedFiles,
  });
}

function json(response: HttpResponse, status: number, value: unknown) {
  response.status(status).json(value);
}

function inferContentType(fileName: string): string {
  return MIME_TYPES[extname(fileName).toLowerCase()] ?? "application/octet-stream";
}

const MIME_TYPES: Record<string, string> = {
  ".3gp": "video/3gpp",
  ".avi": "video/x-msvideo",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".m4v": "video/x-m4v",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".wma": "audio/x-ms-wma",
  ".wmv": "video/x-ms-wmv",
  ".zip": "application/zip",
};
