import { test } from "node:test";
import assert from "node:assert/strict";
import { findMoments } from "./moments";
import { photo } from "./testkit";

/** Sequenza di scatti a intervalli dati (secondi tra uno scatto e il successivo). */
function sequence(prefix: string, startSeconds: number, gaps: number[]) {
  const shots = [photo(`${prefix}0`, startSeconds)];
  let time = startSeconds;
  gaps.forEach((gap, index) => { time += gap; shots.push(photo(`${prefix}${index + 1}`, time)); });
  return shots;
}

test("momenti: una pausa lunga separa, lo scatto continuo resta insieme", () => {
  const ceremony = sequence("c", 0, [20, 25, 18, 30, 22, 19]);
  const cake = sequence("t", 3600, [5, 4, 6, 3]);
  const moments = findMoments([...ceremony, ...cake]);
  assert.equal(moments.length, 2);
  assert.deepEqual(moments[0].photoIds, ceremony.map((shot) => shot.id));
  assert.deepEqual(moments[1].photoIds, cake.map((shot) => shot.id));
  assert.equal(moments[0].startMs, ceremony[0].captureTimeMs);
  assert.equal(moments[1].endMs, cake[cake.length - 1].captureTimeMs);
});

test("momenti: la soglia segue il ritmo del tratto (festa veloce, ritratti lenti)", () => {
  // Alla festa si scatta ogni 3 secondi: una pausa di 100 s è un cambio di momento.
  const party = [...sequence("f", 0, [3, 3, 2, 4, 3, 3, 3]), ...sequence("g", 21 + 100, [3, 2, 3, 4, 3])];
  assert.equal(findMoments(party).length, 2, "alla festa 100 s di pausa separano");
  // Nei ritratti si scatta ogni 60-80 s: la stessa pausa di 100 s è normale.
  const portraits = sequence("r", 0, [70, 65, 80, 100, 75, 60, 72]);
  assert.equal(findMoments(portraits).length, 1, "nei ritratti 100 s sono il ritmo normale");
});

test("momenti: una pausa oltre il massimo separa anche se i dintorni sono lenti, sotto il minimo mai", () => {
  const slow = sequence("s", 0, [900, 840, 1500, 870, 910]);
  assert.equal(findMoments(slow).length, 2, "25 minuti di pausa separano sempre");
  const quick = sequence("q", 0, [1, 1, 1, 80, 1, 1]);
  assert.equal(findMoments(quick).length, 1, "80 s sono sotto la pausa minima");
});

test("momenti: foto senza ora fuori dai momenti, ordine d'ingresso indifferente, id stabili", () => {
  const shots = [...sequence("a", 0, [10, 10, 10]), ...sequence("b", 2000, [10, 10])];
  const undated = photo("x", null);
  const forward = findMoments([...shots, undated]);
  const shuffled = findMoments([shots[3], undated, shots[6], shots[0], shots[4], shots[2], shots[1], shots[5]]);
  assert.deepEqual(shuffled, forward);
  assert.ok(forward.every((moment) => !moment.photoIds.includes("x")));
  assert.deepEqual(forward.map((moment) => moment.id), ["m:a0", "m:b0"]);
  assert.deepEqual(findMoments([]), []);
  assert.deepEqual(findMoments([undated]), []);
});

test("momenti: scatti allo stesso istante (due fotocamere) restano nell'ordine ricevuto", () => {
  const twins = [photo("p1", 0), photo("p2", 0), photo("p3", 0.5)];
  assert.deepEqual(findMoments(twins)[0].photoIds, ["p1", "p2", "p3"]);
  assert.deepEqual(findMoments([twins[1], twins[0], twins[2]])[0].photoIds, ["p2", "p1", "p3"]);
});
