import { test } from "node:test";
import assert from "node:assert/strict";
import { snapMove, snapResize } from "./snap";

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
