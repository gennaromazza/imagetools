import assert from "node:assert/strict";
import test from "node:test";
import {
  isPartyFrameSourceName,
  mapWithConcurrency,
  restoreVerifiedNativeSessionFiles,
} from "./sourceImport.js";

test("l'import limita il lavoro simultaneo e conserva l'ordine della cartella", async () => {
  let active = 0;
  let peak = 0;
  const values = await mapWithConcurrency([0, 1, 2, 3, 4, 5, 6], 3, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, (6 - value) * 2));
    active -= 1;
    return `image-${value}`;
  });

  assert.equal(peak, 3);
  assert.deepEqual(values, [
    "image-0",
    "image-1",
    "image-2",
    "image-3",
    "image-4",
    "image-5",
    "image-6",
  ]);
});

test("l'import PartyFrame scarta RAW e file non immagine prima di leggerli", () => {
  assert.equal(isPartyFrameSourceName("evento.JPG"), true);
  assert.equal(isPartyFrameSourceName("frame.tiff"), true);
  assert.equal(isPartyFrameSourceName("telefono.heic"), true);
  assert.equal(isPartyFrameSourceName("negativo.cr3"), false);
  assert.equal(isPartyFrameSourceName("note.txt"), false);
});

test("un progetto recente riapre i path nativi solo se i file sono ancora gli stessi", () => {
  const reference = [{ path: "foto/a.jpg", absolutePath: "C:/evento/a.jpg", size: 12, lastModified: 100 }];
  const valid = restoreVerifiedNativeSessionFiles(reference, [{
    name: "a.jpg",
    absolutePath: "C:/evento/a.jpg",
    size: 12,
    lastModified: 100,
  }]);
  assert.equal(valid?.[0]?.name, "a.jpg");
  assert.equal(valid?.[0]?.size, 0, "Il renderer conserva solo un riferimento leggero, non i byte originali");

  assert.equal(restoreVerifiedNativeSessionFiles(reference, []), null);
  assert.equal(restoreVerifiedNativeSessionFiles(reference, [{
    name: "a.jpg",
    absolutePath: "C:/evento/a.jpg",
    size: 13,
    lastModified: 100,
  }]), null);
});
