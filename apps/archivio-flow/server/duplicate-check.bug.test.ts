import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { freeSpaceFor } from "./disk-space.js";
import { findArchivedFiles, jobNameForPath, type DuplicateCheckDeps } from "./duplicate-check.js";

interface Fixture { deps: DuplicateCheckDeps & { counters: { fingerprints: number; fullHashes: number; maxParallel: number } }; root: string }

function fixture(options: { archived: Record<string, { size: number; content: string }>; evidence: Record<string, string>; withFullHash?: boolean; allowed?: (p: string) => boolean }): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archivio-dup-"));
  const counters = { fingerprints: 0, fullHashes: 0, maxParallel: 0 };
  let parallel = 0;
  const knownSizes = new Set(Object.values(options.archived).map((value) => value.size));
  const deps: DuplicateCheckDeps & { counters: typeof counters } = {
    counters,
    knownSizes,
    findEvidence: (size, fingerprint) => Object.entries(options.evidence)
      .filter(([key]) => key === `${size}:${fingerprint}`)
      .map(([, destinationPath]) => ({ destinationPath, sessionId: "session-1" })),
    fingerprint: async (filePath) => {
      counters.fingerprints += 1;
      parallel += 1; counters.maxParallel = Math.max(counters.maxParallel, parallel);
      await new Promise((resolve) => setTimeout(resolve, 5));
      parallel -= 1;
      return fs.readFileSync(filePath, "utf8").slice(0, 8);
    },
    stat: async (filePath) => fs.promises.stat(filePath),
    fullHash: options.withFullHash ? async (filePath) => { counters.fullHashes += 1; return fs.readFileSync(filePath, "utf8"); } : undefined,
    isAllowedDestination: options.allowed,
  };
  return { deps, root };
}

function write(root: string, name: string, content: string): string {
  const full = path.join(root, name);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

test("duplicati: una scheda nuova non legge nulla (le dimensioni non coincidono con l'archivio)", async () => {
  const { deps, root } = fixture({ archived: { a: { size: 999, content: "" } }, evidence: {} });
  const files = [write(root, "sd/1.jpg", "contenuto-1"), write(root, "sd/2.jpg", "contenuto-22")];
  assert.deepEqual(await findArchivedFiles(files, deps), []);
  assert.equal(deps.counters.fingerprints, 0, "nessuna lettura per file di dimensione sconosciuta");
});

test("duplicati: una scheda di backup già scaricata in un altro evento viene riconosciuta", async () => {
  const content = "AAAAAAAA-resto-del-file";
  const probe = fixture({ archived: {}, evidence: {} });
  const archived = write(probe.root, "archivio/Evento 1/FOTO_SD/Tester/IMG_1.jpg", content);
  const backup = write(probe.root, "backup-sd/IMG_1.jpg", content);
  const newFile = write(probe.root, "backup-sd/IMG_2.jpg", "BBBBBBBB-altro-contenuto-più-lungo");
  const { deps } = fixture({ archived: { x: { size: Buffer.byteLength(content), content } }, evidence: { [`${Buffer.byteLength(content)}:AAAAAAAA`]: archived }, withFullHash: true });
  const matches = await findArchivedFiles([backup, newFile], deps);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]!.filePath, backup);
  assert.equal(matches[0]!.destinationPath, archived);
  assert.equal(matches[0]!.sessionId, "session-1");
  assert.equal(deps.counters.fingerprints, 1, "solo il file con dimensione nota viene letto");
  assert.equal(deps.counters.fullHashes, 2, "conferma completa di sorgente e destinazione");
});

test("duplicati: stessa impronta ma contenuto diverso = non è un duplicato (con conferma), è probabile (senza)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archivio-dup-"));
  const archived = write(root, "archivio/IMG_1.jpg", "AAAAAAAA-versione-vecchia");
  const source = write(root, "sd/IMG_1.jpg", "AAAAAAAA-versione-nuova!!");
  const size = Buffer.byteLength("AAAAAAAA-versione-vecchia");
  assert.equal(Buffer.byteLength("AAAAAAAA-versione-nuova!!"), size, "stessa dimensione: il caso insidioso");
  const strict = fixture({ archived: { x: { size, content: "" } }, evidence: { [`${size}:AAAAAAAA`]: archived }, withFullHash: true });
  assert.deepEqual(await findArchivedFiles([source], strict.deps), []);
  const loose = fixture({ archived: { x: { size, content: "" } }, evidence: { [`${size}:AAAAAAAA`]: archived } });
  assert.equal((await findArchivedFiles([source], loose.deps)).length, 1, "per l'etichetta in griglia basta l'impronta");
});

test("duplicati: destinazione sparita, di dimensione diversa o fuori archivio non conta come prova", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archivio-dup-"));
  const source = write(root, "sd/IMG_1.jpg", "AAAAAAAA-contenuto");
  const size = Buffer.byteLength("AAAAAAAA-contenuto");
  const key = `${size}:AAAAAAAA`;
  const missing = fixture({ archived: { x: { size, content: "" } }, evidence: { [key]: path.join(root, "non-esiste.jpg") }, withFullHash: true });
  assert.deepEqual(await findArchivedFiles([source], missing.deps), []);
  const shorter = write(root, "archivio/corto.jpg", "AAAAAAAA");
  const wrongSize = fixture({ archived: { x: { size, content: "" } }, evidence: { [key]: shorter } });
  assert.deepEqual(await findArchivedFiles([source], wrongSize.deps), []);
  const archived = write(root, "fuori/IMG_1.jpg", "AAAAAAAA-contenuto");
  const outside = fixture({ archived: { x: { size, content: "" } }, evidence: { [key]: archived }, allowed: () => false });
  assert.deepEqual(await findArchivedFiles([source], outside.deps), []);
  const unreadable = fixture({ archived: { x: { size, content: "" } }, evidence: { [key]: archived } });
  assert.deepEqual(await findArchivedFiles([path.join(root, "manca.jpg")], unreadable.deps), [], "file sorgente illeggibile: nessun errore, nessuna prova");
});

test("duplicati: rispetta la concorrenza richiesta e si ferma su annullamento", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archivio-dup-"));
  const files = Array.from({ length: 12 }, (_, i) => write(root, `sd/${i}.jpg`, "AAAAAAAA-x"));
  const size = Buffer.byteLength("AAAAAAAA-x");
  const archived = write(root, "archivio/a.jpg", "AAAAAAAA-x");
  const { deps } = fixture({ archived: { x: { size, content: "" } }, evidence: { [`${size}:AAAAAAAA`]: archived } });
  const matches = await findArchivedFiles(files, deps, { concurrency: 3 });
  assert.equal(matches.length, 12);
  assert.ok(deps.counters.maxParallel <= 3 && deps.counters.maxParallel >= 2, `parallelismo ${deps.counters.maxParallel}`);
  assert.deepEqual(matches.map((match) => match.filePath), files, "stesso ordine dell'elenco");
  const cancelled = fixture({ archived: { x: { size, content: "" } }, evidence: { [`${size}:AAAAAAAA`]: archived } });
  assert.deepEqual(await findArchivedFiles(files, cancelled.deps, { isCancelled: () => true }), []);
  assert.deepEqual(await findArchivedFiles([], deps), []);
});

test("duplicati: il lavoro a cui appartiene un file è la cartella più specifica, senza confondere nomi simili", () => {
  const jobs = [
    { nomeLavoro: "Evento 1", percorsoCartella: "D:\\Archivio\\2026\\Evento 1" },
    { nomeLavoro: "Evento 10", percorsoCartella: "D:\\Archivio\\2026\\Evento 10" },
    { nomeLavoro: "Archivio 2026", percorsoCartella: "D:\\Archivio\\2026" },
  ];
  assert.equal(jobNameForPath("D:\\Archivio\\2026\\Evento 1\\FOTO_SD\\Tester\\IMG.jpg", jobs), "Evento 1");
  assert.equal(jobNameForPath("d:/archivio/2026/evento 10/FOTO/IMG.jpg", jobs), "Evento 10");
  assert.equal(jobNameForPath("D:\\Archivio\\2026\\Evento 11\\IMG.jpg", jobs), "Archivio 2026", "Evento 11 non è Evento 1");
  assert.equal(jobNameForPath("E:\\Altro\\IMG.jpg", jobs), null);
  assert.equal(jobNameForPath("D:\\Archivio\\2026\\Evento 1", jobs), "Evento 1", "la cartella stessa");
});

test("spazio libero: sale fino alla prima cartella esistente e rifiuta input assurdi", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archivio-space-"));
  const direct = await freeSpaceFor(dir);
  assert.ok(direct && direct.freeBytes > 0 && direct.totalBytes >= direct.freeBytes);
  const deep = await freeSpaceFor(path.join(dir, "non", "esiste", "ancora"));
  assert.ok(deep && deep.freeBytes > 0, "la destinazione verrà creata: conta il disco della cartella esistente");
  assert.equal(await freeSpaceFor(""), null);
  assert.equal(await freeSpaceFor("a\0b"), null);
  assert.equal(await freeSpaceFor(undefined as unknown as string), null);
});
