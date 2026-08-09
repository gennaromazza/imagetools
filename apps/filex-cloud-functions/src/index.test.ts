import assert from "node:assert/strict";
import test from "node:test";
import { DOWNLOADED_RETENTION_MS, MAX_LINK_TTL_MS, MIN_LINK_TTL_MS, createSessionIdentity, downloadedFileExpired, hashToken, normalizeLinkExpiry, sanitizeFileName, sessionCredential, tokensEqual } from "./core.js";

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

test("parses public credentials and sanitizes names", () => {
  const session = createSessionIdentity();
  assert.deepEqual(sessionCredential(`${session.id}.${session.publicToken}`), { id: session.id, token: session.publicToken });
  assert.equal(sessionCredential("bad"), null);
  assert.equal(sanitizeFileName("../foto?.jpg"), "foto_.jpg");
  assert.equal(hashToken("a").length, 64);
});
