import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_GROUP_OPTIONS, fileSequence, findSimilarGroups } from "./groups";
import { groupSets, photo, sceneFingerprint } from "./testkit";

test("gruppi: una raffica dall'ora di scatto, anche senza impronta visiva", () => {
  const photos = [photo("a", 0), photo("b", 0.4), photo("c", 0.8), photo("d", 10), photo("e", 40)];
  const groups = findSimilarGroups(photos);
  assert.deepEqual(groupSets(groups), ["a,b,c"]);
  assert.equal(groups[0].kind, "burst");
  assert.deepEqual(groups[0].photoIds, ["a", "b", "c"], "in ordine di scatto");
  assert.equal(groups[0].id, "g:a");
});

test("gruppi: fotocamere diverse o orientamento diverso non fanno raffica", () => {
  const cameras = [photo("a", 0, { cameraModel: "Z6" }), photo("b", 0.5, { cameraModel: "R5" })];
  assert.deepEqual(findSimilarGroups(cameras), []);
  const sameBody = [photo("a", 0, { cameraModel: "Z6" }), photo("b", 0.5, { cameraModel: "Z6" })];
  assert.equal(findSimilarGroups(sameBody).length, 1);
  const turned = [photo("a", 0, { aspect: 1.5 }), photo("b", 0.5, { aspect: 0.66 })];
  assert.deepEqual(findSimilarGroups(turned), []);
  const unknownCamera = [photo("a", 0, { cameraModel: "Z6" }), photo("b", 0.5)];
  assert.equal(findSimilarGroups(unknownCamera).length, 1, "se il modello manca non si esclude");
});

test("gruppi: con l'impronta, una raffica in cui la fotocamera si è girata si spezza", () => {
  const photos = [
    photo("a", 0, { fingerprint: sceneFingerprint(1) }),
    photo("b", 0.5, { fingerprint: sceneFingerprint(1, { shiftX: 2, noise: 6 }) }),
    photo("c", 1, { fingerprint: sceneFingerprint(101) }),
  ];
  assert.deepEqual(groupSets(findSimilarGroups(photos)), ["a,b"]);
});

test("gruppi: stessa inquadratura poco dopo è «simile», ore dopo no", () => {
  const photos = [
    photo("a", 0, { fingerprint: sceneFingerprint(9) }),
    photo("b", 25, { fingerprint: sceneFingerprint(9, { shiftX: 2, shiftY: 1, noise: 8 }) }),
    photo("c", 7200, { fingerprint: sceneFingerprint(9) }),
  ];
  const groups = findSimilarGroups(photos);
  assert.deepEqual(groupSets(groups), ["a,b"]);
  assert.equal(groups[0].kind, "similar");
  const toneless = [photo("a", 0, { fingerprint: sceneFingerprint(9) }), photo("b", 25, { fingerprint: { ...sceneFingerprint(9), lab: [20, 60, -60] } })];
  assert.deepEqual(findSimilarGroups(toneless), [], "stessa forma ma colori molto diversi: non è la stessa foto");
});

test("gruppi: una lunga sequenza senza impronta non diventa un gruppo unico", () => {
  const photos = Array.from({ length: 40 }, (_, index) => photo(`s${index}`, index * 0.5));
  const groups = findSimilarGroups(photos);
  assert.ok(groups.length >= 2);
  for (const group of groups) {
    const times = group.photoIds.map((id) => photos.find((candidate) => candidate.id === id)!.captureTimeMs!);
    assert.ok(Math.max(...times) - Math.min(...times) <= DEFAULT_GROUP_OPTIONS.maxSpanMs);
    assert.ok(group.photoIds.length <= DEFAULT_GROUP_OPTIONS.maxGroupSize);
  }
  assert.equal(new Set(groups.flatMap((group) => group.photoIds)).size, groups.reduce((sum, group) => sum + group.photoIds.length, 0), "nessuna foto in due gruppi");
});

test("gruppi: niente catene a-b-c se a e c sono troppo diverse", () => {
  const a = sceneFingerprint(4);
  const c = sceneFingerprint(104);
  // b sta «a metà»: metà dei bit come a, metà come c.
  const b = { ...a, hash: a.hash.slice(0, 8) + c.hash.slice(8) };
  const photos = [photo("a", 0, { fingerprint: a }), photo("b", 0.5, { fingerprint: b }), photo("c", 1, { fingerprint: c })];
  const groups = findSimilarGroups(photos, {}, { burstHashMax: 64, linkHashMax: 12 });
  assert.ok(!groupSets(groups).includes("a,b,c"));
});

test("gruppi: massimo di foto per gruppo", () => {
  const photos = Array.from({ length: 10 }, (_, index) => photo(`r${index}`, index * 0.2));
  const groups = findSimilarGroups(photos, {}, { maxGroupSize: 4 });
  assert.ok(groups.every((group) => group.photoIds.length <= 4));
  assert.ok(groups.length >= 3);
});

test("gruppi: le correzioni del fotografo vincono", () => {
  const burst = [photo("a", 0), photo("b", 0.4), photo("c", 0.8)];
  assert.deepEqual(groupSets(findSimilarGroups(burst, { apart: [["a", "b"]] })), ["b,c"], "a e b non stanno mai insieme");
  assert.deepEqual(findSimilarGroups(burst, { apart: [["a", "b"], ["b", "c"], ["a", "c"]] }), [], "gruppo separato del tutto");
  const far = [photo("x", 0), photo("y", 5000), photo("z", 9000)];
  const joined = findSimilarGroups(far, { together: [["x", "z"]] });
  assert.deepEqual(groupSets(joined), ["x,z"]);
  assert.equal(joined[0].kind, "manual");
  const extended = findSimilarGroups([...burst, photo("d", 600)], { together: [["a", "d"]] });
  assert.deepEqual(groupSets(extended), ["a,b,c,d"], "un gruppo unito a mano accoglie la raffica");
  assert.equal(extended[0].kind, "manual");
  assert.deepEqual(groupSets(findSimilarGroups(burst, { together: [["a", "missing"]] })), ["a,b,c"], "riferimenti a foto assenti ignorati");
});

test("gruppi: senza ora di scatto, file con numeri vicini e impronta simile", () => {
  const look = sceneFingerprint(6);
  const near = sceneFingerprint(6, { shiftX: 1, noise: 5 });
  const photos = [
    photo("IMG_0412", null, { fingerprint: look }),
    photo("IMG_0413", null, { fingerprint: near }),
    photo("IMG_0420", null, { fingerprint: near }),
    photo("DSC_0414", null, { fingerprint: near }),
  ];
  assert.deepEqual(groupSets(findSimilarGroups(photos)), ["IMG_0412,IMG_0413"]);
  const blind = [photo("IMG_0412", null), photo("IMG_0413", null)];
  assert.deepEqual(findSimilarGroups(blind), [], "il solo numero del file non basta");
});

test("gruppi: il risultato non dipende dall'ordine delle foto", () => {
  const photos = [
    photo("a", 0, { fingerprint: sceneFingerprint(1) }), photo("b", 0.6, { fingerprint: sceneFingerprint(1, { shiftX: 1 }) }),
    photo("c", 30, { fingerprint: sceneFingerprint(12) }), photo("d", 50, { fingerprint: sceneFingerprint(12, { noise: 6 }) }),
    photo("e", 51, { fingerprint: sceneFingerprint(112) }), photo("f", 300),
  ];
  const forward = groupSets(findSimilarGroups(photos));
  const backward = groupSets(findSimilarGroups([...photos].reverse()));
  assert.deepEqual(backward, forward);
  assert.deepEqual(forward, ["a,b", "c,d"]);
});

test("gruppi: numero di sequenza del nome file", () => {
  assert.deepEqual(fileSequence("IMG_0412.JPG"), { prefix: "img_|", number: 412 });
  assert.deepEqual(fileSequence("DSC01234-2.jpg"), { prefix: "dsc01234-|", number: 2 });
  assert.deepEqual(fileSequence("_Z6A1234 copia.jpg"), { prefix: "_z6a| copia", number: 1234 });
  assert.equal(fileSequence("ritratto.jpg"), null);
  assert.equal(fileSequence(undefined), null);
});
