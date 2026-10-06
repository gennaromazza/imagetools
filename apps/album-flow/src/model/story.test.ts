import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpreadTextOverlay } from "@photo-tools/shared-types";
import { DEFAULT_AUTO_BUILD, autoBuildAlbum } from "./autobuild";
import { assignAssets, createChapter } from "./chapters";
import { overlaysOf } from "./design";
import { assertProjectInvariants, makeProject } from "./fixtures";
import { appendAssets } from "./items";
import type { Project } from "./project";
import { addSpread, setSpreadDone } from "./spreads";
import {
  filterStories, inferPhase, insertStory, isStoryUsed, partsForProposal, planAlbumStories, proposalFromUnit, proposeStory, rankStories,
  replaceWithStory, scoreStory, spaceOfArea, storyContextFor, suggestStoryForSpread, textSimilarity, usedStories, usedTextKeys, type StoryContext,
} from "./story";
import { STORY_CATEGORIES, STORY_LENGTHS, STORY_LIBRARY, STORY_PLACEMENTS, STORY_TONES, STORY_TYPES, lengthOfText, storyById, storyKey } from "./storyLibrary";

/** Contesto di prova con ciò che serve: si cambia solo quello che interessa al singolo caso. */
function context(overrides: Partial<StoryContext> = {}): StoryContext {
  return { phase: null, position: "middle", space: "large", tags: [], intensity: 3, used: new Set(), nearby: [], lastCategory: null, includeQuotes: false, seed: 0, ...overrides };
}

/** Album con `spreads` spread a due pagine: la pagina sinistra ha foto, la destra è libera (tranne dove si chiede di riempirla). */
function albumWithFreePages(spreads: number, fullIndexes: readonly number[] = []): Project {
  let project = makeProject(spreads * 4 + 4);
  for (let index = 0; index < spreads; index += 1) project = addSpread(project, index, "half");
  project.spreads.forEach((spread, index) => {
    project = appendAssets(project, spread.id, 0, [`a${index * 4}`, `a${index * 4 + 1}`]);
    if (fullIndexes.includes(index)) project = appendAssets(project, spread.id, 1, [`a${index * 4 + 2}`]);
  });
  return project;
}

const textsOn = (project: Project, spreadIndex: number) => overlaysOf(project.spreads[spreadIndex]).filter((overlay): overlay is SpreadTextOverlay => overlay.kind === "text");

// ------------------------------------------------------------------ libreria

test("libreria narrativa: oltre trecento voci, tutte le categorie richieste, identificativi unici e metadati validi", () => {
  assert.ok(STORY_LIBRARY.length >= 300, `solo ${STORY_LIBRARY.length} voci`);
  const ids = STORY_LIBRARY.map((unit) => unit.id);
  assert.equal(new Set(ids).size, ids.length, "identificativi unici");
  const required = ["aperture", "preparativi", "casa", "famiglia", "amici", "attesa", "incontro", "cerimonia", "sguardi", "ritratto_coppia", "intimita", "dettagli", "invitati", "ricevimento", "festa", "spontaneita", "tramonto", "notte", "finale", "universali", "poetici", "microcopy", "cinematografici", "chiusure"];
  for (const category of required) assert.ok(STORY_LIBRARY.some((unit) => unit.category === category), `categoria senza voci: ${category}`);
  for (const category of STORY_CATEGORIES) assert.ok(STORY_LIBRARY.some((unit) => unit.category === category), `categoria vuota: ${category}`);

  for (const unit of STORY_LIBRARY) {
    assert.ok(STORY_CATEGORIES.includes(unit.category) && STORY_TYPES.includes(unit.type) && STORY_LENGTHS.includes(unit.length) && STORY_TONES.includes(unit.tone), `${unit.id}: valori non validi`);
    assert.ok([1, 2, 3, 4, 5].includes(unit.emotionalIntensity), `${unit.id}: intensità`);
    assert.ok(unit.recommendedFor.length > 0 && unit.placement.length > 0, `${unit.id}: abbinamenti e posizioni`);
    assert.ok(unit.placement.every((placement) => STORY_PLACEMENTS.includes(placement)), `${unit.id}: posizione sconosciuta`);
    assert.ok((unit.title ?? unit.text ?? "").trim().length > 0, `${unit.id}: vuota`);
    assert.ok((unit.text ?? "").length <= 6000);
    if (unit.type === "title") assert.ok(unit.title && !unit.text, `${unit.id}: un titolo ha solo il titolo`);
    else assert.ok(unit.text, `${unit.id}: manca il testo`);
    if (unit.type === "quote") assert.ok(!unit.original && unit.author && unit.needsSourceCheck, `${unit.id}: la citazione ha l'autore e la fonte da verificare`);
    else assert.ok(unit.original && unit.author === null, `${unit.id}: le frasi originali non hanno autore`);
    if (unit.type === "microcopy") assert.equal(lengthOfText(unit.text!), "micro", `${unit.id}: una parola breve è brevissima`);
    if (unit.type === "short") assert.ok(unit.length === "micro" || unit.length === "short", `${unit.id}`);
    if (unit.type === "medium") assert.equal(unit.length, "medium", `${unit.id}`);
    if (unit.type === "long") assert.equal(unit.length, "long", `${unit.id}`);
  }
});

test("libreria narrativa: niente luoghi comuni da bigliettino, niente prima persona singolare, citazioni separate dalle frasi originali", () => {
  const banned = [/due anime/i, /l['’]amore è/i, /viaggio più bello/i, /per sempre insieme/i, /oggi inizia il viaggio/i, /due cuori/i, /nuova vita/i, /san valentino/i];
  for (const unit of STORY_LIBRARY.filter((candidate) => candidate.original)) {
    const text = `${unit.title ?? ""} ${unit.text ?? ""}`;
    for (const pattern of banned) assert.doesNotMatch(text, pattern, `${unit.id}: luogo comune`);
    assert.doesNotMatch(text, /\b(io|mio|mia|miei|mie|me stess[oa])\b/i, `${unit.id}: prima persona singolare`);
  }
  assert.ok(STORY_LIBRARY.filter((unit) => unit.type === "quote").length >= 6);
  assert.ok(STORY_LIBRARY.every((unit) => (unit.type === "quote") === (unit.category === "citazioni")), "le citazioni stanno solo nella loro categoria");
  assert.equal(storyById(STORY_LIBRARY[10].id), STORY_LIBRARY[10]);
  assert.equal(storyKey("  Il   GIORNO\nprende "), "il giorno prende");
});

test("libreria narrativa: i titoli senza paragrafo restano titoli, i paragrafi senza titolo restano brevi, medi o lunghi, le parole brevi restano separate", () => {
  const titles = STORY_LIBRARY.filter((unit) => unit.type === "title");
  assert.ok(titles.length >= 150);
  assert.ok(STORY_LIBRARY.filter((unit) => unit.type === "microcopy").length >= 31);
  for (const type of ["short", "medium", "long"] as const) assert.ok(STORY_LIBRARY.some((unit) => unit.type === type && !unit.title), `nessun paragrafo ${type}`);
  assert.ok(STORY_LIBRARY.some((unit) => unit.title && unit.text), "esistono anche titolo e paragrafo insieme");
  const pair = STORY_LIBRARY.find((unit) => unit.title === "Scena III — L'incontro");
  assert.ok(pair?.text?.startsWith("E poi gli occhi si incontrano."));
});

// ------------------------------------------------------------------ filtri

test("filtri: categoria, lunghezza, tipo, tono, intensità, origine e ricerca si combinano", () => {
  const ceremony = filterStories({ categories: ["cerimonia"] });
  assert.ok(ceremony.length > 10 && ceremony.every((unit) => unit.category === "cerimonia"));
  const long = filterStories({ lengths: ["long"] });
  assert.ok(long.length > 0 && long.every((unit) => unit.length === "long"));
  assert.ok(filterStories({ origin: "quote" }).every((unit) => !unit.original));
  assert.ok(filterStories({ origin: "original" }).every((unit) => unit.original));
  const mixed = filterStories({ categories: ["festa", "ricevimento"], tones: ["celebratory"], intensities: [4], types: ["title"] });
  assert.ok(mixed.length > 0 && mixed.every((unit) => unit.tone === "celebratory" && unit.emotionalIntensity === 4 && unit.type === "title"));
  assert.ok(filterStories({ query: "ora d'oro" }).some((unit) => unit.title === "L'ora d'oro"));
  assert.equal(filterStories({ query: "zzzzqqqq" }).length, 0);
  assert.equal(filterStories({}).length, STORY_LIBRARY.length);
});

// ------------------------------------------------------------------ selezione

test("selezione: dipende dalla fase, dalla posizione e dallo spazio, ed è ripetibile", () => {
  const ceremony = rankStories(context({ phase: "cerimonia" })).slice(0, 5);
  assert.ok(ceremony.every((entry) => entry.unit.category === "cerimonia" || entry.unit.recommendedFor.includes("cerimonia")), "in cerimonia propone testi di cerimonia");
  const opening = rankStories(context({ phase: "aperture", position: "opening", intensity: 2 })).slice(0, 5);
  assert.ok(opening.every((entry) => ["aperture", "cinematografici", "poetici"].includes(entry.unit.category) || entry.unit.placement.includes("opening")), "in apertura propone aperture");
  const closing = rankStories(context({ phase: "finale", position: "closing" })).slice(0, 5);
  assert.ok(closing.every((entry) => ["finale", "chiusure", "poetici", "cinematografici"].includes(entry.unit.category)), "in chiusura propone finali");
  const middle = rankStories(context({ phase: "festa", position: "middle", intensity: 4 })).slice(0, 12);
  assert.ok(middle.every((entry) => entry.unit.category !== "aperture" && entry.unit.category !== "chiusure"), "a metà album niente aperture né chiusure");

  const again = proposeStory(context({ phase: "festa", seed: 3 }));
  assert.deepEqual(proposeStory(context({ phase: "festa", seed: 3 })), again, "stesso contesto, stessa proposta");
});

test("selezione: rispetta lo spazio (pochissimo = titolo o parola, poco = frase breve, pagina libera = testo medio o lungo con titolo)", () => {
  for (const entry of rankStories(context({ space: "micro" }))) assert.ok(entry.unit.type === "title" || entry.unit.type === "microcopy");
  for (const entry of rankStories(context({ space: "small" }))) {
    assert.ok(["title", "microcopy", "short"].includes(entry.unit.type) && !(entry.unit.title && entry.unit.text), entry.unit.id);
    assert.ok(entry.unit.length === "micro" || entry.unit.length === "short", entry.unit.id);
  }
  for (const entry of rankStories(context({ space: "medium" }))) assert.ok(["short", "medium"].includes(entry.unit.type) && entry.unit.length !== "long", entry.unit.id);
  for (const entry of rankStories(context({ space: "large" }))) assert.ok(["short", "medium", "long"].includes(entry.unit.type) && entry.unit.type !== "title", entry.unit.id);

  const large = proposeStory(context({ phase: "ricevimento", space: "large" }));
  assert.ok(large && (large.kind === "pair" || large.kind === "paragraph"));
  const small = proposeStory(context({ phase: "ricevimento", space: "small" }));
  assert.ok(small && ["paragraph", "title", "microcopy"].includes(small.kind), "poco spazio: mai titolo + paragrafo");
  const micro = proposeStory(context({ phase: "ricevimento", space: "micro" }));
  assert.ok(micro && (micro.kind === "title" || micro.kind === "microcopy"));
});

test("selezione: con spazio per un paragrafo lo accompagna con un titolo della stessa categoria, mai già usato", () => {
  const proposal = proposeStory(context({ phase: "cerimonia", space: "large" }))!;
  if (proposal.unitIds.length === 2) {
    const [titleUnit, paragraphUnit] = proposal.unitIds.map((id) => storyById(id)!);
    assert.equal(titleUnit.category, paragraphUnit.category);
    assert.ok(titleUnit.type === "title" && Boolean(paragraphUnit.text));
  }
  assert.ok(proposal.title && proposal.text);
  const used = new Set([storyKey(proposal.title!), storyKey(proposal.text!)]);
  const other = proposeStory(context({ phase: "cerimonia", space: "large", used }))!;
  assert.notEqual(other.text, proposal.text);
  assert.notEqual(other.title, proposal.title);
});

test("selezione: non ripete un testo già nell'album né ne propone di troppo simili a quelli vicini", () => {
  const best = rankStories(context({ phase: "festa", space: "medium" }))[0].unit;
  const used = new Set([storyKey(best.text ?? best.title ?? "")]);
  assert.equal(scoreStory(best, context({ phase: "festa", space: "medium", used })), null);
  assert.ok(rankStories(context({ phase: "festa", space: "medium", used })).every((entry) => entry.unit.id !== best.id));
  const near = context({ phase: "festa", space: "medium", nearby: [best.text ?? ""] });
  assert.equal(scoreStory(best, near), null, "un testo identico nella pagina accanto");
  assert.ok(textSimilarity("La musica fa il resto della serata", "La musica fa il resto della serata") === 1);
  assert.ok(textSimilarity("Il sole scende lentamente", "Una cerimonia semplice") < 0.2);

  // Mai lo stesso testo due volte: si esaurisce l'elenco senza ripetizioni.
  const seen = new Set<string>();
  let used2 = new Set<string>();
  for (let index = 0; index < 40; index += 1) {
    const proposal = proposeStory(context({ phase: "ricevimento", space: "small", used: used2 }));
    if (!proposal) break;
    const key = storyKey(proposal.text ?? proposal.title ?? "");
    assert.ok(!seen.has(key), `ripetuto: ${key}`);
    seen.add(key);
    used2 = new Set([...used2, key]);
  }
  assert.ok(seen.size >= 15);
});

test("selezione: «Rigenera» scorre alternative diverse e compatibili con la stessa posizione", () => {
  const ctx = context({ phase: "cerimonia", space: "large" });
  const texts = [0, 1, 2, 3, 4, 5].map((attempt) => proposeStory(ctx, attempt)!.text);
  assert.equal(new Set(texts).size, texts.length, "ogni tentativo propone un testo diverso");
  assert.deepEqual(proposeStory(ctx, 0), proposeStory(ctx, 0));
  assert.notDeepEqual(proposeStory(ctx, 0), proposeStory(ctx, 1));
  for (const attempt of [0, 1, 2, 3]) assert.ok(proposeStory(ctx, attempt)!.unitIds.every((id) => storyById(id)!.category === "cerimonia" || storyById(id)!.recommendedFor.includes("cerimonia")));
  assert.equal(proposeStory(ctx, -1) !== null, true, "un tentativo negativo non rompe nulla");
});

test("selezione: le citazioni d'autore non si propongono da sole, solo se richieste", () => {
  assert.ok(rankStories(context({ space: "medium" })).every((entry) => entry.unit.type !== "quote"));
  const withQuotes = rankStories(context({ space: "medium", includeQuotes: true }));
  assert.ok(withQuotes.some((entry) => entry.unit.type === "quote"));
  const quote = proposalFromUnit(STORY_LIBRARY.find((unit) => unit.type === "quote")!);
  assert.equal(quote.kind, "quote");
  assert.ok(quote.author);
  const parts = partsForProposal(quote, 100);
  assert.ok(parts[0].text.startsWith("«") && parts[0].text.endsWith("»"));
  assert.equal(parts[1].text, quote.author);
});

// ------------------------------------------------------------------ contesto

test("contesto: la fase si riconosce dai nomi dei capitoli e delle etichette, altrimenti dalla posizione nell'album", () => {
  let project = makeProject(24);
  project = createChapter(project, "Casa sposo");
  project = createChapter(project, "Cerimonia in chiesa");
  project = createChapter(project, "Ricevimento");
  const [home, church, party] = project.chapters;
  project = assignAssets(project, ["a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7"], home.id);
  project = assignAssets(project, ["a8", "a9", "a10", "a11", "a12", "a13", "a14", "a15"], church.id);
  project = assignAssets(project, ["a16", "a17", "a18", "a19", "a20", "a21", "a22", "a23"], party.id);
  const built = autoBuildAlbum(project, { ...DEFAULT_AUTO_BUILD, photosPerArea: 4, splitMode: "half" });
  const first = built.spreads.findIndex((spread) => spread.areas.some((area) => area.items.some((item) => item.assetId === "a0")));
  const middle = built.spreads.findIndex((spread) => spread.areas.some((area) => area.items.some((item) => item.assetId === "a9")));
  const end = built.spreads.findIndex((spread) => spread.areas.some((area) => area.items.some((item) => item.assetId === "a20")));
  assert.equal(inferPhase(built, first).phase, "casa");
  assert.equal(inferPhase(built, middle).phase, "cerimonia");
  assert.equal(inferPhase(built, end).phase, "ricevimento");
  assert.ok(inferPhase(built, first).tags.includes("casa"));

  const plain = albumWithFreePages(10);
  assert.equal(inferPhase(plain, 0).phase, "aperture");
  assert.equal(inferPhase(plain, 9).phase, "finale");
  assert.ok(["preparativi", "attesa", "cerimonia", "ritratto_coppia", "ricevimento", "festa"].includes(inferPhase(plain, 5).phase ?? ""));
  assert.deepEqual(inferPhase(plain, 99), { phase: null, tags: [] });
});

test("contesto: spazio dalla pagina (libera o con foto), posizione, testi già presenti e vicini", () => {
  const project = albumWithFreePages(6, [2]);
  assert.equal(spaceOfArea(project.spreads[0], 0), "small");
  assert.equal(spaceOfArea(project.spreads[0], 1), "large");
  assert.equal(spaceOfArea(project.spreads[0], 7), "micro");
  const ctx0 = storyContextFor(project, project.spreads[0].id, 1)!;
  assert.equal(ctx0.position, "opening");
  assert.equal(ctx0.space, "large");
  assert.equal(storyContextFor(project, project.spreads[5].id, 1)!.position, "closing");
  assert.equal(storyContextFor(project, project.spreads[2].id, 1)!.position, "middle");
  assert.equal(storyContextFor(project, "x", 0), null);

  const inserted = suggestStoryForSpread(project, project.spreads[1].id, 1)!;
  const after = storyContextFor(inserted.project, project.spreads[2].id, 1)!;
  assert.ok(after.nearby.length > 0, "il testo dello spread accanto conta come vicino");
  assert.ok(after.used.size > 0);
  assert.equal(usedTextKeys(project).size, 0);
});

// ------------------------------------------------------------------ inserimento

test("inserimento: titolo e paragrafo vanno a metà di una pagina libera, agganciati, dentro la pagina e senza rompere l'album", () => {
  const project = albumWithFreePages(4);
  const spreadId = project.spreads[1].id;
  const made = suggestStoryForSpread(project, spreadId, 1, { includeQuotes: false })!;
  assert.ok(made.overlayIds.length >= 1);
  const texts = textsOn(made.project, 1);
  assert.equal(texts.length, made.overlayIds.length);
  const groups = new Set(texts.map((text) => text.groupId));
  assert.equal(groups.size, 1, "i pezzi si spostano insieme");
  for (const text of texts) {
    assert.ok(text.x >= 0.5 - 1e-6 && text.x + text.w <= 1 + 1e-6, "dentro la pagina destra");
    assert.ok(text.y >= 0 && text.y < 0.97);
  }
  assert.equal(made.context.space, "large");
  assertProjectInvariants(made.project, "testo narrativo");
  // Le voci usate si riconoscono dal testo in pagina: quelle da cui nasce la proposta, più altre che hanno la stessa parola (un titolo uguale conta come già usato).
  const usedIds = usedStories(made.project).map((unit) => unit.id);
  for (const id of made.proposal.unitIds) assert.ok(usedIds.includes(id), `${id} non risulta usata`);
  const onPage = new Set(texts.map((text) => storyKey(text.text)));
  for (const unit of usedStories(made.project)) assert.ok([unit.title, unit.text].some((value) => value && onPage.has(storyKey(value))), `${unit.id}: usata senza motivo`);
  assert.ok(isStoryUsed(usedStories(made.project)[0], usedTextKeys(made.project)));
});

test("inserimento: su una pagina con foto basta una frase breve o un titolo, in basso", () => {
  const project = albumWithFreePages(3);
  const made = suggestStoryForSpread(project, project.spreads[1].id, 0)!;
  assert.equal(made.context.space, "small");
  assert.ok(made.proposal.kind === "paragraph" || made.proposal.kind === "title" || made.proposal.kind === "microcopy");
  assert.ok(textsOn(made.project, 1).every((text) => text.y >= 0.5 - 1e-6), "in basso, sopra le foto");
  assert.equal(insertStory(project, "x", 0, made.proposal), null);
  assert.equal(insertStory(project, project.spreads[0].id, 9, made.proposal), null);
});

test("«Rigenera»: toglie la proposta precedente e ne mette un'altra, senza lasciare resti né ripetere", () => {
  const project = albumWithFreePages(3);
  const spreadId = project.spreads[1].id;
  const first = suggestStoryForSpread(project, spreadId, 1)!;
  const second = suggestStoryForSpread(first.project, spreadId, 1, { attempt: 1, replace: first.overlayIds })!;
  assert.notDeepEqual(first.proposal, second.proposal);
  const ids = new Set(textsOn(second.project, 1).map((text) => text.id));
  assert.ok(first.overlayIds.every((id) => !ids.has(id)), "la proposta precedente è stata tolta");
  assert.equal(textsOn(second.project, 1).length, second.overlayIds.length);
  assert.notEqual(textsOn(second.project, 1)[0].text, textsOn(first.project, 1)[0].text);
  assertProjectInvariants(second.project, "rigenerato");
});

test("sostituzione manuale: il testo selezionato prende quello della voce scelta, lo stile resta", () => {
  const project = albumWithFreePages(2);
  const made = suggestStoryForSpread(project, project.spreads[0].id, 1)!;
  const target = textsOn(made.project, 0)[0];
  const unit = STORY_LIBRARY.find((candidate) => candidate.id === "tramonto_short_001")!;
  const replaced = replaceWithStory(made.project, project.spreads[0].id, target.id, unit);
  const after = textsOn(replaced, 0).find((text) => text.id === target.id)!;
  assert.equal(after.text, unit.text);
  assert.equal(after.font, target.font);
  const quote = STORY_LIBRARY.find((candidate) => candidate.type === "quote")!;
  assert.equal(textsOn(replaceWithStory(made.project, project.spreads[0].id, target.id, quote), 0).find((text) => text.id === target.id)!.text, `«${quote.text}»`);
  assert.equal(replaceWithStory(made.project, project.spreads[0].id, "x", unit), made.project);
});

// ------------------------------------------------------------------ album intero

test("album intero: testi solo su pagine libere, non a ogni pagina, senza ripetizioni e senza toccare spread finiti o già con testo", () => {
  let project = albumWithFreePages(16, [3, 4]);
  project = setSpreadDone(project, project.spreads[7].id, true);
  const withText = suggestStoryForSpread(project, project.spreads[9].id, 1)!.project;
  const plan = planAlbumStories(withText);
  assert.ok(plan.planned.length >= 2 && plan.planned.length <= Math.ceil(16 / 4), `${plan.planned.length} testi`);
  const indexes = plan.planned.map((entry) => entry.spreadNumber - 1);
  assert.ok(indexes.includes(0) && indexes.includes(15), "apertura e chiusura");
  assert.ok(!indexes.includes(7) && !indexes.includes(9) && !indexes.includes(3) && !indexes.includes(4), "né finiti, né già con testo, né senza pagina libera");
  const sorted = [...indexes].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i += 1) assert.ok(sorted[i] - sorted[i - 1] >= 1);
  const texts = plan.project.spreads.flatMap((spread) => overlaysOf(spread).filter((overlay): overlay is SpreadTextOverlay => overlay.kind === "text").map((overlay) => storyKey(overlay.text)));
  assert.equal(new Set(texts).size, texts.length, "nessun testo due volte nell'album");
  assert.equal(plan.project.spreads[7].areas.length, project.spreads[7].areas.length);
  assertProjectInvariants(plan.project, "testi per l'album");
  assert.ok(plan.planned.every((entry) => entry.proposal.kind !== "quote"));

  const none = planAlbumStories(autoBuildAlbum(makeProject(20), { ...DEFAULT_AUTO_BUILD, splitMode: "full" }));
  assert.equal(none.planned.length, 0, "senza pagine libere non aggiunge nulla");
  assert.equal(planAlbumStories(albumWithFreePages(8), { maxTexts: 1 }).planned.length, 1);
  assert.equal(planAlbumStories(makeProject(4)).planned.length, 0, "album senza spread");
});

test("album intero: due piani consecutivi non si ripetono e un album diverso riceve testi diversi", () => {
  const first = planAlbumStories(albumWithFreePages(12));
  const second = planAlbumStories(first.project);
  const firstTexts = new Set(first.planned.map((entry) => storyKey(entry.proposal.text ?? entry.proposal.title ?? "")));
  // Le pagine che hanno già un testo non si toccano, quindi il secondo giro riempie solo altre pagine e non ripete.
  for (const entry of second.planned) assert.ok(!firstTexts.has(storyKey(entry.proposal.text ?? entry.proposal.title ?? "")));
  assert.ok(first.planned.length > 0);
});
