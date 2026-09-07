import assert from "node:assert/strict";
import { ChildProcess, type spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import sharp from "sharp";
import { createPartyFrameApp, openFolder, type PartyFrameAppRuntime } from "./app.js";
import {
  PARTY_FRAME_API_CONTRACT,
  isCompatiblePartyFrameApiHealth,
} from "./apiContract.js";
import {
  HttpError,
  OutputReservationMap,
  computeCoverGeometry,
  ensureOutputDirectoryWritable,
  getAutoOrientedDimensions,
} from "./pipeline.js";

test("folder opening requests a visible window and reports launch failures", async () => {
  const folder = path.resolve(tmpdir(), "Foto matrimonio è pronto");
  const launch = ((command, args, options) => {
    assert.equal(command, process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open");
    assert.deepEqual(args, [folder], "Spaces and accents remain in a single path argument");
    assert.equal(options.windowsHide, false, "Explorer must open visibly after the user's click");
    const child = new ChildProcess();
    queueMicrotask(() => child.emit("spawn"));
    return child;
  }) as typeof spawn;
  await openFolder(folder, launch);
  const failingLaunch = (() => {
    const child = new ChildProcess();
    queueMicrotask(() => child.emit("error", new Error("Explorer unavailable")));
    return child;
  }) as typeof spawn;
  await assert.rejects(openFolder(folder, failingLaunch), /Explorer unavailable/);
});

interface TestServer {
  runtime: PartyFrameAppRuntime;
  origin: string;
  close: () => Promise<void>;
}

async function startTestServer(
  dataDir: string,
  sessionToken: string | null = null,
  options: { maxPendingJobs?: number } = {},
): Promise<TestServer> {
  const runtime = await createPartyFrameApp({
    dataDir,
    maxConcurrentJobs: 1,
    ...options,
    retentionMs: 60_000,
    sessionToken,
  });
  const server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  return {
    runtime,
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}

async function testJpeg(width = 64, height = 48): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 190, g: 80, b: 40 } },
  }).jpeg().toBuffer();
}

function customTemplate(width = 120, height = 80): string {
  const inset = 10;
  return JSON.stringify({
    name: "Test",
    variants: {
      horizontal: {
        widthPx: width,
        heightPx: height,
        dpi: 300,
        photoAreaX: 10,
        photoAreaY: 10,
        photoAreaWidth: width - inset * 2,
        photoAreaHeight: height - inset * 2,
      },
      vertical: {
        widthPx: height,
        heightPx: width,
        dpi: 300,
        photoAreaX: 10,
        photoAreaY: 10,
        photoAreaWidth: height - inset * 2,
        photoAreaHeight: width - inset * 2,
      },
    },
  });
}

function appendExportFields(
  form: FormData,
  image: Buffer,
  outputPath: string,
  count: number,
  templatePayload = customTemplate(),
): void {
  const items = [];
  for (let index = 0; index < count; index += 1) {
    form.append("images", new Blob([image], { type: "image/jpeg" }), "duplicate.jpg");
    items.push({
      id: `item-${index + 1}`,
      originalName: "duplicate.jpg",
      relativePath: `folder-${index + 1}/duplicate.jpg`,
      orientation: "horizontal",
      crop: { offsetX: index === 0 ? 1 : -1, offsetY: 0, zoom: 100 },
    });
  }
  form.append("items", JSON.stringify(items));
  form.append("templateId", "custom");
  form.append("customTemplate", templatePayload);
  form.append("quality", "90");
  form.append("format", "jpeg");
  form.append("namingPattern", "same-name");
  form.append("projectName", "Test Project");
  form.append("outputPath", outputPath);
  form.append("createSubfolder", "false");
  form.append("overwrite", "true");
}

async function waitForTerminalJob(
  origin: string,
  id: string,
  headers: HeadersInit = {},
): Promise<Record<string, any>> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${origin}/api/export-jobs/${id}`, { headers });
    assert.equal(response.status, 200);
    const snapshot = await response.json() as Record<string, any>;
    if (["completed", "cancelled", "failed"].includes(snapshot.status)) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Export job did not finish before the test deadline");
}

test("normalized cover offsets use the full available pan range", () => {
  const right = computeCoverGeometry({
    sourceWidth: 200,
    sourceHeight: 100,
    targetWidth: 100,
    targetHeight: 100,
    zoom: 100,
    offsetX: 1,
    offsetY: 0,
  });
  const left = computeCoverGeometry({
    sourceWidth: 200,
    sourceHeight: 100,
    targetWidth: 100,
    targetHeight: 100,
    zoom: 100,
    offsetX: -1,
    offsetY: 0,
  });
  assert.equal(right.overflowX, 100);
  assert.equal(right.extractLeft, 0);
  assert.equal(left.extractLeft, 100);
});

test("output reservation prevents collisions even when overwrite is enabled", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "partyframe-reservation-"));
  const reservations = new OutputReservationMap();
  try {
    const desired = path.join(directory, "constant.jpg");
    assert.equal(reservations.reserve(desired, true), desired);
    assert.equal(reservations.reserve(desired, true), path.join(directory, "constant_01.jpg"));
  } finally {
    reservations.releaseAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("EXIF orientation is applied before cover geometry", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "partyframe-exif-"));
  const filePath = path.join(directory, "rotated.jpg");
  try {
    const image = await sharp({
      create: { width: 40, height: 20, channels: 3, background: "#336699" },
    }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    await writeFile(filePath, image);
    assert.deepEqual(await getAutoOrientedDimensions(filePath), { width: 20, height: 40 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("health exposes the exact API contract and rejects stale export clients before upload", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "partyframe-contract-"));
  const server = await startTestServer(path.join(directory, "data"));
  try {
    const response = await fetch(`${server.origin}/api/health`, { cache: "no-store" });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    const health = await response.json() as Record<string, unknown>;
    assert.equal(health.apiContract, PARTY_FRAME_API_CONTRACT);
    assert.equal(health.instanceId, server.runtime.instanceId);
    assert.equal(health.startedAt, server.runtime.startedAt);
    assert.equal(isCompatiblePartyFrameApiHealth(health), true);
    assert.equal(isCompatiblePartyFrameApiHealth({ status: "ok", timestamp: new Date().toISOString() }), false);

    const staleResponse = await fetch(`${server.origin}/api/export-jobs`, {
      method: "POST",
      headers: { "X-PartyFrame-Api-Contract": "partyframe-api-stale" },
    });
    assert.equal(staleResponse.status, 409);
    assert.equal((await staleResponse.json() as Record<string, unknown>).code, "SERVER_CONTRACT_MISMATCH");
    assert.deepEqual(await readdir(server.runtime.uploadDir), []);
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a normal selected folder with spaces and accents passes the real write preflight", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "partyframe-output-"));
  const selectedFolder = path.join(directory, "Documenti e Immagini", "Evento d'estate");
  const server = await startTestServer(path.join(directory, "data"));
  try {
    await mkdir(selectedFolder, { recursive: true });
    await ensureOutputDirectoryWritable(selectedFolder);
    assert.deepEqual(await readdir(selectedFolder), []);

    const form = new FormData();
    appendExportFields(form, await testJpeg(), selectedFolder, 1);
    form.set("createSubfolder", "true");
    form.set("projectName", "Matrimonio Èlite");
    const createResponse = await fetch(`${server.origin}/api/export-jobs`, { method: "POST", body: form });
    assert.equal(createResponse.status, 202);
    const created = await createResponse.json() as Record<string, any>;
    const completed = await waitForTerminalJob(server.origin, created.id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.result.success.length, 1);
    assert.equal(completed.result.failed.length, 0);

    const outputDir = completed.result.outputDir as string;
    const relativeOutput = path.relative(selectedFolder, outputDir);
    assert.ok(relativeOutput && !relativeOutput.startsWith("..") && !path.isAbsolute(relativeOutput));
    assert.deepEqual(await readdir(outputDir), ["same-name.jpg"]);
    assert.equal((await readdir(outputDir)).some((entry) => entry.startsWith(".partyframe-write-probe-")), false);

    const invalidBase = path.join(directory, "not-a-folder");
    await writeFile(invalidBase, "file");
    await assert.rejects(
      ensureOutputDirectoryWritable(path.join(invalidBase, "child")),
      (error: unknown) => error instanceof HttpError && error.code === "INVALID_OUTPUT_PATH",
    );
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid export does not create the requested output folder and cleans uploads", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "partyframe-invalid-"));
  const server = await startTestServer(path.join(directory, "data"));
  const outputPath = path.join(directory, "must-not-exist");
  try {
    const form = new FormData();
    form.append("images", new Blob([await testJpeg()], { type: "image/jpeg" }), "photo.jpg");
    form.append("items", "[]");
    form.append("templateId", "classic-gold");
    form.append("outputPath", outputPath);
    const response = await fetch(`${server.origin}/api/export-jobs`, { method: "POST", body: form });
    assert.equal(response.status, 400);
    assert.equal(existsSync(outputPath), false);
    assert.deepEqual(await readdir(server.runtime.uploadDir), []);
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("AdobeRGB is rejected explicitly instead of being silently simulated", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "partyframe-icc-"));
  const server = await startTestServer(path.join(directory, "data"));
  const outputPath = path.join(directory, "must-not-exist");
  try {
    const form = new FormData();
    appendExportFields(form, await testJpeg(), outputPath, 1);
    form.set("colorProfile", "AdobeRGB");
    const response = await fetch(`${server.origin}/api/export-jobs`, { method: "POST", body: form });
    assert.equal(response.status, 422);
    assert.equal((await response.json() as Record<string, any>).code, "UNSUPPORTED_COLOR_PROFILE");
    assert.equal(existsSync(outputPath), false);
    assert.deepEqual(await readdir(server.runtime.uploadDir), []);
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("damaged image is reported without creating its requested output folder", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "partyframe-damaged-"));
  const server = await startTestServer(path.join(directory, "data"));
  const outputPath = path.join(directory, "must-not-exist");
  try {
    const form = new FormData();
    appendExportFields(form, Buffer.from("not-a-jpeg"), outputPath, 1);
    const response = await fetch(`${server.origin}/api/export-jobs`, { method: "POST", body: form });
    assert.equal(response.status, 202);
    const created = await response.json() as Record<string, any>;
    const completed = await waitForTerminalJob(server.origin, created.id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.result.success.length, 0);
    assert.equal(completed.result.failed.length, 1);
    assert.equal(existsSync(outputPath), false);
    assert.deepEqual(await readdir(server.runtime.uploadDir), []);
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("job API reports real progress, writes atomically, reserves names and is idempotent", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "partyframe-job-"));
  const server = await startTestServer(path.join(directory, "data"));
  const outputPath = path.join(directory, "result");
  const idempotencyKey = "partyframe-test-001";
  try {
    const form = new FormData();
    appendExportFields(form, await testJpeg(), outputPath, 2);
    const createResponse = await fetch(`${server.origin}/api/export-jobs`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: form,
    });
    assert.equal(createResponse.status, 202);
    const created = await createResponse.json() as Record<string, any>;
    assert.equal(created.progress.completed, 0);
    assert.equal(created.progress.percent, 0);

    const completed = await waitForTerminalJob(server.origin, created.id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.progress.completed, 2);
    assert.equal(completed.progress.percent, 100);
    assert.equal(completed.result.success.length, 2);
    assert.deepEqual(
      completed.result.success.map((entry: { filename: string }) => entry.filename),
      ["same-name.jpg", "same-name_01.jpg"],
    );
    const outputFiles = await readdir(outputPath);
    assert.deepEqual(outputFiles.sort(), ["same-name.jpg", "same-name_01.jpg"]);
    assert.equal(outputFiles.some((filename) => filename.endsWith(".partial")), false);
    const outputMetadata = await sharp(path.join(outputPath, "same-name.jpg")).metadata();
    assert.equal(outputMetadata.density, 300);
    assert.ok(outputMetadata.icc && outputMetadata.icc.length > 0);
    assert.deepEqual(await readdir(server.runtime.uploadDir), []);

    const replayResponse = await fetch(`${server.origin}/api/export-jobs`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
    });
    assert.equal(replayResponse.status, 200);
    const replay = await replayResponse.json() as Record<string, any>;
    assert.equal(replay.id, created.id);

    const cancelCompleted = await fetch(`${server.origin}/api/export-jobs/${created.id}`, { method: "DELETE" });
    assert.equal(cancelCompleted.status, 200);
    assert.equal((await cancelCompleted.json() as Record<string, any>).status, "completed");
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("sequential chunk jobs continue {contatore} numbering via counterOffset", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "partyframe-chunks-"));
  const server = await startTestServer(path.join(directory, "data"));
  const outputPath = path.join(directory, "result");
  const image = await testJpeg();
  try {
    async function runChunk(count: number, counterOffset: number, targetOutput: string): Promise<Record<string, any>> {
      const form = new FormData();
      const items = [];
      for (let index = 0; index < count; index += 1) {
        form.append("images", new Blob([image], { type: "image/jpeg" }), `chunk-${counterOffset + index}.jpg`);
        items.push({
          id: `chunk-item-${counterOffset + index + 1}`,
          originalName: `chunk-${counterOffset + index}.jpg`,
          orientation: "horizontal",
          crop: { offsetX: 0, offsetY: 0, zoom: 100 },
        });
      }
      form.append("items", JSON.stringify(items));
      form.append("templateId", "custom");
      form.append("customTemplate", customTemplate());
      form.append("quality", "90");
      form.append("format", "jpeg");
      form.append("namingPattern", "{contatore}");
      form.append("projectName", "Chunked");
      form.append("outputPath", targetOutput);
      form.append("createSubfolder", "false");
      form.append("overwrite", "false");
      form.append("counterOffset", String(counterOffset));
      const createResponse = await fetch(`${server.origin}/api/export-jobs`, { method: "POST", body: form });
      assert.equal(createResponse.status, 202);
      const created = await createResponse.json() as Record<string, any>;
      return waitForTerminalJob(server.origin, created.id);
    }

    const first = await runChunk(2, 0, outputPath);
    assert.equal(first.status, "completed");
    const sharedOutput = first.result.outputDir as string;
    const second = await runChunk(2, 2, sharedOutput);
    assert.equal(second.status, "completed");
    assert.deepEqual((await readdir(sharedOutput)).sort(), ["001.jpg", "002.jpg", "003.jpg", "004.jpg"]);
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("custom logo and text uploads retain aspect, opacity and clip multiline text at the canvas edge", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "partyframe-overlay-"));
  const server = await startTestServer(path.join(directory, "data"));
  const outputPath = path.join(directory, "result");
  try {
    const payload = JSON.parse(customTemplate());
    payload.variants.horizontal.logos = [{ x: 20, y: 20, width: 40, height: 40, opacity: 50 }];
    payload.variants.horizontal.texts = [{ x: 80, y: 70, width: 20, opacity: 50 }];
    const logo = await sharp({ create: { width: 80, height: 40, channels: 4, background: "red" } }).png().toBuffer();
    const text = await sharp({ create: { width: 20, height: 40, channels: 4, background: "black" } }).png().toBuffer();
    const form = new FormData();
    appendExportFields(form, await testJpeg(), outputPath, 1, JSON.stringify(payload));
    form.set("format", "png");
    form.append("templateOverlayHorizontal0", new Blob([logo], { type: "image/png" }), "logo.png");
    form.append("templateOverlayHorizontal1", new Blob([text], { type: "image/png" }), "text.png");
    const response = await fetch(`${server.origin}/api/export-jobs`, { method: "POST", body: form });
    assert.equal(response.status, 202);
    const result = await waitForTerminalJob(server.origin, (await response.json() as any).id);
    assert.equal(result.status, "completed", JSON.stringify(result));
    const { data, info } = await sharp(path.join(outputPath, "same-name.png")).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));
    assert.deepEqual([info.width, info.height], [120, 80]);
    const base = pixel(25, 25), red = pixel(25, 35), clippedText = pixel(85, 75);
    assert.ok(red[0] > base[0] + 20 && Math.abs(red[1] - base[1] / 2) < 3, `Logo alpha/aspect: ${base} → ${red}`);
    const background = pixel(105, 75);
    assert.ok(clippedText.every((channel, index) => Math.abs(channel - background[index] / 2) <= 2), `Text opacity: ${background} → ${clippedText}`);
  } finally { await server.close(); await rm(directory, { recursive: true, force: true }); }
});

test("rounded photo corners preserve background, border and photo in exported PNGs", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "partyframe-radius-"));
  const server = await startTestServer(path.join(directory, "data"));
  try {
    for (const borderSizePx of [0, 4]) {
      for (const photoRadiusPx of [0, 20]) {
        const payload = JSON.parse(customTemplate());
        Object.assign(payload.variants.horizontal, { borderSizePx, borderColor: "#ff0000", photoRadiusPx });
        const outputPath = path.join(directory, `result-${borderSizePx}-${photoRadiusPx}`);
        const photo = await sharp({ create: { width: 320, height: 240, channels: 3, background: "#2876ad" } }).jpeg().toBuffer();
        const form = new FormData();
        appendExportFields(form, photo, outputPath, 1, JSON.stringify(payload)); form.set("format", "png");
        const response = await fetch(`${server.origin}/api/export-jobs`, { method: "POST", body: form });
        assert.equal(response.status, 202);
        const result = await waitForTerminalJob(server.origin, (await response.json() as any).id);
        assert.equal(result.status, "completed");
        const { data, info } = await sharp(path.join(outputPath, "same-name.png")).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const pixel = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));
        if (photoRadiusPx) assert.deepEqual(pixel(10, 10), pixel(0, 0), "Rounded outer corner reveals background");
        else assert.notDeepEqual(pixel(10, 10), pixel(0, 0), "Zero radius keeps square corners");
        if (borderSizePx) assert.deepEqual(pixel(60, 11), [255, 0, 0], "Border remains visible at the top");
        assert.ok(pixel(60, 40).every((value, index) => Math.abs(value - [40, 118, 173][index]) < 3), "Photo remains visible at the center");
      }
    }
  } finally { await server.close(); await rm(directory, { recursive: true, force: true }); }
});

test("legacy synchronous batch endpoint keeps its result contract", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "partyframe-sync-"));
  const server = await startTestServer(path.join(directory, "data"));
  const outputPath = path.join(directory, "result");
  try {
    const form = new FormData();
    appendExportFields(form, await testJpeg(), outputPath, 1);
    const response = await fetch(`${server.origin}/api/batch-export`, { method: "POST", body: form });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("x-export-job-id") ?? "", /^[0-9a-f-]{36}$/);
    const result = await response.json() as Record<string, any>;
    assert.equal(result.success.length, 1);
    assert.equal(result.failed.length, 0);
    assert.equal(result.outputDir, outputPath);
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("running export can be cancelled without leaving partial or upload files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "partyframe-cancel-"));
  const server = await startTestServer(path.join(directory, "data"));
  const outputPath = path.join(directory, "result");
  try {
    const form = new FormData();
    appendExportFields(form, await testJpeg(320, 240), outputPath, 10, customTemplate(2_000, 1_200));
    const createResponse = await fetch(`${server.origin}/api/export-jobs`, { method: "POST", body: form });
    assert.equal(createResponse.status, 202);
    const created = await createResponse.json() as Record<string, any>;
    const cancelResponse = await fetch(`${server.origin}/api/export-jobs/${created.id}`, { method: "DELETE" });
    assert.ok(cancelResponse.status === 200 || cancelResponse.status === 202);
    const cancelled = await waitForTerminalJob(server.origin, created.id);
    assert.equal(cancelled.status, "cancelled");
    assert.ok(cancelled.progress.completed < cancelled.progress.total);
    assert.deepEqual(await readdir(server.runtime.uploadDir), []);
    if (existsSync(outputPath)) {
      assert.equal((await readdir(outputPath)).some((filename) => filename.endsWith(".partial")), false);
    }
    const repeatedCancel = await fetch(`${server.origin}/api/export-jobs/${created.id}`, { method: "DELETE" });
    assert.equal(repeatedCancel.status, 200);
    assert.equal((await repeatedCancel.json() as Record<string, any>).status, "cancelled");
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("CORS rejects non-local browser origins", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "partyframe-cors-"));
  const server = await startTestServer(path.join(directory, "data"));
  try {
    const response = await fetch(`${server.origin}/api/health`, {
      headers: { Origin: "https://evil.example" },
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json() as Record<string, any>).code, "ORIGIN_NOT_ALLOWED");
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("configured desktop session token protects sensitive APIs", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "partyframe-token-"));
  const server = await startTestServer(path.join(directory, "data"), "test-session-secret");
  try {
    assert.equal((await fetch(`${server.origin}/api/health`)).status, 200);
    const missing = await fetch(`${server.origin}/api/export-jobs`, { method: "POST" });
    assert.equal(missing.status, 401);
    assert.equal((await missing.json() as Record<string, any>).code, "SESSION_TOKEN_REQUIRED");
    const invalid = await fetch(`${server.origin}/api/export-jobs`, {
      method: "POST",
      headers: { "X-PartyFrame-Token": "wrong-secret" },
    });
    assert.equal(invalid.status, 401);
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a full export queue fails before upload and advertises a retry delay", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "partyframe-backpressure-"));
  const server = await startTestServer(path.join(directory, "data"), null, { maxPendingJobs: 1 });
  const outputPath = path.join(directory, "output");
  try {
    const form = new FormData();
    appendExportFields(form, await testJpeg(), outputPath, 200, customTemplate(1_200, 800));
    const firstResponse = await fetch(`${server.origin}/api/export-jobs`, { method: "POST", body: form });
    assert.equal(firstResponse.status, 202);
    const firstJob = await firstResponse.json() as Record<string, any>;

    const rejected = await fetch(`${server.origin}/api/export-jobs`, { method: "POST" });
    assert.equal(rejected.status, 429);
    assert.equal(rejected.headers.get("retry-after"), "3");
    assert.equal((await rejected.json() as Record<string, any>).code, "JOB_QUEUE_FULL");

    const cancelled = await fetch(`${server.origin}/api/export-jobs/${firstJob.id}`, { method: "DELETE" });
    assert.ok(cancelled.status === 200 || cancelled.status === 202);
    const terminal = await waitForTerminalJob(server.origin, firstJob.id);
    assert.equal(terminal.status, "cancelled");
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("native source path requires auth, skips upload cleanup and cannot be overwritten", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "partyframe-native-"));
  const sourcePath = path.join(directory, "source.jpg");
  const sourceBytes = await testJpeg(80, 60);
  await writeFile(sourcePath, sourceBytes);

  const unauthenticated = await startTestServer(path.join(directory, "data-no-token"));
  try {
    const disabledForm = new FormData();
    disabledForm.append("items", JSON.stringify([{
      id: "native-disabled",
      originalName: "source.jpg",
      absolutePath: sourcePath,
      orientation: "horizontal",
      crop: { offsetX: 0, offsetY: 0, zoom: 100 },
    }]));
    disabledForm.append("templateId", "custom");
    disabledForm.append("customTemplate", customTemplate());
    const disabled = await fetch(`${unauthenticated.origin}/api/export-jobs`, { method: "POST", body: disabledForm });
    assert.equal(disabled.status, 403);
    assert.equal((await disabled.json() as Record<string, any>).code, "NATIVE_PATHS_DISABLED");
  } finally {
    await unauthenticated.close();
  }

  const token = "native-test-secret";
  const server = await startTestServer(path.join(directory, "data-token"), token);
  try {
    const form = new FormData();
    form.append("items", JSON.stringify([{
      id: "native-1",
      originalName: "source.jpg",
      absolutePath: sourcePath,
      orientation: "horizontal",
      crop: { offsetX: 0, offsetY: 0, zoom: 100 },
    }]));
    form.append("templateId", "custom");
    form.append("customTemplate", customTemplate());
    form.append("format", "jpeg");
    form.append("namingPattern", "{originale}");
    form.append("outputPath", directory);
    form.append("createSubfolder", "false");
    form.append("overwrite", "true");
    const headers = { "X-PartyFrame-Token": token };
    const response = await fetch(`${server.origin}/api/export-jobs`, { method: "POST", headers, body: form });
    assert.equal(response.status, 202);
    const created = await response.json() as Record<string, any>;
    const completed = await waitForTerminalJob(server.origin, created.id, headers);
    assert.equal(completed.status, "completed");
    assert.equal(completed.result.success[0].filename, "source_01.jpg");
    assert.deepEqual(await readFile(sourcePath), sourceBytes);
    assert.equal(existsSync(path.join(directory, "source_01.jpg")), true);
    assert.deepEqual(await readdir(server.runtime.uploadDir), []);

    const processResponse = await fetch(`${server.origin}/api/process-image`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        absolutePath: sourcePath,
        templateId: "custom",
        customTemplate: JSON.parse(customTemplate()),
        orientation: "horizontal",
        offsetX: 0,
        offsetY: 0,
        zoom: 100,
      }),
    });
    assert.equal(processResponse.status, 200);
    assert.equal((await processResponse.json() as Record<string, any>).success, true);
    assert.deepEqual(await readFile(sourcePath), sourceBytes);

    const mixedOutput = path.join(directory, "mixed-output");
    const mixed = new FormData();
    mixed.append("images", new Blob([await testJpeg()], { type: "image/jpeg" }), "uploaded.jpg");
    mixed.append("items", JSON.stringify([
      {
        id: "native-mixed",
        originalName: "source.jpg",
        absolutePath: sourcePath,
        orientation: "horizontal",
        crop: { offsetX: 0, offsetY: 0, zoom: 100 },
      },
      {
        id: "upload-mixed",
        originalName: "uploaded.jpg",
        orientation: "horizontal",
        crop: { offsetX: 0, offsetY: 0, zoom: 100 },
      },
    ]));
    mixed.append("templateId", "custom");
    mixed.append("customTemplate", customTemplate());
    mixed.append("outputPath", mixedOutput);
    mixed.append("createSubfolder", "false");
    const mixedResponse = await fetch(`${server.origin}/api/export-jobs`, {
      method: "POST",
      headers,
      body: mixed,
    });
    assert.equal(mixedResponse.status, 202);
    const mixedCreated = await mixedResponse.json() as Record<string, any>;
    const mixedCompleted = await waitForTerminalJob(server.origin, mixedCreated.id, headers);
    assert.equal(mixedCompleted.status, "completed");
    assert.equal(mixedCompleted.result.success.length, 2);
    assert.deepEqual(await readdir(server.runtime.uploadDir), []);
    assert.deepEqual(await readFile(sourcePath), sourceBytes);
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
