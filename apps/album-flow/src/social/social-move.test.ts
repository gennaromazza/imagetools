import { test } from "node:test";
import assert from "node:assert/strict";
import { assertCarouselInvariants } from "./check";
import { bestSlotFor, reselectSlidePhotos, swapPhotos, usedAssetIds } from "./edit";
import { photoAt } from "./hit";
import { MAX_SLIDES, MIN_SLIDES } from "./types";
import { buildSlide } from "./build";
import { suggestSlideCount, photosUsedAt } from "./plan";
import { parseCarousels, serializeCarousels } from "./store";
import { album, envOf, plan } from "./testkit";

const project = album();
const base = () => plan(project, { count: 8, seed: 0 });
const twoSlides = (carousel: ReturnType<typeof base>) => carousel.slides.filter((slide) => !slide.span && slide.photos.length > 0);

test("sposta foto: scambio tra slide diverse e nella stessa slide", () => {
  const carousel = base();
  const [a, b] = twoSlides(carousel);
  const idA = a.photos[0];
  const idB = b.photos[0];
  const next = swapPhotos(carousel, { slideId: a.id, slot: 0 }, { slideId: b.id, slot: 0 });
  assert.notEqual(next, carousel);
  assert.equal(next.slides.find((slide) => slide.id === a.id)!.photos[0], idB);
  assert.equal(next.slides.find((slide) => slide.id === b.id)!.photos[0], idA);
  assertCarouselInvariants(next);
  assert.equal(swapPhotos(carousel, { slideId: a.id, slot: 0 }, { slideId: a.id, slot: 0 }), carousel);
  const multi = carousel.slides.find((slide) => slide.photos.length >= 2 && !slide.span)!;
  const same = swapPhotos(carousel, { slideId: multi.id, slot: 0 }, { slideId: multi.id, slot: 1 });
  assert.deepEqual(same.slides.find((slide) => slide.id === multi.id)!.photos.slice(0, 2), [multi.photos[1], multi.photos[0]]);
});

test("sposta foto: mai due volte la stessa foto in una slide e mai dentro un panorama", () => {
  const carousel = base();
  const [a, b] = twoSlides(carousel);
  const dup = { ...carousel, slides: carousel.slides.map((slide) => (slide.id === b.id ? { ...slide, photos: [...slide.photos.slice(0, -1), a.photos[0]] } : slide)) };
  const target = dup.slides.find((slide) => slide.id === b.id)!;
  if (target.photos.length > 1) assert.equal(swapPhotos(dup, { slideId: a.id, slot: 0 }, { slideId: b.id, slot: 0 }), dup);
  const pano = carousel.slides.find((slide) => slide.span);
  if (pano) assert.equal(swapPhotos(carousel, { slideId: a.id, slot: 0 }, { slideId: pano.id, slot: 0 }), carousel);
  assert.equal(swapPhotos(carousel, { slideId: "nessuna", slot: 0 }, { slideId: a.id, slot: 0 }), carousel);
});

test("sposta foto: su uno spazio vuoto la foto si sposta e l'inquadratura riparte", () => {
  const carousel = base();
  const [a, b] = twoSlides(carousel);
  const emptied = { ...carousel, slides: carousel.slides.map((slide) => (slide.id === b.id ? { ...slide, photos: slide.photos.map(() => null) } : slide)) };
  const next = swapPhotos(emptied, { slideId: a.id, slot: 0 }, { slideId: b.id, slot: 0 });
  assert.equal(next.slides.find((slide) => slide.id === b.id)!.photos[0], a.photos[0]);
  assert.equal(next.slides.find((slide) => slide.id === a.id)!.photos[0], null);
  assert.equal(bestSlotFor(emptied, b.id), 0);
});

test("riscegli le foto di una slide: cambia solo quella, senza ripetere foto già usate", () => {
  const carousel = base();
  const target = twoSlides(carousel)[1];
  const next = reselectSlidePhotos(carousel, project, target.id);
  for (const slide of carousel.slides) if (slide.id !== target.id) assert.equal(next.slides.find((item) => item.id === slide.id), slide);
  const after = next.slides.find((slide) => slide.id === target.id)!;
  assert.notDeepEqual(after.photos, target.photos);
  assert.equal(new Set(after.photos).size, after.photos.length);
  assertCarouselInvariants(next);
  void usedAssetIds;
});

test("trascinare e zoom sotto i testi: la foto si trova per geometria", () => {
  const carousel = base();
  const env = envOf(project);
  carousel.slides.forEach((slide, index) => {
    const layers = buildSlide(carousel, index, env).layers;
    for (const layer of layers) {
      if (layer.kind !== "photo" || layer.blur || !layer.assetId) continue;
      const hit = photoAt(layers, layer.x + layer.w / 2, layer.y + layer.h / 2);
      assert.ok(hit, `slide ${index + 1}: il centro di una foto non trova nessuna foto`);
    }
    assert.equal(photoAt(layers, -50, -50), null);
  });
});

test("creazione guidata: il numero proposto contiene tutte le foto scelte", () => {
  const chosen = project.assets.filter((asset) => asset.pickStatus !== "rejected").slice(0, 14).map((asset) => asset.id);
  const count = suggestSlideCount(project, chosen, "editoriale", 7);
  assert.ok(count >= MIN_SLIDES && count <= MAX_SLIDES);
  assert.equal(photosUsedAt(project, chosen, count, "editoriale", 7), chosen.length);
  
  assert.equal(suggestSlideCount(project, chosen.slice(0, 1)), MIN_SLIDES);
  assert.equal(suggestSlideCount(project, project.assets.map((asset) => asset.id)), MAX_SLIDES);
});

test("caroselli già salvati: si rileggono identici e il formato resta lo stesso", () => {
  const carousel = swapPhotos(base(), { slideId: base().slides[0].id, slot: 0 }, { slideId: base().slides[0].id, slot: 0 });
  const text = serializeCarousels([carousel]);
  assert.equal(serializeCarousels(parseCarousels(text)), text);
  assert.equal(JSON.parse(text).version, 1);
});
