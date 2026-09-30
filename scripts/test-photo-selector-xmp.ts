import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { ExifTool } from "exiftool-vendored";
import sharp from "sharp";
import type { ImageAsset } from "@photo-tools/shared-types";
import { parseXmpState, upsertXmpState } from "../apps/photo-selector-app/src/services/xmp-sidecar.ts";
import {
  readEmbeddedStandardRating,
  shutdownXmpCompatibilityService,
  writeEmbeddedStandardXmp,
} from "../apps/filex-desktop/src/xmp-compatibility.ts";
import { writeSidecarXmpForAssetPath } from "../apps/filex-desktop/src/native-folder-service.ts";

Object.assign(globalThis, {
  DOMParser,
  XMLSerializer,
});

const conflictingXml = `<?xpacket begin=""?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description
      rdf:about=""
      xmlns:xmp="http://ns.adobe.com/xap/1.0/"
      xmlns:MicrosoftPhoto="http://ns.microsoft.com/photo/1.0/"
      xmp:Rating="1"
      MicrosoftPhoto:Rating="99" />
  </rdf:RDF>
</x:xmpmeta>`;

assert.equal(
  parseXmpState(conflictingXml).rating,
  1,
  "A rating from another namespace must not be clamped to five and treated as xmp:Rating",
);

const duplicateXml = `<?xpacket begin=""?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="5" />
    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <xmp:Rating>4</xmp:Rating>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>`;

const asset = {
  id: "xmp-test",
  fileName: "rating-test.jpg",
  path: "rating-test.jpg",
  rating: 1,
  pickStatus: "unmarked",
  colorLabel: null,
  customLabels: [],
} as unknown as ImageAsset;

// Pick e colore devono sopravvivere insieme al round-trip sul sidecar.
const pickedRed = { ...asset, pickStatus: "picked", colorLabel: "red", rating: 3 } as unknown as ImageAsset;
const pickedRedState = parseXmpState(upsertXmpState(null, pickedRed, true));
assert.equal(pickedRedState.pickStatus, "picked", "Pick must round-trip");
assert.equal(pickedRedState.colorLabel, "red", "Color label must survive a Pick round-trip");
assert.equal(pickedRedState.rating, 3);

const rejectedBlue = { ...asset, pickStatus: "rejected", colorLabel: "blue", rating: 4 } as unknown as ImageAsset;
const rejectedBlueState = parseXmpState(upsertXmpState(null, rejectedBlue, false));
assert.equal(rejectedBlueState.pickStatus, "rejected");
assert.equal(rejectedBlueState.colorLabel, "blue", "Color label must survive a Reject round-trip");
assert.equal(rejectedBlueState.rating, 4, "Rating must survive a Reject round-trip");

// Un colore cambiato altrove (xmp:Label) prevale sul valore salvato in photosuite.
const staleColorXml = upsertXmpState(null, pickedRed, true).replace('xmp:Label="Select"', 'xmp:Label="Green"');
assert.equal(parseXmpState(staleColorXml).colorLabel, "green", "External xmp:Label color must win");
// Label svuotato da Bridge: il colore salvato non deve riapparire.
const clearedXml = upsertXmpState(null, pickedRed, true).replace(/xmp:Label="Select"/, "");
assert.equal(parseXmpState(clearedXml).colorLabel, undefined, "A cleared xmp:Label must not resurrect a stale color");

// Un sidecar esistente ma illeggibile non va mai sostituito da un pacchetto vuoto.
assert.throws(
  () => upsertXmpState("garbage not xml <<< crs:Exposure2012=+1.0", asset, false),
  /XMP/,
  "An unreadable existing sidecar must not be overwritten",
);

const canonicalXml = upsertXmpState(duplicateXml, asset, true);
assert.equal(
  (canonicalXml.match(/xmp:Rating\s*=/g) ?? []).length,
  1,
  "The writer must leave exactly one canonical xmp:Rating property",
);
assert.equal(parseXmpState(canonicalXml).rating, 1);

const canonicalConflictingXml = upsertXmpState(conflictingXml, asset, true);
assert.equal(
  canonicalConflictingXml.includes("MicrosoftPhoto:Rating="),
  false,
  "A stale Microsoft 0-99 rating must be removed from the sidecar",
);

const temporaryDirectory = await mkdtemp(join(tmpdir(), "filex-xmp-test-"));
const jpegPath = join(temporaryDirectory, "rating-test.jpg");

// exiftool-vendored intentionally uses unref'ed timers/process handles. Keep the
// short-lived test runner alive until the integration round-trip has completed.
const keepAlive = setInterval(() => undefined, 1_000);
const verifierExifTool = new ExifTool({ maxProcs: 1 });

try {
  await sharp({
    create: {
      width: 16,
      height: 16,
      channels: 3,
      background: { r: 32, g: 64, b: 96 },
    },
  }).jpeg().toFile(jpegPath);

  const fiveStarXml = canonicalXml.replace('xmp:Rating="1"', 'xmp:Rating="5"');
  assert.equal(await writeEmbeddedStandardXmp(jpegPath, fiveStarXml), true);
  assert.equal(await readEmbeddedStandardRating(jpegPath), 5);

  await verifierExifTool.write(jpegPath, {}, {
    writeArgs: [
      "-XMP-microsoft:RatingPercent=99",
      "-EXIF:Rating=5",
      "-EXIF:RatingPercent=99",
      "-overwrite_original",
    ],
  });

  assert.equal(await writeEmbeddedStandardXmp(jpegPath, canonicalXml), true);
  assert.equal(
    await readEmbeddedStandardRating(jpegPath),
    1,
    "A JPEG previously rated five stars must expose one star after the update",
  );

  const ratingTags = await verifierExifTool.readRaw<Record<string, unknown>>(jpegPath, {
    readArgs: [
      "-G1",
      "-a",
      "-s",
      "-XMP-xmp:Rating",
      "-XMP-microsoft:RatingPercent",
      "-EXIF:Rating",
      "-EXIF:RatingPercent",
    ],
  });
  assert.equal(ratingTags["XMP-xmp:Rating"], 1);
  assert.equal(ratingTags["XMP-microsoft:RatingPercent"], undefined);
  assert.equal(ratingTags["IFD0:Rating"], undefined);
  assert.equal(ratingTags["IFD0:RatingPercent"], undefined);

  const sourceBeforeSidecarWrite = await readFile(jpegPath);
  const sourceModifiedBeforeSidecarWrite = (await stat(jpegPath)).mtimeMs;
  assert.equal(await writeSidecarXmpForAssetPath(jpegPath, canonicalXml), true);
  assert.deepEqual(
    await readFile(jpegPath),
    sourceBeforeSidecarWrite,
    "Writing a sidecar must not alter the source image",
  );
  assert.equal(
    (await stat(jpegPath)).mtimeMs,
    sourceModifiedBeforeSidecarWrite,
    "Writing a sidecar must preserve the source image modification time",
  );

  const sidecarPath = join(temporaryDirectory, "rating-test.xmp");
  assert.equal(await readFile(sidecarPath, "utf8"), canonicalXml);
  const sidecarModifiedAt = (await stat(sidecarPath)).mtimeMs;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(await writeSidecarXmpForAssetPath(jpegPath, canonicalXml), true);
  assert.equal(
    (await stat(sidecarPath)).mtimeMs,
    sidecarModifiedAt,
    "An unchanged sidecar must not be rewritten",
  );
} finally {
  await verifierExifTool.end().catch(() => {});
  await shutdownXmpCompatibilityService();
  clearInterval(keepAlive);
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log("Photo Selector XMP compatibility tests passed.");
