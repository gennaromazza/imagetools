import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSlide } from "./build";
import { assertCarouselInvariants } from "./check";
import { addSlide, resizeCarousel, usedAssetIds } from "./edit";
import { addPhotosToSlide, allTemplatesForCount, applyTemplateToPhotos, availableInOrder, blankCarousel, isTidy, photoCountOf, templatesForCount, tidyRects, tidySlide } from "./manual";
import { reselectPhotos, restyle, setCarouselPromo, variation } from "./plan";
import { parseCarousel, parseCarousels, serializeCarousels } from "./store";
import { BLANK_ID, SETS, templateOf } from "./templates";
import { album, envOf } from "./testkit";
import { SOCIAL_FORMATS, photosShown, type Carousel, type PhotoLayer } from "./types";
import { defaultBrand } from "./brand";

// Carosello «Da zero»: slide vuote, foto scelte dall'utente, modelli proposti dopo in base a quante foto ci sono.

const project = album();
const env = envOf(project);
const aspectOf = (assetId: string) => env.photos.get(assetId)?.aspect;
const usable = project.assets.filter((asset) => asset.pickStatus !== "rejected");
const ids = usable.map((asset) => asset.id);

const fresh = (assetIds: readonly string[] = ids.slice(0, 12), overrides: Partial<Parameters<typeof blankCarousel>[1]> = {}): Carousel =>
  blankCarousel(project, { setId: "minimal", format: "feed", brand: defaultBrand(project.projectName), name: "A mano", assetIds, ...overrides });

const photoLayers = (carousel: Carousel, index: number): PhotoLayer[] =>
  buildSlide(carousel, index, env).layers.filter((layer): layer is PhotoLayer => layer.kind === "photo" && Boolean(layer.assetId));

test("da zero: le slide partono vuote, in disposizione libera, senza foto messe da noi e senza piano automatico", () => {
  const carousel = fresh();
  assert.equal(carousel.manual, true);
  assert.equal(carousel.slides.length, 2);
  assert.equal(carousel.basis, undefined, "nessuna impronta delle foto migliori: non c'è niente da rifare da soli");
  for (const slide of carousel.slides) {
    assert.equal(slide.templateId, BLANK_ID);
    assert.deepEqual(slide.free, []);
    assert.deepEqual(slide.photos, []);
  }
  assert.equal(usedAssetIds(carousel).size, 0, "nessuna foto scelta al posto tuo");
  assertCarouselInvariants(carousel, project);
  assert.equal(buildSlide(carousel, 0, env).layers.length, 0, "tela vuota");
});

test("da zero: l'elenco delle foto è in ordine di scatto, senza le scartate e senza quelle già usate", () => {
  // Le foto si danno al contrario e con le stelle sparse: l'elenco segue comunque l'ora dello scatto, non l'ordine di arrivo né la classifica.
  let carousel = fresh(ids.slice(0, 10).reverse());
  const before = availableInOrder(carousel, project);
  assert.equal(before.length, 10);
  const times = before.map((asset) => asset.captureTimeMs ?? 0);
  assert.ok(times.every((time) => time > 0), "le foto di prova hanno l'ora di scatto");
  assert.deepEqual(times, [...times].sort((a, b) => a - b), "dalla più vecchia alla più recente");
  assert.notDeepEqual(before.map((asset) => asset.id), ids.slice(0, 10).reverse(), "non segue l'ordine in cui sono state date");
  carousel = addPhotosToSlide(carousel, carousel.slides[0].id, [before[3].id, before[0].id], aspectOf);
  const after = availableInOrder(carousel, project);
  assert.equal(after.length, 8);
  assert.ok(!after.some((asset) => asset.id === before[3].id || asset.id === before[0].id), "le foto messe in una slide escono dall'elenco");
  assert.ok(availableInOrder(fresh(project.assets.filter((asset) => asset.pickStatus === "rejected").map((asset) => asset.id)), project).length === 0, "le scartate non si propongono");
});

test("da zero: le foto entrano nell'ordine in cui le scegli, intere, senza rotazione né ritagli", () => {
  let carousel = fresh();
  const slideId = carousel.slides[0].id;
  const picked = [ids[5], ids[1], ids[9]];
  for (const id of picked) carousel = addPhotosToSlide(carousel, slideId, [id], aspectOf);
  const frames = carousel.slides[0].free!;
  assert.deepEqual(frames.map((frame) => frame.assetId), picked, "l'ordine è quello della tua scelta, non una classifica");
  for (const frame of frames) {
    const aspect = aspectOf(frame.assetId!)!;
    assert.ok(Math.abs((frame.w * 1080) / (frame.h * 1350) / aspect - 1) < 0.02, "la finestra ha le proporzioni della foto: intera");
    assert.ok(frame.x >= 0 && frame.y >= 0 && frame.x + frame.w <= 1.0001 && frame.y + frame.h <= 1.0001, "dentro la tela");
    assert.equal(frame.mask, "rect");
    assert.ok(!frame.rotation && !frame.border && !frame.shadow);
  }
  assert.equal(addPhotosToSlide(carousel, slideId, [picked[0]], aspectOf), carousel, "la stessa foto non entra due volte nella slide");
  assertCarouselInvariants(carousel, project);
});

test("da zero: se sposti una foto a mano le nuove non rimettono in ordine il tuo lavoro; «Ordina le foto» sì", () => {
  let carousel = fresh();
  const slideId = carousel.slides[0].id;
  carousel = addPhotosToSlide(addPhotosToSlide(carousel, slideId, [ids[0]], aspectOf), slideId, [ids[1]], aspectOf);
  const { width, height } = { width: 1080, height: 1350 };
  assert.ok(isTidy(carousel.slides[0].free!, aspectOf, width, height), "appena messe sono in ordine");
  const moved = { ...carousel, slides: carousel.slides.map((slide, index) => (index === 0 ? { ...slide, free: slide.free!.map((frame, at) => (at === 0 ? { ...frame, x: 0.31, y: 0.07 } : frame)) } : slide)) };
  assert.ok(!isTidy(moved.slides[0].free!, aspectOf, width, height));
  const more = addPhotosToSlide(moved, slideId, [ids[2]], aspectOf);
  assert.equal(more.slides[0].free![0].x, 0.31, "la foto che hai spostato resta dove l'hai messa");
  assert.equal(more.slides[0].free!.length, 3);
  const tidy = tidySlide(more, slideId, aspectOf);
  assert.ok(isTidy(tidy.slides[0].free!, aspectOf, width, height));
  assert.deepEqual(tidy.slides[0].free!.map((frame) => frame.assetId), more.slides[0].free!.map((frame) => frame.assetId), "stesse foto, stesso ordine");
});

test("disposizione ordinata: ogni foto resta dentro la tela e fuori dalle altre, per ogni numero di foto e ogni formato", () => {
  const aspects = [1.5, 0.667, 1, 0.8, 1.5, 0.667, 1, 1.5, 0.8, 1, 0.667, 1.5];
  for (const format of SOCIAL_FORMATS) {
    for (let count = 1; count <= 12; count += 1) {
      const rects = tidyRects(aspects.slice(0, count), format.width, format.height);
      assert.equal(rects.length, count);
      rects.forEach((rect, index) => {
        assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= 1.0001 && rect.y + rect.h <= 1.0001, `${format.id}/${count}: fuori dalla tela`);
        assert.ok(Math.abs((rect.w * format.width) / (rect.h * format.height) / aspects[index] - 1) < 0.01, `${format.id}/${count}: foto deformata o ritagliata`);
        for (let other = index + 1; other < count; other += 1) {
          const o = rects[other];
          const overlap = rect.x < o.x + o.w - 0.0001 && o.x < rect.x + rect.w - 0.0001 && rect.y < o.y + o.h - 0.0001 && o.y < rect.y + rect.h - 0.0001;
          assert.equal(overlap, false, `${format.id}/${count}: le foto ${index} e ${other} si sovrappongono`);
        }
      });
    }
  }
});

test("modelli proposti in base a quante foto ci sono: esattamente quel numero di spazi, mai panorama, album o vendita", () => {
  const carousel = fresh();
  for (const set of SETS) for (let count = 1; count <= 6; count += 1) {
    for (const template of templatesForCount({ ...carousel, setId: set.id }, count)) {
      assert.equal(template.slots.length, count, `${set.id}/${template.id}`);
      assert.ok(!template.needsSpread && !template.promo && template.id !== "sh-pano" && template.id !== BLANK_ID);
    }
  }
  assert.ok(templatesForCount(carousel, 1).length >= 3 && templatesForCount(carousel, 2).length >= 2 && templatesForCount(carousel, 4).length >= 1);
  assert.deepEqual(templatesForCount(carousel, 0), []);
  assert.ok(templatesForCount({ ...carousel, setId: "editoriale" }, 3).length >= 2, "gli stili ricchi ne hanno per tre foto");
});

test("applicare un modello usa esattamente le tue foto, tutte, senza ritagli di troppo e senza aggiungerne", () => {
  let carousel = fresh();
  const slideId = carousel.slides[0].id;
  const picked = [ids[4], ids[2], ids[7]];
  for (const id of picked) carousel = addPhotosToSlide(carousel, slideId, [id], aspectOf);
  const options = templatesForCount(carousel, 3);
  assert.ok(options.length > 0);
  for (const template of options) {
    const applied = applyTemplateToPhotos(carousel, slideId, template.id, aspectOf);
    const slide = applied.slides[0];
    assert.equal(slide.templateId, template.id);
    assert.equal(slide.free, undefined, "dopo il modello la slide non è più libera");
    assert.deepEqual([...photosShown(slide)].sort(), [...picked].sort(), `${template.id}: le stesse tre foto`);
    assertCarouselInvariants(applied, project);
    assert.equal(photoLayers(applied, 0).filter((layer) => !layer.blur).length, 3, `${template.id}: tre foto vere (lo sfondo sfocato non conta)`);
  }
  const wrong = templatesForCount(fresh(), 2)[0];
  assert.equal(applyTemplateToPhotos(carousel, slideId, wrong.id, aspectOf), carousel, "un modello con un numero diverso di spazi non si applica");
  assert.equal(applyTemplateToPhotos(fresh(), fresh().slides[0].id, templatesForCount(fresh(), 1)[0].id, aspectOf).slides[0].templateId, BLANK_ID, "su una slide vuota non succede niente");
});

test("applicare un modello mette le foto verticali negli spazi verticali, quando il modello li distingue", () => {
  const portraitIds = usable.filter((asset) => (aspectOf(asset.id) ?? 1) < 0.9).map((asset) => asset.id);
  const landscapeIds = usable.filter((asset) => (aspectOf(asset.id) ?? 1) > 1.2).map((asset) => asset.id);
  assert.ok(portraitIds.length > 2 && landscapeIds.length > 2);
  const withKinds = [2, 3, 4].flatMap((count) => allTemplatesForCount(count)).filter((template) => template.slots.includes("landscape") && template.slots.includes("portrait"));
  assert.ok(withKinds.length > 0, "c'è almeno un modello con uno spazio per tipo");
  const template = withKinds.find((candidate) => candidate.slots.length === 2) ?? withKinds[0];
  const count = template.slots.length;
  let carousel = fresh([...portraitIds.slice(0, 3), ...landscapeIds.slice(0, 3)]);
  const slideId = carousel.slides[0].id;
  // la verticale prima: nell'ordine di lettura sarebbe nello spazio orizzontale se non guardassimo la forma
  const wanted = [portraitIds[0], landscapeIds[0], portraitIds[1], landscapeIds[1]].slice(0, count);
  for (const id of wanted) carousel = addPhotosToSlide(carousel, slideId, [id], aspectOf);
  const applied = applyTemplateToPhotos(carousel, slideId, template.id, aspectOf);
  applied.slides[0].photos.forEach((assetId, slot) => {
    const kind = template.slots[slot];
    const aspect = aspectOf(assetId!)!;
    if (kind === "portrait") assert.ok(aspect < 1, `lo spazio verticale ha una foto verticale (${template.id})`);
    if (kind === "landscape") assert.ok(aspect > 1, `lo spazio orizzontale ha una foto orizzontale (${template.id})`);
  });
});

test("carosello a mano: stile, variante, riscelta, vendita e numero di slide non toccano slide e foto scelte da te", () => {
  let carousel = fresh();
  carousel = addPhotosToSlide(carousel, carousel.slides[0].id, [ids[3], ids[8]], aspectOf);
  carousel = addSlide(carousel, project, BLANK_ID, carousel.slides[0].id);
  assert.equal(carousel.slides.length, 3);
  assert.deepEqual(carousel.slides[1].free, [], "la slide nuova è vuota e libera");
  assert.equal(carousel.slides[1].photos.length, 0);
  const slides = JSON.stringify(carousel.slides);
  assert.equal(JSON.stringify(restyle(project, carousel, "editoriale").slides), slides, "cambiare stile non rifà le slide");
  assert.equal(restyle(project, carousel, "editoriale").setId, "editoriale");
  assert.equal(restyle(project, carousel, "editoriale").manual, true);
  assert.notEqual(restyle(project, carousel, "editoriale").brand.paletteId, carousel.brand.paletteId, "ma i colori sono quelli dello stile");
  for (const next of [variation(project, carousel, 5), reselectPhotos(project, carousel), setCarouselPromo(project, carousel, true), resizeCarousel(carousel, project, 9)]) assert.equal(next, carousel);
});

test("carosello a mano: si salva e si ricarica con le slide vuote e le foto libere, e vale in tutti i formati", () => {
  let carousel = fresh();
  carousel = addPhotosToSlide(carousel, carousel.slides[0].id, [ids[1], ids[2], ids[3]], aspectOf);
  const back = parseCarousel(JSON.parse(JSON.stringify(carousel)))!;
  assert.equal(back.manual, true);
  assert.equal(back.slides.length, 2);
  assert.equal(back.slides[0].free!.length, 3);
  assert.deepEqual(back.slides[1].free, []);
  assert.equal(parseCarousels(serializeCarousels([carousel]))[0].manual, true);
  for (const format of SOCIAL_FORMATS) {
    const resized: Carousel = { ...carousel, format: format.id };
    assertCarouselInvariants(resized, project);
    for (const layer of photoLayers(resized, 0)) assert.ok(layer.x >= -0.5 && layer.x + layer.w <= format.width + 0.5 && layer.y >= -0.5 && layer.y + layer.h <= format.height + 0.5);
  }
});

test("carosello a mano: dopo un modello puoi tornare alla disposizione libera senza perdere le foto", () => {
  let carousel = fresh();
  const slideId = carousel.slides[0].id;
  for (const id of [ids[1], ids[2]]) carousel = addPhotosToSlide(carousel, slideId, [id], aspectOf);
  const template = templatesForCount(carousel, 2)[0];
  const applied = applyTemplateToPhotos(carousel, slideId, template.id, aspectOf);
  assert.equal(photoCountOf(applied.slides[0]), 2);
  assert.ok(templateOf(applied.slides[0].templateId));
  // di nuovo sui modelli con un altro numero di foto
  const three = addPhotosToSlide({ ...applied, slides: applied.slides.map((slide, index) => (index === 0 ? { ...slide, free: [] } : slide)) }, slideId, [ids[4]], aspectOf);
  assert.equal(three.slides[0].free!.length, 1);
});
