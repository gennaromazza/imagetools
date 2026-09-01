import assert from "node:assert/strict";
import test from "node:test";
import { ID_PHOTO_BACKGROUND_MODEL, processIdPhotoBackground } from "./id-photo-background-service.js";

test("usa un modello BiRefNet MIT fissato e verificabile", () => {
  assert.equal(ID_PHOTO_BACKGROUND_MODEL.license, "MIT");
  assert.match(ID_PHOTO_BACKGROUND_MODEL.url, /^https:\/\/github\.com\/ZhengPeng7\/BiRefNet\/releases\/download\/v1\//);
  assert.match(ID_PHOTO_BACKGROUND_MODEL.sha256, /^[a-f0-9]{64}$/);
  assert.equal(ID_PHOTO_BACKGROUND_MODEL.size, 224_005_088);
});

test("rifiuta modalità arbitrarie prima di leggere la fotografia", async () => {
  await assert.rejects(
    processIdPhotoBackground("C:\\FileX-Test", {
      jobId: "job-safe",
      sourcePath: "C:\\missing.jpg",
      mode: "unsafe" as "replace",
      backgroundColor: "#ffffff",
      strength: 70,
    }),
    /Modalità sfondo non valida/,
  );
});
