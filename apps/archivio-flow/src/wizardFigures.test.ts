import assert from "node:assert/strict";
import test from "node:test";
import { loadCopySpeed, saveCopySpeed } from "./copySpeed.js";
import { DEFAULT_COPY_BYTES_PER_SECOND, checkSpace, describeArchivedNote, describeDuration, formatBytes, summarizeArchived } from "./wizardModel.js";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, data };
}

test("cifre: dimensioni in parole semplici", () => {
  assert.equal(formatBytes(0), "0 byte");
  assert.equal(formatBytes(950), "950 byte");
  assert.equal(formatBytes(1_500_000), "1,5 MB");
  assert.equal(formatBytes(38_400_000_000), "38,4 GB");
  assert.equal(formatBytes(120_000_000_000), "120 GB");
  assert.equal(formatBytes(1_250_000_000_000), "1,3 TB");
  assert.equal(formatBytes(-1), "—");
  assert.equal(formatBytes(Number.NaN), "—");
});

test("cifre: tempo stimato in minuti e ore", () => {
  assert.equal(describeDuration(20), "meno di un minuto");
  assert.equal(describeDuration(60), "circa 1 minuto");
  assert.equal(describeDuration(14 * 60 + 10), "circa 14 minuti");
  assert.equal(describeDuration(3600), "circa 1 ora");
  assert.equal(describeDuration(3600 + 20 * 60), "circa 1 ora e 20 minuti");
  assert.equal(describeDuration(2 * 3600 + 5 * 60), "circa 2 ore e 5 minuti");
  assert.equal(describeDuration(-5), "—");
});

test("spazio: avvisa prima di partire se il disco non basta o resta quasi pieno", () => {
  const ok = checkSpace(38e9, 210e9);
  assert.equal(ok.level, "ok");
  assert.match(ok.text, /Servono circa 38 GB, ne hai 210 GB liberi/);
  const tight = checkSpace(38e9, 38.9e9);
  assert.equal(tight.level, "tight");
  assert.match(tight.text, /quasi del tutto/);
  const insufficient = checkSpace(38e9, 30e9);
  assert.equal(insufficient.level, "insufficient");
  assert.match(insufficient.text, /libera spazio o scegli un'altra cartella/);
  assert.equal(checkSpace(30e9, 30.2e9).level, "insufficient", "serve un piccolo margine per i file di servizio");
  assert.equal(checkSpace(38e9, null).level, "unknown");
  assert.equal(checkSpace(0, null).text, "", "niente da copiare: nessun messaggio");
  assert.equal(checkSpace(0, 5e9).level, "ok");
});

test("già in archivio: riassunto con il nome del lavoro solo quando è uno", () => {
  const entries = [
    { filePath: "a", jobName: "Evento 1", size: 100 },
    { filePath: "b", jobName: "Evento 1", size: 200 },
    { filePath: "c", jobName: "Evento 2", size: 300 },
    { filePath: "d", jobName: null, size: 400 },
  ];
  const one = summarizeArchived(entries.slice(0, 2), null)!;
  assert.deepEqual([one.count, one.bytes, one.where], [2, 300, "in «Evento 1»"]);
  const two = summarizeArchived(entries.slice(0, 3), null)!;
  assert.equal(two.where, "in 2 lavori diversi");
  const unknown = summarizeArchived([entries[3]!], null)!;
  assert.equal(unknown.where, "", "lavoro non noto: nessun nome");
  const mixed = summarizeArchived([entries[0]!, entries[3]!], null)!;
  assert.equal(mixed.where, "", "se per un file il lavoro non è noto non si cita un solo nome");
  assert.equal(summarizeArchived(entries, new Set(["b", "c"]))!.count, 2, "conta solo le foto scelte");
  assert.equal(summarizeArchived(entries, new Set(["zzz"])), null);
  assert.equal(summarizeArchived([], null), null);
});

test("velocità di copia: parte prudente, impara dalle importazioni vere e ignora quelle troppo piccole", () => {
  const empty = memoryStorage();
  assert.equal(loadCopySpeed(empty), DEFAULT_COPY_BYTES_PER_SECOND);
  assert.equal(saveCopySpeed(10_000_000, 20_000, empty), null, "10 MB: troppo piccolo per misurare");
  assert.equal(saveCopySpeed(2_000_000_000, 2_000, empty), null, "2 secondi: rumore");
  assert.equal(saveCopySpeed(2_000_000_000, 40_000, empty), 50_000_000, "la prima misura vale da sola");
  assert.equal(loadCopySpeed(empty), 50_000_000);
  assert.equal(saveCopySpeed(3_000_000_000, 100_000, empty), 40_000_000, "poi si fa la media: (50 + 30) / 2");
  assert.equal(loadCopySpeed(memoryStorage({ "filex.archivio-flow.copy-speed": "abc" })), DEFAULT_COPY_BYTES_PER_SECOND);
  assert.equal(loadCopySpeed(memoryStorage({ "filex.archivio-flow.copy-speed": "10" })), DEFAULT_COPY_BYTES_PER_SECOND, "valori assurdi scartati");
  assert.equal(saveCopySpeed(2_000_000_000, 40_000, null), null, "senza storage non si rompe nulla");
  assert.equal(loadCopySpeed(null), DEFAULT_COPY_BYTES_PER_SECOND);
  const broken = { getItem: () => { throw new Error("storage bloccato"); }, setItem: () => { throw new Error("storage bloccato"); } };
  assert.equal(loadCopySpeed(broken), DEFAULT_COPY_BYTES_PER_SECOND);
});

test("già in archivio: frase corretta al singolare e al plurale, con o senza il nome del lavoro", () => {
  assert.equal(describeArchivedNote({ count: 1, bytes: 1, where: "in «Evento 1»" }), "1 foto è già in archivio (in «Evento 1»)");
  assert.equal(describeArchivedNote({ count: 1200, bytes: 1, where: "in 2 lavori diversi" }), "1200 foto sono già in archivio (in 2 lavori diversi)");
  assert.equal(describeArchivedNote({ count: 3, bytes: 1, where: "" }), "3 foto sono già in archivio");
});
