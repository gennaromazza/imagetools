import assert from "node:assert/strict";
import test from "node:test";
import { DOWNLOADED_RETENTION_MS, MAX_DOWNLOAD_CHUNK_BYTES, MAX_LINK_TTL_MS, MIN_LINK_TTL_MS, createSessionIdentity, downloadContentDisposition, downloadedFileExpired, hashToken, normalizeLinkExpiry, publicDownloadRange, publicUploadAllowed, sanitizeFileName, sessionCredential, tokensEqual } from "./core.js";

test("creates an expiring session with independent tokens", () => {
  const session = createSessionIdentity(1_000);
  assert.notEqual(session.publicToken, session.desktopToken);
  assert.equal(tokensEqual(session.publicToken, session.publicTokenHash), true);
  assert.equal(tokensEqual("wrong", session.publicTokenHash), false);
  assert.equal(session.expiresAt, 1_000 + 24 * 60 * 60 * 1000);
  assert.equal(session.retentionExpiresAt, session.expiresAt + DOWNLOADED_RETENTION_MS);
});

test("clamps the configurable link expiry and retains downloads for one hour", () => {
  const now = 100_000;
  assert.equal(normalizeLinkExpiry(now, now), now + MIN_LINK_TTL_MS);
  assert.equal(normalizeLinkExpiry(now + 99 * MAX_LINK_TTL_MS, now), now + MAX_LINK_TTL_MS);
  assert.equal(downloadedFileExpired(now, now + DOWNLOADED_RETENTION_MS - 1), false);
  assert.equal(downloadedFileExpired(now, now + DOWNLOADED_RETENTION_MS), true);
});

test("keeps accepting new batches after a client completed a previous upload", () => {
  const now = 100_000;
  assert.equal(publicUploadAllowed({ expiresAt: now + 1, clientCompleted: true }, now), true);
  assert.equal(publicUploadAllowed({ expiresAt: now, clientCompleted: false }, now), false);
});

test("parses public credentials and sanitizes names", () => {
  const session = createSessionIdentity();
  assert.deepEqual(sessionCredential(`${session.id}.${session.publicToken}`), { id: session.id, token: session.publicToken });
  assert.equal(sessionCredential("bad"), null);
  assert.equal(sanitizeFileName("../foto?.jpg"), "foto_.jpg");
  assert.equal(hashToken("a").length, 64);
});

test("forces shared objects to download with a safe filename", () => {
  assert.equal(
    downloadContentDisposition("vacanza estate (1) é.jpg"),
    "attachment; filename=\"vacanza estate (1) _.jpg\"; filename*=UTF-8''vacanza%20estate%20%281%29%20%C3%A9.jpg",
  );
});


test("limita il proxy cloud a blocchi HTTP da 4 MB", () => {
  assert.deepEqual(publicDownloadRange(MAX_DOWNLOAD_CHUNK_BYTES), { start: 0, end: MAX_DOWNLOAD_CHUNK_BYTES - 1 });
  assert.deepEqual(publicDownloadRange(MAX_DOWNLOAD_CHUNK_BYTES + 1, "bytes=0-4194303"), { start: 0, end: MAX_DOWNLOAD_CHUNK_BYTES - 1 });
  assert.equal(publicDownloadRange(MAX_DOWNLOAD_CHUNK_BYTES + 1), null);
  assert.equal(publicDownloadRange(MAX_DOWNLOAD_CHUNK_BYTES + 1, "bytes=0-4194304"), null);
});
