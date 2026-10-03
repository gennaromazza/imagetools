import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

async function listFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (!entry.name.startsWith(".")) result.push(relative(root, full).replace(/\\/g, "/"));
    }
  }
  await walk(root);
  return result.sort();
}

test("import: foto già archiviate in un altro evento si saltano, i sidecar seguono la foto e l'esito resta completo", async () => {
  const root = await mkdtemp(join(tmpdir(), "archivio-archived-"));
  const archiveRoot = join(root, "archive");
  const cardA = join(root, "cardA");
  const cardB = join(root, "cardB");
  for (const directory of [archiveRoot, cardA, cardB]) await mkdir(directory, { recursive: true });
  process.env.ARCHIVIO_FLOW_DATA_DIR = join(root, "data");
  process.env.ARCHIVIO_FLOW_SKIP_LEGACY_MIGRATION = "1";
  const archivio = await import("./index.js");
  try {
    archivio.saveSettings({ archiveRoot, defaultDestinazione: archiveRoot, defaultAutore: "Tester", cartellePredefinite: [], categoryMappings: [], archiveHierarchy: { yearLevel: null, categoryLevel: null, jobLevel: 1 } });
    const photoOne = "UNO-".repeat(900);
    await writeFile(join(cardA, "IMG_1.jpg"), photoOne);
    await writeFile(join(cardA, "IMG_1.xmp"), "<xmp>1</xmp>");
    await writeFile(join(cardA, "IMG_2.jpg"), "DUE-".repeat(700));
    // La scheda di backup contiene la stessa IMG_1 (con il suo .xmp) e una foto nuova.
    await writeFile(join(cardB, "IMG_1.jpg"), photoOne);
    await writeFile(join(cardB, "IMG_1.xmp"), "<xmp>1</xmp>");
    await writeFile(join(cardB, "IMG_3.jpg"), "TRE-".repeat(650));

    const base = { dataLavoro: "2026-10-02", autore: "Tester", destinazione: archiveRoot, sottoCartella: "", rinominaFile: false, generaJpg: false };

    const first = await archivio.importService({ ...base, sdPath: cardA, nomeLavoro: "Evento 1", selectedFilePaths: [join(cardA, "IMG_1.jpg")] });
    assert.equal(first.incomplete, false);
    assert.equal(first.copiedFiles, 2, "la foto scelta + il suo .xmp");
    assert.deepEqual((await listFiles(archiveRoot)).map((file) => file.split("/").at(-1)), ["IMG_1.jpg", "IMG_1.xmp"]);

    // Controllo preliminare: la scheda di backup viene riconosciuta e il lavoro è nominato.
    const preflight = await archivio.preflightService({
      sdPath: cardB, filePaths: [join(cardB, "IMG_1.jpg"), join(cardB, "IMG_3.jpg")], destinationPath: join(archiveRoot, "cartella-che-non-esiste-ancora"),
    });
    assert.equal(preflight.checkedFiles, 2);
    assert.deepEqual(preflight.archived.map((entry) => [entry.filePath, entry.jobName]), [[join(cardB, "IMG_1.jpg"), "Evento 1"]]);
    assert.ok(typeof preflight.freeBytes === "number" && preflight.freeBytes > 0);
    const outside = await archivio.preflightService({ sdPath: cardB, filePaths: [join(cardA, "IMG_1.jpg")] });
    assert.equal(outside.checkedFiles, 0, "file fuori dalla scheda indicata ignorati");

    // Secondo evento dalla scheda di backup, saltando ciò che è già in archivio.
    const second = await archivio.importService({
      ...base, sdPath: cardB, nomeLavoro: "Evento 2", selectedFilePaths: [join(cardB, "IMG_1.jpg"), join(cardB, "IMG_3.jpg")], skipArchived: true,
    });
    assert.equal(second.incomplete, false, "copiati + saltati = previsti: l'importazione è completa");
    assert.equal(second.errors.length, 0);
    assert.equal(second.copiedFiles, 1, "solo la foto nuova");
    assert.equal(second.skippedFiles, 2, "IMG_1.jpg e IMG_1.xmp erano già in archivio");
    const event2 = await listFiles(second.job.percorsoCartella);
    assert.deepEqual(event2.map((file) => file.split("/").at(-1)), ["IMG_3.jpg"]);

    // Senza la spunta, le stesse foto vengono copiate di nuovo (scelta esplicita dell'utente).
    const third = await archivio.importService({
      ...base, sdPath: cardB, nomeLavoro: "Evento 3", selectedFilePaths: [join(cardB, "IMG_1.jpg")],
    });
    assert.equal(third.copiedFiles, 2);
    assert.equal(third.skippedFiles, 0);

    // Se le foto sono già tutte in archivio, saltarle non lascia un'importazione "incompleta".
    const fourth = await archivio.importService({
      ...base, sdPath: cardB, nomeLavoro: "Evento 4", selectedFilePaths: [join(cardB, "IMG_1.jpg")], skipArchived: true,
    });
    assert.equal(fourth.copiedFiles, 0);
    assert.equal(fourth.skippedFiles, 2);
    assert.equal(fourth.incomplete, false);

    // Nome ordinato: foto e .xmp dello stesso scatto restano abbinati (Lightroom/Bridge).
    const card = join(root, "cardC");
    await mkdir(join(card, "DCIM", "100"), { recursive: true });
    await writeFile(join(card, "DCIM", "100", "DSC01.ARW"), "RAW-".repeat(500));
    await writeFile(join(card, "DCIM", "100", "DSC01.xmp"), "<xmp/>");
    const result = await archivio.importService({
      sdPath: card, nomeLavoro: "Rossi", dataLavoro: "2026-10-02", autore: "Tester", destinazione: archiveRoot, sottoCartella: "", rinominaFile: true, generaJpg: false,
      selectedFilePaths: [join(card, "DCIM", "100", "DSC01.ARW")],
    });
    assert.equal(result.copiedFiles, 2);
    const files = (await listFiles(result.job.percorsoCartella)).map((file) => file.split("/").at(-1)!);
    const raw = files.find((name) => name.endsWith(".ARW"))!;
    const xmp = files.find((name) => name.endsWith(".xmp"))!;
    assert.ok(raw && xmp);
    assert.equal(raw.replace(/\.ARW$/, ""), xmp.replace(/\.xmp$/, ""));
    assert.match(raw, /^Rossi_20261002_Tester_DSC01_[0-9a-f]{8}\.ARW$/);
  } finally {
    archivio.closeStudioFlowStore();
    await rm(root, { recursive: true, force: true });
  }
});


