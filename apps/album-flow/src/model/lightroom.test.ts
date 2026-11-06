import assert from "node:assert/strict";
import { test } from "node:test";
import { makeProject } from "./fixtures";
import { applySidecarReadings, setColorLabel, setPickStatus } from "./library";

/** Colore, scarto e lettura da Lightroom: ciò che Album Flow scrive nei file XMP e rilegge. */

test("selezionata, scartata e senza segno valgono per più foto e non fanno nulla se già così", () => {
  const project = makeProject(4);
  const picked = setPickStatus(project, ["a0", "a1"], "picked");
  assert.deepEqual(picked.assets.map((asset) => asset.pickStatus ?? "unmarked"), ["picked", "picked", "unmarked", "unmarked"]);
  assert.equal(setPickStatus(picked, ["a0", "a1"], "picked"), picked, "già così: nessuna modifica");
  assert.equal(setPickStatus(picked, ["a0"], "unmarked").assets[0].pickStatus, "unmarked");
  assert.equal(setPickStatus(project, ["inesistente"], "rejected"), project);
});

test("il colore si assegna e si toglie", () => {
  const project = makeProject(3);
  const red = setColorLabel(project, ["a1"], "red");
  assert.equal(red.assets[1].colorLabel, "red");
  assert.equal(setColorLabel(red, ["a1"], "red"), red);
  assert.equal(setColorLabel(red, ["a1"], null).assets[1].colorLabel, null);
});

test("la lettura da Lightroom aggiorna stelle, segno e colore solo dove sono cambiati", () => {
  const project = makeProject(3);
  const before = project.assets.map((asset) => asset.rating);
  const { project: next, changed } = applySidecarReadings(project, [
    { assetId: "a0", rating: before[0] ?? 0, pickStatus: "unmarked", colorLabel: null },
    { assetId: "a1", rating: 5, pickStatus: "rejected", colorLabel: "blue" },
    { assetId: "sconosciuta", rating: 3, pickStatus: "picked", colorLabel: "red" },
  ]);
  assert.equal(changed, 1);
  assert.equal(next.assets[0], project.assets[0], "la foto invariata resta la stessa");
  assert.equal(next.assets[1].rating, 5);
  assert.equal(next.assets[1].selectorRating, 5);
  assert.equal(next.assets[1].pickStatus, "rejected");
  assert.equal(next.assets[1].colorLabel, "blue");
  assert.equal(applySidecarReadings(next, []).project, next, "senza letture niente cambia");
});

test("con «stelle solo di questo album» la lettura non tocca le stelle ma aggiorna segno e colore", () => {
  const project = makeProject(2, {});
  const mine = { ...project, settings: { ...project.settings, ratingPolicy: "project" as const } };
  const { project: next } = applySidecarReadings(mine, [{ assetId: "a1", rating: 5, pickStatus: "picked", colorLabel: "green" }]);
  assert.equal(next.assets[1].rating, mine.assets[1].rating);
  assert.equal(next.assets[1].pickStatus, "picked");
  assert.equal(next.assets[1].colorLabel, "green");
});

test("una lettura senza stelle (file senza valutazione) lascia le stelle dell'album", () => {
  const project = makeProject(2);
  const { project: next } = applySidecarReadings(project, [{ assetId: "a1", rating: null, pickStatus: "unmarked", colorLabel: "yellow" }]);
  assert.equal(next.assets[1].rating, project.assets[1].rating);
  assert.equal(next.assets[1].colorLabel, "yellow");
});
