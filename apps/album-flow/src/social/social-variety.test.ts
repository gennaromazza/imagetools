import { test } from "node:test";
import assert from "node:assert/strict";
import { assertCarouselInvariants } from "./check";
import { resizeCarousel } from "./edit";
import { freshSeed, reselectPhotos, restyle, variation } from "./plan";
import { parseCarousel } from "./store";
import { album, plan } from "./testkit";
import { SETS, TEMPLATES, arcFor, templatesForSet } from "./templates";
import { usedAssetIds } from "./edit";

// Varietà: tanti modelli e un ordine diverso a ogni carosello, così quelli fatti a una settimana di distanza non escono uguali.

const sequence = (carousel: ReturnType<typeof plan>) => carousel.slides.map((slide) => slide.templateId).join(",");

test("catalogo: molti modelli per stile e nessuno dimenticato fuori dalle trame", () => {
  assert.ok(TEMPLATES.length >= 50, `solo ${TEMPLATES.length} modelli in totale`);
  for (const set of SETS) assert.ok(templatesForSet(set.id).length >= 25, `${set.id}: ${templatesForSet(set.id).length} modelli tra cui scegliere`);
  const reachable = new Set<string>(["sh-pano", "sh-mockup"]);
  for (const set of SETS) for (const id of [set.arc.open, set.arc.close, ...set.arc.middle, ...(set.closeAlt ?? [])]) reachable.add(id);
  const orphans = TEMPLATES.filter((template) => !reachable.has(template.id)).map((template) => template.id);
  assert.deepEqual(orphans, [], `modelli che nessuna trama propone mai: ${orphans.join(", ")}`);
  for (const set of SETS) {
    assert.equal(new Set(set.arc.middle).size, set.arc.middle.length, `${set.id}: modelli doppi nella trama`);
    assert.ok(set.arc.middle.length >= 18, `${set.id}: trama di mezzo troppo corta (${set.arc.middle.length})`);
  }
});

test("seme: senza seme la trama è quella di base; con un seme i modelli cambiano ordine, sempre gli stessi e sempre lo stesso ordine", () => {
  for (const set of SETS) {
    assert.deepEqual(arcFor(set, 0), { open: set.arc.open, middle: [...set.arc.middle], close: set.arc.close });
    assert.deepEqual(arcFor(set), arcFor(set, 0));
    const shuffled = arcFor(set, 12345);
    assert.deepEqual([...shuffled.middle].sort(), [...set.arc.middle].sort(), "stessi modelli, ordine diverso");
    assert.notDeepEqual(shuffled.middle, set.arc.middle);
    assert.deepEqual(arcFor(set, 12345), shuffled, "stesso seme, stesso ordine");
    assert.ok([set.arc.close, ...(set.closeAlt ?? [])].includes(shuffled.close));
    const orders = new Set(Array.from({ length: 30 }, (_, index) => arcFor(set, index + 1).middle.slice(0, 6).join(",")));
    assert.ok(orders.size >= 25, `${set.id}: pochi ordini diversi (${orders.size} su 30)`);
  }
});

test("seme: caroselli diversi dallo stesso album, validi, con specchi solo dove hanno senso", () => {
  const project = album();
  const base = plan(project, { count: 10, setId: "moda" });
  assert.ok(base.slides.every((slide) => !slide.flip), "senza seme niente specchi");
  assert.equal(base.seed, undefined);
  const sequences = new Set<string>();
  let flips = 0;
  for (let seed = 1; seed <= 12; seed += 1) {
    const carousel = plan(project, { count: 10, setId: "moda", seed });
    assertCarouselInvariants(carousel, project);
    assert.equal(carousel.seed, seed);
    assert.equal(carousel.slides[0].templateId, "mo-cover", "l'apertura è sempre quella dello stile");
    assert.ok(["sh-closing"].includes(carousel.slides[9].templateId), "la chiusura è sempre una chiusura");
    for (const slide of carousel.slides) {
      if (slide.flip) {
        flips += 1;
        assert.ok(!slide.span && !["sh-mockup", "sh-pano"].includes(slide.templateId), "panorama e album non si specchiano");
      }
    }
    assert.ok(!carousel.slides[0].flip && !carousel.slides[9].flip, "apertura e chiusura restano dritte");
    sequences.add(sequence(carousel));
    assert.equal(sequence(plan(project, { count: 10, setId: "moda", seed })), sequence(carousel), "stesso seme, stesso carosello");
  }
  assert.ok(sequences.size >= 10, `solo ${sequences.size} caroselli diversi su 12 semi`);
  assert.ok(flips >= 10, `troppo pochi specchi (${flips} su 12 caroselli)`);
  assert.ok(freshSeed() > 0 && freshSeed() !== freshSeed(), "ogni carosello nuovo riceve un seme diverso");
  assert.ok(plan(project, { setId: "cinema", count: 8, seed: 1 }).slides.length === 8);
  const closings = new Set(Array.from({ length: 40 }, (_, index) => plan(project, { setId: "cinema", count: 8, seed: index + 1 }).slides[7].templateId));
  assert.ok(closings.has("ci-credits") && closings.has("sh-closing"), "in Cinema la chiusura può essere anche i titoli di coda");
});

test("seme: ridimensionare, riscegliere le foto e cambiare stile non perdono la varietà", () => {
  const project = album();
  const carousel = plan(project, { count: 8, setId: "galleria", seed: 777 });
  const bigger = resizeCarousel(carousel, project, 20);
  assertCarouselInvariants(bigger, project);
  assert.equal(bigger.seed, 777);
  assert.equal(bigger.slides.length, 20);
  const middle = arcFor(SETS.find((set) => set.id === "galleria")!, 777).middle;
  const added = bigger.slides.filter((slide) => !carousel.slides.some((old) => old.id === slide.id)).map((slide) => slide.templateId);
  assert.ok(added.every((id) => middle.includes(id)), "le slide aggiunte seguono la trama di questo carosello");

  const again = reselectPhotos(project, carousel);
  assert.equal(sequence(again), sequence(carousel), "riscegliere le foto non cambia i modelli");
  assert.deepEqual(again.slides.map((slide) => Boolean(slide.flip)), carousel.slides.map((slide) => Boolean(slide.flip)), "né gli specchi");
  const other = restyle(project, carousel, "editoriale");
  assert.equal(other.seed, 777);
  assertCarouselInvariants(other, project);
});

test("altra variante: stessi stile, foto e testi scritti, ma modelli in un altro ordine", () => {
  const project = album();
  const carousel = plan(project, { count: 10, setId: "editoriale", seed: 5 });
  const edited = { ...carousel, slides: carousel.slides.map((slide, index) => (index === 0 ? { ...slide, texts: { title: "Titolo mio" } } : slide)) };
  const next = variation(project, edited, 99);
  assertCarouselInvariants(next, project);
  assert.equal(next.id, carousel.id);
  assert.equal(next.setId, "editoriale");
  assert.equal(next.slides.length, 10);
  assert.equal(next.seed, 99);
  assert.notEqual(sequence(next), sequence(edited));
  assert.equal(next.slides[0].texts.title, "Titolo mio", "il testo scritto passa alla stessa slide");
  const before = [...usedAssetIds(edited)];
  const kept = before.filter((id) => usedAssetIds(next).has(id)).length;
  assert.ok(kept >= before.length * 0.6, `le foto già scelte restano (${kept}/${before.length})`);
});

test("seme: si salva e si rilegge, un valore assurdo si scarta", () => {
  const project = album();
  const carousel = plan(project, { count: 6, seed: 4242 });
  assert.equal(parseCarousel(JSON.parse(JSON.stringify(carousel)))!.seed, 4242);
  for (const bad of [-5, 0, 1.5, "7", 1e12, null]) {
    const raw = JSON.parse(JSON.stringify(carousel)) as Record<string, unknown>;
    raw.seed = bad;
    assert.equal(parseCarousel(raw)!.seed, undefined, `seme non valido: ${String(bad)}`);
  }
});
