import assert from "node:assert/strict";
import test from "node:test";
import { ByteLruCache } from "./byteLruCache.js";
import { getArchivioPreviewImageUrl, hasArchivioPreviewCached } from "./archivioDesktopApi.js";
import {
  buildSdRowOffsets, buildSdRows, buildSdRowsFromOrdered, mediaCount, mediaOnly, orderSdFiles, sameSdFileList, sameSdWindow,
  virtualSdWindow, virtualSdWindowFromOffsets, type SdFile, type SdGridRow,
} from "./sdBrowserModel.js";

function files(count: number, spreadDays = 3): SdFile[] {
  const base = Date.parse("2026-09-06T08:00:00");
  return Array.from({ length: count }, (_, i) => ({
    filePath: `I:/DCIM/IMG_${String(i).padStart(6, "0")}.CR3`, fileName: `IMG_${i}.CR3`,
    mtimeMs: base + (i % spreadDays) * 86_400_000 + Math.floor(i / spreadDays) * 1000,
    size: 25_000_000 + i, ext: ".cr3", isJpg: false, mediaType: "photo",
  }));
}

/** Implementazione originale (lineare): il riferimento che la ricerca binaria deve riprodurre. */
function referenceWindow(rows: SdGridRow[], scrollTop: number, height: number) {
  const offsets = [0];
  for (const row of rows) offsets.push(offsets[offsets.length - 1]! + (row.header ? 42 : 176));
  let start = 0;
  while (start < rows.length && offsets[start + 1]! < scrollTop - 352) start++;
  let end = start;
  while (end < rows.length && offsets[end]! < scrollTop + height + 352) end++;
  return { start, end, before: offsets[start]!, after: offsets[rows.length]! - offsets[end]! };
}

test("scroll: la ricerca binaria dà la stessa finestra dell'algoritmo lineare, anche ai bordi", () => {
  for (const [count, columns] of [[0, 4], [1, 4], [7, 3], [2000, 4], [20_000, 6]] as const) {
    const rows = buildSdRows(files(count), columns);
    const offsets = buildSdRowOffsets(rows);
    const total = offsets[offsets.length - 1]!;
    const positions = [-500, 0, 1, 41, 42, 43, 351, 352, 353, total / 3, total / 2, total - 560, total - 1, total, total + 5000];
    for (const height of [0, 300, 560, 1400]) {
      for (const position of positions) {
        assert.deepEqual(virtualSdWindowFromOffsets(offsets, position, height), referenceWindow(rows, position, height), `${count} file, scroll ${position}, altezza ${height}`);
      }
    }
    assert.deepEqual(virtualSdWindow(rows, 0, 560), referenceWindow(rows, 0, 560));
  }
});

test("scroll: la finestra resta piccola e distanze spaziatori + righe coprono sempre l'altezza totale", () => {
  const rows = buildSdRows(files(20_000), 4);
  const offsets = buildSdRowOffsets(rows);
  const total = offsets[offsets.length - 1]!;
  for (const position of [0, 50_000, total - 560]) {
    const window = virtualSdWindowFromOffsets(offsets, position, 560);
    assert.ok(window.end - window.start < 15);
    assert.equal(window.before + (offsets[window.end]! - offsets[window.start]!) + window.after, total);
  }
});

test("griglia: righe da file già ordinati identiche a quelle con riordinamento", () => {
  const shuffled = files(3000, 5).reverse();
  const viaSort = buildSdRows(shuffled, 5);
  const viaOrdered = buildSdRowsFromOrdered(orderSdFiles(shuffled), 5);
  assert.deepEqual(viaOrdered.map(row => [row.date, row.header, row.files.map(file => file.filePath)]), viaSort.map(row => [row.date, row.header, row.files.map(file => file.filePath)]));
});

test("scroll: una finestra invariata non deve causare un nuovo rendering", () => {
  const rows = buildSdRows(files(20_000), 4);
  const offsets = buildSdRowOffsets(rows);
  const a = virtualSdWindowFromOffsets(offsets, 10_000, 560);
  assert.equal(sameSdWindow(a, virtualSdWindowFromOffsets(offsets, 10_001, 560)), true, "1 px di scroll resta nella stessa finestra");
  assert.equal(sameSdWindow(a, virtualSdWindowFromOffsets(offsets, 10_000 + 176, 560)), false, "una riga avanti cambia finestra");
});

test("lettura SD: la stessa pagina provvisoria viene riconosciuta senza ordinare", () => {
  const page = files(5000);
  assert.equal(sameSdFileList(page, page.map(file => ({ ...file }))), true);
  assert.equal(sameSdFileList(page, page.slice(0, 4999)), false);
  const touched = page.map(file => ({ ...file }));
  touched[4000] = { ...touched[4000]!, mtimeMs: touched[4000]!.mtimeMs + 1 };
  assert.equal(sameSdFileList(page, touched), false);
  const swapped = [...page]; [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
  assert.equal(sameSdFileList(page, swapped), false);
});

test("budget: 50.000 foto, costruzione griglia e 20.000 eventi di scroll restano rapidi", () => {
  const ordered = orderSdFiles(files(50_000, 10));
  let started = performance.now();
  const rows = buildSdRowsFromOrdered(ordered, 6);
  const offsets = buildSdRowOffsets(rows);
  const build = performance.now() - started;
  started = performance.now();
  const total = offsets[offsets.length - 1]!;
  for (let i = 0; i < 20_000; i++) virtualSdWindowFromOffsets(offsets, (i * 7919) % total, 700);
  const scroll = performance.now() - started;
  // Soglie larghe (sono ~10x il tempo atteso) per non essere fragili su macchine lente.
  assert.ok(build < 1500, `costruzione griglia ${build.toFixed(0)} ms`);
  assert.ok(scroll < 200, `20.000 scroll ${scroll.toFixed(0)} ms (era O(righe) per evento)`);
});

test("cache LRU: limiti su voci e byte, ordine d'uso e sostituzione senza deriva del conteggio", () => {
  const blob = (size: number) => ({ size });
  const byEntries = new ByteLruCache<{ size: number }>(3, 1000);
  for (const key of ["a", "b", "c"]) byEntries.set(key, blob(10));
  byEntries.get("a");
  byEntries.set("d", blob(10));
  assert.deepEqual([byEntries.has("a"), byEntries.has("b"), byEntries.has("c"), byEntries.has("d")], [true, false, true, true], "elimina il meno usato");

  const byBytes = new ByteLruCache<{ size: number }>(100, 100);
  byBytes.set("x", blob(60)); byBytes.set("y", blob(60));
  assert.equal(byBytes.has("x"), false);
  assert.equal(byBytes.totalBytes, 60);

  const replace = new ByteLruCache<{ size: number }>(10, 1000);
  replace.set("k", blob(100)); replace.set("k", blob(40));
  assert.equal(replace.totalBytes, 40);
  assert.equal(replace.count, 1);

  const single = new ByteLruCache<{ size: number }>(10, 50);
  single.set("grande", blob(500));
  assert.equal(single.has("grande"), true, "l'ultima voce non viene mai scartata da sola");
  for (let i = 0; i < 1000; i++) replace.set(`k${i % 7}`, blob(i % 13));
  assert.ok(replace.totalBytes >= 0 && replace.count <= 10);
});

test("anteprime: scorrere oltre 512 foto e tornare indietro non rifà le richieste", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  let thumbnailCalls = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { filexDesktop: {
    getThumbnail: async () => { thumbnailCalls++; return { bytes: new Uint8Array(6000), mimeType: "image/jpeg" }; },
    getArchivioPreviewImage: async () => null,
  } } });
  const urls: string[] = [];
  try {
    assert.equal(hasArchivioPreviewCached("I:/", "perf-0.jpg", "k"), false);
    for (let i = 0; i < 800; i++) {
      const url = await getArchivioPreviewImageUrl("I:/", `perf-${i}.jpg`, "k");
      if (url) urls.push(url);
    }
    assert.equal(thumbnailCalls, 800);
    assert.equal(hasArchivioPreviewCached("I:/", "perf-0.jpg", "k"), true, "la prima foto è ancora in cache dopo 800 miniature");
    assert.equal(hasArchivioPreviewCached("I:/", "perf-0.jpg", "altra-scheda"), false);
    const url = await getArchivioPreviewImageUrl("I:/", "perf-0.jpg", "k");
    if (url) urls.push(url);
    assert.equal(thumbnailCalls, 800, "tornando indietro non si rilegge la SD");
  } finally {
    urls.forEach(url => URL.revokeObjectURL(url));
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("griglia: file di servizio (.xmp, .dat) fuori dalla griglia e dai conteggi, foto e video restano", () => {
  const base = files(3);
  const mixed: SdFile[] = [
    { ...base[0]!, mediaType: "photo" },
    { ...base[1]!, filePath: "I:/DCIM/DSC01.xmp", fileName: "DSC01.xmp", ext: ".xmp", mediaType: "other" },
    { ...base[2]!, filePath: "I:/clip.mp4", fileName: "clip.mp4", ext: ".mp4", mediaType: "video" },
    { ...base[2]!, filePath: "I:/WPSettings.dat", fileName: "WPSettings.dat", ext: ".dat", mediaType: "other" },
  ];
  assert.deepEqual(mediaOnly(mixed).map(file => file.fileName), [base[0]!.fileName, "clip.mp4"]);
  assert.deepEqual(mediaOnly([]), []);
  assert.equal(mediaCount({ matchedFiles: 1620, matchedOtherFiles: 1500 }), 120);
  assert.equal(mediaCount({ matchedFiles: 10 }), 10);
  assert.equal(mediaCount({ matchedFiles: 3, matchedOtherFiles: 9 }), 0, "mai negativo");
});
