import { test } from "node:test";
import assert from "node:assert/strict";
import type { LayoutNode } from "@photo-tools/shared-types";
import { MAX_RATIO, MIN_RATIO, areaOuterRects, crossesFold, insetRect, layoutCells, spreadSizeMm, type LeafCell, type Rect } from "./geometry";
import { clearLayoutCache, estimateCost, generateLayouts, generateLayoutsCached, scoreTree, type LayoutPhoto } from "./generate";
import { resolveDropTarget, dropHighlight } from "./drop";
import { applyShape, countLeaves, hasLeaf, naturalRatios, insertAtNode, insertBeside, leaf, leafIds, mirrorHorizontal, mirrorVertical, nodeAt, pathOfLeaf, removeLeaf, renameLeaf, setRatioAt, shapeOfTree, split, swapLeaves, treeKind, validateTree } from "./tree";

const SHEET = { widthCm: 30, heightCm: 30 };

function assertCellsValid(cells: readonly LeafCell[], rect: Rect, label = "") {
  const eps = 1e-6;
  for (const cell of cells) {
    assert.ok(cell.rect.w > 0 && cell.rect.h > 0, `${label} cella vuota`);
    assert.ok(cell.rect.x >= rect.x - eps && cell.rect.y >= rect.y - eps, `${label} cella fuori (origine)`);
    assert.ok(cell.rect.x + cell.rect.w <= rect.x + rect.w + eps && cell.rect.y + cell.rect.h <= rect.y + rect.h + eps, `${label} cella fuori (fine)`);
  }
  for (let i = 0; i < cells.length; i += 1) {
    for (let j = i + 1; j < cells.length; j += 1) {
      const a = cells[i].rect;
      const b = cells[j].rect;
      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      assert.ok(!(overlapX > eps && overlapY > eps), `${label} celle sovrapposte`);
    }
  }
}

const photos = (aspects: number[]): LayoutPhoto[] => aspects.map((aspect, index) => ({ id: `p${index}`, aspect }));
const L = 1.5, P = 2 / 3, S = 1;

// ---------------------------------------------------------------------------- albero

test("albero: inserimento accanto a una foto dal lato scelto", () => {
  const base = split("row", 0.5, leaf("a"), leaf("b"));
  const left = insertBeside(base, "b", "n", "left");
  assert.deepEqual(leafIds(left), ["a", "n", "b"]);
  const bottom = insertBeside(base, "a", "n", "bottom");
  assert.deepEqual(leafIds(bottom), ["a", "n", "b"]);
  assert.equal(treeKind(bottom), "r(c(o,o),o)");
  const top = insertBeside(base, "a", "n", "top");
  assert.deepEqual(leafIds(top), ["n", "a", "b"]);
  assert.equal(insertBeside(base, "zzz", "n", "left"), base, "bersaglio inesistente: nessun cambiamento");
  assert.equal(countLeaves(insertBeside(leaf("a"), "a", "n", "right")), 2);
});

test("albero: rimozione e fusione con il fratello", () => {
  const tree = split("row", 0.4, leaf("a"), split("column", 0.5, leaf("b"), leaf("c")));
  assert.deepEqual(leafIds(removeLeaf(tree, "b")), ["a", "c"]);
  assert.equal(treeKind(removeLeaf(tree, "b")!), "r(o,o)");
  assert.equal(removeLeaf(leaf("a"), "a"), null);
  assert.equal(removeLeaf(tree, "zzz"), tree);
  assert.equal(removeLeaf(null, "a"), null);
});

test("albero: scambio, rinomina, percorsi, rapporto, specchi", () => {
  const tree = split("row", 0.3, leaf("a"), split("column", 0.6, leaf("b"), leaf("c")));
  assert.deepEqual(leafIds(swapLeaves(tree, "a", "c")), ["c", "b", "a"]);
  assert.deepEqual(leafIds(renameLeaf(tree, "b", "x")), ["a", "x", "c"]);
  assert.equal(pathOfLeaf(tree, "c"), "11");
  assert.equal(pathOfLeaf(tree, "nope"), null);
  assert.equal(nodeAt(tree, "1")?.kind, "split");
  assert.equal(nodeAt(tree, "000"), null);
  const changed = setRatioAt(tree, "1", 0.99);
  assert.ok(Math.abs((nodeAt(changed, "1") as { ratio: number }).ratio - MAX_RATIO) < 1e-9, "rapporto limitato");
  assert.equal(setRatioAt(tree, "0", 0.2), tree, "una foglia non ha rapporto");
  assert.deepEqual(mirrorHorizontal(mirrorHorizontal(tree)), tree);
  assert.deepEqual(mirrorVertical(mirrorVertical(tree)), tree);
  assert.deepEqual(leafIds(mirrorHorizontal(tree)), ["b", "c", "a"]);
  assert.ok(hasLeaf(tree, "b") && !hasLeaf(tree, "z"));
});

test("albero: forma dei layout preferiti riapplicabile a foto diverse", () => {
  const tree = split("row", 0.35, leaf("a"), split("column", 0.5, leaf("b"), leaf("c")));
  const shape = shapeOfTree(tree);
  assert.deepEqual(leafIds(shape), ["0", "1", "2"]);
  const applied = applyShape(shape, ["x", "y", "z"])!;
  assert.deepEqual(leafIds(applied), ["x", "y", "z"]);
  assert.equal(treeKind(applied), treeKind(tree));
  assert.equal(applyShape(shape, ["x", "y"]), null, "numero di foto diverso");
});

test("albero: validazione strutturale", () => {
  const ok = split("row", 0.5, leaf("a"), leaf("b"));
  assert.deepEqual(validateTree(ok, ["a", "b"]), []);
  assert.ok(validateTree(split("row", 0.5, leaf("a"), leaf("a"))).length > 0, "foto duplicata");
  assert.ok(validateTree(ok, ["a", "c"]).length > 0, "foto diverse");
  assert.ok(validateTree({ kind: "split", dir: "row", ratio: 1.4, first: leaf("a"), second: leaf("b") }).length > 0, "rapporto non valido");
  assert.ok(validateTree(null, ["a"]).length > 0);
  assert.deepEqual(validateTree(null, []), []);
});

// ---------------------------------------------------------------------------- geometria

test("geometria: aree per divisione dello spread", () => {
  const { width, height } = spreadSizeMm(SHEET);
  assert.deepEqual([width, height], [600, 300]);
  assert.deepEqual(areaOuterRects(SHEET, "full"), [{ x: 0, y: 0, w: 600, h: 300 }]);
  const half = areaOuterRects(SHEET, "half");
  assert.deepEqual(half.map((r) => [r.x, r.w]), [[0, 300], [300, 300]]);
  const third = areaOuterRects(SHEET, "third");
  assert.ok(Math.abs(third[0].w - 200) < 1e-9 && Math.abs(third[1].x - 200) < 1e-9 && Math.abs(third[1].w - 400) < 1e-9);
  const two = areaOuterRects(SHEET, "two-thirds");
  assert.ok(Math.abs(two[0].w - 400) < 1e-9 && Math.abs(two[1].w - 200) < 1e-9);
  for (const mode of ["half", "third", "two-thirds"] as const) {
    const [a, b] = areaOuterRects(SHEET, mode);
    assert.ok(Math.abs(a.w + b.w - 600) < 1e-9 && Math.abs(a.x + a.w - b.x) < 1e-9);
  }
});

test("geometria: padding senza mai annullare il rettangolo", () => {
  assert.deepEqual(insetRect({ x: 0, y: 0, w: 100, h: 50 }, 10), { x: 10, y: 10, w: 80, h: 30 });
  const tiny = insetRect({ x: 0, y: 0, w: 20, h: 20 }, 500);
  assert.ok(tiny.w > 0 && tiny.h > 0);
  assert.deepEqual(insetRect({ x: 5, y: 5, w: 100, h: 100 }, -3), { x: 5, y: 5, w: 100, h: 100 });
});

test("geometria: celle senza sovrapposizioni, con spazio tra le foto e separatori coerenti", () => {
  const tree = split("row", 0.4, leaf("a"), split("column", 0.5, leaf("b"), leaf("c")));
  const rect = { x: 10, y: 20, w: 300, h: 200 };
  const { cells, dividers } = layoutCells(tree, rect, 4);
  assert.equal(cells.length, 3);
  assertCellsValid(cells, rect);
  assert.equal(dividers.length, 2);
  const a = cells[0].rect;
  const b = cells[1].rect;
  assert.ok(Math.abs(b.x - (a.x + a.w) - 4) < 1e-9, "spazio tra le colonne");
  assert.ok(Math.abs(a.w - (300 - 4) * 0.4) < 1e-9);
  assert.equal(dividers[0].path, "");
  assert.equal(dividers[1].path, "1");
  assert.ok(Math.abs(dividers[0].line.x - (a.x + a.w)) < 1e-9 && dividers[0].line.w === 4);
  const overridden = layoutCells(tree, rect, 4, { "": 0.7 });
  assert.ok(Math.abs(overridden.cells[0].rect.w - (300 - 4) * 0.7) < 1e-9, "il rapporto provvisorio ha la precedenza");
  assert.equal(layoutCells(null, rect, 4).cells.length, 0);
});

test("geometria: attraversamento della piega", () => {
  assert.equal(crossesFold({ x: 200, y: 0, w: 200, h: 100 }, 300), true);
  assert.equal(crossesFold({ x: 0, y: 0, w: 300, h: 100 }, 300), false);
  assert.equal(crossesFold({ x: 300, y: 0, w: 100, h: 100 }, 300), false);
});

// ---------------------------------------------------------------------------- generazione

test("generazione: rispetta l'ordine, è deterministica e restituisce layout validi", () => {
  const set = photos([L, P, L, P, S]);
  const rect = { x: 0, y: 0, w: 280, h: 280 };
  const a = generateLayouts(set, { rect, gapMm: 3 });
  const b = generateLayouts(set, { rect, gapMm: 3 });
  assert.deepEqual(a, b, "stessi dati, stesso risultato");
  assert.ok(a.length >= 8, `servono più candidati, ne ho ${a.length}`);
  for (const candidate of a) {
    assert.deepEqual(leafIds(candidate.tree), set.map((photo) => photo.id), "ordine di lettura = ordine delle foto");
    assert.deepEqual(validateTree(candidate.tree, set.map((p) => p.id)), []);
    assertCellsValid(layoutCells(candidate.tree, rect, 3).cells, rect, candidate.kind);
  }
  for (let i = 1; i < a.length; i += 1) assert.ok(a[i].score >= a[i - 1].score - 1e-12, "ordinati dal migliore");
  assert.equal(new Set(a.map((c) => JSON.stringify(c.tree))).size, a.length, "nessun duplicato");
});

test("generazione: sceglie la disposizione che ritaglia meno", () => {
  const wide = { x: 0, y: 0, w: 600, h: 300 };
  const twoPortraits = generateLayouts(photos([P, P]), { rect: wide, gapMm: 3 });
  assert.ok(twoPortraits[0].kind.startsWith("r("), "due verticali in area larga: affiancate");
  assert.ok(twoPortraits[0].cropLoss < 0.35);
  const tall = { x: 0, y: 0, w: 200, h: 400 };
  const twoLandscapes = generateLayouts(photos([L, L]), { rect: tall, gapMm: 3 });
  assert.ok(twoLandscapes[0].kind.startsWith("c("), "due orizzontali in area alta: impilate");
  const exact = generateLayouts(photos([1.5]), { rect: { x: 0, y: 0, w: 300, h: 200 }, gapMm: 0 });
  assert.ok(exact[0].cropLoss < 1e-9, "una foto con la stessa proporzione dell'area non si ritaglia");
  assert.equal(exact[0].tree.kind, "leaf");
});

test("generazione: poche foto offrono comunque varie scelte per lo Shuffle, senza layout assurdi", () => {
  const rect = { x: 0, y: 0, w: 280, h: 280 };
  const two = generateLayouts(photos([L, L]), { rect, gapMm: 3 });
  assert.ok(two.length >= 3, `2 foto: ${two.length} candidati`);
  const three = generateLayouts(photos([L, P, L]), { rect, gapMm: 3 });
  assert.ok(three.length >= 6, `3 foto: ${three.length} candidati`);
  assert.ok(new Set(three.map((c) => c.kind)).size >= 2, "strutture diverse");
  for (const set of [two, three]) {
    const best = set[0].score;
    for (const candidate of set) assert.ok(candidate.score <= Math.max(best * 2.2, best + 0.5) + 1e-9, `candidato assurdo: ${candidate.score.toFixed(2)} contro ${best.toFixed(2)}`);
  }
});

test("generazione: molte foto (8-12) con tempi contenuti e layout validi", () => {
  const rect = { x: 0, y: 0, w: 280, h: 280 };
  for (const n of [8, 10, 12]) {
    const set = photos(Array.from({ length: n }, (_, i) => [L, P, S, L, P][i % 5]));
    const started = performance.now();
    const result = generateLayouts(set, { rect, gapMm: 2 });
    const elapsed = performance.now() - started;
    assert.ok(result.length >= 6, `${n} foto: ${result.length} candidati`);
    assert.ok(elapsed < 1500, `${n} foto: ${Math.round(elapsed)} ms`);
    for (const candidate of result) {
      assert.deepEqual(leafIds(candidate.tree), set.map((p) => p.id));
      assertCellsValid(layoutCells(candidate.tree, rect, 2).cells, rect, `${n} foto`);
    }
    assert.ok(result[0].cropLoss < 0.5, `${n} foto: perdita ${result[0].cropLoss.toFixed(2)}`);
  }
});

test("generazione: casi limite (nessuna foto, rettangolo minuscolo, proporzioni anomale)", () => {
  const rect = { x: 0, y: 0, w: 280, h: 280 };
  assert.deepEqual(generateLayouts([], { rect, gapMm: 3 }), []);
  assert.equal(generateLayouts(photos([L]), { rect: { x: 0, y: 0, w: 1, h: 1 }, gapMm: 3 }).length, 1);
  const tiny = generateLayouts(photos([L, P]), { rect: { x: 0, y: 0, w: 2, h: 2 }, gapMm: 3 });
  assert.equal(tiny.length, 1);
  const weird = generateLayouts(photos([0, -3, NaN, 400, 0.001]), { rect, gapMm: 3 });
  assert.ok(weird.length > 0);
  for (const candidate of weird) assertCellsValid(layoutCells(candidate.tree, rect, 3).cells, rect);
});

test("generazione: la cache restituisce lo stesso elenco e la stima dei costi è coerente", () => {
  clearLayoutCache();
  const rect = { x: 0, y: 0, w: 280, h: 280 };
  const set = photos([L, P, S]);
  const first = generateLayoutsCached(set, { rect, gapMm: 3 });
  assert.equal(generateLayoutsCached(set, { rect, gapMm: 3 }), first);
  const cheap = estimateCost([1, 1], { x: 0, y: 0, w: 600, h: 300 }, 3);
  const costly = estimateCost([0.4, 0.4, 3, 3], { x: 0, y: 0, w: 300, h: 300 }, 3);
  assert.ok(cheap < costly, "foto compatibili con l'area costano meno");
  assert.equal(estimateCost([1, 1], { x: 0, y: 0, w: 600, h: 300 }, 3), cheap);
});

test("generazione: lo spazio tra le foto e le proporzioni limite non producono celle minuscole", () => {
  const rect = { x: 0, y: 0, w: 200, h: 200 };
  const result = generateLayouts(photos([L, L, L, L, L, L]), { rect, gapMm: 6 });
  for (const candidate of result) {
    for (const cell of layoutCells(candidate.tree, rect, 6).cells) assert.ok(cell.rect.w > 5 && cell.rect.h > 5);
  }
  const best = result[0].tree;
  assert.ok(scoreTree(best, new Map(photos([L, L, L, L, L, L]).map((p) => [p.id, p.aspect])), rect, 6).score <= result[result.length - 1].score + 1e-9);
  assert.ok(MIN_RATIO > 0);
});

// ---------------------------------------------------------------------------- rilascio

test("rilascio: centro, bordi, spazio tra le foto e aree vuote", () => {
  const tree = split("row", 0.5, leaf("a"), leaf("b"));
  const rect = { x: 0, y: 0, w: 300, h: 100 };
  const { cells } = layoutCells(tree, rect, 10);
  const areas = [{ rect, cells }];
  const a = cells[0].rect;
  assert.deepEqual(resolveDropTarget(areas, a.x + a.w / 2, a.y + a.h / 2), { areaIndex: 0, itemId: "a", zone: "center" });
  assert.equal(resolveDropTarget(areas, a.x + 2, a.y + a.h / 2)?.zone, "left");
  assert.equal(resolveDropTarget(areas, a.x + a.w - 2, a.y + a.h / 2)?.zone, "right");
  assert.equal(resolveDropTarget(areas, a.x + a.w / 2, a.y + 2)?.zone, "top");
  assert.equal(resolveDropTarget(areas, a.x + a.w / 2, a.y + a.h - 2)?.zone, "bottom");
  const gapX = a.x + a.w + 5;
  const between = resolveDropTarget(areas, gapX, 50);
  assert.ok(between && between.zone !== "center" && between.zone !== "area", "nello spazio si inserisce, non si sostituisce");
  assert.equal(resolveDropTarget(areas, 999, 999), null);
  const empty = resolveDropTarget([{ rect, cells: [] }], 10, 10);
  assert.deepEqual(empty, { areaIndex: 0, itemId: null, zone: "area" });
  const second = resolveDropTarget([{ rect: { x: 0, y: 0, w: 100, h: 100 }, cells: [] }, { rect: { x: 100, y: 0, w: 100, h: 100 }, cells: [] }], 150, 50);
  assert.equal(second?.areaIndex, 1);
});

test("rilascio: evidenziazione coerente con la zona", () => {
  const cell = { x: 0, y: 0, w: 100, h: 80 };
  const area = { x: 0, y: 0, w: 300, h: 80 };
  assert.deepEqual(dropHighlight({ areaIndex: 0, itemId: "a", zone: "center" }, cell, area), cell);
  assert.deepEqual(dropHighlight({ areaIndex: 0, itemId: "a", zone: "left" }, cell, area), { x: 0, y: 0, w: 50, h: 80 });
  assert.deepEqual(dropHighlight({ areaIndex: 0, itemId: "a", zone: "bottom" }, cell, area), { x: 0, y: 40, w: 100, h: 40 });
  assert.deepEqual(dropHighlight({ areaIndex: 0, itemId: null, zone: "area" }, null, area), area);
});

// ---------------------------------------------------------------------------- albero come insieme

test("albero: un layout generato resta valido dopo una sequenza di modifiche", () => {
  const set = photos([L, P, L, S]);
  const rect = { x: 0, y: 0, w: 280, h: 280 };
  let tree: LayoutNode = generateLayouts(set, { rect, gapMm: 3 })[0].tree;
  tree = insertBeside(tree, "p1", "n1", "right");
  tree = insertBeside(tree, "p3", "n2", "top", 0.4);
  tree = removeLeaf(tree, "p0")!;
  tree = swapLeaves(tree, "n1", "p2");
  tree = mirrorHorizontal(tree);
  assert.deepEqual(validateTree(tree, leafIds(tree)), []);
  assert.equal(countLeaves(tree), 5);
  assertCellsValid(layoutCells(tree, rect, 3).cells, rect, "dopo modifiche");
});

test("rilascio su una disposizione libera: conta la foto più in alto e c'è solo il centro", () => {
  const cells: LeafCell[] = [
    { itemId: "sotto", path: "", rect: { x: 0, y: 0, w: 100, h: 100 }, z: 0 },
    { itemId: "sopra", path: "", rect: { x: 50, y: 50, w: 100, h: 100 }, z: 3 },
  ];
  const area = { rect: { x: 0, y: 0, w: 200, h: 200 }, cells, free: true };
  assert.deepEqual(resolveDropTarget([area], 75, 75), { areaIndex: 0, itemId: "sopra", zone: "center" }, "dove si sovrappongono vince la più alta");
  assert.deepEqual(resolveDropTarget([area], 10, 10), { areaIndex: 0, itemId: "sotto", zone: "center" });
  assert.equal(resolveDropTarget([area], 180, 20), null, "fuori da ogni foto: nessun rilascio");
  assert.equal(resolveDropTarget([area], 1, 1)?.node, undefined, "niente zone intelligenti sul bordo");
});

test("albero: una foto si infila accanto a un intero ramo, o lungo tutto il bordo", () => {
  const tree = split("row", 0.5, split("column", 0.5, leaf("a"), leaf("b")), leaf("c"));
  const edge = insertAtNode(tree, "", "n", "left", 0.25);
  assert.deepEqual(leafIds(edge), ["n", "a", "b", "c"]);
  assert.equal(edge.kind === "split" && edge.dir === "row" && edge.ratio === 0.25, true);
  const group = insertAtNode(tree, "0", "n", "bottom", 0.4);
  assert.deepEqual(leafIds(group), ["a", "b", "n", "c"], "sotto l'intero gruppo a/b");
  assert.equal(insertAtNode(tree, "111", "n", "left"), tree, "percorso inesistente: nessun cambio");
});

test("rapporti naturali: con lo spazio tra le foto una riga ha foto alte uguali e la colonna impilata riempie la stessa altezza", () => {
  const aspects: Record<string, number> = { a: 2 / 3, b: 1.5, c: 1.5 };
  const asp = (id: string) => aspects[id];
  const tree = split("row", 0.5, leaf("a"), split("column", 0.5, leaf("b"), leaf("c")));
  for (const gap of [0, 2, 5]) {
    const size = { w: 300, h: 100 };
    const aligned = naturalRatios(tree, asp, size, gap);
    const cells = layoutCells(aligned, { x: 0, y: 0, ...size }, gap).cells;
    const content = (id: string) => {
      const found = cells.find((c) => c.itemId === id)!;
      const cell = found.rect;
      const anchor = found.anchor!.y;
      const h = Math.min(cell.h, cell.w / asp(id));
      return { y: cell.y + (cell.h - h) * anchor, h };
    };
    const [a, b, c] = ["a", "b", "c"].map(content);
    assert.ok(Math.abs(a.h - 100) < 1e-3, `gap ${gap}: la verticale usa tutta l'altezza (${a.h})`);
    assert.ok(Math.abs(b.y - a.y) < 1e-3, `gap ${gap}: bordo alto`);
    assert.ok(Math.abs(c.y + c.h - (a.y + a.h)) < 1e-3, `gap ${gap}: bordo basso`);
    assert.equal(naturalRatios(aligned, asp, size, gap), aligned, "già allineato: stesso albero");
  }
  assert.equal(naturalRatios(leaf("a"), asp, { w: 10, h: 10 }, 2).kind, "leaf");
});
