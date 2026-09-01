import assert from "node:assert/strict";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { processIdPhotoBackground } from "../apps/filex-desktop/src/id-photo-background-service.js";

const dataRoot = join(tmpdir(), "filex-id-photo-background-smoke-cache");
await mkdir(dataRoot, { recursive: true });
const sourcePath = join(dataRoot, "smoke-portrait.png");
const width = 512;
const height = 640;
const background = Buffer.alloc(width * height * 3, 232);
await writeFile(sourcePath, await sharp(background, { raw: { width, height, channels: 3 } })
  .composite([{ input: Buffer.from('<svg width="240" height="420"><ellipse cx="120" cy="105" rx="82" ry="100" fill="#c58f72"/><rect x="38" y="185" width="164" height="235" rx="70" fill="#314d6b"/></svg>'), left: 136, top: 100 }])
  .png().toBuffer());

const result = await processIdPhotoBackground(dataRoot, {
  jobId: "smoke",
  sourcePath,
  mode: "replace",
  backgroundColor: "#ffffff",
  strength: 100,
});
assert.equal(result.status, "completed");
assert.ok((await stat(result.maskPath)).size > 1_000);
assert.ok((await stat(result.processedPath)).size > 1_000);
assert.match(result.maskSha256, /^[a-f0-9]{64}$/);
console.log(`FileX ID Photo background smoke: PASS (${result.modelVersion})`);
