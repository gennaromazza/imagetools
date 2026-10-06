import { test } from "node:test";
import assert from "node:assert/strict";
import { mulberry32 } from "../engine/rng";
import { DEFAULT_AUTO_BUILD, autoBuildAlbum } from "../model/autobuild";
import { FONT_FAMILIES } from "../model/typography";
import { makeAsset, makeProject } from "../model/fixtures";
import type { Project } from "../model/project";
import { approximateMeasure } from "../render/text-layout";
import { buildSlide, resolveTexts, templateForSlide } from "./build";
import { FONT_PAIRS, PALETTES, brandFontIds, defaultBrand, monogramOf, readableOn } from "./brand";
import { assertCarouselInvariants, carouselReport } from "./check";
import { parseAlbumProject, serializeAlbumProject } from "../model/portability";
import { setRating } from "../model/library";
import {
  acceptSelection, addPanorama, addSlide, duplicateSlide, moveSlide, removeSlide, renameCarousel, replacePhoto, resetSlideText, setCaption, setFormat, setSlidePhoto, setSlideSpread,
  resizeCarousel, setSlideFlip, setSlideFraming, setSlideTemplate, setSlideText, setSlideTone, spanRange, unusedRanked, updateBrand, usedAssetIds,
} from "./edit";
import { exportCarouselWith, slideFileName } from "./export-core";
import { balance, coverFit, fitSize, fitWindow, layoutOf, mirrorLayers, starPath } from "./kit";
import { focusRange, normalizeFraming } from "./framing";
import { clampCount, envFor, pickForSlot, planCarousel, rankPhotos, reselectPhotos, restyle, selectionBasis, selectionChanged, setBrand, slotFit } from "./plan";
import { maskPath, renderSlideSvg, type RenderMedia } from "./render";
import { parseCarousel, parseCarousels, serializeCarousels } from "./store";
import { SETS, TEMPLATES, setInfo, templateOf, templatesForSet } from "./templates";
import { MAX_SLIDES, MIN_SLIDES, SOCIAL_FORMATS, formatOf, type Carousel, type Slide, type SocialFormatId, type SlotKind } from "./types";

import { album, allMedia, envOf, measure, plan, slideFor, withSlides } from "./testkit";

const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);

// ---------------------------------------------------------------------------
// Marca e catalogo
// ---------------------------------------------------------------------------

test("marca: palette e coppie di font coerenti con la libreria dell'app", () => {
  assert.equal(new Set(PALETTES.map((palette) => palette.id)).size, PALETTES.length, "palette con id doppi");
  for (const palette of PALETTES) for (const color of [palette.dark, palette.light, palette.accent, palette.soft]) assert.match(color, /^#[0-9a-f]{6}$/i, `colore non valido in ${palette.id}`);
  assert.equal(new Set(FONT_PAIRS.map((pair) => pair.id)).size, FONT_PAIRS.length);
  const known = new Set(FONT_FAMILIES.map((font) => font.id));
  for (const pair of FONT_PAIRS) for (const id of [pair.display, pair.script, pair.body]) assert.ok(known.has(id), `il font ${id} (${pair.id}) non esiste nella libreria: l'esportazione non potrebbe incorporarlo`);
  for (const pair of FONT_PAIRS) assert.equal(FONT_FAMILIES.find((font) => font.id === pair.script)?.category, "script", `${pair.id}: la parola calligrafica deve essere un font calligrafico`);
  assert.deepEqual(brandFontIds({ ...defaultBrand(""), fontPairId: "moda" }).sort(), ["bodoni-moda", "jost", "pinyon-script"]);
  assert.equal(monogramOf("  luigi e carolina"), "L");
  assert.equal(monogramOf("!!!"), "·");
  assert.equal(readableOn("#ffffff", "#111111", "#eeeeee"), "#111111");
  assert.equal(readableOn("#101010", "#111111", "#eeeeee"), "#eeeeee");
  assert.equal(readableOn("non-un-colore", "#111111", "#eeeeee"), "#111111");
});

test("catalogo: identificativi unici, trame che puntano a modelli veri, campi senza doppioni", () => {
  assert.equal(new Set(TEMPLATES.map((template) => template.id)).size, TEMPLATES.length, "modelli con id doppi");
  for (const set of SETS) {
    for (const id of [set.arc.open, set.arc.close, ...set.arc.middle]) assert.ok(templateOf(id), `${set.id}: il modello ${id} della trama non esiste`);
    assert.ok(set.arc.middle.length >= 4, `${set.id}: una trama di mezzo troppo corta si ripete subito`);
    assert.ok(PALETTES.some((palette) => palette.id === set.paletteId) && FONT_PAIRS.some((pair) => pair.id === set.fontPairId), `${set.id}: colori o font consigliati inesistenti`);
    assert.ok(templatesForSet(set.id).length >= 5, `${set.id}: troppo pochi modelli tra cui scegliere`);
  }
  for (const template of TEMPLATES) {
    assert.equal(new Set(template.fields.map((fieldDef) => fieldDef.key)).size, template.fields.length, `${template.id}: campi con chiave doppia`);
    for (const variant of template.variants ?? []) for (const key of Object.keys(variant)) assert.ok(template.fields.some((fieldDef) => fieldDef.key === key), `${template.id}: la variante usa il campo inesistente ${key}`);
  }
  assert.equal(setInfo("moda").id, "moda");
});

// ---------------------------------------------------------------------------
// Geometria e testo
// ---------------------------------------------------------------------------

test("coverFit: l'immagine copre sempre la cornice, non si deforma e il centro scelto si rispetta (prova casuale)", () => {
  const random = mulberry32(11);
  for (let index = 0; index < 3000; index += 1) {
    const frame = { x: random() * 200 - 100, y: random() * 200 - 100, w: 20 + random() * 900, h: 20 + random() * 900 };
    const aspect = 0.2 + random() * 5;
    const zoom = 1 + random() * 4;
    const cx = random();
    const cy = random();
    const fit = coverFit(frame, aspect, zoom, cx, cy);
    assert.ok(Math.abs(fit.w / fit.h - aspect) < 0.01 * aspect, "proporzioni alterate");
    const eps = 0.02;
    assert.ok(fit.x <= frame.x + eps && fit.y <= frame.y + eps && fit.x + fit.w >= frame.x + frame.w - eps && fit.y + fit.h >= frame.y + frame.h - eps, "bordi vuoti nella cornice");
  }
  const centered = coverFit({ x: 0, y: 0, w: 100, h: 100 }, 2, 1, 0.5, 0.5);
  assert.equal(centered.h, 100);
  assert.equal(centered.x, -50, "una foto larga si ritaglia ai lati in modo simmetrico");
  const left = coverFit({ x: 0, y: 0, w: 100, h: 100 }, 2, 1, 0, 0.5);
  assert.equal(left.x, 0, "con il centro a sinistra si vede il bordo sinistro");
  assert.deepEqual(coverFit({ x: 0, y: 0, w: 100, h: 100 }, Number.NaN, Number.NaN, Number.NaN, Number.NaN), coverFit({ x: 0, y: 0, w: 100, h: 100 }, 1, 1, 0.5, 0.5), "valori non numerici non rompono il disegno");
});

test("fitSize e balance: il titolo sta nella larghezza e le righe si bilanciano", () => {
  const face = (text: string, size: number) => approximateMeasure(text, { family: "x", weight: 400, italic: false }, size);
  const size = fitSize(approximateMeasure, "UNA RIGA LUNGA", "bodoni-moda", { width: 400, max: 500, min: 10 });
  assert.ok(face("UNA RIGA LUNGA", size) <= 400.01, "il titolo esce dalla larghezza");
  assert.ok(fitSize(approximateMeasure, "AB", "bodoni-moda", { width: 400, max: 60, min: 10 }) === 60, "non supera il massimo");
  assert.ok(fitSize(approximateMeasure, "UNA RIGA LUNGHISSIMA CHE NON ENTRA", "bodoni-moda", { width: 40, max: 60, min: 18 }) === 18, "non scende sotto il minimo");
  assert.equal(balance("Luigi e Carolina"), "Luigi e\nCarolina");
  assert.equal(balance("Per sempre"), "Per sempre", "i titoli brevi restano su una riga");
  assert.equal(balance("Già\nspezzato a mano qui"), "Già\nspezzato a mano qui", "un a capo scritto da chi usa il programma non si tocca");
  assert.equal(balance("Parola"), "Parola");
  assert.match(starPath(10, 10, 5), /^M[\d. L-]+Z$/);
});

// ---------------------------------------------------------------------------
// Ogni modello, in ogni formato e tono
// ---------------------------------------------------------------------------

test("modelli: in tutti i formati e toni i livelli sono validi, il testo non esce dalla tela e le foto occupano lo spazio", () => {
  const project = album();
  const failures: string[] = [];
  for (const format of SOCIAL_FORMATS) {
    for (const template of TEMPLATES) {
      for (const [tone, flip] of [["dark", false], ["light", false], ["dark", true], ["light", true]] as const) {
        const base = plan(project);
        const slide: Slide = { ...slideFor(template.id, project), tone, ...(template.id === "sh-pano" ? { span: { index: 1, count: 3 } } : { flip }) };
        const carousel = withSlides({ ...base, brand: { ...base.brand, name: "Studio Luce", handle: "@studioluce" } }, [slide, slide], format.id);
        const built = buildSlide(carousel, 0, envOf(project));
        const where = `${template.id} · ${format.id} · ${tone}${flip ? " · specchiato" : ""}`;
        const ids = new Set<string>();
        const slotsSeen = new Set<number>();
        for (const layer of built.layers) {
          if (ids.has(layer.id)) failures.push(`${where}: livello ${layer.id} doppio`);
          ids.add(layer.id);
          const numbers = Object.entries(layer).filter(([key, value]) => typeof value === "number" && key !== "opacity").map(([, value]) => value);
          if (!numbers.every(finite)) failures.push(`${where}: livello ${layer.id} con numeri non validi`);
          if (layer.kind === "photo") {
            slotsSeen.add(layer.slot);
            if (layer.w <= 0 || layer.h <= 0) failures.push(`${where}: foto senza dimensioni`);
            const overlapW = Math.min(layer.x + layer.w, format.width) - Math.max(layer.x, 0);
            const overlapH = Math.min(layer.y + layer.h, format.height) - Math.max(layer.y, 0);
            if (overlapW <= 0 || overlapH <= 0 || (overlapW * overlapH) / (layer.w * layer.h) < 0.05) failures.push(`${where}: la foto ${layer.slot} è quasi tutta fuori dalla tela`);
          }
          if (layer.kind === "text") {
            if (!layer.text.trim()) failures.push(`${where}: testo vuoto nel livello ${layer.id}`);
            if (layer.sizePx < 12) failures.push(`${where}: testo troppo piccolo (${layer.sizePx}px)`);
            if (!layer.rotation && template.id !== "sh-pano") {
              const height = layoutOf(layer, measure).height;
              if (layer.x < -0.5 || layer.x + layer.w > format.width + 0.5) failures.push(`${where}: il testo «${layer.text.slice(0, 24)}» esce a destra o a sinistra`);
              if (layer.y < -0.5 || layer.y + height > format.height + 0.5) failures.push(`${where}: il testo «${layer.text.slice(0, 24)}» esce in alto o in basso (y ${layer.y}, altezza ${Math.round(height)})`);
            }
          }
        }
        for (let slot = 0; slot < template.slots.length; slot += 1) if (!slotsSeen.has(slot)) failures.push(`${where}: lo spazio foto ${slot} non è disegnato`);
        if (template.needsSpread && !built.layers.some((layer) => layer.kind === "spread")) failures.push(`${where}: manca la doppia pagina`);
        if (!/^#[0-9a-f]{6}$/i.test(built.background)) failures.push(`${where}: sfondo non valido`);
      }
    }
  }
  assert.deepEqual(failures, [], failures.slice(0, 12).join("\n"));
});

test("modelli: campi svuotati spariscono dalla slide e i valori predefiniti usano marca e album", () => {
  const project = album();
  const carousel = plan(project, { brand: { ...defaultBrand(""), name: "Atelier Luce", handle: "@atelier" } });
  const template = templateOf("ed-cover")!;
  const slide = slideFor("ed-cover", project);
  const texts = resolveTexts(template, slide, carousel.brand, project.projectName);
  assert.equal(texts.kicker, "ATELIER LUCE");
  assert.equal(texts.title, project.projectName);
  const emptied = withSlides(carousel, [{ ...slide, texts: { title: "", subtitle: "", kicker: "" } }, slide]);
  const built = buildSlide(emptied, 0, envOf(project));
  assert.equal(built.layers.filter((layer) => layer.kind === "text" && layer.text.trim() === "").length, 0);
  assert.ok(!built.layers.some((layer) => layer.kind === "text" && layer.text.includes("ATELIER")), "un campo svuotato deve sparire");
  assert.equal(templateForSlide(carousel, { ...slide, templateId: "non-esiste" }).id, setInfo(carousel.setId).arc.open, "un modello sconosciuto ripiega sull'apertura dello stile");
});

test("panorama: le parti si incastrano senza stacchi e il testo continua da una slide all'altra", () => {
  const project = album();
  const wide = project.assets[7];
  const base = plan(project, { count: 6 });
  const parts = [0, 1, 2].map((index): Slide => ({ id: `p${index}`, templateId: "sh-pano", photos: [wide.id], texts: { word: "Per sempre" }, span: { index, count: 3 } }));
  const carousel = withSlides(base, [...parts, ...base.slides.slice(0, 1)]);
  const photos = parts.map((_, index) => buildSlide(carousel, index, envOf(project)).layers.find((layer) => layer.kind === "photo")!);
  for (let index = 0; index < 3; index += 1) {
    const layer = photos[index] as Extract<typeof photos[number], { kind: "photo" }>;
    assert.equal(layer.w, 3 * 1080, "la foto copre tutte le slide");
    assert.equal(layer.x, -index * 1080, "ogni parte mostra il suo tratto");
  }
  const texts = parts.map((_, index) => buildSlide(carousel, index, envOf(project)).layers.find((layer) => layer.kind === "text" && layer.font === "pinyon-script")!);
  const [first, second] = texts as Array<Extract<typeof texts[number], { kind: "text" }>>;
  assert.equal(second.x - first.x, -1080, "la parola gigante prosegue sulla slide successiva");
  assert.equal(first.sizePx, second.sizePx);
});

// ---------------------------------------------------------------------------
// Disegno SVG
// ---------------------------------------------------------------------------

test("SVG: ben formato, identificativi unici e collegati, testo protetto, foto mancanti segnalate", () => {
  const project = album();
  const base = plan(project, { brand: { ...defaultBrand(""), name: 'Luce & "Ombra" <Studio>', handle: "@a&b" } });
  const tricky = { ...slideFor("ed-hero", project), texts: { title: 'Rock & <b>"Roll"</b>', body: "a < b > c 'd'", script: "x&y" } };
  const svg = renderSlideSvg(withSlides(base, [tricky, tricky]), 0, envOf(project), allMedia(project), { idPrefix: "t0" });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 1080 1350" width="1080" height="1350"/);
  assert.ok(svg.endsWith("</svg>"));
  assert.ok(!svg.includes("<b>"), "il testo scritto dall'utente non deve diventare codice");
  assert.ok(/&amp;/.test(svg) && /&lt;b&gt;/i.test(svg), "il testo è protetto");
  assert.ok(!/<b>|<\/b>/i.test(svg), "nessun tag scritto dall'utente deve restare nell'SVG");
  const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "identificativi interni doppi");
  for (const match of svg.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.includes(match[1]), `riferimento a ${match[1]} senza definizione`);
  assert.ok(!/NaN|undefined|Infinity/.test(svg), "valori non validi nell'SVG");
  // Due slide nella stessa pagina non si scambiano gli identificativi se hanno prefissi diversi.
  const other = renderSlideSvg(withSlides(base, [tricky, tricky]), 1, envOf(project), allMedia(project), { idPrefix: "t1" });
  const otherIds = [...other.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(otherIds.filter((id) => ids.includes(id)).length, 0);
  // Foto senza immagine: segnaposto grigio riconoscibile, mai un SVG rotto.
  const empty = renderSlideSvg(withSlides(base, [tricky, tricky]), 0, envOf(project), { photos: new Map(), spreads: new Map() }, { idPrefix: "e", placeholders: true });
  assert.ok(empty.includes("data-empty-slot") && empty.includes("Aggiungi una foto"));
  assert.ok(!renderSlideSvg(withSlides(base, [tricky, tricky]), 0, envOf(project), { photos: new Map(), spreads: new Map() }, { idPrefix: "e2" }).includes("Aggiungi una foto"), "in esportazione il segnaposto non porta scritte");
});

test("SVG: foto ruotate di un quarto di giro, maschere nei limiti, effetti definiti una volta", () => {
  const project = album();
  const turned = { ...project, assets: project.assets.map((asset, index) => (index === 0 ? { ...asset, rotationDegrees: 90 as const } : asset)) };
  const slide: Slide = { id: "x", templateId: "ed-hero", photos: [turned.assets[0].id], texts: {} };
  const carousel = withSlides(plan(turned), [slide, slide]);
  const svg = renderSlideSvg(carousel, 0, envOf(turned), allMedia(turned), { idPrefix: "r" });
  assert.match(svg, /<image [^>]*transform="rotate\(90 /, "la rotazione dell'utente deve vedersi");
  for (const mask of ["rect", "ellipse", "arch"] as const) {
    const path = maskPath(mask, 100, 200, 300, 500, mask === "rect" ? 12 : 0, 8);
    assert.match(path, /^M[\d. a-zA-Z-]+Z$/, mask);
    assert.ok(!/NaN/.test(path));
  }
  const cin = withSlides(plan(project), [{ ...slideFor("ci-strip", project) }, slide]);
  const blurred = renderSlideSvg(cin, 0, envOf(project), allMedia(project), { idPrefix: "c" });
  assert.match(blurred, /<feGaussianBlur stdDeviation="46"/, "lo sfondo sfocato usa un filtro");
  const mono = renderSlideSvg(withSlides(plan(project), [slideFor("ed-quote", project), slide]), 0, envOf(project), allMedia(project), { idPrefix: "m" });
  assert.match(mono, /feColorMatrix type="saturate" values="0"/, "il bianco e nero usa un filtro");
});

// ---------------------------------------------------------------------------
// Piano automatico
// ---------------------------------------------------------------------------

test("piano: ogni stile, formato e numero di slide dà un carosello valido, con apertura e chiusura", () => {
  const project = album();
  for (const set of SETS) {
    for (const format of SOCIAL_FORMATS) {
      for (const count of [2, 3, 5, 8, 12, 20]) {
        const carousel = plan(project, { setId: set.id, format: format.id, count });
        assert.equal(carousel.slides.length, count, `${set.id} ${count}`);
        assertCarouselInvariants(carousel, project);
        assert.equal(carousel.slides[0].templateId, set.arc.open);
        assert.equal(carousel.slides[count - 1].templateId, set.arc.close);
      }
    }
  }
  assert.equal(clampCount(0), MIN_SLIDES);
  assert.equal(clampCount(99), MAX_SLIDES);
  assert.equal(clampCount(7.4), 7);
});

test("piano: foto migliori, mai scartate, mai ripetute finché ce ne sono di nuove, forma giusta per ogni spazio", () => {
  const project = album();
  const carousel = plan(project, { count: 10, setId: "galleria" });
  const used = [...usedAssetIds(carousel)];
  const rejected = project.assets.filter((asset) => asset.pickStatus === "rejected").map((asset) => asset.id);
  assert.ok(used.every((id) => !rejected.includes(id)), "una foto scartata nel Selector non deve finire in un post");
  const flat = carousel.slides.filter((slide) => !slide.span).flatMap((slide) => slide.photos);
  assert.equal(new Set(flat).size, flat.length, "foto ripetuta pur avendone di nuove");
  const ranking = rankPhotos(project);
  const average = (ids: string[]) => ids.reduce((sum, id) => sum + (ranking.find((photo) => photo.assetId === id)?.score ?? 0), 0) / ids.length;
  assert.ok(average(used) > average(ranking.map((photo) => photo.assetId)) + 5, "le foto scelte devono valere più della media dell'album");
  const byId = new Map(ranking.map((photo) => [photo.assetId, photo]));
  let wrong = 0;
  let total = 0;
  for (const slide of carousel.slides) {
    const template = templateOf(slide.templateId)!;
    template.slots.forEach((slot: SlotKind, index) => {
      const id = slide.photos[index];
      if (!id || slide.span) return;
      total += 1;
      if (slotFit(slot, byId.get(id)!.aspect) === 0) wrong += 1;
    });
  }
  assert.ok(total > 8 && wrong === 0, `${wrong} foto con la forma sbagliata su ${total}: con 40 foto di ogni forma non deve succedere`);
});

test("piano: poche foto → si riprendono le migliori ma mai due volte nella stessa slide; senza foto gli spazi restano vuoti", () => {
  const few = album({ photos: 6, panorama: false, spreads: false });
  const carousel = plan(few, { count: 10 });
  assertCarouselInvariants(carousel, few);
  for (const slide of carousel.slides) {
    const ids = slide.photos.filter(Boolean);
    assert.equal(new Set(ids).size, ids.length, "la stessa foto due volte nella stessa slide");
  }
  assert.ok(carousel.slides.every((slide) => slide.photos.every(Boolean)), "con almeno una foto idonea ogni spazio va riempito, anche riusando");
  const none = makeProject(0);
  const empty = plan(none, { count: 4 });
  assert.ok(empty.slides.every((slide) => slide.photos.every((id) => id === null)));
  assert.equal(carouselReport(empty, none).warnings > 0, true, "gli spazi vuoti vanno segnalati");
});

test("piano: panorama solo con foto davvero larghe, album solo se esiste, ripetizioni con testi diversi, esito stabile", () => {
  const project = album();
  const carousel = plan(project, { count: 8 });
  const pano = carousel.slides.filter((slide) => slide.templateId === "sh-pano");
  assert.equal(pano.length, 2, "con un panorama nell'album e 8 slide se ne fa uno su due slide");
  assert.deepEqual(pano.map((slide) => slide.span), [{ index: 0, count: 2 }, { index: 1, count: 2 }]);
  assert.equal(pano[0].photos[0], project.assets[7].id);
  assert.equal(pano[0].photos[0], pano[1].photos[0]);
  assert.equal(carousel.slides.indexOf(pano[1]) - carousel.slides.indexOf(pano[0]), 1, "le parti stanno una dopo l'altra");

  const mockup = carousel.slides[carousel.slides.length - 2];
  assert.equal(mockup.templateId, "sh-mockup");
  assert.ok(mockup.spreadId && project.spreads.some((spread) => spread.id === mockup.spreadId));
  assert.ok(mockup.spreadId2 && mockup.spreadId2 !== mockup.spreadId, "la seconda doppia pagina è diversa dalla prima");

  const small = plan(project, { count: 4 });
  assert.ok(!small.slides.some((slide) => slide.templateId === "sh-pano" || slide.templateId === "sh-mockup"), "in un carosello breve niente panorama né album");
  const noSpreads = album({ spreads: false });
  assert.ok(!plan(noSpreads, { count: 8 }).slides.some((slide) => slide.templateId === "sh-mockup"), "senza doppie pagine non si propone il mockup");
  const noWide = album({ panorama: false });
  assert.ok(!plan(noWide, { count: 8 }).slides.some((slide) => slide.templateId === "sh-pano"), "senza foto larghe non si propone il panorama");

  // Il modello che torna più volte non ripete i testi.
  for (const set of SETS) {
    const long = plan(project, { setId: set.id, count: 14 });
    const seen = new Map<string, string[]>();
    for (const slide of long.slides) {
      if (slide.span || slide.templateId === "sh-mockup") continue;
      const texts = JSON.stringify(resolveTexts(templateOf(slide.templateId)!, slide, long.brand, project.projectName));
      seen.set(slide.templateId, [...(seen.get(slide.templateId) ?? []), texts]);
    }
    const repeated = [...seen.entries()].filter(([id, list]) => list.length > 1 && (templateOf(id)?.variants?.length ?? 0) > 0);
    for (const [id, list] of repeated) assert.equal(new Set(list.slice(0, 1 + (templateOf(id)!.variants!.length))).size, Math.min(list.length, 1 + templateOf(id)!.variants!.length), `${set.id}/${id}: stessi testi nelle copie`);
  }

  const again = plan(project, { count: 8 });
  const shape = (value: Carousel) => value.slides.map((slide) => [slide.templateId, slide.photos, slide.spreadId ?? null, slide.span ?? null]);
  assert.deepEqual(shape(again), shape(carousel), "lo stesso album deve dare sempre lo stesso carosello");
});

test("piano: scelta delle foto preferite e limitata, foto di capitoli diversi, scelta per spazio", () => {
  const project = album();
  const ranking = rankPhotos(project);
  assert.ok(ranking.every((photo, index) => index === 0 || photo.score <= ranking[index - 1].score), "classifica non ordinata");
  assert.ok(!ranking.some((photo) => photo.assetId === project.assets[2].id), "la foto scartata non è in classifica");
  const only = new Set(project.assets.slice(10, 16).map((asset) => asset.id));
  assert.ok(rankPhotos(project, only).every((photo) => only.has(photo.assetId)));
  const limited = plan(project, { count: 5, assetIds: [...only] });
  assert.ok([...usedAssetIds(limited)].every((id) => only.has(id)), "il carosello deve usare solo le foto indicate");
  const favourite = project.assets[33].id;
  const preferred = plan(project, { count: 8, prefer: [favourite] });
  assert.ok(usedAssetIds(preferred).has(favourite), "una foto preferita compare");
  const taken = new Set<string>();
  const pick = pickForSlot("portrait", ranking, taken, new Map());
  assert.ok(pick && pick.aspect <= 0.95, "per uno spazio verticale si sceglie una foto verticale");
  assert.equal(pickForSlot("any", [], taken, new Map()), null);
  assert.equal(slotFit("portrait", 0.66), 1);
  assert.equal(slotFit("landscape", 0.66), 0);
  assert.equal(slotFit("any", 3), 1);
});

test("restyle: cambiare stile tiene numero di slide, foto scelte e testi scritti dall'utente", () => {
  const project = album();
  let carousel = plan(project, { count: 8 });
  carousel = setSlideText(carousel, carousel.slides[0].id, "title", "Il mio titolo");
  const photosBefore = [...usedAssetIds(carousel)].filter((id) => carousel.slides.some((slide) => !slide.span && slide.photos.includes(id)));
  const next = restyle(project, carousel, "moda");
  assertCarouselInvariants(next, project);
  assert.equal(next.id, carousel.id, "resta lo stesso carosello");
  assert.equal(next.setId, "moda");
  assert.equal(next.slides.length, carousel.slides.length);
  assert.equal(next.brand.paletteId, setInfo("moda").paletteId, "si propongono i colori dello stile");
  assert.equal(next.brand.name, carousel.brand.name);
  assert.equal(next.slides[0].texts.title, "Il mio titolo", "il testo scritto passa alla slide nella stessa posizione");
  const kept = photosBefore.filter((id) => usedAssetIds(next).has(id)).length;
  assert.ok(kept >= Math.floor(photosBefore.length * 0.5), `cambiando stile si deve mantenere la maggior parte delle foto scelte (${kept}/${photosBefore.length})`);
  assert.equal(setBrand(carousel.brand, "cinema").fontPairId, setInfo("cinema").fontPairId);
});

// ---------------------------------------------------------------------------
// Modifiche
// ---------------------------------------------------------------------------

test("modifiche: ogni operazione senza effetto restituisce lo stesso oggetto", () => {
  const project = album();
  const carousel = plan(project, { count: 8 });
  const first = carousel.slides[0];
  assert.equal(renameCarousel(carousel, carousel.name), carousel);
  assert.equal(renameCarousel(carousel, "   "), carousel);
  assert.equal(setCaption(carousel, carousel.caption), carousel);
  assert.equal(setFormat(carousel, carousel.format), carousel);
  assert.equal(updateBrand(carousel, { handle: carousel.brand.handle }), carousel);
  const once = setSlideText(carousel, first.id, "title", "x");
  assert.notEqual(once, carousel);
  assert.equal(setSlideText(once, first.id, "title", "x"), once, "lo stesso testo due volte non cambia nulla");
  assert.equal(resetSlideText(carousel, first.id, "title"), carousel);
  assert.equal(setSlideTone(carousel, first.id, undefined), carousel);
  assert.equal(setSlideTemplate(carousel, project, first.id, first.templateId), carousel);
  assert.equal(setSlidePhoto(carousel, first.id, 0, first.photos[0]), carousel);
  assert.equal(moveSlide(carousel, carousel.slides[0].id, -1), carousel);
  assert.equal(moveSlide(carousel, carousel.slides[carousel.slides.length - 1].id, 1), carousel);
  assert.equal(removeSlide(carousel, "non-esiste"), carousel);
  assert.equal(setSlideText(carousel, "non-esiste", "title", "x"), carousel);
});

test("modifiche: testi, tono, foto (con scambio) e modello", () => {
  const project = album();
  let carousel = plan(project, { count: 8 });
  const hero = carousel.slides[1];
  carousel = setSlideText(carousel, hero.id, "title", "Nuovo titolo");
  assert.equal(carousel.slides[1].texts.title, "Nuovo titolo");
  assert.equal(setSlideText(carousel, hero.id, "title", "z".repeat(900)).slides[1].texts.title?.length, 600, "i testi hanno un limite");
  assert.equal("title" in resetSlideText(carousel, hero.id, "title").slides[1].texts, false);
  assert.equal(setSlideTone(carousel, hero.id, "light").slides[1].tone, "light");
  assert.equal("tone" in setSlideTone(setSlideTone(carousel, hero.id, "light"), hero.id, undefined).slides[1], false);

  const collage = addSlide(carousel, project, "ci-strip", hero.id);
  const strip = collage.slides[2];
  assert.equal(strip.photos.length, 3);
  const swapped = setSlidePhoto(collage, strip.id, 0, strip.photos[2]);
  assert.equal(swapped.slides[2].photos[0], strip.photos[2]);
  assert.equal(swapped.slides[2].photos[2], strip.photos[0], "la stessa foto in due spazi si scambia, non si duplica");
  const emptied = setSlidePhoto(collage, strip.id, 1, null);
  assert.equal(emptied.slides[2].photos[1], null);
  assert.equal(setSlidePhoto(collage, strip.id, 9, "x"), collage, "spazio inesistente");

  const changed = setSlideTemplate(setSlideText(carousel, hero.id, "title", "Resta"), project, hero.id, "ed-sandwich");
  assert.equal(changed.slides[1].templateId, "ed-sandwich");
  assert.equal(changed.slides[1].photos[0], hero.photos[0], "la foto resta nello stesso spazio");
  const toMockup = setSlideTemplate(carousel, project, hero.id, "sh-mockup");
  assert.ok(toMockup.slides[1].spreadId, "il mockup riceve da solo una doppia pagina");
  assert.equal(toMockup.slides[1].photos.length, 0);
  const spreadChanged = setSlideSpread(toMockup, hero.id, 2, project.spreads[3].id);
  assert.equal(spreadChanged.slides[1].spreadId2, project.spreads[3].id);
  assert.equal(setSlideSpread(spreadChanged, hero.id, 2, null).slides[1].spreadId2, null);
  assertCarouselInvariants(changed, project);
  assertCarouselInvariants(toMockup, project);
});

test("modifiche: ordine, duplicati, limiti 2-20 e panorama che non si spezza mai", () => {
  const project = album();
  let carousel = plan(project, { count: 8 });
  const ids = () => carousel.slides.map((slide) => slide.id);
  const [a, b] = ids();
  carousel = moveSlide(carousel, a, 1);
  assert.deepEqual(ids().slice(0, 2), [b, a]);
  carousel = duplicateSlide(carousel, a);
  assert.equal(carousel.slides.length, 9);
  assert.equal(carousel.slides[2].templateId, carousel.slides[1].templateId);
  assert.notEqual(carousel.slides[2].id, carousel.slides[1].id);

  const panoStart = carousel.slides.findIndex((slide) => slide.span?.index === 0);
  const panoId = carousel.slides[panoStart].id;
  const before = ids();
  const moved = moveSlide(carousel, panoId, 1);
  assertCarouselInvariants(moved, project);
  const movedAt = moved.slides.findIndex((slide) => slide.span?.index === 0);
  assert.equal(movedAt, panoStart + 1, "il panorama si sposta intero");
  assert.equal(moved.slides[movedAt + 1].span?.index, 1);
  assert.equal(duplicateSlide(carousel, panoId), carousel, "un panorama non si duplica a metà");
  const withoutPano = removeSlide(carousel, panoId);
  assert.equal(withoutPano.slides.length, carousel.slides.length - 2, "eliminando una parte si toglie tutto il panorama");
  assertCarouselInvariants(withoutPano, project);
  assert.deepEqual(spanRange(carousel, panoStart), [panoStart, panoStart + 1]);
  assert.deepEqual(ids(), before);

  const tiny = plan(project, { count: 2 });
  assert.equal(removeSlide(tiny, tiny.slides[0].id), tiny, "sotto le due slide non si scende");
  const full = plan(project, { count: 20 });
  assert.equal(addSlide(full, project, "ed-hero"), full, "oltre venti slide non si sale");
  assert.equal(duplicateSlide(full, full.slides[1].id), full);
  const nearlyFull = plan(project, { count: 19 });
  assert.equal(addPanorama(nearlyFull, project.assets[7].id, 2), nearlyFull, "un panorama di due slide non entra in un carosello da 19");
  const withPano = addPanorama(tiny, project.assets[7].id, 3, tiny.slides[0].id);
  assert.equal(withPano.slides.length, 5);
  assert.deepEqual(withPano.slides.slice(1, 4).map((slide) => slide.span), [{ index: 0, count: 3 }, { index: 1, count: 3 }, { index: 2, count: 3 }]);
  assertCarouselInvariants(withPano, project);
  const swapped = replacePhoto(withPano, withPano.slides[2].id, 0, project.assets[10].id);
  assert.ok(swapped.slides.slice(1, 4).every((slide) => slide.photos[0] === project.assets[10].id), "cambiare la foto di un panorama la cambia su tutte le parti");
  assert.ok(unusedRanked(swapped, project).every((photo) => !usedAssetIds(swapped).has(photo.assetId)));
});

test("modifiche: oltre mille operazioni casuali non rompono mai il carosello", () => {
  const project = album();
  for (const seed of [1, 2, 3]) {
    const random = mulberry32(seed * 7919);
    let carousel = plan(project, { count: 4 + Math.floor(random() * 10), setId: SETS[seed % SETS.length].id });
    const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)];
    for (let step = 0; step < 400; step += 1) {
      const slide = pick(carousel.slides);
      const operation = Math.floor(random() * 16);
      const asset = pick(project.assets);
      switch (operation) {
        case 0: carousel = moveSlide(carousel, slide.id, random() < 0.5 ? -1 : 1); break;
        case 1: carousel = removeSlide(carousel, slide.id); break;
        case 2: carousel = duplicateSlide(carousel, slide.id); break;
        case 3: carousel = addSlide(carousel, project, pick(templatesForSet(carousel.setId).filter((template) => template.id !== "sh-pano")).id, slide.id); break;
        case 4: carousel = addPanorama(carousel, project.assets[7].id, 2 + Math.floor(random() * 3), slide.id); break;
        case 5: carousel = setSlideTemplate(carousel, project, slide.id, pick(templatesForSet(carousel.setId).filter((template) => template.id !== "sh-pano")).id); break;
        case 6: carousel = replacePhoto(carousel, slide.id, Math.floor(random() * 5), random() < 0.2 ? null : asset.id); break;
        case 7: carousel = setSlideText(carousel, slide.id, "title", String(step)); break;
        case 8: carousel = setFormat(carousel, pick(SOCIAL_FORMATS).id); break;
        case 9: carousel = restyle(project, carousel, pick(SETS).id); break;
        case 10: carousel = setSlideTone(carousel, slide.id, pick([undefined, "dark", "light"] as const)); break;
        case 11: carousel = updateBrand(carousel, { paletteId: pick(PALETTES).id, fontPairId: pick(FONT_PAIRS).id }); break;
        case 12: carousel = setSlideSpread(carousel, slide.id, random() < 0.5 ? 1 : 2, random() < 0.2 ? null : pick(project.spreads).id); break;
        case 14: carousel = resizeCarousel(carousel, project, 2 + Math.floor(random() * 19)); break;
        case 13: carousel = parseCarousel(JSON.parse(JSON.stringify(carousel))) ?? carousel; break;
        default: carousel = setSlidePhoto(carousel, slide.id, Math.floor(random() * 3), asset.id); break;
      }
      assertCarouselInvariants(carousel, project);
      if (step % 40 === 0) {
        // Qualunque stato raggiunto si disegna e si controlla senza errori, in tutti i formati.
        const svg = renderSlideSvg(carousel, Math.floor(random() * carousel.slides.length), envOf(project), allMedia(project), { idPrefix: `f${step}` });
        assert.ok(svg.startsWith("<svg") && !/NaN|undefined/.test(svg));
        assert.equal(typeof carouselReport(carousel, project).errors, "number");
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Controlli prima dell'export
// ---------------------------------------------------------------------------

test("controlli: spazi vuoti, foto sparite, doppie pagine mancanti, troppe slide, risoluzione bassa", () => {
  const project = album();
  const carousel = plan(project, { count: 8 });
  const clean = carouselReport(carousel, project);
  assert.equal(clean.errors, 0);
  assert.equal(clean.warnings, 0, clean.issues.map((issue) => issue.message).join(" | "));
  assert.ok(clean.issues.some((issue) => issue.level === "info" && /profilo/.test(issue.message)), "senza profilo si suggerisce di aggiungerlo");
  assert.ok(!carouselReport({ ...carousel, brand: { ...carousel.brand, handle: "@x" } }, project).issues.some((issue) => /profilo/.test(issue.message)));

  const cleared = setSlidePhoto(carousel, carousel.slides[1].id, 0, null);
  const emptySlot = carouselReport(cleared, project);
  assert.ok(emptySlot.issues.some((issue) => issue.level === "warning" && issue.slideIndex === 1 && /manca una foto/.test(issue.message)));

  const gone = carouselReport(carousel, { ...project, assets: project.assets.filter((asset) => asset.id !== carousel.slides[1].photos[0]) });
  assert.ok(gone.issues.some((issue) => /non è più nell'album/.test(issue.message)));

  const mockupIndex = carousel.slides.findIndex((slide) => slide.templateId === "sh-mockup");
  const noSpread = carouselReport({ ...carousel, slides: carousel.slides.map((slide, index) => (index === mockupIndex ? { ...slide, spreadId: null } : slide)) }, project);
  assert.ok(noSpread.issues.some((issue) => issue.slideIndex === mockupIndex && /doppia pagina/.test(issue.message)));

  const tooMany = { ...carousel, slides: Array.from({ length: 21 }, (_, index) => ({ ...carousel.slides[index % carousel.slides.length], id: `dup${index}` })) };
  assert.equal(carouselReport(tooMany, project).errors, 1);
  assert.equal(carouselReport({ ...carousel, slides: carousel.slides.slice(0, 1) }, project).errors, 1);

  const small = { ...project, assets: project.assets.map((asset) => (asset.id === carousel.slides[1].photos[0] ? { ...asset, width: 400, height: 600, aspectRatio: 400 / 600 } : asset)) };
  assert.ok(carouselReport(carousel, small).issues.some((issue) => issue.slideIndex === 1 && /pochi pixel/.test(issue.message)), "una foto piccola a tutta pagina va segnalata");

  const target = carousel.slides.findIndex((slide, index) => index > 1 && !slide.span && slide.photos.length === 1);
  const reused = withSlides(carousel, carousel.slides.map((slide, index) => (index === target ? { ...slide, photos: [...carousel.slides[1].photos] } : slide)));
  assert.ok(carouselReport(reused, project).issues.some((issue) => issue.level === "info" && /compare in 2 slide/.test(issue.message)));
});

// ---------------------------------------------------------------------------
// Archivio locale
// ---------------------------------------------------------------------------

test("archivio: salva e rilegge senza perdere nulla; ciò che non è valido si scarta senza buttare tutto", () => {
  const project = album();
  const carousel = plan(project, { count: 8, name: "Teaser" });
  const text = serializeCarousels([carousel]);
  assert.deepEqual(parseCarousels(text), [carousel]);
  assert.deepEqual(parseCarousels(null), []);
  assert.deepEqual(parseCarousels("{non è json"), []);
  assert.deepEqual(parseCarousels(JSON.stringify({ version: 99, carousels: [carousel] })), [], "una versione che non conosciamo non si interpreta");
  assert.deepEqual(parseCarousels(JSON.stringify({ version: 1, carousels: "no" })), []);

  const damaged = JSON.parse(text) as { version: number; carousels: Array<Record<string, unknown>> };
  const good = structuredClone(damaged.carousels[0]);
  damaged.carousels.push({ ...structuredClone(good), id: "danneggiato", slides: "no" }, { ...structuredClone(good), id: "senza-marca", brand: null }, 42 as never);
  assert.equal(parseCarousels(JSON.stringify(damaged)).length, 1, "un carosello rotto non porta via gli altri");

  const mixed = structuredClone(good) as { slides: Array<Record<string, unknown>>; format: string; setId: string; name: string; caption: string; brand: Record<string, unknown> };
  mixed.slides[1] = { ...mixed.slides[1], templateId: "modello-che-non-esiste" };
  mixed.slides[2] = { ...mixed.slides[2], photos: [1, "", null, "x", "y", "z", "w"], texts: { title: 5, inventato: "x", subtitle: "ok" } };
  mixed.format = "orizzontale";
  mixed.setId = "sconosciuto";
  mixed.name = "n".repeat(500);
  mixed.caption = "c".repeat(5000);
  mixed.brand = { name: "x".repeat(200), handle: 7, paletteId: "non-esiste", fontPairId: "neppure" };
  const repaired = parseCarousel(mixed)!;
  assert.equal(repaired.slides.length, good.slides ? (good.slides as unknown[]).length - 1 : 0, "il modello sconosciuto si scarta");
  assert.equal(repaired.format, "feed");
  assert.equal(repaired.setId, SETS[0].id);
  assert.equal(repaired.name.length, 60);
  assert.equal(repaired.caption.length, 2200);
  assert.equal(repaired.brand.name.length, 40);
  assert.equal(repaired.brand.handle, "");
  assert.equal(repaired.brand.paletteId, PALETTES[0].id);
  const sanitized = repaired.slides.find((slide) => slide.id === (mixed.slides[2].id as string))!;
  assert.equal(sanitized.photos.length, templateOf(sanitized.templateId)!.slots.length, "le foto si adattano agli spazi del modello");
  assert.ok(sanitized.photos.every((id) => id === null || typeof id === "string"));
  assert.equal(sanitized.texts.title, undefined, "un testo che non è testo si scarta");
  assert.equal("inventato" in sanitized.texts, false, "i campi che il modello non ha si scartano");

  const broken = structuredClone(good) as { slides: Array<Record<string, unknown>> };
  const panoIndex = broken.slides.findIndex((slide) => (slide.span as { index: number } | undefined)?.index === 0);
  broken.slides.splice(panoIndex + 1, 1);
  const withoutBrokenPano = parseCarousel(broken)!;
  assert.ok(!withoutBrokenPano.slides.some((slide) => slide.span), "un panorama a cui manca un pezzo non si mostra a metà");
  assert.equal(parseCarousel({ ...good, slides: [] }), null, "un carosello vuoto non vale");
});

// ---------------------------------------------------------------------------
// Esportazione
// ---------------------------------------------------------------------------

test("esportazione: una immagine per slide, nomi ordinati, dimensioni giuste, testo del post, annullamento", async () => {
  const project = album();
  const carousel = setCaption(plan(project, { count: 5, name: "Teaser matrimonio" }), "Un giorno speciale #matrimonio");
  const written: Array<{ name: string; mime: string; size: number }> = [];
  const writer = { async write(name: string, bytes: Uint8Array, mime: string) { written.push({ name, mime, size: bytes.length }); return `C:\\out\\${name}`; }, where: () => "prova" };
  const sizes: Array<[number, number]> = [];
  const progress: number[] = [];
  const deps = { renderSvg: async (index: number) => `<svg data-i="${index}"/>`, toJpeg: async (_svg: string, width: number, height: number) => { sizes.push([width, height]); return new Uint8Array([1, 2, 3]); } };
  const result = await exportCarouselWith("Album Rossi", carousel, writer, { scale: 1, quality: 0.9, withCaption: true, onProgress: (done) => progress.push(done) }, deps);
  assert.equal(result.count, 5);
  assert.deepEqual(written.map((file) => file.name), [1, 2, 3, 4, 5].map((n) => `Album-Rossi-Teaser-matrimonio-0${n}.jpg`).concat("Album-Rossi-Teaser-matrimonio-testo-del-post.txt"));
  assert.equal(written[5].mime, "text/plain");
  assert.ok(sizes.every(([w, h]) => w === 1080 && h === 1350));
  assert.deepEqual(progress, [1, 2, 3, 4, 5]);
  assert.equal(slideFileName("Album", carousel, 11), "Album-Teaser-matrimonio-12.jpg");

  written.length = 0;
  sizes.length = 0;
  await exportCarouselWith("Album", setFormat(carousel, "story"), writer, { scale: 2, quality: 1, withCaption: false }, deps);
  assert.ok(sizes.every(([w, h]) => w === 2160 && h === 3840), "la dimensione doppia vale per ogni formato");
  assert.equal(written.length, 5, "senza l'opzione il testo del post non si salva");

  written.length = 0;
  const signal = { cancelled: false };
  const partial = await exportCarouselWith("Album", carousel, writer, { scale: 1, quality: 0.9, withCaption: true, signal, onProgress: (done) => { if (done === 2) signal.cancelled = true; } }, deps);
  assert.equal(partial.count, 2);
  assert.equal(written.length, 2, "un'esportazione interrotta non scrive altro, nemmeno il testo del post");

  written.length = 0;
  await exportCarouselWith("Album", { ...carousel, caption: "   " }, writer, { scale: 1, quality: 0.9, withCaption: true }, deps);
  assert.equal(written.length, 5, "un testo del post vuoto non genera un file");
  assert.equal(formatOf("story").height, 1920);
});

// ---------------------------------------------------------------------------
// Segnalino «Per i social» e riscelta delle foto
// ---------------------------------------------------------------------------

test("segnalino «Per i social»: le foto segnate passano davanti a qualsiasi numero di stelle e il file resta valido", () => {
  const project = album();
  const marked = project.assets[33];
  assert.ok((marked.rating ?? 0) < 5, "la foto di prova non deve già avere cinque stelle");
  const tagged: Project = { ...project, assets: project.assets.map((asset) => (asset.id === marked.id ? { ...asset, albumTags: ["social" as const] } : asset)) };
  assert.equal(rankPhotos(tagged)[0].assetId, marked.id, "la foto segnata è la prima della classifica");
  assert.ok(usedAssetIds(plan(tagged, { count: 6 })).has(marked.id), "e finisce nel carosello");
  assert.ok(!usedAssetIds(plan(project, { count: 4 })).has(marked.id), "senza il segnalino non c'era");
  const reopened = parseAlbumProject(serializeAlbumProject(tagged));
  assert.ok(reopened.assets.find((asset) => asset.id === marked.id)!.albumTags?.includes("social"), "il segnalino sopravvive al salvataggio e alla riapertura");
});

test("riscelta: se stelle o segnalini cambiano il carosello lo sa, e «Riscegli le foto» tiene stile, formato, numero di slide e testi", () => {
  const project = album();
  let carousel = plan(project, { count: 8, setId: "moda", format: "square" });
  carousel = setSlideText(carousel, carousel.slides[0].id, "title", "Titolo mio");
  assert.equal(selectionChanged(project, carousel), false, "appena creato non c'è nulla da aggiornare");
  assert.equal(selectionChanged(project, { ...carousel, basis: undefined }), false, "un carosello salvato prima di questa funzione non mostra avvisi");

  const favourite = project.assets[31].id;
  assert.ok(!usedAssetIds(carousel).has(favourite) && (project.assets[31].rating ?? 0) < 5, "la foto di prova non è già nel carosello");
  const rated = setRating(project, favourite, 5);
  assert.notEqual(selectionBasis(rated), selectionBasis(project));
  assert.equal(selectionChanged(rated, carousel), true, "cinque stelle date dopo la creazione cambiano la classifica");
  assert.ok(!usedAssetIds(carousel).has(favourite), "la bozza salvata non si aggiorna da sola");

  const marked: Project = { ...rated, assets: rated.assets.map((asset) => (asset.id === favourite ? { ...asset, albumTags: ["social" as const] } : asset)) };
  const fresh = reselectPhotos(marked, carousel);
  assertCarouselInvariants(fresh, marked);
  assert.equal(fresh.id, carousel.id);
  assert.equal(fresh.setId, "moda");
  assert.equal(fresh.format, "square");
  assert.equal(fresh.slides.length, 8);
  assert.equal(fresh.slides[0].texts.title, "Titolo mio", "il testo scritto resta");
  assert.equal(selectionChanged(marked, fresh), false, "dopo la riscelta non resta nulla da aggiornare");
  assert.ok(usedAssetIds(fresh).has(favourite), "la foto segnata ora è nel carosello");

  const restyled = restyle(rated, carousel, "cinema");
  assert.equal(selectionChanged(rated, restyled), true, "cambiare stile non riscegle le foto: l'avviso resta");
  const accepted = acceptSelection(carousel, selectionBasis(rated));
  assert.equal(selectionChanged(rated, accepted), false, "«Tienilo così» fa sparire l'avviso");
  assert.equal(acceptSelection(accepted, selectionBasis(rated)), accepted);
  assert.equal(parseCarousel(JSON.parse(JSON.stringify(carousel)))!.basis, carousel.basis, "l'impronta si salva e si rilegge");
});

// ---------------------------------------------------------------------------
// Tante slide: modelli universali e numero di slide
// ---------------------------------------------------------------------------

test("venti slide: ogni stile ha abbastanza modelli da non ripetere gli stessi layout", () => {
  const project = album();
  for (const set of SETS) {
    const carousel = plan(project, { setId: set.id, count: 20 });
    assert.equal(carousel.slides.length, 20);
    assertCarouselInvariants(carousel, project);
    const uses = new Map<string, number>();
    for (const slide of carousel.slides) uses.set(slide.templateId, (uses.get(slide.templateId) ?? 0) + 1);
    const distinct = [...uses.keys()].filter((id) => id !== "sh-pano").length;
    assert.ok(distinct >= 14, `${set.id}: solo ${distinct} modelli diversi su 20 slide`);
    const worst = Math.max(...[...uses.entries()].filter(([id]) => id !== "sh-pano").map(([, count]) => count));
    assert.ok(worst <= 2, `${set.id}: un modello compare ${worst} volte`);
    // I modelli universali prendono il fondo dallo stile.
    const tones = new Set(carousel.slides.filter((slide) => slide.templateId.startsWith("sh-") && !["sh-pano", "sh-mockup", "sh-closing"].includes(slide.templateId)).map((slide) => slide.tone));
    if (set.flexTone !== "alternate") assert.deepEqual([...tones], [set.flexTone], `${set.id}: fondo dei modelli universali`);
    else assert.deepEqual([...tones].sort(), ["dark", "light"], `${set.id}: il fondo deve alternarsi`);
  }
});

test("numero di slide: si aggiungono e si tolgono prima della chiusura, senza toccare il resto", () => {
  const project = album();
  const base = plan(project, { count: 8 });
  const grown = resizeCarousel(base, project, 20);
  assertCarouselInvariants(grown, project);
  assert.equal(grown.slides.length, 20);
  assert.equal(grown.slides[0].id, base.slides[0].id, "la copertina resta");
  assert.equal(grown.slides[19].id, base.slides[7].id, "la chiusura resta in fondo");
  assert.deepEqual(grown.slides.slice(0, 7).map((slide) => slide.id), base.slides.slice(0, 7).map((slide) => slide.id), "le slide già fatte non cambiano");
  assert.ok(grown.slides.filter((slide) => slide.templateId === "sh-mockup").length === 1, "il mockup resta uno solo");
  const used = new Map<string, number>();
  for (const slide of grown.slides) used.set(slide.templateId, (used.get(slide.templateId) ?? 0) + 1);
  assert.ok(Math.max(...[...used.entries()].filter(([id]) => id !== "sh-pano").map(([, count]) => count)) <= 2, "le slide aggiunte scelgono i modelli meno usati");

  const edited = setSlideText(base, base.slides[1].id, "title", "Lo tengo");
  const smaller = resizeCarousel(resizeCarousel(edited, project, 20), project, 10);
  assertCarouselInvariants(smaller, project);
  assert.equal(smaller.slides.length, 10);
  assert.equal(smaller.slides[1].texts.title, "Lo tengo", "i testi scritti sopravvivono");
  assert.equal(smaller.slides[0].templateId, setInfo(smaller.setId).arc.open);
  assert.equal(smaller.slides[9].templateId, setInfo(smaller.setId).arc.close);
  const onlyProtected = resizeCarousel(edited, project, 5);
  assertCarouselInvariants(onlyProtected, project);
  assert.equal(onlyProtected.slides.length, 5, "con meno slide restano copertina, chiusura, panorama e album");

  assert.equal(resizeCarousel(base, project, 8), base, "stesso numero: nessun cambiamento");
  assert.equal(resizeCarousel(base, project, 99).slides.length, 20, "mai oltre venti");
  assert.ok(resizeCarousel(base, project, 0).slides.length >= 2, "mai sotto due");
  const protectedOnly = resizeCarousel(base, project, 2);
  assertCarouselInvariants(protectedOnly, project);
  assert.ok(protectedOnly.slides.some((slide) => slide.span) || protectedOnly.slides.length === 2, "un panorama non si spezza per arrivare al numero voluto");

  // Le copie dello stesso modello non ripetono i testi.
  const longer = resizeCarousel(plan(project, { setId: "galleria", count: 6 }), project, 20);
  const solos = longer.slides.filter((slide) => slide.templateId === "ga-solo");
  const texts = solos.map((slide) => JSON.stringify(resolveTexts(templateOf("ga-solo")!, slide, longer.brand, project.projectName)));
  assert.equal(new Set(texts).size, texts.length, "le polaroid o le foto singole ripetono gli stessi testi");
});

test("varianti: ogni modello che può tornare due volte in un carosello ha testi alternativi, e le copie sono diverse", () => {
  const exempt = new Set(["sh-pano", "sh-mockup", "sh-closing", "ed-cover", "ed-cta", "ga-collage", "mo-cover"]);
  for (const template of TEMPLATES) if (!exempt.has(template.id)) assert.ok((template.variants?.length ?? 0) > 0, `${template.id} non ha varianti dei testi`);
  const project = album();
  for (const set of SETS) {
    const carousel = plan(project, { setId: set.id, count: 20 });
    const seen = new Map<string, string[]>();
    for (const slide of carousel.slides) {
      if (slide.span || slide.templateId === "sh-mockup") continue;
      const texts = JSON.stringify(resolveTexts(templateOf(slide.templateId)!, slide, carousel.brand, project.projectName));
      seen.set(slide.templateId, [...(seen.get(slide.templateId) ?? []), texts]);
    }
    for (const [id, list] of seen) assert.equal(new Set(list).size, list.length, `${set.id}/${id}: due copie con gli stessi testi`);
  }
});
