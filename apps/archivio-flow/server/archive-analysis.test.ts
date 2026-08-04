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

  try {
    const archivio = await import("./index.js");
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

    const jobId = analysis.items[0]?.jobId;
    assert.ok(jobId);
    const result = await archivio.renameAnalyzedArchiveJobs([jobId]);
    assert.equal(result.renamed.length, 1);
    assert.equal(existsSync(currentFolder), false);
    assert.equal(existsSync(expectedFolder), true);

    const jobs = await archivio.listJobsService();
    assert.equal(jobs[0]?.id, jobId);
    assert.equal(jobs[0]?.percorsoCartella, expectedFolder);
    assert.equal(jobs[0]?.numeroFile, 1);

    const manualFolder = join(archiveRoot, "2025", "Eventi", "Cliente Senza Data");
    const repairedManualFolder = join(archiveRoot, "2025", "Eventi", "2025-05-06 - Cliente Sistemato - 06-05-2025");
    await mkdir(join(manualFolder, "FOTO_SD"), { recursive: true });
    const manualAnalysis = await archivio.analyzeArchive();
    const manualItem = manualAnalysis.items.find((item) => item.currentFolderPath === manualFolder);
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
    const externalNames = await readdir(externalImport.cartellaFotoFinale);
    assert.ok(externalNames.some((name) => name.startsWith("MarioeAnna_20240621_Tester_photo_")));

    const refreshedExternalJobs = await archivio.listJobsService();
    assert.equal(refreshedExternalJobs.find((job) => job.id === jobId)?.numeroFile, 2);

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
    const sourceBytes = await readFile(sourcePhotoPath);
    await writeFile(sourcePhotoPath, Buffer.alloc(sourceBytes.length, 0));
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

    await assert.rejects(archivio.generateLowQualityService("missing-job", false), /Lavoro non trovato/);
    const lowQualityAfterError = await archivio.generateLowQualityService(firstImport.job.id, false);
    assert.equal(lowQualityAfterError.ok, true);
  } finally {
    const resolvedTempRoot = tmpdir().toLowerCase();
    const resolvedTestRoot = testRoot.toLowerCase();
    assert.ok(resolvedTestRoot.startsWith(`${resolvedTempRoot}\\`) || resolvedTestRoot.startsWith(`${resolvedTempRoot}/`));
    await rm(testRoot, { recursive: true });
  }
});
