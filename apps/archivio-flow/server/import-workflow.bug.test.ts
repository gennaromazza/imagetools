import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, stat, utimes, writeFile, readdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

test("import: preparazione corrente, concorrenza, mezzanotte e confini inclusivi", async () => {
  const root = await mkdtemp(join(tmpdir(), "archivio-workflow-"));
  const sdPath = join(root, "sd");
  const archiveRoot = join(root, "archive");
  await mkdir(sdPath);
  await mkdir(archiveRoot);
  process.env.ARCHIVIO_FLOW_DATA_DIR = join(root, "data");
  process.env.ARCHIVIO_FLOW_SKIP_LEGACY_MIGRATION = "1";
  const archivio = await import("./index.js");
  try {
    archivio.saveSettings({ archiveRoot, defaultDestinazione: archiveRoot, defaultAutore: "Tester", cartellePredefinite: [], categoryMappings: [], archiveHierarchy: { yearLevel: null, categoryLevel: null, jobLevel: 1 } });
    for (const [name, date] of [
      ["evening.jpg", "2026-09-06T21:15:32.125"],
      ["night.jpg", "2026-09-07T02:30:42.500"],
      ["night-twin.jpg", "2026-09-07T02:30:42.500"],
      ["morning.jpg", "2026-09-07T09:00:00.000"],
      ["last-second.jpg", "2026-09-07T23:59:59.500"],
    ]) {
      const file = join(sdPath, name!);
      await writeFile(file, name!);
      const timestamp = new Date(date!);
      await utimes(file, timestamp, timestamp);
    }
    const first = (await stat(join(sdPath, "evening.jpg"))).mtimeMs;
    const last = (await stat(join(sdPath, "night.jpg"))).mtimeMs;
    const bounds = { mtimeFrom: new Date(Math.floor(first)).toISOString(), mtimeTo: new Date(Math.ceil(last)).toISOString() };
    const preview = await archivio.getFilterPreviewService({ sdPath, ...bounds, maxSamples: 36 });
    assert.equal(preview.matchedFiles, 3);
    const day = await archivio.getFilterPreviewService({ sdPath, mtimeFrom: "2026-09-07T00:00:00.000", mtimeTo: "2026-09-07T23:59:59.999" });
    assert.equal(day.matchedFiles, 4);
    const pageOne = await archivio.getFilterPreviewService({ sdPath, maxSamples: 2, sampleOffset: 0, groupGapHours: 6 });
    const pageTwo = await archivio.getFilterPreviewService({ sdPath, maxSamples: 2, sampleOffset: pageOne.nextSampleOffset! });
    const pageThree = await archivio.getFilterPreviewService({ sdPath, maxSamples: 2, sampleOffset: pageTwo.nextSampleOffset! });
    const allPages = [...pageOne.sampleFiles, ...pageTwo.sampleFiles, ...pageThree.sampleFiles];
    assert.equal(new Set(allPages.map((file) => file.filePath)).size, 5);
    assert.equal(pageThree.nextSampleOffset, null);
    assert.equal(pageOne.inventoryRevision, pageThree.inventoryRevision);
    assert.deepEqual(pageOne.timeGroups?.map((group) => group.fileCount), [3, 1, 1]);
    assert.equal(pageOne.timeGroups?.[0]?.lastFile.fileName.startsWith("night"), true);
    await assert.rejects(archivio.getFilterPreviewService({ sdPath, groupGapHours: 0 }));
    const request = { sdPath, nomeLavoro: "Matrimonio", dataLavoro: "2026-09-06", autore: "Tester", destinazione: archiveRoot, sottoCartella: "", rinominaFile: false, generaJpg: false };
    const pending = archivio.importService({ ...request, ...bounds, operationId: "wedding" });
    const preparing = await archivio.getImportProgressService();
    assert.equal(preparing.operationId, "wedding");
    assert.equal(preparing.active, true);
    assert.equal(preparing.copiedFiles, 0);
    assert.equal(preparing.phase, "idle");
    await assert.rejects(archivio.importService({ ...request, operationId: "overlap" }), /corso/);
    assert.equal((await archivio.getImportProgressService()).operationId, "wedding");
    const imported = await pending;
    assert.equal(imported.copiedFiles, 3);
    assert.equal(imported.job.dataLavoro, "2026-09-06");
    const next = archivio.importService({ ...request, nomeLavoro: "Comunioni", mtimeFrom: "2026-09-07T09:00:00.000", operationId: "communions" });
    const second = await archivio.getImportProgressService();
    assert.equal(second.operationId, "communions");
    assert.equal(second.copiedFiles, 0);
    assert.equal(second.currentFileName, null);
    assert.equal(second.active, true);
    assert.equal((await next).copiedFiles, 2);
    const exact = await archivio.importService({ ...request, nomeLavoro: "Solo foto scelta", selectedFilePaths: [join(sdPath, "night.jpg"), join(sdPath, "night.jpg")] });
    assert.equal(exact.copiedFiles, 1);
    assert.deepEqual((await readdir(join(exact.job.percorsoCartella, "FOTO_SD", "Tester"))).filter((name) => name.endsWith(".jpg")), ["night.jpg"]);
    const otherCard = join(root, "other-card");
    await mkdir(otherCard);
    await writeFile(join(otherCard, "another.jpg"), "seconda scheda");
    const date = new Date("2026-09-07T01:30:00");
    await utimes(join(otherCard, "another.jpg"), date, date);
    const secondCardImport = await archivio.importService({ ...request, sdPath: otherCard, existingJobId: imported.job.id, selectedFilePaths: [join(otherCard, "another.jpg")] });
    assert.equal(secondCardImport.job.id, imported.job.id);
    assert.equal(secondCardImport.job.dataLavoro, "2026-09-06");
    const history = await archivio.getStudioFlowStatusService();
    assert.ok(history.sessions.some((session) => session.jobId === imported.job.id && session.mediaStartMs === date.getTime()));
    await assert.rejects(archivio.importService({ ...request, selectedFilePaths: [] }), /50000/);
    await assert.rejects(archivio.importService({ ...request, selectedFilePaths: [join(otherCard, "another.jpg")] }), /fuori/);
    await symlink(otherCard, join(sdPath, "escape"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(archivio.importService({ ...request, selectedFilePaths: [join(sdPath, "escape", "another.jpg")] }), /fuori/);
    await assert.rejects(archivio.importService({ ...request, selectedFilePaths: [join(sdPath, "missing.jpg")] }), /non più valida/);
    await assert.rejects(archivio.importService({ ...request, ...bounds, selectedFilePaths: [join(sdPath, "night.jpg")] }), /combinata/);
    const bigCard = join(root, "paginated-card");
    await mkdir(bigCard);
    for (let offset = 0; offset < 5001; offset += 100) {
      await Promise.all(Array.from({ length: Math.min(100, 5001 - offset) }, (_, index) => writeFile(join(bigCard, `${String(offset + index).padStart(5, "0")}.jpg`), "test")));
    }
    const largeFirst = await archivio.getFilterPreviewService({ sdPath: bigCard, maxSamples: 5000, sampleOffset: 0 });
    const largeLast = await archivio.getFilterPreviewService({ sdPath: bigCard, maxSamples: 5000, sampleOffset: largeFirst.nextSampleOffset! });
    assert.equal(largeFirst.sampleFiles.length, 5000);
    assert.equal(largeLast.sampleFiles.length, 1);
    assert.equal(new Set([...largeFirst.sampleFiles, ...largeLast.sampleFiles].map((file) => file.filePath)).size, 5001);
    assert.equal(largeLast.nextSampleOffset, null);
    const changed = largeFirst.sampleFiles[0]!;
    await utimes(changed.filePath, new Date(changed.mtimeMs + 100_000), new Date(changed.mtimeMs + 100_000));
    const changedPage = await archivio.getFilterPreviewService({ sdPath: bigCard, maxSamples: 1, sampleOffset: 5000 });
    assert.notEqual(changedPage.inventoryRevision, largeFirst.inventoryRevision);
    const started = performance.now();
    let progressive = await archivio.getFilterPreviewService({ sdPath: bigCard, inventorySession: "progressive-test", sampleOffset: 0, maxSamples: 5000 });
    const firstPageMs = performance.now() - started;
    let polls = 0;
    while (!progressive.inventoryComplete && polls++ < 200) {
      await new Promise(resolve => setTimeout(resolve, 20));
      progressive = await archivio.getFilterPreviewService({ sdPath: bigCard, inventorySession: "progressive-test", sampleOffset: 0, maxSamples: 5000 });
    }
    const inventoryMs = performance.now() - started;
    assert.equal(progressive.inventoryComplete, true);
    assert.equal(progressive.matchedFiles, 5001);
    const cachedPage = await archivio.getFilterPreviewService({ sdPath: bigCard, inventorySession: "progressive-test", sampleOffset: 5000, maxSamples: 5000 });
    assert.equal(cachedPage.sampleFiles.length, 1);
    assert.equal(cachedPage.inventoryRevision, progressive.inventoryRevision);
    // Existing session is a stable browsing snapshot; explicit refresh rereads the card.
    await writeFile(join(bigCard, "new-after-scan.jpg"), "new");
    assert.equal((await archivio.getFilterPreviewService({ sdPath: bigCard, inventorySession: "progressive-test", sampleOffset: 0 })).matchedFiles, 5001);
    let refreshed = await archivio.getFilterPreviewService({ sdPath: bigCard, inventorySession: "refreshed-test", sampleOffset: 0 });
    polls = 0;
    while (!refreshed.inventoryComplete && polls++ < 200) {
      await new Promise(resolve => setTimeout(resolve, 20));
      refreshed = await archivio.getFilterPreviewService({ sdPath: bigCard, inventorySession: "refreshed-test", sampleOffset: 0 });
    }
    assert.equal(refreshed.inventoryComplete, true);
    assert.equal(refreshed.matchedFiles, 5002);
    assert.notEqual(refreshed.inventoryRevision, progressive.inventoryRevision);
    await assert.rejects(archivio.getFilterPreviewService({ sdPath: bigCard, inventorySession: "../invalid" }));
    console.log(`SD 5001 file: prima risposta ${Math.round(firstPageMs)} ms; inventario completo ${Math.round(inventoryMs)} ms.`);
    await assert.rejects(archivio.importService({ ...request, sdPath: join(root, "missing"), operationId: "invalid" }));
    assert.equal((await archivio.getImportProgressService()).active, false);
    assert.equal((await archivio.getImportProgressService()).phase, "error");
  } finally {
    archivio.closeStudioFlowStore();
    await rm(root, { recursive: true, force: true });
  }
});
