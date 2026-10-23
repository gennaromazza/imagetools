import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findSimilarGroups, type PhotoFingerprint } from "@photo-tools/photo-similarity";
import { sceneFingerprint } from "../../../../packages/photo-similarity/src/testkit.js";
import type { CaptureTimeInfo } from "./photo-sort-cache.js";
import { fingerprintSize } from "./similar-fingerprints.js";
import {
  buildSimilarPhotosView,
  detachPhoto,
  EMPTY_SIMILARITY_OVERRIDES,
  hasSimilarityOverrides,
  isGroupDecided,
  isSameGroupingInput,
  joinPhotos,
  planKeepOne,
  separatePhotos,
  toSimilarityPhotos,
  type SimilarityAsset,
} from "./similar-photos.js";

const T0 = Date.UTC(2026, 5, 5, 15, 0, 0);

function asset(id: string, overrides: Partial<SimilarityAsset> = {}): SimilarityAsset {
  return { id, fileName: `${id}.jpg`, width: 6000, height: 4000, aspectRatio: 1.5, rating: 0, ...overrides };
}

function captures(entries: Array<[string, number, string | null]>): Map<string, CaptureTimeInfo> {
  return new Map(entries.map(([id, seconds, cameraModel]) => [id, { timeMs: T0 + seconds * 1000, cameraModel }]));
}

const noPrints = () => undefined;
const printsFrom = (prints: Record<string, PhotoFingerprint>) => (photo: SimilarityAsset) => prints[photo.id];

describe("foto simili nel Selector", () => {
  it("riconosce una raffica dall'ora di scatto EXIF già letta, non tra due fotocamere né tra foto girate", () => {
    const assets = [asset("a"), asset("b"), asset("c"), asset("d"), asset("e", { rotationDegrees: 90 }), asset("f")];
    const capture = captures([["a", 0, "Z6"], ["b", 0.4, "Z6"], ["c", 0.9, "R5"], ["d", 30, "Z6"], ["e", 30.5, "Z6"], ["f", 120, null]]);
    const photos = toSimilarityPhotos(assets, capture, noPrints);
    assert.deepEqual(photos[0], { id: "a", fileName: "a.jpg", captureTimeMs: T0, cameraModel: "Z6", aspect: 1.5, rating: 0, fingerprint: undefined });
    assert.equal(photos[4]!.aspect, 4000 / 6000, "la rotazione di un quarto di giro scambia le proporzioni");
    assert.equal(photos[5]!.cameraModel, undefined, "modello assente: non esclude la foto");
    const groups = findSimilarGroups(photos);
    assert.deepEqual(groups.map((group) => group.photoIds), [["a", "b"]]);
    assert.equal(groups[0]!.kind, "burst");
  });

  it("raggruppa la stessa inquadratura scattata poco dopo grazie alle impronte delle miniature", () => {
    const assets = [asset("a"), asset("b"), asset("c")];
    const capture = captures([["a", 0, "Z6"], ["b", 25, "Z6"], ["c", 40, "Z6"]]);
    const prints = { a: sceneFingerprint(9), b: sceneFingerprint(9, { shiftX: 2, shiftY: 1, noise: 8 }), c: sceneFingerprint(77) };
    const groups = findSimilarGroups(toSimilarityPhotos(assets, capture, printsFrom(prints)));
    assert.deepEqual(groups.map((group) => [group.kind, group.photoIds]), [["similar", ["a", "b"]]]);
    assert.deepEqual(findSimilarGroups(toSimilarityPhotos(assets, capture, noPrints)), [], "senza impronte 25 s non bastano");
  });

  it("mette in evidenza la consigliata: prima le stelle del fotografo, poi la nitidezza", () => {
    const assets = [asset("a"), asset("b"), asset("c")];
    const capture = captures([["a", 0, "Z6"], ["b", 0.3, "Z6"], ["c", 0.6, "Z6"]]);
    const prints = { a: sceneFingerprint(5, { blur: 2 }), b: sceneFingerprint(5, { shiftX: 1 }), c: sceneFingerprint(5, { blur: 1, shiftX: 1 }) };
    const photos = toSimilarityPhotos(assets, capture, printsFrom(prints));
    const groups = findSimilarGroups(photos);
    assert.equal(groups.length, 1);

    const sharp = buildSimilarPhotosView(groups, photos);
    assert.equal(sharp.groups[0]!.recommendedId, "b");
    assert.equal(sharp.groups[0]!.reason, "più nitida");
    assert.deepEqual(sharp.groups[0]!.photoIds, ["a", "b", "c"], "le varianti restano in ordine di scatto");
    assert.deepEqual(sharp.membershipById.get("b"), { groupId: groups[0]!.id, position: 2, size: 3, recommended: true });
    assert.equal(sharp.membershipById.get("a")!.recommended, false);

    const rated = toSimilarityPhotos(assets.map((item) => (item.id === "a" ? { ...item, rating: 4 } : item)), capture, printsFrom(prints));
    const starred = buildSimilarPhotosView(groups, rated);
    assert.equal(starred.groups[0]!.recommendedId, "a", "le stelle vincono sulla nitidezza");
    assert.equal(starred.groups[0]!.reason, "4 stelle");
  });

  it("classificare non ricalcola i gruppi: contano solo foto, ora, fotocamera, proporzioni e impronte", () => {
    const assets = [asset("a"), asset("b")];
    const capture = captures([["a", 0, "Z6"], ["b", 0.5, "Z6"]]);
    const print = sceneFingerprint(3);
    const before = toSimilarityPhotos(assets, capture, () => print);
    const rated = toSimilarityPhotos(assets.map((item) => ({ ...item, rating: 5 })), capture, () => print);
    assert.equal(isSameGroupingInput(before, rated), true);
    assert.equal(isSameGroupingInput(before, toSimilarityPhotos(assets, capture, (item) => (item.id === "b" ? sceneFingerprint(4) : print))), false);
    assert.equal(isSameGroupingInput(before, toSimilarityPhotos(assets, captures([["a", 0, "Z6"]]), () => print)), false);
    assert.equal(isSameGroupingInput(before, before.slice(1)), false);
  });

  it("«Tieni questa» tiene la scelta e scarta solo le altre varianti", () => {
    assert.deepEqual(planKeepOne(["a", "b", "c"], "b"), { pick: "b", reject: ["a", "c"] });
    assert.throws(() => planKeepOne(["a", "b"], "z"), /non fa parte del gruppo/);
    const status: Record<string, "picked" | "rejected" | "unmarked"> = { a: "rejected", b: "unmarked" };
    assert.equal(isGroupDecided(["a", "b"], (id) => status[id]), false, "scartarne una non decide il gruppo");
    status.b = "picked";
    assert.equal(isGroupDecided(["a", "b"], (id) => status[id]), true);
  });

  it("le correzioni della sessione separano, tolgono e uniscono le varianti", () => {
    const assets = [asset("a"), asset("b"), asset("c"), asset("far")];
    const capture = captures([["a", 0, "Z6"], ["b", 0.4, "Z6"], ["c", 0.8, "Z6"], ["far", 3600, "Z6"]]);
    const photos = toSimilarityPhotos(assets, capture, noPrints);
    const groupsWith = (overrides: typeof EMPTY_SIMILARITY_OVERRIDES) => findSimilarGroups(photos, overrides).map((group) => [group.kind, group.photoIds]);

    assert.equal(hasSimilarityOverrides(EMPTY_SIMILARITY_OVERRIDES), false);
    assert.deepEqual(groupsWith(EMPTY_SIMILARITY_OVERRIDES), [["burst", ["a", "b", "c"]]]);

    const separated = separatePhotos(EMPTY_SIMILARITY_OVERRIDES, ["a", "b", "c"]);
    assert.deepEqual(groupsWith(separated), [], "Separa: nessuna resta insieme");
    assert.equal(separatePhotos(separated, ["a", "b", "c"]).apart.length, 3, "nessuna coppia doppia");

    const detached = detachPhoto(EMPTY_SIMILARITY_OVERRIDES, "c", ["a", "b", "c"]);
    assert.deepEqual(groupsWith(detached), [["burst", ["a", "b"]]], "Togli dal gruppo: le altre restano insieme");

    const joined = joinPhotos(EMPTY_SIMILARITY_OVERRIDES, ["c", "far"]);
    assert.deepEqual(groupsWith(joined), [["manual", ["a", "b", "c", "far"]]], "Unisci: anche foto scattate lontane");

    const rejoined = joinPhotos(separated, ["a", "b"]);
    assert.deepEqual(rejoined.apart, [["a", "c"], ["b", "c"]], "unire annulla le coppie «non simili» tra le foto scelte");
    assert.deepEqual(joinPhotos(joinPhotos(EMPTY_SIMILARITY_OVERRIDES, ["a", "far"]), ["far", "c"]).together, [["far", "c", "a"]], "gruppi uniti che si toccano diventano uno");
    assert.equal(joinPhotos(EMPTY_SIMILARITY_OVERRIDES, ["a"]), EMPTY_SIMILARITY_OVERRIDES, "una foto sola non cambia nulla");
  });

  it("riduce le miniature a 200 px sul lato lungo senza ingrandirle", () => {
    assert.deepEqual(fingerprintSize(400, 300), { width: 200, height: 150 });
    assert.deepEqual(fingerprintSize(300, 600), { width: 100, height: 200 });
    assert.deepEqual(fingerprintSize(120, 80), { width: 120, height: 80 });
    assert.deepEqual(fingerprintSize(5000, 10), { width: 200, height: 1 });
    assert.deepEqual(fingerprintSize(0, 80), { width: 0, height: 0 });
  });
});
