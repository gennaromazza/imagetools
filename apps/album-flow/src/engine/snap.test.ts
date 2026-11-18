import { test } from "node:test";
import assert from "node:assert/strict";
import { snapEqualGaps, snapMove, snapResize } from "./snap";
import { gapMeasures } from "./arrange";

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

test("aggancio: il bordo sinistro si attacca al bordo di un'altra foto entro la soglia e mostra la linea guida", () => {
  const other = box(100, 50, 80, 60);
  const result = snapMove(box(102, 200, 50, 40), [other], 3);
  assert.equal(result.rect.x, 100);
  assert.equal(result.rect.y, 200, "l'altro asse non si muove");
  const vertical = result.guides.filter((guide) => guide.axis === "x");
  assert.equal(vertical.length, 1);
  assert.equal(vertical[0].at, 100);
  assert.ok(vertical[0].from <= 50 && vertical[0].to >= 240, "la linea copre entrambe le foto");
});

test("aggancio: fuori soglia non cambia nulla; centro e bordo destro si agganciano", () => {
  const other = box(100, 50, 80, 60);
  const far = snapMove(box(110, 200, 50, 40), [other], 3);
  assert.deepEqual(far.rect, box(110, 200, 50, 40));
  assert.deepEqual(far.guides, []);
  // centro della foto (x + 25) sul centro dell'altra (140)
  const center = snapMove(box(116, 300, 50, 40), [other], 3);
  assert.equal(center.rect.x + 25, 140);
  // bordo destro (x + 50) sul destro dell'altra (180)
  const rightEdge = snapMove(box(131, 300, 50, 40), [other], 3);
  assert.equal(rightEdge.rect.x + 50, 180);
});

test("aggancio: sui due assi insieme e con il candidato più vicino; più foto allineate danno una sola linea", () => {
  const a = box(100, 0, 50, 50);
  const b = box(100, 100, 50, 50);
  const result = snapMove(box(101, 74, 30, 30), [a, b], 3);
  assert.equal(result.rect.x, 100);
  const lines = result.guides.filter((guide) => guide.axis === "x");
  assert.equal(lines.length, 1, "una sola linea per posizione");
  assert.ok(lines[0].from <= 0 && lines[0].to >= 150);
  const both = snapMove(box(101, 51, 30, 30), [a], 3);
  assert.equal(both.rect.x, 100);
  assert.equal(both.rect.y, 50, "il bordo in alto si attacca al basso dell'altra foto");
});

test("ridimensionamento: il bordo destro o in basso si attacca e le proporzioni restano", () => {
  const other = box(200, 0, 40, 40);
  const result = snapResize(box(100, 100, 98, 49), [other], 3);
  assert.equal(result.rect.x + result.rect.w, 200);
  assert.ok(Math.abs(result.rect.w / result.rect.h - 2) < 1e-9, "proporzioni uguali");
  assert.equal(result.guides.length, 1);
  const none = snapResize(box(100, 100, 60, 30), [other], 3);
  assert.deepEqual(none.rect, box(100, 100, 60, 30));
  const bottom = snapResize(box(100, 100, 60, 29), [box(0, 0, 10, 130)], 3);
  assert.equal(bottom.rect.y + bottom.rect.h, 130);
  assert.ok(Math.abs(bottom.rect.w / bottom.rect.h - 60 / 29) < 1e-9);
});

test("centro della pagina: il centro di una foto o di un gruppo si aggancia a un punto-centro anche senza altre foto", () => {
  const center = box(300, 200, 0, 0);
  const result = snapMove(box(240, 150, 118, 100), [center], 4, { targetCenters: false });
  assert.equal(result.rect.x + result.rect.w / 2, 300, "centrata in orizzontale");
  assert.equal(result.rect.y + result.rect.h / 2, 200, "centrata in verticale");
  assert.equal(result.guides.length, 2, "una linea guida per asse");
  const far = snapMove(box(100, 100, 50, 50), [center], 4, { targetCenters: false });
  assert.deepEqual(far.rect, box(100, 100, 50, 50), "lontano dal centro non si muove");
});

test("stessa distanza: la foto si ferma al centro tra due vicine, con lo stesso spazio a destra e a sinistra", () => {
  const left = box(0, 0, 40, 60);
  const right = box(200, 0, 40, 60);
  // lo spazio libero è 200 - 40 = 160, la foto è larga 50: a x = 40 + 55 = 95 i due spazi sono uguali (55 mm)
  const result = snapEqualGaps(box(93, 0, 50, 60), [left, right], 4);
  assert.equal(result.rect.x, 95);
  assert.equal(result.matched.x, 55);
  const gaps = gapMeasures(result.rect, [left, right], result.matched);
  assert.equal(gaps.length, 2);
  assert.ok(gaps.every((gap) => gap.equal), "i due spazi si evidenziano come uguali");
  // fuori soglia non cambia nulla
  assert.deepEqual(snapEqualGaps(box(80, 0, 50, 60), [left, right], 4).rect, box(80, 0, 50, 60));
});

test("stessa distanza: ripete lo spazio già presente tra due altre foto, sui due assi", () => {
  const a = box(0, 0, 40, 40);
  const b = box(52, 0, 40, 40); // spazio di 12 mm tra a e b
  // una terza foto accanto a b: dovrebbe stare a 12 mm → x = 92 + 12 = 104
  const next = snapEqualGaps(box(106, 0, 40, 40), [a, b], 4);
  assert.equal(next.rect.x, 104);
  assert.equal(next.matched.x, 12);
  // lo stesso in verticale: sotto a, a 12 mm da b? (b non la sovrappone in x) → sotto b a 12 mm da una coppia verticale
  const top = box(300, 0, 40, 30);
  const below = box(300, 42, 40, 30); // spazio verticale 12 mm
  const vertical = snapEqualGaps(box(300, 86, 40, 30), [top, below], 4);
  assert.equal(vertical.rect.y, 84);
  assert.equal(vertical.matched.y, 12);
});

test("stessa distanza: non si aggancia dove le foto si toccherebbero né con spazi non adiacenti", () => {
  const a = box(0, 0, 40, 40);
  const middle = box(60, 0, 40, 40);
  const far = box(140, 0, 40, 40);
  // a e far hanno 100 mm di distanza ma con middle in mezzo: non è uno spazio da ripetere (gli spazi veri sono 20 e 40)
  const result = snapEqualGaps(box(222, 0, 40, 40), [a, middle, far], 4);
  assert.equal(result.matched.x, 40, "si ripete lo spazio tra middle e far");
  assert.equal(result.rect.x, 220);
  const notHundred = snapEqualGaps(box(281, 0, 40, 40), [a, middle, far], 4);
  assert.equal(notHundred.matched.x, undefined, "i 100 mm tra a e far non sono uno spazio da ripetere");
  assert.equal(notHundred.rect.x, 281);
  // foto senza vicine sull'asse: nessun aggancio
  assert.deepEqual(snapEqualGaps(box(0, 500, 40, 40), [a], 4).matched, {});
  // gli assi si possono escludere
  assert.equal(snapEqualGaps(box(106, 0, 40, 40), [a, box(52, 0, 40, 40)], 4, { x: false, y: true }).rect.x, 106);
});

test("aggancio a bordi: il centro della foto si allinea al centro di un'altra, anche con larghezze diverse (foto una sotto l'altra)", () => {
  const above = box(100, 50, 200, 60);
  const result = snapMove(box(152, 130, 100, 40), [above], 4, { targetCenters: false });
  assert.equal(result.rect.x, 150, "centro con centro: 100 + 200/2 = 150 + 100/2");
  assert.ok(result.guides.some((guide) => guide.axis === "x" && Math.abs(guide.at - 200) < 1e-9), "linea guida sul centro comune");
  // senza i centri la foto non scatta sul centro di un bersaglio per il bordo
  const edge = snapMove(box(204, 130, 50, 40), [above], 3, { targetCenters: false });
  assert.equal(edge.rect.x, 204, "il bordo della foto non si attacca al centro del bersaglio");
});

test("spazio standard: una foto sotto un'altra si ferma alla distanza dell'album, anche senza altre foto da imitare", () => {
  const above = box(100, 50, 80, 60);
  const moving = box(100, 114, 80, 40);
  const snapped = snapEqualGaps(moving, [above], 3, { x: false, y: true }, [5]);
  assert.equal(snapped.rect.y, 115, "110 + 5");
  assert.equal(snapped.matched.y, 5);
  assert.equal(snapEqualGaps(moving, [above], 3, { x: false, y: true }).rect.y, 114, "senza lo spazio standard non c'è nulla da ripetere");
  assert.equal(snapEqualGaps(box(100, 130, 80, 40), [above], 3, { x: false, y: true }, [5]).rect.y, 130, "troppo lontana: nessun aggancio");
  const sideBySide = snapEqualGaps(box(183, 50, 40, 60), [above], 3, { x: true, y: false }, [5]);
  assert.equal(sideBySide.rect.x, 185, "vale anche in orizzontale");
});
