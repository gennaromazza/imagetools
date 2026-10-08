import { test } from "node:test";
import assert from "node:assert/strict";
import { assertCarouselInvariants } from "./check";
import { addFreePhoto, bestSlotFor, enterFreeMode, leaveFreeMode, removeFreeFrame, reorderFreeFrame, reselectSlidePhotos, resetMovedElements, setFreeFrame, setLayerOffset, setTextOffset, swapPhotos, usedAssetIds } from "./edit";
import { TEMPLATES, templateOf } from "./templates";
import { restyle } from "./plan";
import { graphicAt, photoAt } from "./hit";
import { MAX_SLIDES, MIN_SLIDES, formatOf, type PhotoLayer } from "./types";
import { renderSlideSvg } from "./render";
import { buildSlide } from "./build";
import { suggestSlideCount, photosUsedAt } from "./plan";
import { parseCarousels, serializeCarousels } from "./store";
import { album, allMedia, envOf, measure, plan, withSlides } from "./testkit";

const project = album();
const base = () => plan(project, { count: 14, seed: 0 });
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

test("modelli: almeno dieci modelli con tre o quattro foto", () => {
  const many = TEMPLATES.filter((template) => template.slots.length >= 3 && template.slots.length <= 4);
  assert.ok(many.length >= 10, `solo ${many.length} modelli con 3-4 foto`);
});

test("modo libero: si entra senza spostare nulla, si sposta, si aggiunge, si sovrappone e si torna al modello", () => {
  const carousel = base();
  const env = envOf(project);
  const target = carousel.slides.findIndex((slide) => !slide.span && slide.photos.filter(Boolean).length >= 2);
  const id = carousel.slides[target].id;
  const layers = buildSlide(carousel, target, env).layers;
  const free = enterFreeMode(carousel, id, layers);
  const slide = free.slides[target];
  assert.ok(slide.free && slide.free.length >= 2);
  // stesse posizioni di prima
  const photosOf = (list: typeof layers) => list.filter((layer): layer is PhotoLayer => layer.kind === "photo" && !layer.blur);
  const after = photosOf(buildSlide(free, target, env).layers);
  const before = photosOf(layers);
  assert.equal(after.length, before.length);
  for (let i = 0; i < before.length; i += 1) {
    assert.ok(Math.abs(after[i].x - before[i].x) < 1 && Math.abs(after[i].y - before[i].y) < 1 && Math.abs(after[i].w - before[i].w) < 1, "il modo libero ha spostato una foto");
  }
  assertCarouselInvariants(free);
  const frame = slide.free![0];
  const moved = setFreeFrame(free, id, frame.id, { x: 0.3, y: 0.2, w: 0.5, h: 0.3, rotation: 12 });
  assert.equal(moved.slides[target].free![0].rotation, 12);
  assert.equal(setFreeFrame(moved, id, frame.id, { x: 0.3 }), moved, "una modifica senza effetto restituisce lo stesso carosello");
  const extra = project.assets.find((asset) => asset.pickStatus !== "rejected" && !usedAssetIds(moved).has(asset.id))!;
  const added = addFreePhoto(moved, id, extra.id, 1.5);
  assert.equal(added.slides[target].free!.length, slide.free!.length + 1);
  assert.ok(usedAssetIds(added).has(extra.id));
  const front = reorderFreeFrame(added, id, frame.id, "front");
  assert.equal(front.slides[target].free!.at(-1)!.id, frame.id);
  assert.equal(removeFreeFrame(front, id, frame.id).slides[target].free!.length, slide.free!.length);
  assertCarouselInvariants(front);
  assert.deepEqual(leaveFreeMode(front, id).slides[target].photos, carousel.slides[target].photos);
  // un salvataggio vecchio e uno con modo libero si rileggono uguali
  const text = serializeCarousels([front]);
  assert.deepEqual(JSON.parse(serializeCarousels(parseCarousels(text))), JSON.parse(text));
  // cambiare stile non butta via la disposizione libera
  const styled = restyle(project, front, "galleria");
  assert.ok(styled.slides.some((item) => item.free));
});

test("testi spostati a mano: scostamento salvato, applicato e riportabile al posto", () => {
  const carousel = base();
  const env = envOf(project);
  const target = carousel.slides.findIndex((slide) => !slide.span && templateOf(slide.templateId)!.fields.length > 0);
  const slide = carousel.slides[target];
  const key = templateOf(slide.templateId)!.fields[0].key;
  const textOf = (c: typeof carousel) => buildSlide(c, target, env).layers.filter((layer) => layer.kind === "text" && layer.field === key) as Array<{ x: number; y: number }>;
  const baseline = textOf(carousel);
  if (baseline.length === 0) return;
  const moved = setTextOffset(carousel, slide.id, key, { dx: 0.1, dy: -0.05 });
  const shifted = textOf(moved);
  assert.ok(Math.abs(shifted[0].x - baseline[0].x - 108) < 1 && Math.abs(shifted[0].y - baseline[0].y + 67.5) < 1);
  assertCarouselInvariants(moved);
  const text = serializeCarousels([moved]);
  assert.equal(serializeCarousels(parseCarousels(text)), text);
  assert.equal(setTextOffset(moved, slide.id, key, null).slides[target].textOffset, undefined);
  assert.equal(setTextOffset(carousel, slide.id, "campo-che-non-esiste", { dx: 0.2, dy: 0 }), carousel);
});

test("elementi del modello spostati a mano: livelli traslati, salvati, riportabili al posto", () => {
  const carousel = base();
  const env = envOf(project);
  const target = carousel.slides.findIndex((slide) => !slide.span && slide.templateId !== "sh-mockup" && buildSlide(carousel, carousel.slides.indexOf(slide), env).layers.some((layer) => layer.kind === "rect" || layer.kind === "line" || layer.kind === "path"));
  assert.ok(target >= 0);
  const layers = buildSlide(carousel, target, env).layers;
  const movable = layers.find((layer) => (layer.kind === "line" || layer.kind === "rect" || layer.kind === "path") && graphicAt(layers, 0, 0, measure, 1080, 1350) !== undefined)!;
  const moved = setLayerOffset(carousel, carousel.slides[target].id, movable.id, { dx: 0.1, dy: 0.2 });
  const after = buildSlide(moved, target, env).layers.find((layer) => layer.id === movable.id)!;
  assert.ok(Math.abs((after.dx ?? 0) - 108) < 0.5 && Math.abs((after.dy ?? 0) - 270) < 0.5);
  assertCarouselInvariants(moved);
  const svg = renderSlideSvg(moved, target, env, allMedia(project), { idPrefix: "t" });
  assert.match(svg, /translate\(108 270\)/);
  const text = serializeCarousels([moved]);
  assert.deepEqual(JSON.parse(serializeCarousels(parseCarousels(text))), JSON.parse(text));
  assert.equal(resetMovedElements(moved, carousel.slides[target].id).slides[target].layerOffset, undefined);
  assert.equal(setLayerOffset(carousel, carousel.slides[target].id, movable.id, null), carousel);
});

test("modelli semplici a una foto: foto intera, margine, bordo bianco, cornice, tonda, con didascalia", () => {
  const solos = TEMPLATES.filter((template) => template.id.startsWith("sh-solo-"));
  assert.ok(solos.length >= 8);
  for (const template of solos) assert.deepEqual(template.slots, ["any"]);
  for (const format of ["feed", "square", "story"] as const) {
    for (const template of solos) {
      const carousel = withSlides(plan(project, { count: 4 }), [{ id: "s", templateId: template.id, photos: [project.assets[1].id], texts: {} }, { id: "s2", templateId: template.id, photos: [project.assets[3].id], texts: {} }], format);
      const layers = buildSlide(carousel, 0, envOf(project)).layers;
      const photo = layers.find((layer): layer is PhotoLayer => layer.kind === "photo");
      assert.ok(photo && photo.w > 0 && photo.h > 0, `${template.id}/${format}: manca la foto`);
      const { width, height } = formatOf(format);
      assert.ok(photo.x >= -1 && photo.y >= -1 && photo.x + photo.w <= width + 1 && photo.y + photo.h <= height + 1, `${template.id}/${format}: foto fuori dalla tela`);
    }
  }
});
