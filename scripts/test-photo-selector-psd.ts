import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { writePsdBuffer } from "ag-psd";
import sharp from "sharp";
import { isNativeFolderImageFile } from "../apps/filex-desktop/src/native-folder-service";
import {
  getPsdJpegConversionProgressDesktop,
  startPsdJpegConversionDesktop,
} from "../apps/filex-desktop/src/psd-jpeg-conversion-service";
import { renderPsdCompositeToJpeg } from "../apps/filex-desktop/src/psd-image-service";
import { buildPlaceholderAssets, isImageFile } from "../apps/photo-selector-app/src/services/folder-access";

const FIXTURE_WIDTH = 4;
const FIXTURE_HEIGHT = 2;

function makePsdFixture() {
  const data = new Uint8ClampedArray(FIXTURE_WIDTH * FIXTURE_HEIGHT * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 212;
    data[index + 1] = 126;
    data[index + 2] = 48;
    data[index + 3] = 255;
  }
  return writePsdBuffer({
    width: FIXTURE_WIDTH,
    height: FIXTURE_HEIGHT,
    imageData: { width: FIXTURE_WIDTH, height: FIXTURE_HEIGHT, data },
    children: [],
  });
}

function getFirstJpegQuantizationValue(bytes: Uint8Array): number | null {
  for (let offset = 2; offset + 5 < bytes.length; offset += 1) {
    if (bytes[offset] !== 0xff || bytes[offset + 1] !== 0xdb) {
      continue;
    }
    return bytes[offset + 5] ?? null;
  }
  return null;
}

async function waitForConversion(): Promise<ReturnType<typeof getPsdJpegConversionProgressDesktop>> {
  for (let attempt = 0; attempt < 1_200; attempt += 1) {
    const progress = getPsdJpegConversionProgressDesktop();
    if (progress.status !== "running") {
      return progress;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timeout durante la conversione PSD.");
}

async function verifyRealPsdFolder(folderPath: string, convert: boolean): Promise<void> {
  const fileNames = (await readdir(folderPath))
    .filter((fileName) => fileName.toLowerCase().endsWith(".psd"))
    .sort((left, right) => left.localeCompare(right));
  assert.ok(fileNames.length > 0, "La cartella indicata non contiene PSD.");
  const sourcePaths = fileNames.map((fileName) => join(folderPath, fileName));
  const sourceSizes = await Promise.all(sourcePaths.map(async (sourcePath) => (await stat(sourcePath)).size));

  for (const sourcePath of sourcePaths) {
    const preview = await renderPsdCompositeToJpeg(sourcePath, { maxDimension: 1024, quality: 95 });
    assert.ok(preview, `Composito PSD non disponibile: ${sourcePath}`);
    assert.equal(preview.mimeType, "image/jpeg");
    assert.deepEqual(Array.from(preview.bytes.subarray(0, 2)), [0xff, 0xd8]);
  }

  if (!convert) {
    console.log(`PSD reali: ${sourcePaths.length} compositi letti con successo (conversione non richiesta).`);
    return;
  }

  const outputFolderPath = join(folderPath, "JPEG da PSD");
  const existingOutputNames = new Set(
    await readdir(outputFolderPath).catch(() => [] as string[]).then((entries) => entries.map((entry) => entry.toLocaleLowerCase())),
  );
  const remainingSourcePaths = sourcePaths.filter((sourcePath) => {
    const expectedName = `${basename(sourcePath, extname(sourcePath))}.jpg`.toLocaleLowerCase();
    return !existingOutputNames.has(expectedName);
  });

  if (remainingSourcePaths.length > 0) {
    const started = startPsdJpegConversionDesktop({ inputPaths: remainingSourcePaths });
    assert.equal(started.status, "running");
    const result = await waitForConversion();
    assert.equal(result.status, "completed");
    assert.equal(result.generated, remainingSourcePaths.length);
    assert.equal(result.errors, 0);
    assert.equal(new Set(result.results.map((item) => item.outputPath).filter(Boolean)).size, remainingSourcePaths.length);
  }

  let refreshedPrintOutputCount = 0;
  if (process.env.PHOTO_SELECTOR_PSD_REAL_REFRESH_PRINT_OUTPUTS === "1") {
    for (const sourcePath of sourcePaths) {
      const outputPath = join(outputFolderPath, `${basename(sourcePath, extname(sourcePath))}.jpg`);
      const printJpeg = await renderPsdCompositeToJpeg(sourcePath, { quality: 100 });
      assert.ok(printJpeg, `Composito PSD non disponibile: ${sourcePath}`);
      const temporaryOutputPath = `${outputPath}.filex-print-${process.pid}.tmp`;
      await writeFile(temporaryOutputPath, printJpeg.bytes);
      await rename(temporaryOutputPath, outputPath);
      const outputMetadata = await sharp(outputPath).metadata();
      assert.equal(outputMetadata.chromaSubsampling, "4:4:4");
      assert.equal(getFirstJpegQuantizationValue(await readFile(outputPath)), 1);
      refreshedPrintOutputCount += 1;
    }
  }
  await Promise.all(sourcePaths.map(async (sourcePath, index) => {
    assert.equal((await stat(sourcePath)).size, sourceSizes[index]);
  }));
  console.log(
    refreshedPrintOutputCount > 0
      ? `PSD reali: ${refreshedPrintOutputCount} JPEG aggiornati alla qualità di stampa massima senza modificare gli originali.`
      : `PSD reali: ${remainingSourcePaths.length} JPEG creati senza modificare gli originali.`,
  );
}

const workDir = await mkdtemp(join(tmpdir(), "filex-photo-selector-psd-"));
try {
  const sourcePath = join(workDir, "copertina.psd");
  const sourceBytes = makePsdFixture();
  await writeFile(sourcePath, sourceBytes);

  assert.equal(isImageFile("copertina.psd"), true);
  assert.equal(isNativeFolderImageFile("copertina.psd"), true);
  assert.equal(isImageFile("copertina.psb"), false);

  const placeholders = buildPlaceholderAssets([{
    name: "copertina.psd",
    relativePath: "Album/copertina.psd",
    absolutePath: sourcePath,
    size: sourceBytes.byteLength,
    lastModified: 1,
    createdAt: 1,
  }]);
  assert.equal(placeholders.length, 1);
  assert.equal(placeholders[0]?.fileName, "copertina.psd");

  const rendered = await renderPsdCompositeToJpeg(sourcePath, { quality: 95 });
  assert.ok(rendered);
  assert.equal(rendered.mimeType, "image/jpeg");
  assert.equal(rendered.width, FIXTURE_WIDTH);
  assert.equal(rendered.height, FIXTURE_HEIGHT);
  assert.deepEqual(Array.from(rendered.bytes.subarray(0, 2)), [0xff, 0xd8]);

  const firstStart = startPsdJpegConversionDesktop({ inputPaths: [sourcePath] });
  assert.equal(firstStart.status, "running");
  const firstResult = await waitForConversion();
  assert.equal(firstResult.status, "completed");
  assert.equal(firstResult.generated, 1);
  const firstOutput = firstResult.results[0]?.outputPath;
  assert.ok(firstOutput);
  assert.equal((await stat(firstOutput)).isFile(), true);
  const firstOutputBytes = await readFile(firstOutput);
  assert.equal((await sharp(firstOutput).metadata()).chromaSubsampling, "4:4:4");
  assert.equal(getFirstJpegQuantizationValue(firstOutputBytes), 1);
  assert.deepEqual(await readFile(sourcePath), sourceBytes);

  const secondStart = startPsdJpegConversionDesktop({ inputPaths: [sourcePath] });
  assert.equal(secondStart.status, "running");
  const secondResult = await waitForConversion();
  assert.equal(secondResult.status, "completed");
  assert.equal(secondResult.generated, 1);
  const secondOutput = secondResult.results[0]?.outputPath;
  assert.ok(secondOutput);
  assert.notEqual(secondOutput, firstOutput);
  assert.match(secondOutput, /copertina \(2\)\.jpg$/i);
  assert.deepEqual(await readFile(sourcePath), sourceBytes);

  console.log("PhotoSelector PSD: importazione, anteprima e conversione sicura: PASS");
} finally {
  await rm(workDir, { recursive: true, force: true });
}

const realPsdFolder = process.env.PHOTO_SELECTOR_PSD_REAL_FOLDER?.trim();
if (realPsdFolder) {
  await verifyRealPsdFolder(realPsdFolder, process.env.PHOTO_SELECTOR_PSD_REAL_CONVERT === "1");
}
