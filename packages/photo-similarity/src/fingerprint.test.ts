import { test } from "node:test";
import assert from "node:assert/strict";
import { MONOCHROME_CHROMA, colorDistance, computeFingerprint, hashDistance, isMonochrome, rgbToLab } from "./fingerprint";
import { sceneFingerprint, sceneRgba } from "./testkit";

/** Scene sintetiche in cui un piccolo passo della fotocamera cambia poco l'impronta (verificato sui valori). */
const STEADY = [1, 4, 6, 9, 12];

test("impronta: 16 cifre esadecimali, identica per la stessa immagine", () => {
  const a = sceneFingerprint(1);
  assert.match(a.hash, /^[0-9a-f]{16}$/);
  assert.deepEqual(sceneFingerprint(1), a);
  assert.equal(hashDistance(a.hash, a.hash), 0);
});

test("impronta: lo stesso scatto spostato o con rumore resta vicino, una scena diversa è lontana", () => {
  for (const seed of STEADY) {
    const a = sceneFingerprint(seed);
    const next = sceneFingerprint(seed, { shiftX: 2, shiftY: 1, noise: 8 });
    const brighter = sceneFingerprint(seed, { brightness: 12 });
    assert.ok(hashDistance(a.hash, next.hash) <= 8, `scena ${seed}: passo della fotocamera ${hashDistance(a.hash, next.hash)} bit`);
    assert.ok(hashDistance(a.hash, brighter.hash) <= 4, `scena ${seed}: più luce ${hashDistance(a.hash, brighter.hash)} bit`);
    assert.ok(colorDistance(a, next) < 8, `scena ${seed}: i colori medi non cambiano con un passo`);
  }
  for (const [x, y] of [[1, 101], [9, 109], [12, 112], [1, 9]]) {
    const distance = hashDistance(sceneFingerprint(x).hash, sceneFingerprint(y).hash);
    assert.ok(distance >= 20, `scene ${x} e ${y} troppo vicine: ${distance} bit`);
  }
});

test("impronta: distanza simmetrica, valori non confrontabili valgono il massimo", () => {
  const a = sceneFingerprint(4).hash;
  const b = sceneFingerprint(104).hash;
  assert.equal(hashDistance(a, b), hashDistance(b, a));
  assert.equal(hashDistance(a, "abc"), 64);
  assert.equal(hashDistance("", ""), 64);
  assert.equal(hashDistance("zzzzzzzzzzzzzzzz", a), 64);
  assert.equal(hashDistance("0000000000000000", "ffffffffffffffff"), 64);
});

test("impronta: riconosce il bianco e nero", () => {
  for (const seed of STEADY) {
    const color = sceneFingerprint(seed);
    const mono = sceneFingerprint(seed, { mono: true });
    assert.ok(isMonochrome(mono), `scena ${seed} in bianco e nero: croma ${mono.chroma}`);
    assert.ok(!isMonochrome(color), `scena ${seed} a colori: croma ${color.chroma}`);
    assert.ok(mono.chroma < MONOCHROME_CHROMA && color.chroma > MONOCHROME_CHROMA * 3);
  }
});

test("impronta: la foto mossa o sfocata è meno nitida", () => {
  for (const seed of STEADY) {
    const sharp = sceneFingerprint(seed, { noise: 2 });
    const soft = sceneFingerprint(seed, { noise: 2, blur: 2 });
    assert.ok(sharp.sharpness > soft.sharpness * 2, `scena ${seed}: ${sharp.sharpness} contro ${soft.sharpness}`);
  }
});

test("impronta: luci bruciate e ombre chiuse", () => {
  const white = sceneFingerprint(3, { fill: 255 });
  const black = sceneFingerprint(3, { fill: 0 });
  assert.equal(white.clipHigh, 1);
  assert.equal(white.clipLow, 0);
  assert.equal(black.clipLow, 1);
  assert.equal(black.clipHigh, 0);
  const normal = sceneFingerprint(3);
  assert.ok(normal.clipHigh < 0.5 && normal.clipLow < 0.5);
});

test("impronta: Lab di riferimento e immagini non valide", () => {
  const [l, a, b] = rgbToLab(255, 255, 255);
  assert.ok(Math.abs(l - 100) < 0.1 && Math.abs(a) < 0.1 && Math.abs(b) < 0.1);
  assert.deepEqual(rgbToLab(0, 0, 0).map((value) => Math.round(value)), [0, 0, 0]);
  assert.ok(rgbToLab(255, 0, 0)[1] > 60, "il rosso ha a positivo");
  assert.throws(() => computeFingerprint(new Uint8ClampedArray(10), 4, 4));
  assert.throws(() => computeFingerprint(new Uint8ClampedArray(0), 0, 0));
  // Immagini piccolissime: nessun errore, nitidezza nulla.
  const tiny = sceneRgba(2, { width: 2, height: 2 });
  assert.equal(computeFingerprint(tiny.rgba, tiny.width, tiny.height).sharpness, 0);
});
