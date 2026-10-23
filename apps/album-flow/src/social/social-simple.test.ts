import { test } from "node:test";
import assert from "node:assert/strict";
import { countTagged, filterAssets } from "../model/library";
import type { Project } from "../model/project";
import { assertCarouselInvariants, carouselReport } from "./check";
import { addSlide, replacePhoto, reselectSlidePhotos, resizeCarousel, setCarouselPool, setSlideTemplate, unusedRanked, usedAssetIds } from "./edit";
import { carouselPoolIds, defaultPoolIds, isPromoCarousel, markedPhotoIds, planCarousel, reselectPhotos, restyle, setCarouselPromo, variation } from "./plan";
import { parseCarousel } from "./store";
import { SETS, TEMPLATES, simpleMiddle, templateOf, templatesForSet } from "./templates";
import { album, plan } from "./testkit";
import { SOCIAL_FORMATS } from "./types";
import { defaultBrand } from "./brand";

// «Solo foto» e foto del carosello: un carosello semplice non propone slide di vendita e sceglie solo tra le foto segnate «Per i social».

/** Segna «Per i social» le foto indicate. */
const mark = (project: Project, ids: readonly string[]): Project => ({
  ...project,
  assets: project.assets.map((asset) => (ids.includes(asset.id) ? { ...asset, albumTags: [...(asset.albumTags ?? []), "social" as const] } : asset)),
});

/** Un album con dodici foto segnate «Per i social» (non scartate, di forme diverse) e le altre no. */
function markedAlbum(): { project: Project; marked: string[] } {
  const base = album();
  const marked = base.assets.filter((asset) => asset.pickStatus !== "rejected" && asset.id !== base.assets[7].id).filter((_, index) => index % 3 === 1).slice(0, 12).map((asset) => asset.id);
  return { project: mark(base, marked), marked };
}

const simple = (project: Project, overrides: Partial<Parameters<typeof planCarousel>[1]> = {}) =>
  planCarousel(project, { setId: "editoriale", format: "feed", count: 8, brand: defaultBrand(project.projectName), ...overrides });

const PROMO_IDS = ["ci-credits", "ed-cta", "ed-list", "ed-quote", "ga-letter", "ga-savedate", "mo-circle", "mo-offset", "mo-panel", "mo-sticker", "sh-book", "sh-checklist", "sh-closing", "sh-date", "sh-faq", "sh-mockup", "sh-split", "sh-statement"];

test("modelli di vendita: sono quelli noti, ognuno ha un posto tra i modelli e i semplici sono la maggioranza", () => {
  assert.deepEqual(TEMPLATES.filter((template) => template.promo).map((template) => template.id).sort(), [...PROMO_IDS].sort(), "i modelli di vendita sono una lista decisa, non un caso");
  for (const set of SETS) {
    const all = templatesForSet(set.id);
    assert.ok(all.some((template) => template.promo), `${set.id}: i modelli di vendita restano tra quelli tra cui scegliere`);
    assert.ok(all.filter((template) => !template.promo && template.slots.length > 0).length >= 22, `${set.id}: pochi modelli semplici`);
    const middle = simpleMiddle(set);
    assert.ok(middle.length >= 16, `${set.id}: trama «Solo foto» troppo corta (${middle.length})`);
    assert.equal(new Set(middle).size, middle.length);
    for (const id of [set.simple.open, set.simple.close, ...middle]) {
      const template = templateOf(id);
      assert.ok(template && !template.promo && template.slots.length > 0, `${set.id}/${id}: un modello «Solo foto» ha una foto e nessun testo di vendita`);
    }
    assert.ok(!middle.includes(set.simple.open) && !middle.includes(set.simple.close), `${set.id}: apertura e chiusura non tornano nel mezzo`);
  }
});

test("Solo foto: nessun modello di vendita in nessuno stile, formato, numero di slide o seme; apertura e chiusura con una foto", () => {
  const project = album();
  for (const set of SETS) {
    for (const format of SOCIAL_FORMATS) {
      for (const count of [2, 3, 5, 8, 12, 20]) {
        for (const seed of [0, 1, 2, 7, 31]) {
          const carousel = simple(project, { setId: set.id, format: format.id, count, seed });
          assert.equal(carousel.promo, false);
          assert.equal(carousel.slides.length, count);
          assertCarouselInvariants(carousel, project);
          for (const slide of carousel.slides) {
            const template = templateOf(slide.templateId)!;
            assert.ok(!template.promo, `${set.id}/${count}/${seed}: ${slide.templateId} è un modello di vendita`);
            assert.ok(template.slots.length > 0, `${set.id}: ${slide.templateId} non ha foto`);
          }
          assert.equal(carousel.slides[0].templateId, set.simple.open);
          assert.equal(carousel.slides[count - 1].templateId, set.simple.close);
        }
      }
    }
  }
  assert.deepEqual(simple(project).slides.map((slide) => slide.templateId), simple(project, { promo: false }).slides.map((slide) => slide.templateId), "senza indicazioni il carosello è «Solo foto»");
});

test("Solo foto: le slide che un carosello semplice non ha mai sono le pagine dell'album, prenota, domande frequenti e simili", () => {
  const project = album();
  for (const set of SETS) {
    const ids = new Set(simple(project, { setId: set.id, count: 20, seed: 9 }).slides.map((slide) => slide.templateId));
    for (const id of ["sh-mockup", "sh-faq", "sh-book", "sh-checklist", "sh-date", "sh-closing", "ed-cta", "ga-savedate", "ci-credits"]) assert.ok(!ids.has(id), `${set.id}: ${id} in un carosello «Solo foto»`);
  }
  // Con la vendita tornano: la chiusura e la vetrina dell'album.
  const full = plan(project, { setId: "galleria", count: 10, promo: true });
  assert.equal(full.promo, true);
  assert.ok(full.slides.some((slide) => slide.templateId === "sh-mockup"), "con la vendita c'è la doppia pagina dell'album");
  assert.ok(full.slides.some((slide) => templateOf(slide.templateId)?.promo));
});

test("Solo foto / vendita: si passa dall'uno all'altro tenendo stile, foto e testi dei modelli che restano", () => {
  const project = album();
  const photos = simple(project, { setId: "moda", count: 10, seed: 3 });
  const edited = { ...photos, slides: photos.slides.map((slide, index) => (index === 0 ? { ...slide, texts: { title: "Titolo mio" } } : slide)) };
  assert.equal(setCarouselPromo(project, edited, false), edited, "già «Solo foto»: nessun cambiamento");
  const full = setCarouselPromo(project, edited, true);
  assertCarouselInvariants(full, project);
  assert.equal(full.promo, true);
  assert.equal(full.id, edited.id);
  assert.equal(full.setId, "moda");
  assert.equal(full.seed, 3);
  assert.equal(full.slides.length, 10);
  assert.ok(full.slides.some((slide) => templateOf(slide.templateId)?.promo), "con la vendita arrivano i modelli di vendita");
  assert.equal(full.slides[9].templateId, "sh-closing");
  const sameTemplate = full.slides.find((slide) => slide.templateId === edited.slides[0].templateId);
  assert.equal(sameTemplate?.texts.title, "Titolo mio", "un testo scritto resta dove il modello è lo stesso");

  const back = setCarouselPromo(project, full, false);
  assertCarouselInvariants(back, project);
  assert.equal(back.promo, false);
  assert.ok(back.slides.every((slide) => !templateOf(slide.templateId)?.promo));

  // Un carosello salvato prima di questa versione non dice nulla: lo dicono le sue slide.
  const { promo: _promo, ...legacyFull } = full;
  const { promo: _other, ...legacySimple } = back;
  assert.equal(isPromoCarousel(legacyFull), true);
  assert.equal(isPromoCarousel(legacySimple), false);
  assert.equal(isPromoCarousel(restyle(project, legacyFull, "cinema")), true, "cambiare stile non toglie le slide di vendita a un carosello che le aveva");
  assert.ok(restyle(project, legacySimple, "cinema").slides.every((slide) => !templateOf(slide.templateId)?.promo));
  assert.ok(variation(project, legacySimple, 5).slides.every((slide) => !templateOf(slide.templateId)?.promo));
});

test("Solo foto: aggiungere slide e portarle a 20 non fa entrare modelli di vendita", () => {
  const project = album();
  for (const set of SETS) {
    const carousel = simple(project, { setId: set.id, count: 6, seed: 4 });
    const bigger = resizeCarousel(carousel, project, 20);
    assertCarouselInvariants(bigger, project);
    assert.ok(bigger.slides.every((slide) => !templateOf(slide.templateId)?.promo), `${set.id}: ingrandendo entra un modello di vendita`);
    const smaller = resizeCarousel(bigger, project, 3);
    // Un panorama non si spezza: se c'è, restano apertura, le sue parti e chiusura.
    assert.ok(smaller.slides.length >= 3 && smaller.slides.length <= 4, `${set.id}: ${smaller.slides.length} slide`);
    assert.equal(smaller.slides[0].templateId, set.simple.open);
    assert.equal(smaller.slides[smaller.slides.length - 1].templateId, set.simple.close);
  }
  // Una slide di vendita si può comunque aggiungere a mano, e non cambia il tipo del carosello.
  const carousel = simple(project, { count: 5 });
  const added = addSlide(carousel, project, "sh-faq", carousel.slides[1].id);
  assert.equal(added.slides.length, 6);
  assert.equal(added.promo, false);
});

test("foto del carosello: di partenza le segnate «Per i social», altrimenti tutte le non scartate", () => {
  const plain = album();
  const rejected = plain.assets.filter((asset) => asset.pickStatus === "rejected").map((asset) => asset.id);
  assert.deepEqual(markedPhotoIds(plain), []);
  assert.equal(defaultPoolIds(plain).length, plain.assets.length - rejected.length);
  assert.ok(defaultPoolIds(plain).every((id) => !rejected.includes(id)));

  const { project, marked } = markedAlbum();
  assert.deepEqual([...markedPhotoIds(project)].sort(), [...marked].sort());
  assert.deepEqual([...defaultPoolIds(project)].sort(), [...marked].sort());
  // Una foto segnata e poi scartata non conta più.
  const withRejected = { ...project, assets: project.assets.map((asset) => (asset.id === marked[0] ? { ...asset, pickStatus: "rejected" as const } : asset)) };
  assert.ok(!markedPhotoIds(withRejected).includes(marked[0]));
});

test("foto del carosello: piano e ogni modifica automatica restano dentro le foto segnate", () => {
  const { project, marked } = markedAlbum();
  const inside = (carousel: ReturnType<typeof simple>, where: string, extra: readonly string[] = []) => {
    const outside = [...usedAssetIds(carousel)].filter((id) => !marked.includes(id) && !extra.includes(id));
    assert.deepEqual(outside, [], `${where}: foto non segnate «Per i social»`);
  };
  for (const promo of [false, true]) {
    for (const set of SETS) {
      const carousel = simple(project, { setId: set.id, count: 12, seed: 5, promo });
      assertCarouselInvariants(carousel, project);
      assert.equal(carousel.assetIds, undefined, "senza una lista scelta non se ne salva una");
      inside(carousel, `piano ${set.id}`);

      inside(reselectPhotos(project, carousel), `riscegli ${set.id}`);
      inside(variation(project, carousel, 77), `altra variante ${set.id}`);
      for (const other of SETS) inside(restyle(project, carousel, other.id), `da ${set.id} a ${other.id}`);
      inside(resizeCarousel(carousel, project, 20), `20 slide ${set.id}`);
      inside(resizeCarousel(carousel, project, 3), `3 slide ${set.id}`);
      for (const template of templatesForSet(set.id)) {
        if (template.id === "sh-pano") continue;
        inside(addSlide(carousel, project, template.id), `aggiungi ${template.id}`);
        inside(setSlideTemplate(carousel, project, carousel.slides[2].id, template.id), `modello ${template.id}`);
      }
      for (const slide of carousel.slides) inside(reselectSlidePhotos(carousel, project, slide.id), `riscegli la slide ${slide.id}`);
      assert.deepEqual(unusedRanked(carousel, project).filter((photo) => !marked.includes(photo.assetId)), [], "le foto disponibili sono solo quelle segnate");
    }
  }
});

test("foto del carosello: una foto messa a mano resta del carosello; la lista scelta resta anche cambiando stile e variante", () => {
  const { project, marked } = markedAlbum();
  const outsider = project.assets.find((asset) => asset.pickStatus !== "rejected" && !marked.includes(asset.id) && asset.id !== project.assets[7].id)!.id;
  const carousel = simple(project, { count: 8, seed: 2 });
  const first = carousel.slides.findIndex((slide) => !slide.span && slide.photos.length > 0);
  const hand = replacePhoto(carousel, carousel.slides[first].id, 0, outsider);
  assert.ok(carouselPoolIds(project, hand).includes(outsider), "la foto messa a mano fa parte delle foto del carosello");
  assert.ok(!carouselPoolIds(project, carousel).includes(outsider));
  for (const next of [restyle(project, hand, "cinema"), variation(project, hand, 12), reselectSlidePhotos(hand, project, hand.slides[(first + 1) % hand.slides.length].id)]) {
    const outside = [...usedAssetIds(next)].filter((id) => !marked.includes(id) && id !== outsider);
    assert.deepEqual(outside, [], "nessun'altra foto non segnata entra");
  }

  // Con una lista scelta nella creazione guidata, resta quella: nessuna foto fuori lista, nemmeno segnata.
  const chosen = marked.slice(0, 6);
  const own = simple(project, { count: 6, assetIds: chosen });
  assert.deepEqual(own.assetIds, chosen);
  for (const next of [reselectPhotos(project, own), variation(project, own, 3), restyle(project, own, "moda"), resizeCarousel(own, project, 12)]) {
    assert.deepEqual(next.assetIds, own.assetIds, "la lista resta");
    assert.deepEqual([...usedAssetIds(next)].filter((id) => !chosen.includes(id)), [], "nemmeno una foto segnata fuori lista");
  }
  // «Riscegli le foto» dell'avviso riparte dalle foto segnate di adesso e lascia la scelta automatica.
  const extra = project.assets.find((asset) => asset.pickStatus !== "rejected" && !marked.includes(asset.id) && asset.id !== outsider && asset.id !== project.assets[7].id)!.id;
  const moreMarked = mark(project, [extra]);
  const refreshed = reselectPhotos(moreMarked, own, true);
  assert.equal(refreshed.assetIds, undefined);
  assert.ok(carouselPoolIds(moreMarked, refreshed).includes(extra));
  assertCarouselInvariants(refreshed, moreMarked);
});

test("foto del carosello: «Scegli le foto» sostituisce quelle tolte, non tocca le altre e rifiuta una lista vuota", () => {
  const { project, marked } = markedAlbum();
  const carousel = simple(project, { count: 8, seed: 6 });
  const keep = marked.slice(0, 7);
  const outsider = project.assets.find((asset) => asset.pickStatus !== "rejected" && !marked.includes(asset.id) && asset.id !== project.assets[7].id)!.id;
  const next = setCarouselPool(carousel, project, [...keep, outsider]);
  assertCarouselInvariants(next, project);
  assert.deepEqual(next.assetIds, [...keep, outsider]);
  assert.deepEqual([...usedAssetIds(next)].filter((id) => ![...keep, outsider].includes(id)), [], "le foto tolte non sono più in nessuna slide");
  next.slides.forEach((slide, index) => {
    const before = carousel.slides[index];
    if (slide.span) { assert.equal(slide, before, "un panorama non cambia"); return; }
    slide.photos.forEach((id, slot) => { if (before.photos[slot] && keep.includes(before.photos[slot]!)) assert.equal(id, before.photos[slot], "una foto che resta nella lista resta dov'è"); });
  });
  assert.equal(setCarouselPool(carousel, project, []), carousel, "una lista vuota non si applica");
  assert.equal(setCarouselPool(carousel, project, ["non-esiste"]), carousel, "foto che non esistono non fanno una lista");
  const few = marked.slice(0, 6);
  const restricted = setCarouselPool(carousel, project, few);
  assertCarouselInvariants(restricted, project);
  const outsidePano = restricted.slides.filter((slide) => !slide.span).flatMap((slide) => slide.photos).filter((id): id is string => Boolean(id) && !few.includes(id as string));
  assert.deepEqual(outsidePano, [], "con poche foto si riusano, ma solo quelle (un panorama non cambia)");
});

test("foto del carosello: l'elenco e il tipo si salvano e si rileggono; valori assurdi si scartano", () => {
  const { project, marked } = markedAlbum();
  const carousel = simple(project, { count: 6, assetIds: marked.slice(0, 8), promo: true });
  const back = parseCarousel(JSON.parse(JSON.stringify(carousel)))!;
  assert.deepEqual(back.assetIds, carousel.assetIds);
  assert.equal(back.promo, true);
  const none = parseCarousel(JSON.parse(JSON.stringify(simple(project, { count: 6 }))))!;
  assert.equal(none.assetIds, undefined);
  assert.equal(none.promo, false);
  const raw = JSON.parse(JSON.stringify(carousel)) as Record<string, unknown>;
  raw.assetIds = ["a", "", 5, null, "a", "b"];
  raw.promo = "si";
  const cleaned = parseCarousel(raw)!;
  assert.deepEqual(cleaned.assetIds, ["a", "b"]);
  assert.equal(cleaned.promo, undefined);
  raw.assetIds = "non è un elenco";
  assert.equal(parseCarousel(raw)!.assetIds, undefined);
});

test("controlli: se il carosello usa foto non segnate «Per i social» lo si dice, senza bloccare nulla", () => {
  const { project, marked } = markedAlbum();
  const notes = (carousel: ReturnType<typeof simple>, source: Project) => carouselReport(carousel, source).issues.filter((issue) => issue.message.includes("Per i social"));
  const inside = simple(project, { count: 6, assetIds: marked });
  assert.deepEqual(notes(inside, project), []);
  const outsider = project.assets.find((asset) => asset.pickStatus !== "rejected" && !marked.includes(asset.id) && asset.id !== project.assets[7].id)!;
  const hand = replacePhoto(inside, inside.slides[0].id, 0, outsider.id);
  const found = notes(hand, project);
  assert.equal(found.length, 1);
  assert.equal(found[0].level, "info");
  assert.ok(found[0].message.includes(outsider.fileName));
  assert.equal(carouselReport(hand, project).errors, 0);
  // Se nessuna foto è segnata non c'è nulla da dire.
  assert.deepEqual(notes(plan(album(), { count: 6 }), album()), []);
});

test("libreria: il filtro «Per i social» mostra solo le foto segnate e il contatore le conta", () => {
  const { project, marked } = markedAlbum();
  assert.equal(countTagged(project.assets, "social"), marked.length);
  assert.equal(countTagged(project.assets, "cover"), 0);
  const shown = filterAssets(project, project.assets, { tag: "social" });
  assert.deepEqual(shown.map((asset) => asset.id).sort(), [...marked].sort());
  assert.equal(filterAssets(project, project.assets, {}).length, project.assets.length, "senza filtro si vedono tutte");
  const twoStars = filterAssets(project, project.assets, { tag: "social", minRating: 4 });
  assert.ok(twoStars.every((asset) => marked.includes(asset.id) && (asset.rating ?? 0) >= 4), "il filtro si somma agli altri");
});
