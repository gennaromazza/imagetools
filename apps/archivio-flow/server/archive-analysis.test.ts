import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import sharp from "sharp";

test("maps an external job and renames it only after explicit confirmation", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "archivio-flow-analysis-"));
  const dataDir = join(testRoot, "data");
  const archiveRoot = join(testRoot, "archive");
  const currentFolder = join(archiveRoot, "2024", "Matrimoni", "Matrimonio Mario e Anna 21-06-2024");
  const expectedFolder = join(archiveRoot, "2024", "Matrimoni", "2024-06-21 - Mario e Anna - 21-06-2024");

  await mkdir(join(currentFolder, "FOTO_SD", "Original"), { recursive: true });
  await writeFile(join(currentFolder, "FOTO_SD", "Original", "existing.txt"), "existing", "utf8");
  process.env.ARCHIVIO_FLOW_DATA_DIR = dataDir;
  process.env.ARCHIVIO_FLOW_SKIP_LEGACY_MIGRATION = "1";

  let archivio: any = null;
  try {
    archivio = await import("./index.js");
    archivio.saveSettings({
      archiveRoot,
      defaultDestinazione: archiveRoot,
      defaultAutore: "",
      cartellePredefinite: [],
      archiveHierarchy: { yearLevel: 1, categoryLevel: 2, jobLevel: 3 },
    });

    const analysis = await archivio.analyzeArchive();
    assert.deepEqual(analysis.warnings, []);
    assert.equal(analysis.registeredJobs, 1);
    assert.equal(analysis.renameReadyJobs, 1);
    assert.equal(analysis.items[0]?.currentFolderPath, currentFolder);
    assert.equal(analysis.items[0]?.proposedFolderPath, expectedFolder);
    const indexed = await archivio.getStudioFlowStatusService();
    assert.equal(indexed.archiveIndex.state, "ready");
    assert.ok(indexed.archiveIndex.fileCount >= 1);
    assert.equal(existsSync(join(dataDir, "settings.json")), false);

    const persistedScanAt = indexed.archiveIndex.lastFullScanAt;
    assert.ok(persistedScanAt);
    await new Promise((resolve) => setTimeout(resolve, 25));
    await archivio.listJobsService();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const afterListLoad = await archivio.getStudioFlowStatusService();
    assert.equal(
      afterListLoad.archiveIndex.lastFullScanAt,
      persistedScanAt,
      "caricare la lista lavori non deve ricostruire un indice già persistito",
    );

    const jobId = analysis.items[0]?.jobId;
    assert.ok(jobId);
    const renamePromise = archivio.renameAnalyzedArchiveJobs([jobId]);
    await assert.rejects(
      archivio.renameAnalyzedArchiveJobs([jobId]),
      /rinomina dell'archivio e gia in corso/i,
    );
    const result = await renamePromise;
    assert.equal(result.renamed.length, 1);
    assert.equal(existsSync(currentFolder), false);
    assert.equal(existsSync(expectedFolder), true);

    const jobs = await archivio.listJobsService();
    assert.equal(jobs[0]?.id, jobId);
    assert.equal(jobs[0]?.percorsoCartella, expectedFolder);
    assert.equal(jobs[0]?.numeroFile, 1);
    const renameProgress = archivio.getArchiveRenameProgress();
    assert.equal(renameProgress.phase, "completed");
    assert.equal(renameProgress.active, false);
    assert.equal(renameProgress.completed, 1);
    assert.equal(renameProgress.renamedCount, 1);
    const afterRenameStatus = await archivio.getStudioFlowStatusService();
    assert.equal(
      afterRenameStatus.archiveIndex.lastFullScanAt,
      persistedScanAt,
      "la conferma della rinomina non deve forzare una nuova scansione completa",
    );

    const manualFolder = join(archiveRoot, "2025", "Eventi", "Cliente Senza Data");
    const repairedManualFolder = join(archiveRoot, "2025", "Eventi", "2025-05-06 - Cliente Sistemato - 06-05-2025");
    await mkdir(join(manualFolder, "FOTO_SD"), { recursive: true });
    await writeFile(join(manualFolder, "FOTO_SD", "nuovo.txt"), "nuovo", "utf8");
    const beforeIncremental = await archivio.getStudioFlowStatusService();
    await archivio.refreshArchiveIndexSubtree(manualFolder);
    const afterIncremental = await archivio.getStudioFlowStatusService();
    assert.equal(
      afterIncremental.archiveIndex.lastFullScanAt,
      persistedScanAt,
      "un nuovo lavoro deve aggiornare solo il proprio sottoalbero",
    );
    assert.equal(afterIncremental.archiveIndex.fileCount, beforeIncremental.archiveIndex.fileCount + 1);
    const manualAnalysis = await archivio.analyzeArchive();
    const afterIncrementalAnalysis = await archivio.getStudioFlowStatusService();
    assert.equal(
      afterIncrementalAnalysis.archiveIndex.lastFullScanAt,
      persistedScanAt,
      "il controllo nomi non deve ripetere una scansione completa quando l'indice esiste",
    );
    const manualItem = manualAnalysis.items.find((item: any) => item.currentFolderPath === manualFolder);
    assert.ok(manualItem);
    assert.equal(manualItem.status, "needs-review");
    const manualRename = await archivio.renameAnalyzedArchiveJobs([{
      jobId: manualItem.jobId,
      nomeLavoro: "Cliente Sistemato",
      dataLavoro: "2025-05-06",
    }]);
    assert.equal(manualRename.renamed.length, 1);
    assert.equal(existsSync(manualFolder), false);
    assert.equal(existsSync(repairedManualFolder), true);

    const sdPath = join(testRoot, "sd");
    await mkdir(sdPath, { recursive: true });
    await sharp({
      create: { width: 32, height: 24, channels: 3, background: { r: 80, g: 120, b: 160 } },
    }).jpeg().toFile(join(sdPath, "photo.jpg"));

    const externalImport = await archivio.importService({
      sdPath,
      nomeLavoro: "",
      dataLavoro: "2026-08-04",
      autore: "Tester",
      destinazione: "",
      sottoCartella: "",
      existingJobId: jobId,
      rinominaFile: true,
      generaJpg: false,
    });
    assert.equal(externalImport.incomplete, false);
    assert.equal(existsSync(join(dataDir, "jobs.json")), false);
    const safeAfterArchiveImport = await archivio.checkSafeToFormatService(sdPath);
    assert.equal(safeAfterArchiveImport.status, "SAFE");
    const externalNames = await readdir(externalImport.cartellaFotoFinale);
    assert.ok(externalNames.some((name) => name.startsWith("MarioeAnna_20240621_Tester_photo_")));

    const refreshedExternalJobs = await archivio.listJobsService();
    assert.equal(refreshedExternalJobs.find((job: any) => job.id === jobId)?.numeroFile, 2);

    await assert.rejects(
      archivio.importService({
        sdPath,
        nomeLavoro: "Destinazione pericolosa",
        dataLavoro: "2026-08-04",
        autore: "Tester",
        destinazione: sdPath,
        sottoCartella: "",
        rinominaFile: false,
        generaJpg: false,
      }),
      /destinazione non puo trovarsi dentro la SD/i,
    );

    const importRoot = join(testRoot, "imports");
    const firstImport = await archivio.importService({
      sdPath,
      nomeLavoro: "Prova nomi originali",
      dataLavoro: "2026-08-04",
      autore: "Tester",
      destinazione: importRoot,
      sottoCartella: "",
      rinominaFile: false,
      generaJpg: false,
    });
    assert.equal(existsSync(join(firstImport.cartellaFotoFinale, "photo.jpg")), true);
    const safeAfterImport = await archivio.checkSafeToFormatService(sdPath);
    assert.equal(safeAfterImport.status, "SAFE");
    assert.equal(safeAfterImport.verifiedFiles, 1);

    const videoSdPath = join(testRoot, "video-sd");
    await mkdir(videoSdPath, { recursive: true });
    await writeFile(join(videoSdPath, "clip.mov"), "video-test-content", "utf8");
    const videoImport = await archivio.importService({
      sdPath: videoSdPath,
      nomeLavoro: "Prova video",
      dataLavoro: "2026-08-04",
      autore: "Tester",
      destinazione: archiveRoot,
      sottoCartella: "Cerimonia",
      rinominaFile: false,
      generaJpg: false,
    });
    assert.equal(existsSync(join(videoImport.job.percorsoCartella, "VIDEO_SD", "Tester", "Cerimonia", "clip.mov")), true);
    assert.equal(videoImport.job.numeroFile, 1);
    const safeAfterVideoImport = await archivio.checkSafeToFormatService(videoSdPath);
    assert.equal(safeAfterVideoImport.status, "SAFE");

    const secondImport = await archivio.importService({
      sdPath,
      nomeLavoro: "",
      dataLavoro: "2026-08-04",
      autore: "Tester",
      destinazione: "",
      sottoCartella: "",
      existingJobId: firstImport.job.id,
      rinominaFile: false,
      generaJpg: true,
    });
    assert.equal(secondImport.skippedFiles, 1);
    assert.equal(secondImport.jpgGenerati, 1);
    assert.equal(existsSync(join(firstImport.job.percorsoCartella, "BASSA_QUALITA", "Tester", "photo.jpg")), true);

    const importedPhotoPath = join(firstImport.cartellaFotoFinale, "photo.jpg");
    const sourcePhotoPath = join(sdPath, "photo.jpg");
    const originalCardSnapshot = await archivio.captureCardSnapshot(sdPath);
    const sourceBytes = await readFile(sourcePhotoPath);
    await writeFile(sourcePhotoPath, Buffer.alloc(sourceBytes.length, 0));
    const reusedCardSnapshot = await archivio.captureCardSnapshot(sdPath);
    assert.equal(reusedCardSnapshot.cardId, originalCardSnapshot.cardId);
    assert.notEqual(reusedCardSnapshot.id, originalCardSnapshot.id);
    assert.notEqual(reusedCardSnapshot.contentFingerprint, originalCardSnapshot.contentFingerprint);
    const unsafeAfterSourceChange = await archivio.checkSafeToFormatService(sdPath);
    assert.equal(unsafeAfterSourceChange.status, "UNSAFE");
    const repairedImport = await archivio.importService({
      sdPath,
      nomeLavoro: "",
      dataLavoro: "2026-08-04",
      autore: "Tester",
      destinazione: "",
      sottoCartella: "",
      existingJobId: firstImport.job.id,
      rinominaFile: false,
      generaJpg: false,
    });
    assert.equal(repairedImport.copiedFiles, 1);
    assert.deepEqual(await readFile(importedPhotoPath), await readFile(sourcePhotoPath));
    const safeAfterRepair = await archivio.checkSafeToFormatService(sdPath);
    assert.equal(safeAfterRepair.status, "UNSAFE");

    await assert.rejects(archivio.generateLowQualityService("missing-job", false), /Lavoro non trovato/);
    const lowQualityAfterError = await archivio.generateLowQualityService(firstImport.job.id, false);
    assert.equal(lowQualityAfterError.ok, true);
  } finally {
    archivio?.closeStudioFlowStore();
    const resolvedTempRoot = tmpdir().toLowerCase();
    const resolvedTestRoot = testRoot.toLowerCase();
    assert.ok(resolvedTestRoot.startsWith(`${resolvedTempRoot}\\`) || resolvedTestRoot.startsWith(`${resolvedTempRoot}/`));
    await rm(testRoot, { recursive: true });
  }
});
