if (process.env.BENCH_SET_POOL) process.env.UV_THREADPOOL_SIZE = process.env.BENCH_SET_POOL;
// Benchmark della sola fase di decodifica miniature (riga di comando, eseguito da Electron):
//   bench-thumbnail-decode.cjs <cartella> [ripetizioni] [max file]
// Confronta il percorso attuale (nativeImage sul main thread) con sharp + shrink-on-load.
const { app, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const RAW = new Set([".cr2",".cr3",".nef",".arw",".raf",".dng",".orf",".rw2",".pef",".srw"]);
const MAX = 320;
const q = (n) => Math.round(n * 10) / 10;

async function extractPreviews(dir, limit) {
  const { ExifTool } = require("exiftool-vendored");
  const et = new ExifTool({ maxProcs: 4 });
  const out = [];
  for (const f of fs.readdirSync(dir).filter((n) => !/\.xmp$/i.test(n)).slice(Number(process.env.BENCH_SKIP || 0), Number(process.env.BENCH_SKIP || 0) + limit)) {
    const p = path.join(dir, f); const ext = path.extname(f).toLowerCase();
    if (ext === ".raf" && process.env.BENCH_RAF_HEADER) { // lettura diretta dell'offset del JPEG nell'intestazione RAF
      const fd = fs.openSync(p, "r"); const h = Buffer.alloc(100); fs.readSync(fd, h, 0, 100, 0);
      const off = h.readUInt32BE(84), len = h.readUInt32BE(88); const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, off); fs.closeSync(fd);
      out.push({ name: f, buf: b }); continue;
    }
    if (RAW.has(ext)) {
      for (const tag of ["JpgFromRaw", "PreviewImage"]) {
        const b = await et.extractBinaryTagToBuffer(tag, p).catch(() => null);
        if (b && b.length > 20000) { out.push({ name: f, buf: b }); break; }
      }
    } else if ([".jpg",".jpeg"].includes(ext)) out.push({ name: f, buf: fs.readFileSync(p) });
  }
  await et.end();
  return out;
}

function currentPath(buf) { // riproduce renderThumbnailFromResolvedSource
  const img = nativeImage.createFromBuffer(buf);
  const { width, height } = img.getSize();
  const s = Math.min(1, MAX / Math.max(width, height));
  return img.resize({ width: Math.round(width * s), height: Math.round(height * s), quality: "good" }).toJPEG(72).length;
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

app.whenReady().then(async () => {
  const dir = process.argv[2]; const reps = Number(process.argv[3] || 25); const limit = Number(process.argv[4] || 200);
  const sharp = require("sharp");
  const tx = performance.now();
  const base = await extractPreviews(dir, limit);
  const ext = performance.now() - tx;
  console.log(`estrazione anteprime (exiftool, 4 processi): ${q(ext)} ms per ${base.length} file -> ${q(ext/Math.max(1,base.length))} ms/file`);
  if (!base.length) { console.log("nessun file utilizzabile"); return app.quit(); }
  const set = Array.from({ length: base.length * reps }, (_, i) => base[i % base.length]);
  const meta = await sharp(base[0].buf).metadata();
  console.log(`anteprime: ${base.length} (${meta.width}x${meta.height}, ${q(base[0].buf.length/1024)} KB) x${reps} = ${set.length} decodifiche, cpu=${require("os").availableParallelism()}`);

  let t = performance.now();
  for (const s of set) currentPath(s.buf);
  const cur = performance.now() - t;
  console.log(`ATTUALE nativeImage (main thread, seriale): ${q(cur)} ms  -> ${q(cur/set.length)} ms/foto, ${q(set.length/(cur/1000))} foto/s`);

  const run = async (conc) => {
    t = performance.now();
    await pool(set, conc, (s) => sharp(s.buf, { failOn: "none" }).rotate().resize(MAX, MAX, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer());
    const d = performance.now() - t;
    console.log(`sharp shrink-on-load, concorrenza ${String(conc).padStart(2)}: ${q(d)} ms -> ${q(d/set.length)} ms/foto, ${q(set.length/(d/1000))} foto/s`);
  };
  for (const c of [1, 4, 8, 16]) await run(c);
  app.quit();
});
