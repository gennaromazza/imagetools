import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSlide } from "./build";
import { assertCarouselInvariants } from "./check";
import { addPanorama, setSlideFlip, setSlideFraming, setSlidePhoto, setSlideTemplate } from "./edit";
import { focusRange, normalizeFraming, rotateDelta } from "./framing";
import { coverFit, fitWindow, mirrorLayers } from "./kit";
import { parseCarousel } from "./store";
import { album, envOf, plan, slideFor, withSlides } from "./testkit";
import type { Carousel, PhotoLayer } from "./types";

// Inquadratura delle foto dentro i modelli (zoom, spostamento, forma) e disposizione speculare.

const photoOf = (carousel: Carousel, project: ReturnType<typeof album>, index = 0): PhotoLayer =>
  buildSlide(carousel, index, envOf(project)).layers.find((layer): layer is PhotoLayer => layer.kind === "photo")!;

test("inquadratura: valori corretti, nulla da salvare quando è quella predefinita, spostamento limitato a ciò che si vede", () => {
  assert.equal(normalizeFraming({ zoom: 1, cx: 0.5, cy: 0.5 }), null);
  assert.equal(normalizeFraming(null), null);
  assert.deepEqual(normalizeFraming({ zoom: 9, cx: -3, cy: 4, shape: 1.5 }), { zoom: 4, cx: 0, cy: 1, shape: 1.5 });
  assert.deepEqual(normalizeFraming({ zoom: 2, cx: Number.NaN, cy: 0.5, shape: 99 }), { zoom: 2, cx: 0.5, cy: 0.5 }, "NaN e forme assurde si scartano");
  assert.equal(normalizeFraming({ zoom: 2, cx: 0.5, cy: 0.5, shape: 1.5 }, false)!.shape, undefined, "nei panorami la forma non si cambia");
  assert.deepEqual(focusRange(100, 100), [0.5, 0.5]);
  const [low, high] = focusRange(100, 400);
  assert.ok(Math.abs(low - 0.125) < 1e-9 && Math.abs(high - 0.875) < 1e-9);
  const frame = { x: 10, y: 10, w: 100, h: 100 };
  assert.equal(coverFit(frame, 4, 1, low, 0.5).x, frame.x, "al limite sinistro il bordo dell'immagine tocca la cornice");
  const right = coverFit(frame, 4, 1, high, 0.5);
  assert.ok(Math.abs(right.x + right.w - (frame.x + frame.w)) < 0.01, "e a destra pure");
  assert.deepEqual(fitWindow({ x: 0, y: 0, w: 400, h: 300 }, 1), { x: 50, y: 0, w: 300, h: 300 }, "la finestra 1:1 sta al centro dello spazio");
  assert.deepEqual(fitWindow({ x: 0, y: 0, w: 300, h: 400 }, 2), { x: 0, y: 125, w: 300, h: 150 });
});

test("inquadratura: si applica ai livelli, gli sfondi sfocati restano fermi, la forma è una finestra dentro lo spazio", () => {
  const project = album();
  const hero = { ...slideFor("ed-hero", project), id: "h" };
  const carousel = withSlides(plan(project, { count: 4 }), [hero, hero]);
  const plain = photoOf(carousel, project);
  assert.equal(plain.zoom, 1);
  const moved = photoOf(setSlideFraming(carousel, "h", 0, { zoom: 2, cx: 0.2, cy: 0.7 }), project);
  assert.deepEqual([moved.zoom, moved.cx, moved.cy], [2, 0.2, 0.7]);
  const squared = photoOf(setSlideFraming(carousel, "h", 0, { shape: 1 }), project);
  assert.ok(Math.abs(squared.w / squared.h - 1) < 0.001, "la finestra ha la forma scelta");
  assert.ok(squared.x >= plain.x - 0.01 && squared.y >= plain.y - 0.01 && squared.x + squared.w <= plain.x + plain.w + 0.01 && squared.y + squared.h <= plain.y + plain.h + 0.01, "e sta dentro lo spazio del modello");
  assert.ok(Math.abs(squared.x + squared.w / 2 - (plain.x + plain.w / 2)) < 0.01, "centrata");

  const strip = { ...slideFor("ci-strip", project), id: "s" };
  const framed = setSlideFraming(withSlides(plan(project, { count: 4 }), [strip, strip]), "s", 0, { zoom: 3, cx: 0.1, cy: 0.1, shape: 1 });
  const photos = buildSlide(framed, 0, envOf(project)).layers.filter((layer): layer is PhotoLayer => layer.kind === "photo");
  const background = photos.find((layer) => layer.blur)!;
  assert.equal(background.zoom, 1, "lo sfondo sfocato non segue l'inquadratura");
  assert.ok(background.w > 1080, "e non perde la sua estensione");
});

test("inquadratura: modifiche pure, nuova foto = inquadratura da capo, scambio porta con sé l'inquadratura, panorama sempre in blocco", () => {
  const project = album();
  const base = plan(project, { count: 4 });
  const strip = { ...slideFor("ci-strip", project), id: "s" };
  let carousel = withSlides(base, [strip, strip]);
  assert.equal(setSlideFraming(carousel, "s", 0, null), carousel, "nessuna inquadratura da cancellare");
  assert.equal(setSlideFraming(carousel, "s", 7, { zoom: 2 }), carousel, "spazio inesistente");
  carousel = setSlideFraming(carousel, "s", 0, { zoom: 9 });
  assert.equal(carousel.slides[0].framing![0]!.zoom, 4, "lo zoom ha un limite");
  assert.equal(setSlideFraming(carousel, "s", 0, { zoom: 4 }), carousel, "lo stesso valore non cambia nulla");
  carousel = setSlideFraming(carousel, "s", 2, { cx: 0.3 });
  assert.equal(carousel.slides[0].framing!.length, 3);
  const third = carousel.slides[0].photos[2];
  const swapped = setSlidePhoto(carousel, "s", 0, third);
  assert.equal(swapped.slides[0].framing![2]!.zoom, 4, "l'inquadratura segue la foto nello scambio");
  assert.equal(swapped.slides[0].framing![0]!.cx, 0.3);
  const another = setSlidePhoto(carousel, "s", 0, project.assets[36].id);
  assert.ok(!another.slides[0].framing![0], "una foto nuova riparte dall'inquadratura predefinita");
  assert.equal(another.slides[0].framing![2]!.cx, 0.3, "le altre foto non cambiano");
  const cleared = setSlideFraming(setSlideFraming(carousel, "s", 0, null), "s", 2, null);
  assert.ok(!("framing" in cleared.slides[0]), "senza inquadrature non resta nessun campo");
  assert.equal(setSlideTemplate(carousel, project, "s", "ci-duo").slides[0].framing, undefined, "cambiando modello le inquadrature ripartono");

  const pano = addPanorama(withSlides(base, [slideFor("ed-cover", project), slideFor("ed-cta", project)]), project.assets[7].id, 3);
  const first = pano.slides.find((slide) => slide.span)!;
  const moved = setSlideFraming(pano, first.id, 0, { zoom: 2, cx: 0.3, shape: 1 });
  assertCarouselInvariants(moved, project);
  const parts = moved.slides.filter((slide) => slide.span);
  assert.equal(parts.length, 3);
  assert.ok(parts.every((part) => part.framing![0]!.zoom === 2 && part.framing![0]!.cx === 0.3 && part.framing![0]!.shape === undefined), "il panorama si inquadra per intero e senza cambiare forma");
  assert.equal(setSlideFlip(pano, first.id, true), pano, "un panorama non si specchia");
});

test("specchio: ogni elemento passa dall'altra parte, due specchi rendono l'originale, inquadratura e specchio si salvano", () => {
  const project = album();
  const slide = { ...slideFor("ga-savedate", project), id: "f" };
  const carousel = withSlides(plan(project, { count: 4 }), [slide, slide]);
  const normal = buildSlide(carousel, 0, envOf(project)).layers;
  const flipped = buildSlide(setSlideFlip(carousel, "f", true), 0, envOf(project)).layers;
  assert.equal(flipped.length, normal.length);
  for (let index = 0; index < normal.length; index += 1) {
    const before = normal[index];
    const after = flipped[index];
    if (before.kind === "photo" || before.kind === "rect") assert.ok(Math.abs(before.x + before.w + (after as typeof before).x - 1080) < 0.02, "specchiata rispetto al centro della tela");
    if (before.kind === "text") assert.equal((after as typeof before).align, before.align === "left" ? "right" : before.align === "right" ? "left" : "center");
  }
  assert.deepEqual(mirrorLayers(mirrorLayers(normal, 1080), 1080), normal, "specchiare due volte riporta all'originale");
  assert.equal(setSlideFlip(setSlideFlip(carousel, "f", true), "f", false).slides[0].flip, undefined);
  assert.equal(setSlideFlip(carousel, "f", false), carousel);

  const saved = parseCarousel(JSON.parse(JSON.stringify(setSlideFlip(setSlideFraming(carousel, "f", 0, { zoom: 2, shape: 0.8 }), "f", true))))!;
  assert.equal(saved.slides[0].flip, true);
  assert.deepEqual(saved.slides[0].framing![0], { zoom: 2, cx: 0.5, cy: 0.5, shape: 0.8 }, "inquadratura e specchio sopravvivono al salvataggio");
  const broken = JSON.parse(JSON.stringify(carousel)) as { slides: Array<Record<string, unknown>> };
  broken.slides[0].framing = [{ zoom: 99, cx: "x", cy: -1, shape: 1000 }, "no", null, 7, 8];
  const cleaned = parseCarousel(broken)!;
  assert.deepEqual(cleaned.slides[0].framing![0], { zoom: 4, cx: 0.5, cy: 0 }, "valori assurdi corretti");
  assert.equal(cleaned.slides[0].framing!.length, 4, "una inquadratura per foto");
});

test("trascinamento di una foto inclinata: lo spostamento si riporta nel sistema della foto", () => {
  const near = (value: number, expected: number) => assert.ok(Math.abs(value - expected) < 1e-9, `${value} ≠ ${expected}`);
  const straight = rotateDelta(10, 4, 0);
  near(straight.dx, 10); near(straight.dy, 4);
  const quarter = rotateDelta(10, 0, 90);
  near(quarter.dx, 0); near(quarter.dy, -10);
  const back = rotateDelta(quarter.dx, quarter.dy, -90);
  near(back.dx, 10); near(back.dy, 0);
  const tilted = rotateDelta(30, -12, -5);
  near(Math.hypot(tilted.dx, tilted.dy), Math.hypot(30, -12));
});
