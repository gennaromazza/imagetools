import { test } from "node:test";
import assert from "node:assert/strict";
import { fontPairOf, paletteOf } from "./brand";
import { buildSlide } from "./build";
import { assertCarouselInvariants } from "./check";
import { addPanorama, setSlideTemplate } from "./edit";
import { setSlideTextStyle, suggestCarouselTexts, suggestFieldText, suggestSlideTexts } from "./edit-text";
import { normalizeText } from "./kit";
import { parseCarousel } from "./store";
import { suggestForTemplate, suggestKindOf, suggestText } from "./suggest";
import { album, envOf, plan, slideFor, withSlides } from "./testkit";
import { TEMPLATES, templateOf } from "./templates";
import { normalizeTextStyle } from "./textstyle";
import type { Carousel, PhotoLayer, TextLayer } from "./types";

// Stile dei testi (carattere, corpo, colore, allineamento, maiuscole) e suggerimenti dalla libreria editoriale.

const textLayers = (carousel: Carousel, project: ReturnType<typeof album>, index = 0): TextLayer[] =>
  buildSlide(carousel, index, envOf(project)).layers.filter((layer): layer is TextLayer => layer.kind === "text");

test("stile dei testi: valori corretti, nulla da salvare quando non cambia niente", () => {
  assert.equal(normalizeTextStyle(null), null);
  assert.equal(normalizeTextStyle({}), null);
  assert.equal(normalizeTextStyle({ scale: 1 }), null, "corpo uguale al modello: nessuna scelta");
  assert.equal(normalizeTextStyle({ scale: 1.02 }), null, "quasi uguale: nessuna scelta");
  assert.deepEqual(normalizeTextStyle({ scale: 9 }), { scale: 1.5 });
  assert.deepEqual(normalizeTextStyle({ scale: 0.1 }), { scale: 0.6 });
  assert.deepEqual(normalizeTextStyle({ scale: 1.23 }), { scale: 1.25 }, "passi di un ventesimo");
  assert.deepEqual(normalizeTextStyle({ color: "rosa" as never, font: "comic" as never, align: "justify" as never }), null, "valori sconosciuti scartati");
  assert.deepEqual(normalizeTextStyle({ uppercase: false }), { uppercase: false }, "togliere le maiuscole è una scelta vera");
  assert.deepEqual(normalizeTextStyle({ scale: Number.NaN, color: "accent", font: "script", align: "right", uppercase: true }), { color: "accent", font: "script", align: "right", uppercase: true });
});

test("stile dei testi: si applica al testo giusto, ricalcola gli ingombri e non tocca gli altri campi", () => {
  const project = album();
  const hero = { ...slideFor("ed-hero", project), id: "h" };
  const carousel = withSlides(plan(project, { count: 4 }), [hero, hero]);
  const pair = fontPairOf(carousel.brand.fontPairId);
  const pal = paletteOf(carousel.brand.paletteId);
  const title = (value: Carousel) => textLayers(value, project).find((layer) => layer.field === "title")!;
  const plain = title(carousel);
  assert.equal(plain.field, "title", "il testo sa da quale campo viene");

  assert.ok(Math.abs(title(setSlideTextStyle(carousel, "h", "title", { scale: 0.8 })).sizePx - plain.sizePx * 0.8) < 0.05, "corpo moltiplicato");
  assert.equal(title(setSlideTextStyle(carousel, "h", "title", { font: "script" })).font, pair.script);
  assert.equal(title(setSlideTextStyle(carousel, "h", "title", { color: "accent" })).color, pal.accent);
  assert.equal(title(setSlideTextStyle(carousel, "h", "title", { align: "right" })).align, "right");
  assert.equal(title(setSlideTextStyle(carousel, "h", "title", { uppercase: false })).uppercase, false);
  const others = (value: Carousel) => textLayers(value, project).filter((layer) => layer.field && layer.field !== "title").map((layer) => JSON.stringify([layer.field, layer.sizePx, layer.font, layer.color, layer.align]));
  assert.deepEqual(others(setSlideTextStyle(carousel, "h", "title", { scale: 1.3, color: "accent" })), others(carousel), "gli altri campi restano come sono");

  // Con testo più grande il riquadro che lo contiene cresce (ingombri ricalcolati, non solo il corpo).
  const offset = { ...slideFor("mo-offset", project), id: "o" };
  const accent = paletteOf(plan(project, { setId: "moda" }).brand.paletteId).accent;
  const boxHeight = (value: Carousel) => (buildSlide(value, 0, envOf(project)).layers.find((layer) => layer.kind === "rect" && layer.fill === accent) as { h: number }).h;
  const base = withSlides(plan(project, { count: 4, setId: "moda" }), [offset, offset]);
  assert.ok(boxHeight(setSlideTextStyle(base, "o", "body", { scale: 1.4 })) > boxHeight(base) + 10, "il riquadro si adatta al testo più grande");
});

test("stile dei testi: quasi ogni campo è collegato al suo testo nell'anteprima", () => {
  const project = album();
  const unlinked: string[] = [];
  for (const template of TEMPLATES) {
    const slide = { ...slideFor(template.id, project), id: "x", ...(template.id === "sh-pano" ? { span: { index: 0, count: 2 } } : {}) };
    const carousel = withSlides(plan(project, { count: 4 }), [slide, slide]);
    const linked = new Set(textLayers(carousel, project).map((layer) => layer.field).filter(Boolean));
    for (const field of template.fields) if (!linked.has(field.key)) unlinked.push(`${template.id}.${field.key}`);
    for (const layer of textLayers(carousel, project)) if (layer.field) assert.ok(template.fields.some((candidate) => candidate.key === layer.field), `${template.id}: campo ${layer.field} inesistente`);
  }
  // Campi che il modello compone o divide (non è un testo solo): si modificano dal pannello ma non si cliccano nell'anteprima.
  const allowed = new Set(["ga-editorial.words", "sh-pano.hint"]);
  const unexpected = unlinked.filter((id) => !allowed.has(id));
  assert.deepEqual(unexpected, [], `campi non collegati: ${unexpected.join(", ")}`);
});

test("stile dei testi: modifiche pure, un panorama in blocco, si salva e sopravvive al cambio di modello", () => {
  const project = album();
  const hero = { ...slideFor("ed-hero", project), id: "h" };
  const carousel = withSlides(plan(project, { count: 4 }), [hero, hero]);
  assert.equal(setSlideTextStyle(carousel, "h", "title", null), carousel, "nessuno stile da togliere");
  assert.equal(setSlideTextStyle(carousel, "h", "campo-inesistente", { scale: 1.2 }), carousel);
  assert.equal(setSlideTextStyle(carousel, "h", "title", { scale: 1 }), carousel, "corpo uguale al modello: nessun cambiamento");
  const styled = setSlideTextStyle(setSlideTextStyle(carousel, "h", "title", { scale: 1.2 }), "h", "title", { color: "accent" });
  assert.deepEqual(styled.slides[0].textStyle, { title: { scale: 1.2, color: "accent" } }, "le scelte si sommano");
  assert.equal(setSlideTextStyle(styled, "h", "title", { scale: 1.2 }), styled, "stesso valore: stesso oggetto");
  const cleared = setSlideTextStyle(styled, "h", "title", null);
  assert.ok(!("textStyle" in cleared.slides[0]), "senza scelte non resta nessun campo");

  const saved = parseCarousel(JSON.parse(JSON.stringify(styled)))!;
  assert.deepEqual(saved.slides[0].textStyle, styled.slides[0].textStyle);
  const broken = JSON.parse(JSON.stringify(styled)) as { slides: Array<Record<string, unknown>> };
  broken.slides[0].textStyle = { title: { scale: 50, color: "viola", font: "script" }, inventato: { scale: 1.3 } };
  assert.deepEqual(parseCarousel(broken)!.slides[0].textStyle, { title: { scale: 1.5, font: "script" } }, "valori assurdi corretti, campi inesistenti scartati");

  const sandwich = setSlideTemplate(styled, project, "h", "ed-cover");
  assert.deepEqual(sandwich.slides[0].textStyle, { title: { scale: 1.2, color: "accent" } }, "i campi con lo stesso nome tengono lo stile");
  assert.equal(setSlideTemplate(styled, project, "h", "ed-sandwich").slides[0].textStyle, undefined, "i campi che non esistono più lo perdono");

  const pano = addPanorama(withSlides(plan(project, { count: 4 }), [slideFor("ed-cover", project), slideFor("ed-cta", project)]), project.assets[7].id, 2);
  const first = pano.slides.find((slide) => slide.span)!;
  const styledPano = setSlideTextStyle(pano, first.id, "word", { scale: 1.3, color: "accent" });
  assertCarouselInvariants(styledPano, project);
  assert.ok(styledPano.slides.filter((slide) => slide.span).every((slide) => slide.textStyle?.word?.scale === 1.3), "il panorama si ritocca per intero");
});

test("suggerimenti: campi giusti, testi della libreria, sempre nuovi e mai ripetuti", () => {
  assert.equal(suggestKindOf("title"), "title");
  assert.equal(suggestKindOf("script"), "word");
  assert.equal(suggestKindOf("quote"), "line");
  assert.equal(suggestKindOf("body"), "body");
  for (const personal of ["names", "who", "date", "place", "button", "items", "handle", "kicker", "side1", "foot"]) assert.equal(suggestKindOf(personal), null, `${personal}: dato personale, non si suggerisce`);

  const limits = { title: [2, 4, 30], word: [1, 2, 18], line: [28, 96, 96], body: [90, 230, 230] } as const;
  for (const kind of ["title", "word", "line", "body"] as const) {
    const seen = new Set<string>();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const text = suggestText(kind, { seed: "prova", attempt, setId: "galleria" });
      assert.ok(text && text.trim().length > 0, `${kind}: nessun suggerimento`);
      assert.ok(!/[<>]/.test(text!) && !text!.includes("\n"), `${kind}: testo non adatto a un campo`);
      if (kind === "title" || kind === "word") assert.ok(text!.split(/\s+/).length <= limits[kind][1] && text!.length <= limits[kind][2], `${kind}: troppo lungo «${text}»`);
      else assert.ok(text!.length <= limits[kind][2], `${kind}: troppo lungo (${text!.length})`);
      seen.add(normalizeText(text!));
    }
    assert.ok(seen.size >= 25, `${kind}: poca varietà (${seen.size} testi diversi su 40)`);
  }
  assert.equal(suggestText("title", { seed: "a", attempt: 3 }), suggestText("title", { seed: "a", attempt: 3 }), "stessa richiesta, stesso testo");
  assert.notEqual(suggestText("title", { seed: "a", attempt: 3 }), suggestText("title", { seed: "a", attempt: 4 }), "ogni richiesta successiva dà un testo diverso");
  const first = suggestText("line", { seed: "z", attempt: 0 })!;
  assert.notEqual(suggestText("line", { seed: "z", attempt: 0, current: first }), first, "mai uguale al testo di adesso");
  assert.notEqual(suggestText("line", { seed: "z", attempt: 0, avoid: new Set([first.toUpperCase() + "!"]) }), first, "né a uno già usato (anche scritto diversamente)");
  assert.match(suggestText("title", { seed: "q", attempt: 0, multiline: true }) ?? "", /./);
  const balanced = [...Array(30).keys()].map((attempt) => suggestText("title", { seed: "m", attempt, multiline: true })!).filter((text) => text.length >= 11);
  assert.ok(balanced.length > 0 && balanced.every((text) => text.split("\n").length === 2), "un titolo su più righe si divide in due righe bilanciate");
});

test("suggerimenti: per campo, per slide e per tutto il carosello senza ripetizioni", () => {
  const project = album();
  const carousel = plan(project, { count: 12, setId: "cinema" });
  const hero = carousel.slides.find((slide) => slide.templateId === "ci-full")!;
  const one = suggestFieldText(carousel, hero.id, "title", 0);
  assert.notEqual(one.slides[carousel.slides.indexOf(hero)].texts.title, hero.texts.title);
  assert.equal(suggestFieldText(carousel, hero.id, "kicker", 0), carousel, "un campo personale non si suggerisce");
  assert.equal(suggestFieldText(carousel, "non-esiste", "title", 0), carousel);
  const again = suggestFieldText(one, hero.id, "title", 1);
  assert.notEqual(again.slides[carousel.slides.indexOf(hero)].texts.title, one.slides[carousel.slides.indexOf(hero)].texts.title, "il clic successivo propone un altro testo");

  const template = templateOf("ga-savedate")!;
  const proposals = suggestForTemplate(template, { slideId: "s", attempt: 0, setId: "galleria", texts: {} });
  assert.deepEqual(Object.keys(proposals).sort(), ["script", "title"], "solo i campi suggeribili del modello");
  assert.equal(new Set(Object.values(proposals).map(normalizeText)).size, Object.keys(proposals).length, "i campi della stessa slide non ricevono lo stesso testo");

  const slideTexts = suggestSlideTexts(carousel, hero.id, 0);
  assertCarouselInvariants(slideTexts, project);
  assert.ok(Object.keys(slideTexts.slides[carousel.slides.indexOf(hero)].texts).length >= 1);

  const all = suggestCarouselTexts(carousel, 0);
  assertCarouselInvariants(all, project);
  const suggested: string[] = [];
  all.slides.forEach((slide) => {
    if (slide.span) return;
    for (const field of templateOf(slide.templateId)!.fields) if (suggestKindOf(field.key) && slide.texts[field.key]) suggested.push(normalizeText(slide.texts[field.key]));
  });
  assert.ok(suggested.length >= 12, "quasi ogni slide riceve dei testi");
  assert.equal(new Set(suggested).size, suggested.length, "nessun testo suggerito due volte nello stesso carosello");
  const next = suggestCarouselTexts(all, 1);
  assert.notDeepEqual(next.slides.map((slide) => slide.texts), all.slides.map((slide) => slide.texts), "rigenerando i testi cambiano");
});
