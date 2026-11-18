import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import sharp from "sharp";
import { applyColorToJpeg, hasOriginalBackup, isJpegPath, originalBackupPath, parseColorTransform, restoreOriginalJpeg } from "./photo-color-service.js";

/** Il modello di Album Flow (una sola matematica per schermo, esportazione e file): si carica da lì per provare che il file esce uguale. */
async function albumModel() {
  const path = resolve(process.cwd(), "apps", "album-flow", "src", "model", "colorAdjust.ts");
  return (await import(pathToFileURL(path).href)) as {
    colorTransform: (adjust: Record<string, number>) => { slope: number[]; intercept: number[]; saturation: number };
    saturationMatrix: (saturation: number) => number[][];
    applyTransform: (r: number, g: number, b: number, transform: unknown) => number[];
  };
}

async function workspace() {
  const dir = await fs.mkdtemp(join(tmpdir(), "af-color-"));
  return { dir, backups: join(dir, "backups"), done: () => fs.rm(dir, { recursive: true, force: true }) };
}

/** Foto di prova 48×32: colori vari e sfumati, con l'orientamento EXIF 6 (da ruotare di 90°) per vedere che non viene toccato. */
async function sampleJpeg(file: string): Promise<Buffer> {
  const width = 48;
  const height = 32;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const i = (y * width + x) * 3;
    raw[i] = 40 + Math.round((x / width) * 150);
    raw[i + 1] = 60 + Math.round((y / height) * 110);
    raw[i + 2] = 200 - Math.round(((x + y) / (width + height)) * 120);
  }
  const bytes = await sharp(raw, { raw: { width, height, channels: 3 } }).withMetadata({ orientation: 6 }).jpeg({ quality: 100, chromaSubsampling: "4:4:4" }).toBuffer();
  await fs.writeFile(file, bytes);
  return bytes;
}

async function pixelsOf(buffer: Buffer) {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

const toInput = (model: Awaited<ReturnType<typeof albumModel>>, adjust: Record<string, number>) => {
  const t = model.colorTransform(adjust);
  return { matrix: model.saturationMatrix(t.saturation).flat(), slope: t.slope, intercept: t.intercept };
};

test("correzione sul file: il JPG esce come lo calcola il modello di Album Flow (stessa matematica di schermo ed esportazione)", async () => {
  const model = await albumModel();
  const ws = await workspace();
  try {
    const file = join(ws.dir, "foto.jpg");
    const original = await sampleJpeg(file);
    const adjust = { brightness: 25, contrast: 30, saturation: -20, temperature: 35, tint: -15 };
    const result = await applyColorToJpeg(file, toInput(model, adjust), ws.backups);
    assert.equal(result.ok, true, result.message);
    const before = await pixelsOf(original);
    const after = await pixelsOf(await fs.readFile(file));
    assert.deepEqual([after.width, after.height], [before.width, before.height], "dimensioni invariate");
    const transform = model.colorTransform(adjust);
    let worst = 0;
    let total = 0;
    for (let i = 0; i < before.data.length; i += 3) {
      const expected = model.applyTransform(before.data[i] / 255, before.data[i + 1] / 255, before.data[i + 2] / 255, transform);
      for (let c = 0; c < 3; c += 1) {
        const difference = Math.abs(after.data[i + c] - Math.round(expected[c] * 255));
        worst = Math.max(worst, difference);
        total += difference;
      }
    }
    // Una decina di livelli su 255 sarebbe un ordine diverso dei passaggi; qui restano il tondo a 8 bit tra i due passaggi e la ricompressione JPEG.
    assert.ok(worst <= 6, `differenza massima dal modello: ${worst} livelli`);
    assert.ok(total / before.data.length < 1.5, `differenza media dal modello: ${(total / before.data.length).toFixed(2)} livelli`);
    const changed = before.data.some((value, index) => Math.abs(value - after.data[index]) > 8);
    assert.ok(changed, "la foto è davvero cambiata");
  } finally { await ws.done(); }
});

test("correzione sul file: orientamento EXIF e metadati restano, la copia di sicurezza si fa una volta sola e si può ripristinare", async () => {
  const model = await albumModel();
  const ws = await workspace();
  try {
    const file = join(ws.dir, "ritratto.jpeg");
    const original = await sampleJpeg(file);
    assert.equal(await hasOriginalBackup(file, ws.backups), false);
    const first = await applyColorToJpeg(file, toInput(model, { brightness: 20 }), ws.backups);
    assert.equal(first.ok, true, first.message);
    assert.equal((await sharp(await fs.readFile(file)).metadata()).orientation, 6, "l'orientamento resta quello del file");
    assert.equal(await hasOriginalBackup(file, ws.backups), true);
    assert.deepEqual(await fs.readFile(originalBackupPath(file, ws.backups)), original, "la copia è il file di partenza, byte per byte");
    const second = await applyColorToJpeg(file, toInput(model, { contrast: 40 }), ws.backups);
    assert.equal(second.ok, true, second.message);
    assert.deepEqual(await fs.readFile(originalBackupPath(file, ws.backups)), original, "una seconda correzione non sostituisce la copia di sicurezza");
    assert.deepEqual((await fs.readdir(ws.dir)).filter((name) => name.endsWith(".tmp")), [], "nessun file temporaneo rimasto");
    const restored = await restoreOriginalJpeg(file, ws.backups);
    assert.equal(restored.ok, true, restored.message);
    assert.deepEqual(await fs.readFile(file), original, "ripristino identico all'originale");
  } finally { await ws.done(); }
});

test("correzione sul file: rifiuta file non JPG, valori fuori scala, file mancanti e ripristini senza copia", async () => {
  const model = await albumModel();
  const ws = await workspace();
  try {
    const png = join(ws.dir, "foto.png");
    await fs.writeFile(png, await sharp({ create: { width: 4, height: 4, channels: 3, background: "#808080" } }).png().toBuffer());
    assert.equal((await applyColorToJpeg(png, toInput(model, { brightness: 10 }), ws.backups)).ok, false, "PNG non ammesso");
    const fake = join(ws.dir, "finta.jpg");
    const notAnImage = Buffer.from("questo non e' un'immagine");
    await fs.writeFile(fake, notAnImage);
    assert.equal((await applyColorToJpeg(fake, toInput(model, { brightness: 10 }), ws.backups)).ok, false, "un file che non è un JPG non si tocca");
    assert.deepEqual(await fs.readFile(fake), notAnImage);
    const good = join(ws.dir, "buona.jpg");
    await sampleJpeg(good);
    const bad = { matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], slope: [1, 1, 40], intercept: [0, 0, 0] };
    assert.equal((await applyColorToJpeg(good, bad, ws.backups)).ok, false, "pendenza fuori scala");
    assert.equal(await hasOriginalBackup(good, ws.backups), false, "un rifiuto non lascia copie");
    assert.equal((await applyColorToJpeg(join(ws.dir, "manca.jpg"), toInput(model, { tint: 5 }), ws.backups)).ok, false);
    assert.equal((await restoreOriginalJpeg(good, ws.backups)).ok, false, "nessuna copia da ripristinare");
    assert.equal(parseColorTransform(null), null);
    assert.equal(parseColorTransform({ matrix: [1], slope: [1, 1, 1], intercept: [0, 0, 0] }), null);
    assert.ok(parseColorTransform({ matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], slope: [1, 1, 1], intercept: [0, 0, 0] }));
    assert.ok(isJpegPath("C:/foto/A.JPG") && isJpegPath("/x/y.jpeg") && !isJpegPath("a.png") && !isJpegPath("a.tif"));
  } finally { await ws.done(); }
});

test("correzione sul file: rifiuta JPG CMYK, in scala di grigi o con profilo diverso da sRGB, senza lasciare copie né toccare il file", async () => {
  const model = await albumModel();
  const ws = await workspace();
  try {
    const input = toInput(model, { brightness: 15 });
    const make = async (name: string, build: (image: sharp.Sharp) => sharp.Sharp) => {
      const file = join(ws.dir, name);
      const base = sharp({ create: { width: 16, height: 16, channels: 3, background: "#6688aa" } });
      await fs.writeFile(file, await build(base).jpeg({ quality: 95 }).toBuffer());
      return file;
    };
    const cases: Array<[string, (image: sharp.Sharp) => sharp.Sharp]> = [
      ["cmyk.jpg", (image) => image.toColourspace("cmyk")],
      ["grigi.jpg", (image) => image.toColourspace("b-w")],
      ["p3.jpg", (image) => image.withIccProfile("p3")],
    ];
    for (const [name, build] of cases) {
      const file = await make(name, build);
      const before = await fs.readFile(file);
      const result = await applyColorToJpeg(file, input, ws.backups);
      assert.equal(result.ok, false, `${name}: deve essere rifiutato`);
      assert.deepEqual(await fs.readFile(file), before, `${name}: il file non cambia`);
      assert.equal(await hasOriginalBackup(file, ws.backups), false, `${name}: nessuna copia di sicurezza`);
    }
    const srgb = await make("srgb.jpg", (image) => image.withIccProfile("srgb"));
    assert.equal((await applyColorToJpeg(srgb, input, ws.backups)).ok, true, "un JPG con profilo sRGB si corregge");
  } finally { await ws.done(); }
});
