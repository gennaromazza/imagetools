import assert from "node:assert/strict";
import test from "node:test";
import { FirebaseAnonymousAuth } from "./firebase-anonymous-auth.js";

test("creates and exports an anonymous Firebase identity", async () => {
  let changes = 0;
  const auth = new FirebaseAnonymousAuth("public-key", null, () => { changes += 1; }, async () => new Response(JSON.stringify({ idToken: "id-token", refreshToken: "refresh-token", localId: "device-1", expiresIn: "3600" }), { status: 200 }));
  assert.equal(await auth.getIdToken(), "id-token");
  assert.deepEqual(auth.exportState(), { localId: "device-1", refreshToken: "refresh-token" });
  assert.equal(changes, 1);
});

test("refreshes a persisted anonymous identity", async () => {
  const auth = new FirebaseAnonymousAuth("public-key", { localId: "old", refreshToken: "old-refresh" }, undefined, async (_url, init) => {
    assert.match(String(init?.body), /refresh_token=old-refresh/);
    return new Response(JSON.stringify({ id_token: "new-id", refresh_token: "new-refresh", user_id: "device-1", expires_in: "3600" }), { status: 200 });
  });
  assert.equal(await auth.getIdToken(), "new-id");
  assert.deepEqual(auth.exportState(), { localId: "device-1", refreshToken: "new-refresh" });
});
