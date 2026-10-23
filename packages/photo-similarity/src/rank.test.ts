import { test } from "node:test";
import assert from "node:assert/strict";
import { rankForSpread } from "./compatibility";
import { rankGroup } from "./rank";
import { photo, sceneFingerprint } from "./testkit";

test("migliore del gruppo: contano prima le stelle del fotografo", () => {
  const ranked = rankGroup([
    photo("a", 0, { rating: 3, fingerprint: sceneFingerprint(1, { noise: 2 }) }),
    photo("b", 1, { rating: 5, fingerprint: sceneFingerprint(1, { noise: 2, blur: 2 }) }),
    photo("c", 2, { rating: 4 }),
  ]);
  assert.deepEqual(ranked.order, ["b", "c", "a"], "5 stelle anche se meno nitida");
  assert.equal(ranked.reason, "5 stelle");
});

test("migliore del gruppo: a parità di stelle la più nitida, poi l'esposizione, poi la prima", () => {
  const sharp = rankGroup([
    photo("a", 0, { rating: 4, fingerprint: sceneFingerprint(4, { noise: 2, blur: 2 }) }),
    photo("b", 1, { rating: 4, fingerprint: sceneFingerprint(4, { noise: 2 }) }),
  ]);
  assert.deepEqual(sharp.order, ["b", "a"]);
  assert.equal(sharp.reason, "più nitida");

  const base = sceneFingerprint(6);
  const exposure = rankGroup([
    photo("a", 0, { fingerprint: { ...base, clipHigh: 0.2 } }),
    photo("b", 1, { fingerprint: { ...base, clipHigh: 0 } }),
  ]);
  assert.deepEqual(exposure.order, ["b", "a"]);
  assert.equal(exposure.reason, "esposizione migliore");

  const tie = rankGroup([photo("b", 3), photo("a", 1), photo("c", 2)]);
  assert.deepEqual(tie.order, ["a", "c", "b"], "a parità vince il primo scatto");
  assert.equal(tie.reason, "prima della serie");
});

test("migliore del gruppo: «prima della serie» solo se è davvero il primo scatto", () => {
  // Sulle foto reali la consigliata di una raffica era spesso la seconda o la quarta, vinta di poco
  // in nitidezza, ma il motivo diceva «prima della serie».
  const base = sceneFingerprint(8);
  const slightly = rankGroup([
    photo("a", 0, { fingerprint: { ...base, sharpness: 100 } }),
    photo("b", 1, { fingerprint: { ...base, sharpness: 105 } }),
  ]);
  assert.deepEqual(slightly.order, ["b", "a"]);
  assert.equal(slightly.reason, "di poco più nitida");

  const first = rankGroup([
    photo("a", 0, { fingerprint: { ...base, sharpness: 105 } }),
    photo("b", 1, { fingerprint: { ...base, sharpness: 100 } }),
  ]);
  assert.deepEqual(first.order, ["a", "b"]);
  assert.equal(first.reason, "prima della serie");

  const mixed = rankGroup([
    photo("a", 0, { fingerprint: { ...base, sharpness: 104, clipHigh: 0.05 } }),
    photo("b", 1, { fingerprint: { ...base, sharpness: 100, clipHigh: 0 } }),
    photo("c", 2, { fingerprint: { ...base, sharpness: 102, clipHigh: 0.02 } }),
  ]);
  assert.equal(mixed.order[0], "b");
  assert.equal(mixed.reason, "esposizione migliore", "vince la luce, non l'ordine di scatto");
});

test("migliore del gruppo: casi limite", () => {
  assert.deepEqual(rankGroup([]), { order: [], reason: "" });
  assert.deepEqual(rankGroup([photo("solo", 0)]), { order: ["solo"], reason: "" });
  assert.equal(rankGroup([photo("a", 0, { rating: 1 }), photo("b", 1)]).reason, "1 stella");
});

test("adatte allo spread: prima lo stesso momento, poi quello vicino, poi il resto", () => {
  const placed = [photo("p1", 0), photo("p2", 30)];
  const momentOf = new Map([["p1", "m1"], ["p2", "m1"], ["same", "m1"], ["near", "m2"], ["far", "m3"]]);
  const candidates = [photo("far", 7200), photo("near", 400), photo("same", 60)];
  const ranked = rankForSpread(candidates, { spreadPhotos: placed, momentOf });
  assert.deepEqual(ranked.map((entry) => entry.id), ["same", "near", "far"]);
  assert.deepEqual(ranked[0].reasons, ["stesso momento"]);
  assert.deepEqual(ranked[1].reasons, ["momento vicino"]);
  assert.deepEqual(ranked[2].reasons, []);
  assert.deepEqual(rankForSpread(candidates, { spreadPhotos: [], momentOf }), [], "senza foto sullo spread non c'è contesto");
  assert.equal(rankForSpread(candidates, { spreadPhotos: placed, momentOf }, 2).length, 2);
});

test("adatte allo spread: bianco e nero con bianco e nero, toni simili, stelle a parità", () => {
  const momentOf = new Map<string, string>();
  const monoSpread = [photo("p", 0, { fingerprint: sceneFingerprint(1, { mono: true }) })];
  const mono = photo("mono", 5000, { fingerprint: sceneFingerprint(4, { mono: true }) });
  const color = photo("color", 5000, { fingerprint: sceneFingerprint(4) });
  const ranked = rankForSpread([color, mono], { spreadPhotos: monoSpread, momentOf });
  assert.deepEqual(ranked.map((entry) => entry.id), ["mono", "color"]);
  assert.ok(ranked[0].reasons.includes("bianco e nero come lo spread"));
  assert.ok(ranked[1].score < 0, "il colore su uno spread in bianco e nero è penalizzato");

  const colorSpread = [photo("p", 0, { fingerprint: sceneFingerprint(9) })];
  const tones = rankForSpread([photo("x", 9000, { fingerprint: sceneFingerprint(9, { brightness: 8 }) })], { spreadPhotos: colorSpread, momentOf });
  assert.ok(tones[0].reasons.includes("toni simili"));

  const stars = rankForSpread([photo("low", 9000, { rating: 1 }), photo("top", 9000, { rating: 5 })], { spreadPhotos: [photo("p", 0)], momentOf });
  assert.deepEqual(stars.map((entry) => entry.id), ["top", "low"]);
  assert.ok(stars[0].reasons.includes("5 stelle"));
});
