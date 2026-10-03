import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SpreadTextOverlay } from "@photo-tools/shared-types";
import { MAX_OVERLAYS_PER_SPREAD, addGraphicOverlay, addTextOverlay, addTextStack, backgroundsOf, duplicateOverlay, fontIdsOfSpread, mediaIdsOfSpread, orderOverlay, overlaysInPaintOrder, overlaysOf, removeOverlay, groupMembers, groupOverlays, moveOverlayGroup, ungroupOverlay, setAlbumBackground, setSpreadBackground, updateOverlay, updateSpreadBackground } from "./design";
import { LIBRARY_KEYS, SEED_PHRASES, addPhrase, loadPhrases, loadSavedStyles, phraseGroups, removePhrase, removeSavedStyle, savePhrases, saveSavedStyles, updatePhrase, upsertSavedStyle } from "./designLibrary";
import { assertProjectInvariants, makeProject } from "./fixtures";
import { parseAlbumProject, serializeAlbumProject } from "./portability";
import { addSpread, setSpreadDone } from "./spreads";
import { FONT_FAMILIES, TEXT_PRESETS, contrastRatio, fontInfo, nearestFace, readableOn, sanitizeTextStyle } from "./typography";
import { renderBackgroundsSvg, renderOverlaysSvg, overlayBox } from "../render/design-svg";
import { approximateMeasure, layoutText } from "../render/text-layout";
import { renderSpreadSvg } from "../render/spread-svg";
import type { Project } from "./project";

const here = dirname(fileURLToPath(import.meta.url));
const familyOf = (id: string) => fontInfo(id).family;

function withSpread(): { project: Project; spreadId: string } {
  const project = addSpread(makeProject(4), 0, "half");
  return { project, spreadId: project.spreads[0].id };
}

const textOf = (project: Project, id: string) => overlaysOf(project.spreads[0]).find((overlay) => overlay.id === id) as SpreadTextOverlay;

// ------------------------------------------------------------------ font

test("font: ogni famiglia dichiarata ha i suoi file e la licenza è documentata", () => {
  const dir = join(here, "..", "assets", "fonts");
  const files = new Set(readdirSync(dir));
  assert.ok(files.has("OFL-1.1.txt"), "manca il testo della licenza SIL OFL");
  const notes = readFileSync(join(dir, "FONTS.md"), "utf8");
  for (const font of FONT_FAMILIES) {
    for (const weight of font.weights) assert.ok(files.has(`${font.id}-${String(weight).padStart(3, "0")}-normal.woff2`), `${font.id}: manca il peso ${weight}`);
    if (font.italic) assert.ok(files.has(`${font.id}-400-italic.woff2`), `${font.id}: manca il corsivo`);
    assert.ok(notes.includes(font.family), `${font.family} non è elencato in FONTS.md`);
    assert.ok(existsSync(join(dir, `${font.id}-${String(font.weights[0]).padStart(3, "0")}-normal.woff2`)));
  }
  // Nessun file orfano: ogni woff2 appartiene a una famiglia dichiarata.
  for (const file of files) if (file.endsWith(".woff2")) assert.ok(FONT_FAMILIES.some((font) => file.startsWith(`${font.id}-`)), `file orfano: ${file}`);
  assert.ok(!/non\s+open\s*source|proprietar/i.test(notes), "FONTS.md non deve citare font non liberi");
});

test("tipografia: pesi e corsivi inesistenti ripiegano sul più vicino, gli stili fuori scala si limitano", () => {
  assert.deepEqual(nearestFace("abril-fatface", 700, true), { weight: 400, italic: false });
  assert.deepEqual(nearestFace("jost", 700, false), { weight: 600, italic: false });
  assert.equal(nearestFace("bodoni-moda", 400, true).italic, true);
  const wild = sanitizeTextStyle({ font: "non-esiste", sizePt: 9999, weight: 700, lineHeight: -4, trackingEm: 90, color: "rosso", align: "boh" as never, opacity: 0, dropCapLines: 99, paragraphSpacePt: -3 });
  assert.equal(wild.font, "cormorant-garamond");
  assert.equal(wild.sizePt, 400);
  assert.equal(wild.lineHeight, 0.8);
  assert.equal(wild.trackingEm, 1);
  assert.equal(wild.color, "#1c1c1c");
  assert.equal(wild.align, "left");
  assert.equal(wild.opacity, 0.05);
  assert.equal(wild.dropCapLines, 6);
  assert.equal(wild.paragraphSpacePt, 0);
  for (const preset of TEXT_PRESETS) {
    assert.deepEqual(sanitizeTextStyle(preset.style), preset.style, `${preset.id}: stile non già in regola`);
    assert.ok(!/vogue/i.test(preset.name + preset.sample + preset.use), "niente marchi altrui negli esempi");
  }
});

// ------------------------------------------------------------------ testi

test("testi: si aggiungono con lo stile scelto, si modificano entro i limiti e si tolgono", () => {
  let { project, spreadId } = withSpread();
  const made = addTextOverlay(project, spreadId, { presetId: "headline", text: "Ciao", at: { x: 0.25, y: 0.1 } });
  assert.ok(made.overlayId);
  project = made.project;
  const text = textOf(project, made.overlayId!);
  assert.equal(text.kind, "text");
  assert.equal(text.font, "playfair-display");
  assert.equal(text.text, "Ciao");
  assert.ok(text.x >= 0 && text.x + text.w <= 1, "resta dentro lo spread");
  assert.equal(text.z, 1);
  assertProjectInvariants(project, "testo aggiunto");

  const edited = updateOverlay(project, spreadId, text.id, { sizePt: 5000, x: 9, rotation: 500, color: "x", text: "y".repeat(20000) });
  const after = textOf(edited, text.id);
  assert.equal(after.sizePt, 400);
  assert.equal(after.x, 1.5);
  assert.equal(after.rotation, 180);
  assert.equal(after.color, "#1c1c1c");
  assert.equal(after.text.length, 6000);
  assert.equal(updateOverlay(project, spreadId, text.id, { sizePt: text.sizePt }), project, "nessun cambiamento → stesso progetto");
  assert.equal(updateOverlay(project, spreadId, "x", { sizePt: 20 }), project);
  assert.equal(updateOverlay(project, "x", text.id, { sizePt: 20 }), project);

  const without = removeOverlay(edited, spreadId, text.id);
  assert.ok(!("overlays" in without.spreads[0]), "senza elementi la chiave sparisce");
  assert.equal(removeOverlay(without, spreadId, text.id), without);
  assert.equal(addTextOverlay(project, "x").overlayId, null);
});

test("testi: duplicare, ordinare e il tetto di elementi per spread", () => {
  let { project, spreadId } = withSpread();
  const ids: string[] = [];
  for (const preset of ["headline", "body", "caption"]) {
    const made = addTextOverlay(project, spreadId, { presetId: preset });
    project = made.project;
    ids.push(made.overlayId!);
  }
  assert.deepEqual(overlaysOf(project.spreads[0]).map((overlay) => overlay.z), [1, 2, 3]);
  project = orderOverlay(project, spreadId, ids[0], "front");
  assert.deepEqual(overlaysInPaintOrder(overlaysOf(project.spreads[0])).map((overlay) => overlay.id), [ids[1], ids[2], ids[0]]);
  assert.equal(orderOverlay(project, spreadId, ids[0], "front"), project, "già davanti");
  project = orderOverlay(project, spreadId, ids[0], "back");
  assert.equal(overlaysInPaintOrder(overlaysOf(project.spreads[0]))[0].id, ids[0]);
  const copy = duplicateOverlay(project, spreadId, ids[1]);
  assert.ok(copy.overlayId && copy.overlayId !== ids[1]);
  assert.equal(overlaysOf(copy.project.spreads[0]).length, 4);
  assertProjectInvariants(copy.project, "duplicato");

  let crowded = project;
  for (let index = overlaysOf(crowded.spreads[0]).length; index < MAX_OVERLAYS_PER_SPREAD; index += 1) crowded = addTextOverlay(crowded, spreadId).project;
  assert.equal(overlaysOf(crowded.spreads[0]).length, MAX_OVERLAYS_PER_SPREAD);
  assert.equal(addTextOverlay(crowded, spreadId).overlayId, null);
  assert.equal(duplicateOverlay(crowded, spreadId, ids[0]).overlayId, null);
  assert.equal(addGraphicOverlay(crowded, spreadId, { mediaId: "media-1", aspect: 1 }).overlayId, null);
});

test("grafiche: proporzioni e limiti, e richiamo dei file della libreria", () => {
  const { project, spreadId } = withSpread();
  const made = addGraphicOverlay(project, spreadId, { mediaId: "media-ab", aspect: 2, width: 0.3 });
  const graphic = overlaysOf(made.project.spreads[0])[0];
  assert.equal(graphic.kind, "graphic");
  assert.equal(addGraphicOverlay(project, spreadId, { mediaId: "", aspect: 1 }).overlayId, null);
  const odd = overlaysOf(addGraphicOverlay(project, spreadId, { mediaId: "m", aspect: -4 }).project.spreads[0])[0];
  assert.equal(odd.kind === "graphic" ? odd.aspect : 0, 1, "proporzioni non valide → quadrata");
  const edited = updateOverlay(made.project, spreadId, graphic.id, { opacity: 5, w: 99 });
  const next = overlaysOf(edited.spreads[0])[0];
  assert.equal(next.kind === "graphic" ? next.opacity : -1, 1);
  assert.equal(next.w, 2);
  let withBackground = setSpreadBackground(made.project, spreadId, "left", { mediaId: "builtin-ivory", aspect: 1.5 });
  withBackground = addTextOverlay(withBackground, spreadId, { style: { font: "jost" } }).project;
  assert.deepEqual(mediaIdsOfSpread(withBackground.spreads[0]).sort(), ["builtin-ivory", "media-ab"]);
  assert.deepEqual(fontIdsOfSpread(withBackground.spreads[0]), ["jost"]);
});

// ------------------------------------------------------------------ sfondi

test("sfondi: uno per pagina o uno su tutto lo spread, mai in conflitto; l'album salta gli spread finiti", () => {
  let { project, spreadId } = withSpread();
  project = setSpreadBackground(project, spreadId, "left", { mediaId: "builtin-ivory", aspect: 1.5 });
  project = setSpreadBackground(project, spreadId, "right", { mediaId: "builtin-slate", aspect: 1.5, opacity: 0.4 });
  assert.deepEqual(backgroundsOf(project.spreads[0]).map((background) => background.scope), ["left", "right"]);
  project = setSpreadBackground(project, spreadId, "spread", { mediaId: "builtin-dawn", aspect: 1.5, fit: "tile", tileCm: 999 });
  const [only] = backgroundsOf(project.spreads[0]);
  assert.equal(backgroundsOf(project.spreads[0]).length, 1, "tutto lo spread sostituisce le pagine");
  assert.equal(only.tileCm, 40);
  project = setSpreadBackground(project, spreadId, "left", { mediaId: "builtin-ink", aspect: 1.5 });
  assert.deepEqual(backgroundsOf(project.spreads[0]).map((background) => background.scope), ["left"], "una pagina sostituisce lo sfondo di tutto lo spread");
  assert.equal(setSpreadBackground(project, spreadId, "right", null), project);
  project = updateSpreadBackground(project, spreadId, "left", { fit: "contain", opacity: 0.5 });
  assert.equal(backgroundsOf(project.spreads[0])[0].fit, "contain");
  assert.equal(updateSpreadBackground(project, spreadId, "right", { fit: "tile" }), project);
  assertProjectInvariants(project, "sfondi");
  project = setSpreadBackground(project, spreadId, "left", null);
  assert.ok(!("backgrounds" in project.spreads[0]));

  let album = addSpread(addSpread(project, 1, "full"), 2, "full");
  album = setSpreadDone(album, album.spreads[1].id, true);
  const painted = setAlbumBackground(album, "spread", { mediaId: "builtin-linen", aspect: 1.5 });
  assert.equal(backgroundsOf(painted.spreads[0]).length, 1);
  assert.equal(backgroundsOf(painted.spreads[1]).length, 0, "spread finito intatto");
  assert.equal(backgroundsOf(painted.spreads[2]).length, 1);
  assert.equal(backgroundsOf(setAlbumBackground(painted, "spread", null).spreads[0]).length, 0);
});

// ------------------------------------------------------------------ impaginazione del testo

const overlay = (patch: Partial<SpreadTextOverlay>): SpreadTextOverlay => ({
  ...sanitizeTextStyle({ font: "jost", sizePt: 10, align: "left", lineHeight: 1.5 }),
  kind: "text", id: "t", x: 0.1, y: 0.1, w: 0.5, rotation: 0, z: 1, text: "", ...patch,
});

test("layout: va a capo senza uscire dalla cornice, mantiene i paragrafi e la maiuscola", () => {
  const box = 40;
  const text = overlay({ text: "uno due tre quattro cinque sei sette otto nove dieci undici dodici\nsecondo paragrafo breve", uppercase: true, paragraphSpacePt: 10 });
  const layout = layoutText(text, box, approximateMeasure, familyOf);
  assert.ok(layout.lines.length > 4);
  for (const line of layout.lines) assert.ok(approximateMeasure(line.text, { family: "x", weight: 400, italic: false }, layout.sizeMm) <= box + 1e-6, `riga troppo larga: ${line.text}`);
  assert.ok(layout.lines.every((line) => line.text === line.text.toUpperCase()));
  const gaps = layout.lines.slice(1).map((line, index) => line.baseline - layout.lines[index].baseline);
  const lineMm = layout.sizeMm * text.lineHeight;
  assert.ok(gaps.filter((gap) => gap > lineMm + 1e-6).length === 1, "una sola riga è separata dallo spazio tra paragrafi");
  assert.ok(Math.abs(layout.height - (layout.lines.length * lineMm + (10 * 25.4) / 72)) < 1e-6);
  assert.deepEqual(layoutText(overlay({ text: "" }), box, approximateMeasure, familyOf).lines.map((line) => line.text), [""]);
});

test("layout: una parola più larga della cornice si spezza, il giustificato non allarga l'ultima riga", () => {
  const long = layoutText(overlay({ text: "supercalifragilistichespiralidoso" }), 10, approximateMeasure, familyOf);
  assert.ok(long.lines.length > 1);
  assert.equal(long.lines.map((line) => line.text).join(""), "supercalifragilistichespiralidoso");
  const justified = layoutText(overlay({ text: "alfa beta gamma delta epsilon zeta eta theta iota kappa", align: "justify" }), 30, approximateMeasure, familyOf);
  const stretched = justified.lines.filter((line) => line.justifyTo);
  assert.ok(stretched.length >= 1 && stretched.length === justified.lines.length - 1);
  assert.ok(stretched.every((line) => line.justifyTo === 30));
  const centered = layoutText(overlay({ text: "alfa beta", align: "center" }), 30, approximateMeasure, familyOf);
  assert.deepEqual([centered.lines[0].anchor, centered.lines[0].x], ["middle", 15]);
  assert.equal(layoutText(overlay({ text: "alfa", align: "right" }), 30, approximateMeasure, familyOf).lines[0].x, 30);
});

test("layout: il capolettera stacca la prima lettera e accorcia le prime righe", () => {
  const text = overlay({ text: "Tutto è iniziato con un sorriso e con un abbraccio lungo, poi sono arrivati i fiori, la musica e la luce del tramonto sulle sedie del giardino.", dropCapLines: 3, sizePt: 10 });
  const layout = layoutText(text, 60, approximateMeasure, familyOf);
  assert.ok(layout.dropCap && layout.dropCap.char === "T");
  assert.ok(layout.dropCap!.sizeMm > layout.sizeMm * 2);
  assert.ok(layout.lines[0].x > 0 && layout.lines[2].x > 0 && layout.lines[3].x === 0, "le prime tre righe sono rientrate");
  assert.ok(!layout.lines[0].text.startsWith("T"));
  assert.ok(layout.height >= 3 * layout.sizeMm * text.lineHeight);
  const short = layoutText(overlay({ text: "Ciao", dropCapLines: 4 }), 60, approximateMeasure, familyOf);
  assert.ok(short.height >= 4 * short.sizeMm * 1.5 - 1e-6, "il capolettera non esce dalla cornice");
});

test("layout: casuale — mai righe oltre la cornice, mai testo perso", () => {
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const words = ["sole", "mare", "festa", "abbraccio", "ricordo", "à", "è", "supercalifragilistichespiralidoso", "a", "—"];
  for (let run = 0; run < 150; run += 1) {
    const text = Array.from({ length: 1 + Math.floor(random() * 5) }, () => Array.from({ length: 1 + Math.floor(random() * 25) }, () => words[Math.floor(random() * words.length)]).join(" ")).join("\n");
    const width = 8 + random() * 120;
    const spec = overlay({ text, align: (["left", "center", "right", "justify"] as const)[Math.floor(random() * 4)], dropCapLines: random() < 0.3 ? 3 : 0, trackingEm: random() * 0.3, sizePt: 6 + random() * 40 });
    const layout = layoutText(spec, width, approximateMeasure, familyOf);
    const letters = (layout.dropCap?.char ?? "") + layout.lines.map((line) => line.text.replaceAll(" ", "")).join("");
    assert.equal(letters, text.replace(/\s+/g, ""), `testo perso (prova ${run})`);
    for (const line of layout.lines) {
      const measured = approximateMeasure(line.text, { family: "x", weight: 400, italic: false }, layout.sizeMm) + layout.trackingMm * [...line.text].length;
      const room = Math.max(layout.sizeMm, width - (line.x > 0 && spec.align === "left" ? line.x : 0));
      assert.ok(measured <= room + layout.sizeMm * 1.01 + 1e-6 || [...line.text].length <= 1, `riga oltre la cornice (prova ${run}): ${measured} > ${room}`);
    }
  }
});

// ------------------------------------------------------------------ SVG

test("SVG: i testi usano il font scelto, ruotano attorno al centro e il testo viene protetto", () => {
  let { project, spreadId } = withSpread();
  const made = addTextOverlay(project, spreadId, { presetId: "headline", text: "Tom & <Jerry> \"insieme\"", at: { x: 0.5, y: 0.2 } });
  project = updateOverlay(made.project, spreadId, made.overlayId!, { rotation: 12, opacity: 0.5 });
  const ctx = { media: new Map<string, string>(), measure: approximateMeasure };
  const svg = renderOverlaysSvg(project, project.spreads[0], ctx);
  assert.match(svg, /font-family="&apos;Playfair Display&apos;, serif"/);
  assert.match(svg, /rotate\(12 /);
  assert.match(svg, /opacity="0.5"/);
  assert.ok(svg.includes("Tom &amp; &lt;Jerry&gt;"), "il testo è protetto");
  assert.ok(!svg.includes("<Jerry>"));
  const box = overlayBox(project, textOf(project, made.overlayId!), approximateMeasure);
  assert.ok(box.w > 0 && box.h > 0 && box.rotation === 12);
  assert.equal(renderOverlaysSvg(project, { ...project.spreads[0], overlays: [] }, ctx), "");
});

test("SVG: sfondi di pagina, piastrelle e grafiche mancanti, e spread completo con font incorporati", () => {
  let { project, spreadId } = withSpread();
  project = setSpreadBackground(project, spreadId, "right", { mediaId: "builtin-linen", aspect: 1.5, fit: "tile", tileCm: 5, opacity: 0.5 });
  const graphic = addGraphicOverlay(project, spreadId, { mediaId: "mine", aspect: 2 });
  project = graphic.project;
  project = addTextOverlay(project, spreadId, { presetId: "masthead", text: "Titolo" }).project;
  const media = new Map([["builtin-linen", "data:image/svg+xml;utf8,<svg/>"], ["mine", "data:image/png;base64,AAAA"]]);
  const ctx = { media, measure: approximateMeasure };
  const backgrounds = renderBackgroundsSvg(project, project.spreads[0], ctx);
  assert.match(backgrounds, /<pattern id="bgp-/);
  assert.match(backgrounds, /width="50" height="33.333"/);
  assert.match(backgrounds, /opacity="0.5"/);
  assert.equal(renderBackgroundsSvg(project, project.spreads[0], { media: new Map(), measure: approximateMeasure }), "", "immagine non caricata: niente");
  assert.equal((renderOverlaysSvg(project, project.spreads[0], { media: new Map(), measure: approximateMeasure }).match(/<image/g) ?? []).length, 0);

  const full = renderSpreadSvg(project, project.spreads[0], undefined, { forPrint: true, design: { ...ctx, fontCss: "@font-face{font-family:'X';src:url(data:font/woff2;base64,AA)}" } });
  assert.match(full, /<style>@font-face/);
  assert.ok(full.indexOf("bgp-") < full.indexOf("data-overlay-id"), "gli sfondi stanno sotto i testi");
  assert.ok(renderSpreadSvg(project, project.spreads[0], undefined, { forPrint: true }).indexOf("data-overlay-id") < 0, "senza `design` l'SVG resta quello di prima");
});

// ------------------------------------------------------------------ salvataggio

test("salvataggio: testi, grafiche e sfondi sopravvivono; i file non validi vengono rifiutati", () => {
  let { project, spreadId } = withSpread();
  project = addTextOverlay(project, spreadId, { presetId: "dropcap", text: "Prova di salvataggio" }).project;
  project = addGraphicOverlay(project, spreadId, { mediaId: "media-1", aspect: 1.5 }).project;
  project = setSpreadBackground(project, spreadId, "spread", { mediaId: "builtin-ivory", aspect: 1.5, fit: "cover" });
  const restored = parseAlbumProject(serializeAlbumProject(project));
  assert.deepEqual(restored, JSON.parse(JSON.stringify(project)));
  const withMedia = JSON.parse(serializeAlbumProject(project, { "media-1": { dataUrl: "data:image/png;base64,AA" } }));
  assert.deepEqual(Object.keys(withMedia.media), ["media-1"]);
  assert.ok(!("media" in JSON.parse(serializeAlbumProject(project, {}))));

  const broken = (change: (spread: Record<string, any>) => void) => { const file = JSON.parse(serializeAlbumProject(project)); change(file.project.spreads[0]); return () => parseAlbumProject(JSON.stringify(file)); };
  assert.throws(broken((spread) => { spread.overlays[0].sizePt = 0; }), /sizePt/);
  assert.throws(broken((spread) => { spread.overlays[0].color = "javascript:alert(1)"; }), /Colore/);
  assert.throws(broken((spread) => { spread.overlays[0].align = "diagonale"; }), /align/);
  assert.throws(broken((spread) => { spread.overlays[1].id = spread.overlays[0].id; }), /duplicato/);
  assert.throws(broken((spread) => { spread.overlays[1].mediaId = "../etc/passwd"; }), /Identificativo/);
  assert.throws(broken((spread) => { spread.backgrounds[0].opacity = 3; }), /opacity/);
  assert.throws(broken((spread) => { spread.backgrounds.push({ ...spread.backgrounds[0], scope: "left" }); }), /convive/);
  assert.throws(broken((spread) => { spread.overlays = "no"; }), /overlays/);
  // Un album senza queste novità si apre come prima.
  const plain = makeProject(3);
  assert.deepEqual(parseAlbumProject(serializeAlbumProject(plain)), JSON.parse(JSON.stringify(plain)));
});

// ------------------------------------------------------------------ archivio personale

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, data };
}

test("archivio: frasi di partenza, aggiungere senza doppioni, modificare, raggruppare, cancellare", () => {
  const storage = memoryStorage();
  let phrases = loadPhrases(storage);
  assert.equal(phrases.length, SEED_PHRASES.length);
  assert.ok(new Set(phrases.map((phrase) => phrase.id)).size === phrases.length);
  phrases = addPhrase(phrases, "  Una frase mia  ", "Le mie");
  assert.equal(phrases.at(-1)?.text, "Una frase mia");
  assert.equal(addPhrase(phrases, "Una frase mia", "Le mie").length, phrases.length, "niente doppioni");
  assert.equal(addPhrase(phrases, "   ").length, phrases.length);
  const id = phrases.at(-1)!.id;
  phrases = updatePhrase(phrases, id, { text: "Modificata", group: "Viaggio" });
  assert.deepEqual([phrases.at(-1)?.text, phrases.at(-1)?.group], ["Modificata", "Viaggio"]);
  assert.equal(updatePhrase(phrases, id, { text: "   " }).at(-1)?.text, "Modificata", "una frase non diventa vuota");
  assert.ok(phraseGroups(phrases).includes("Viaggio"));
  assert.equal(savePhrases(phrases, storage), true);
  assert.deepEqual(loadPhrases(storage), phrases);
  assert.equal(removePhrase(loadPhrases(storage), id).length, phrases.length - 1);
  assert.equal(savePhrases([], { getItem: () => null, setItem: () => { throw new Error("pieno"); } }), false, "spazio esaurito");
});

test("archivio: dati rovinati non rompono nulla e gli stili salvati restano in regola", () => {
  assert.equal(loadPhrases(memoryStorage({ [LIBRARY_KEYS.phrases]: "{non json" })).length, SEED_PHRASES.length);
  assert.equal(loadPhrases(memoryStorage({ [LIBRARY_KEYS.phrases]: JSON.stringify([{ id: "a", text: "ok", group: 5 }, { id: 7 }, null, "x"]) })).length, 1);
  assert.deepEqual(loadPhrases(null).length, SEED_PHRASES.length);
  assert.deepEqual(loadSavedStyles(memoryStorage({ [LIBRARY_KEYS.styles]: "[1,2]" })), []);

  const storage = memoryStorage();
  let styles = upsertSavedStyle([], "Titolo capitolo", { ...TEXT_PRESETS[1].style, sizePt: 9999 });
  assert.equal(styles[0].style.sizePt, 400);
  styles = upsertSavedStyle(styles, "titolo CAPITOLO", TEXT_PRESETS[2].style);
  assert.equal(styles.length, 1, "stesso nome: sostituisce");
  assert.equal(styles[0].style.font, "jost");
  assert.equal(upsertSavedStyle(styles, "  ", TEXT_PRESETS[0].style).length, 1);
  assert.equal(saveSavedStyles(styles, storage), true);
  assert.deepEqual(loadSavedStyles(storage), styles);
  assert.equal(removeSavedStyle(styles, styles[0].id).length, 0);
});

test("leggibilità: il testo inserito su uno sfondo scuro (o chiaro) cambia colore se non si leggerebbe", () => {
  assert.equal(readableOn("#111111", "#000000"), "#f5f1ea");
  assert.equal(readableOn("#111111", "#2b312d"), "#f5f1ea");
  assert.equal(readableOn("#ffffff", "#ffffff"), "#1c1c1c");
  assert.equal(readableOn("#111111", "#ffffff"), "#111111", "già leggibile: resta com'è");
  assert.equal(readableOn("#b08a3e", "#f4efe6"), "#1c1c1c", "oro su avorio: troppo poco contrasto");
  assert.equal(readableOn("#111111", undefined), "#111111");
  assert.equal(readableOn("#111111", "colore-strano"), "#111111");
  assert.ok((contrastRatio("#000000", "#ffffff") ?? 0) > 20);
  const { project, spreadId } = withSpread();
  for (const preset of TEXT_PRESETS) {
    for (const backdrop of ["#000000", "#ffffff", "#2b312d", "#f4efe6"]) {
      const made = addTextOverlay(project, spreadId, { presetId: preset.id, backdrop });
      const placed = textOf(made.project, made.overlayId!);
      assert.ok((contrastRatio(placed.color, backdrop) ?? 0) >= 3, `${preset.id} su ${backdrop}: colore ${placed.color} illeggibile`);
    }
  }
  const plain = addTextOverlay(project, spreadId, { presetId: "masthead" });
  assert.equal(textOf(plain.project, plain.overlayId!).color, "#111111", "senza sfondo noto non cambia");
});

test("preset composti: titolo e paragrafo diventano box separati, uno sotto l'altro, senza sovrapporsi", () => {
  const { project, spreadId } = withSpread();
  const composed = TEXT_PRESETS.filter((preset) => preset.stack);
  assert.ok(composed.length >= 3);
  for (const preset of composed) {
    for (const backdrop of ["#000000", "#ffffff"]) {
      const made = addTextStack(project, spreadId, { presetId: preset.id, at: { x: 0.25, y: 0.3 }, backdrop });
      const items = overlaysOf(made.project.spreads[0]) as SpreadTextOverlay[];
      assert.equal(items.length, preset.stack!.length, `${preset.id}: un box per pezzo`);
      assert.equal(made.overlayId, items[preset.stack!.findIndex((part) => part.presetId === preset.id)].id, "resta selezionato il pezzo principale");
      assert.deepEqual(items.map((item) => item.text), preset.stack!.map((part) => part.text));
      const boxes = items.map((item) => overlayBox(made.project, item, approximateMeasure));
      for (let index = 1; index < boxes.length; index += 1) assert.ok(boxes[index].y >= boxes[index - 1].y + boxes[index - 1].h - 1e-6, `${preset.id}: il pezzo ${index + 1} si sovrappone`);
      assert.ok(items.every((item) => item.y >= 0 && item.y <= 0.98), "dentro lo spread");
      assert.ok(items.every((item) => (contrastRatio(item.color, backdrop) ?? 0) >= 3), "leggibili");
      assertProjectInvariants(made.project, `composto ${preset.id}`);
    }
  }
  const title = addTextStack(project, spreadId, { presetId: "headline" });
  const [kicker, headline, deck, body] = overlaysOf(title.project.spreads[0]) as SpreadTextOverlay[];
  assert.deepEqual([kicker.font, headline.font, deck.italic, body.align], ["jost", "playfair-display", true, "justify"], "ogni pezzo ha il suo stile");
  assert.equal(title.overlayId, headline.id, "si parte dal titolo, non dalla riga piccola");
  assert.equal(overlaysOf(addTextStack(project, spreadId, { presetId: "caption" }).project.spreads[0]).length, 1, "stile semplice: un solo testo");
  assert.equal(overlaysOf(addTextStack(project, spreadId, { presetId: "headline", text: "Mio" }).project.spreads[0]).length, 1, "con testo proprio: un solo box");
});

test("gruppi: i pezzi di una composizione si spostano insieme finché non si sganciano", () => {
  const { project, spreadId } = withSpread();
  const made = addTextStack(project, spreadId, { presetId: "headline", at: { x: 0.3, y: 0.2 } });
  const before = overlaysOf(made.project.spreads[0]) as SpreadTextOverlay[];
  assert.equal(before.length, 4);
  assert.equal(new Set(before.map((item) => item.groupId)).size, 1);
  assert.ok(before[0].groupId);
  assert.equal(groupMembers(made.project.spreads[0], before[2].id).length, 4);

  const moved = moveOverlayGroup(made.project, spreadId, before[1].id, 0.1, -0.05);
  const after = overlaysOf(moved.spreads[0]) as SpreadTextOverlay[];
  after.forEach((item, index) => {
    assert.ok(Math.abs(item.x - (before[index].x + 0.1)) < 1e-4 && Math.abs(item.y - (before[index].y - 0.05)) < 1e-4, "stesso scarto per tutti: restano allineati");
  });
  assert.equal(moveOverlayGroup(made.project, spreadId, before[1].id, 0, 0), made.project);

  const freed = ungroupOverlay(moved, spreadId, before[3].id);
  assert.ok(!("groupId" in overlaysOf(freed.spreads[0])[3]));
  const again = overlaysOf(moveOverlayGroup(freed, spreadId, before[0].id, 0.05, 0).spreads[0]) as SpreadTextOverlay[];
  assert.ok(Math.abs(again[0].x - after[0].x - 0.05) < 1e-4 && Math.abs(again[1].x - after[1].x - 0.05) < 1e-4, "gli altri tre vanno ancora insieme");
  assert.ok(Math.abs(again[3].x - after[3].x) < 1e-6 && Math.abs(again[3].y - after[3].y) < 1e-6, "quello sganciato resta dov'è");
  assert.equal(ungroupOverlay(freed, spreadId, before[3].id), freed);

  // Se restano due, poi uno solo, l'ultimo torna libero: niente gruppi di un elemento.
  let shrinking = freed;
  shrinking = ungroupOverlay(shrinking, spreadId, before[2].id);
  assert.equal(groupMembers(shrinking.spreads[0], before[0].id).length, 2);
  shrinking = removeOverlay(shrinking, spreadId, before[1].id);
  assert.ok(overlaysOf(shrinking.spreads[0]).every((item) => !item.groupId), "nessun gruppo con un solo elemento");
  const copy = duplicateOverlay(made.project, spreadId, before[0].id);
  assert.ok(!overlaysOf(copy.project.spreads[0]).find((item) => item.id === copy.overlayId)?.groupId, "la copia è libera");

  assertProjectInvariants(moved, "gruppo spostato");
  const restored = parseAlbumProject(serializeAlbumProject(moved));
  assert.equal((overlaysOf(restored.spreads[0])[0] as SpreadTextOverlay).groupId, before[0].groupId);
  const broken = JSON.parse(serializeAlbumProject(moved));
  broken.project.spreads[0].overlays[0].groupId = "../x";
  assert.throws(() => parseAlbumProject(JSON.stringify(broken)), /groupId/);
});

test("gruppi: si possono agganciare più testi, anche di gruppi diversi, e poi si muovono insieme", () => {
  let { project, spreadId } = withSpread();
  const ids = ["headline", "caption", "signature"].map((preset) => { const made = addTextOverlay(project, spreadId, { presetId: preset }); project = made.project; return made.overlayId!; });
  assert.equal(groupOverlays(project, spreadId, [ids[0]]), project, "serve più d'un elemento");
  const grouped = groupOverlays(project, spreadId, [ids[0], ids[1]]);
  assert.equal(groupMembers(grouped.spreads[0], ids[0]).length, 2);
  assert.equal(groupMembers(grouped.spreads[0], ids[2]).length, 1, "il terzo resta libero");
  const stack = addTextStack(grouped, spreadId, { presetId: "pullquote" });
  const stackIds = overlaysOf(stack.project.spreads[0]).slice(3).map((item) => item.id);
  const merged = groupOverlays(stack.project, spreadId, [ids[2], stackIds[0]]);
  assert.equal(groupMembers(merged.spreads[0], ids[2]).length, 1 + stackIds.length, "il gruppo della citazione entra intero");
  assert.equal(groupMembers(merged.spreads[0], ids[0]).length, 2, "gli altri gruppi non cambiano");
  const everything = groupOverlays(merged, spreadId, [ids[0], ids[2]]);
  assert.equal(groupMembers(everything.spreads[0], ids[1]).length, 2 + 1 + stackIds.length);
  const shifted = moveOverlayGroup(everything, spreadId, ids[1], 0.05, 0.02);
  for (const [index, item] of overlaysOf(shifted.spreads[0]).entries()) assert.ok(Math.abs(item.x - overlaysOf(everything.spreads[0])[index].x - 0.05) < 1e-4);
  assertProjectInvariants(everything, "agganciati");
});
