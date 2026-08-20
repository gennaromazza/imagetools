import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

test("safe-to-format è fail-closed per file extra, contenuto cambiato e destinazione mancante", async () => {
  const root = await mkdtemp(join(tmpdir(), "studioflow-safe-"));
  const dataDir = join(root, "data");
  const archiveRoot = join(root, "archive");
  const sdRoot = join(root, "sd");
  await mkdir(archiveRoot, { recursive: true });
  await mkdir(sdRoot, { recursive: true });
  await writeFile(join(sdRoot, "a.jpg"), "AAAA", "utf8");
  await writeFile(join(sdRoot, "b.jpg"), "BBBB", "utf8");
  process.env.ARCHIVIO_FLOW_DATA_DIR = dataDir;
  process.env.ARCHIVIO_FLOW_SKIP_LEGACY_MIGRATION = "1";
  let archivio: any = null;
  try {
    archivio = await import("./index.js");
    archivio.saveSettings({
      archiveRoot, defaultDestinazione: archiveRoot, defaultAutore: "Tester", cartellePredefinite: [],
      archiveHierarchy: { yearLevel: null, categoryLevel: null, jobLevel: 1 },
    });
    const snapshotOne = await archivio.captureCardSnapshot(sdRoot);
    const snapshotAgain = await archivio.captureCardSnapshot(sdRoot);
    assert.equal(snapshotOne.id, snapshotAgain.id);
    assert.equal(snapshotOne.contentFingerprint, snapshotAgain.contentFingerprint);
    await writeFile(join(sdRoot, "a.jpg"), "CCCC", "utf8");
    const changedSnapshot = await archivio.captureCardSnapshot(sdRoot);
    assert.equal(changedSnapshot.cardId, snapshotOne.cardId);
    assert.notEqual(changedSnapshot.contentFingerprint, snapshotOne.contentFingerprint);
    await writeFile(join(sdRoot, "a.jpg"), "AAAA", "utf8");
    const imported = await archivio.importService({
      sdPath:sdRoot, nomeLavoro:"Safety", dataLavoro:"2026-08-20", autore:"Tester",
      destinazione:archiveRoot, sottoCartella:"", rinominaFile:false, generaJpg:false,
    });
    assert.equal((await archivio.checkSafeToFormatService(sdRoot)).status, "SAFE");

    await writeFile(join(sdRoot, "extra.jpg"), "EXTRA", "utf8");
    const partialExtra = await archivio.checkSafeToFormatService(sdRoot);
    assert.equal(partialExtra.status, "PARTIAL");
    assert.equal(partialExtra.unknownFiles, 1);
    await unlink(join(sdRoot, "extra.jpg"));

    await writeFile(join(sdRoot, "a.jpg"), "ZZZZ", "utf8");
    const changedContent = await archivio.checkSafeToFormatService(sdRoot);
    assert.equal(changedContent.status, "PARTIAL");
    assert.equal(changedContent.verifiedFiles, 1);

    await writeFile(join(sdRoot, "a.jpg"), "AAAA", "utf8");
    await unlink(join(imported.cartellaFotoFinale, "a.jpg"));
    const missingDestination = await archivio.checkSafeToFormatService(sdRoot);
    assert.equal(missingDestination.status, "PARTIAL");

    const unknownSd = join(root, "unknown-sd");
    await mkdir(unknownSd);
    await writeFile(join(unknownSd, "never-imported.jpg"), "NEW", "utf8");
    assert.equal((await archivio.checkSafeToFormatService(unknownSd)).status, "UNSAFE");

    assert.deepEqual(await readFile(join(sdRoot, "b.jpg")), Buffer.from("BBBB"));
  } finally {
    archivio?.closeStudioFlowStore();
    await rm(root, { recursive: true, force: true });
  }
});
