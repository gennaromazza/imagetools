import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSlide } from "./build";
import { assertCarouselInvariants } from "./check";
import { setSlideFraming, setWholePhotos } from "./edit";
import { isPromoCarousel, planCarousel, reselectPhotos, restyle, setCarouselPromo, variation } from "./plan";
import { parseCarousel, parseCarousels, serializeCarousels } from "./store";
import { SETS, TEMPLATES, setInfo, templatesForSet } from "./templates";
import { album, envOf, plan, slideFor, withSlides } from "./testkit";
import { SOCIAL_FORMATS, type Carousel, type PhotoLayer } from "./types";
import { defaultBrand } from "./brand";

// «Foto intere» (nessun ritaglio) e stile Minimal: solo foto, senza testi né forme.

const project = album();
const env = envOf(project);

/** Le foto vere di una slide costruita, con le proporzioni dell'immagine. */
function photoLayers(carousel: Carousel, index: number): Array<{ layer: PhotoLayer; aspect: number }> {
  const built = buildSlide(carousel, index, env);
  return built.layers.filter((layer): layer is PhotoLayer => layer.kind === "photo" && !layer.blur && Boolean(layer.assetId)).map((layer) => ({ layer, aspect: env.photos.get(layer.assetId!)!.aspect }));
}

const SINGLE_SLIDE = (templateId: string, whole: boolean, format: Carousel["format"] = "feed"): Carousel =>
  withSlides({ ...plan(project, { setId: "editoriale", format }), ...(whole ? { whole: true } : {}) }, [slideFor(templateId, project)], format);

test("foto intere: in ogni modello, stile e formato la foto ha le proporzioni dell'immagine, senza forme, e sta nello spazio", () => {
  for (const format of SOCIAL_FORMATS) {
    for (const template of TEMPLATES) {
      if (template.needsSpread) continue;
      const carousel = SINGLE_SLIDE(template.id, true, format.id);
      for (const { layer, aspect } of photoLayers(carousel, 0)) {
        assert.ok(Math.abs(layer.w / layer.h / aspect - 1) < 0.004, `${template.id}/${format.id}: la foto è ritagliata (finestra ${(layer.w / layer.h).toFixed(3)} contro foto ${aspect.toFixed(3)})`);
        assert.equal(layer.mask, "rect", `${template.id}: con le foto intere non ci sono forme tonde o ad arco`);
        assert.ok(layer.zoom === 1 && layer.cx === 0.5 && layer.cy === 0.5, `${template.id}: senza inquadratura scelta la foto non si ingrandisce`);
        assert.ok(layer.x >= -0.5 && layer.y >= -0.5 && layer.x + layer.w <= format.width + 0.5 && layer.y + layer.h <= format.height + 0.5, `${template.id}/${format.id}: la foto esce dalla tela`);
      }
    }
  }
});

test("foto intere: senza l'opzione i modelli ritagliano come prima (la prova distingue i due modi)", () => {
  let cropped = 0;
  for (const template of TEMPLATES) {
    if (template.needsSpread || template.id.startsWith("mn-")) continue;
    for (const { layer, aspect } of photoLayers(SINGLE_SLIDE(template.id, false), 0)) if (Math.abs(layer.w / layer.h / aspect - 1) > 0.05) cropped += 1;
  }
  assert.ok(cropped > 20, `pochi ritagli (${cropped}): la prova non distingue più i due modi`);
});

test("foto intere: le scelte fatte a mano vincono, i panorami e gli sfondi sfocati non cambiano", () => {
  const carousel = SINGLE_SLIDE("sh-solo-full", true);
  const zoomed = setSlideFraming(carousel, carousel.slides[0].id, 0, { zoom: 2, cx: 0.3, cy: 0.6 });
  const [{ layer }] = photoLayers(zoomed, 0);
  assert.equal(layer.zoom, 2, "l'inquadratura scelta a mano resta");
  assert.equal(layer.w, buildSlide(SINGLE_SLIDE("sh-solo-full", false), 0, env).layers.find((entry): entry is PhotoLayer => entry.kind === "photo")!.w, "e la finestra è quella del modello");

  const base = plan(project, { setId: "editoriale", count: 8 });
  const pano = base.slides.findIndex((slide) => slide.span);
  assert.ok(pano >= 0, "l'album di prova ha un panorama");
  const same = (index: number, whole: boolean) => JSON.stringify(buildSlide({ ...base, ...(whole ? { whole: true } : {}) }, index, env).layers.filter((layer) => layer.kind === "photo"));
  assert.equal(same(pano, true), same(pano, false), "le parti di un panorama devono combaciare: non cambiano");

  const cinema = withSlides({ ...plan(project, { setId: "cinema" }), whole: true }, [slideFor("ci-strip", project)]);
  const blurred = buildSlide(cinema, 0, env).layers.filter((layer): layer is PhotoLayer => layer.kind === "photo" && Boolean(layer.blur));
  assert.ok(blurred.length > 0 && blurred.every((layer) => layer.w >= 1080 && layer.h >= 1350), "lo sfondo sfocato copre ancora tutta la slide");
});

test("foto intere: l'opzione si salva, si toglie e sopravvive a stile, variante, riscelta e passaggio alla vendita", () => {
  const made = planCarousel(project, { setId: "galleria", format: "feed", count: 8, brand: defaultBrand(project.projectName), whole: true });
  assert.equal(made.whole, true);
  assertCarouselInvariants(made, project);
  assert.equal(parseCarousel(JSON.parse(JSON.stringify(made)))?.whole, true, "si ricarica");
  assert.equal(parseCarousels(serializeCarousels([made]))[0].whole, true);
  const off = setWholePhotos(made, false);
  assert.equal("whole" in off, false, "togliendola non resta traccia nel file");
  assert.equal(setWholePhotos(off, false), off, "nessun cambiamento = lo stesso oggetto");
  assert.equal(setWholePhotos(off, true).whole, true);
  assert.equal(parseCarousel(JSON.parse(JSON.stringify(off)))?.whole, undefined);

  for (const [what, next] of [
    ["restyle", restyle(project, made, "cinema")],
    ["variation", variation(project, made, 12345)],
    ["reselectPhotos", reselectPhotos(project, made)],
    ["setCarouselPromo", setCarouselPromo(project, made, !isPromoCarousel(made))],
  ] as const) assert.equal(next.whole, true, `${what} tiene le foto intere`);
});

test("Minimal: solo foto, nessun testo, nessuna forma, nessun elemento che non sia una foto", () => {
  const set = setInfo("minimal");
  assert.equal(set.id, "minimal");
  const own = templatesForSet("minimal");
  assert.ok(own.filter((template) => template.set === "minimal").length >= 6, "ha più modelli: uno, due, tre e quattro foto");
  assert.deepEqual(own.filter((template) => template.set === "shared").map((template) => template.id), ["sh-pano"], "dei modelli comuni solo il panorama");
  for (const template of own.filter((entry) => entry.set === "minimal")) {
    assert.equal(template.fields.length, 0, `${template.id}: niente testi`);
    assert.ok(!template.promo && !template.needsSpread && template.slots.length > 0, `${template.id}: né vendita né album`);
    for (const format of SOCIAL_FORMATS) {
      const carousel = withSlides(plan(project, { setId: "minimal", format: format.id }), [slideFor(template.id, project)], format.id);
      const built = buildSlide(carousel, 0, env);
      assert.ok(built.layers.length > 0 && built.layers.every((layer) => layer.kind === "photo"), `${template.id}/${format.id}: solo livelli foto`);
      for (const { layer, aspect } of photoLayers(carousel, 0)) {
        assert.equal(layer.mask, "rect");
        assert.ok(Math.abs(layer.w / layer.h / aspect - 1) < 0.004, `${template.id}/${format.id}: foto ritagliata anche senza l'opzione`);
      }
    }
  }
});

test("Minimal: ogni formato, seme e numero di slide dà un carosello valido, con tutte le foto intere e senza testi", () => {
  for (const format of SOCIAL_FORMATS) {
    for (const count of [2, 3, 6, 8, 12, 20]) {
      for (const seed of [0, 7, 99]) {
        const carousel = plan(project, { setId: "minimal", format: format.id, count, seed, promo: seed === 99 });
        assert.equal(carousel.slides.length, count);
        assertCarouselInvariants(carousel, project);
        assert.equal(carousel.brand.paletteId, defaultBrand("").paletteId, "il piano non cambia la marca scelta");
        carousel.slides.forEach((slide, index) => {
          if (slide.span) return;
          assert.ok(slide.templateId.startsWith("mn-") || slide.templateId === "sh-pano", `${slide.templateId}: un modello fuori dallo stile Minimal`);
          assert.ok(photoLayers(carousel, index).length >= 1, "ogni slide ha almeno una foto vera");
        });
      }
    }
  }
  assert.ok(plan(project, { setId: "minimal", count: 8 }).slides.some((slide) => slide.templateId === "mn-single"), "apre con una sola foto");
});

test("Minimal: si arriva e si parte con restyle senza perdere le foto scelte", () => {
  const start = plan(project, { setId: "editoriale", count: 8 });
  const minimal = restyle(project, start, "minimal");
  assert.equal(minimal.setId, "minimal");
  assertCarouselInvariants(minimal, project);
  const before = new Set(start.slides.flatMap((slide) => slide.photos).filter(Boolean));
  const after = new Set(minimal.slides.flatMap((slide) => slide.photos).filter(Boolean));
  const kept = [...before].filter((id) => after.has(id)).length;
  assert.ok(kept >= Math.min(before.size, after.size) * 0.5, `le foto già scelte restano (${kept} su ${before.size})`);
  for (const set of SETS) assertCarouselInvariants(restyle(project, minimal, set.id), project);
});
