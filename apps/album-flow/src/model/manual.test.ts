import { test } from "node:test";
import assert from "node:assert/strict";
import type { AlbumSplitMode, LayoutNode } from "@photo-tools/shared-types";
import { resolveDropTarget, type DropArea, type DropTarget } from "../engine/drop";
import { mulberry32 } from "../engine/rng";
import { alignFitAreas, applyStyleToAlbum, ensureCellFloor, setAreaStyle, setLinked, settleCellFloor, shuffleArea, usableStyle } from "./areas";
import { MIN_CELL_MM, MIN_INNER_MM } from "./defaults";
import { assertProjectInvariants, makeAsset, makeProject } from "./fixtures";
import { appendAssets, dropOnSpread, dropOnSpreadPlanned, removeItem, removeRefusal, setItemView, toggleItemLock } from "./items";
import { setAreaLocked } from "./layoutLock";
import { removeAssets, rotateAssetQuarter, rotationRefusal } from "./library";
import { preflightReport } from "./preflight";
import { areaGeometry, hasFreeLayout, smallestCellMm, type Project } from "./project";
import { addSpread, setSpreadDone } from "./spreads";

/**
 * Modalità manuale: i gesti che costruiscono o ritoccano un layout a mano (rilasci sul bordo e tra due foto, scambi, stile, lucchetto, rotazione)
 * non devono mai lasciare una foto schiacciata a pochi millimetri o a zero (sparirebbe in stampa), né aggirare il lucchetto.
 * I rilasci partono da punti casuali dello spread e passano da `resolveDropTarget`, come nell'interfaccia.
 */

const SIDE_TOLERANCE_MM = 1;

const areasOf = (project: Project, spreadIndex: number): DropArea[] => project.spreads[spreadIndex].areas.map((area, index) => {
  const geometry = areaGeometry(project, project.spreads[spreadIndex], index);
  return { rect: geometry.outer, cells: geometry.cells, dividers: geometry.dividers, free: hasFreeLayout(area) };
});

/** Riempie la prima pagina di uno spread rilasciando una foto alla volta in punti casuali, come farebbe una persona con il mouse. */
function fillByDrops(mode: "fit" | "fill", split: AlbumSplitMode, trial: number, onStep: (project: Project, count: number, rebuilt: boolean) => void): Project {
  const random = mulberry32(trial * 7919 + (mode === "fit" ? 1 : 2));
  let project = makeProject(30);
  project = addSpread(project, 0, split);
  const spreadId = project.spreads[0].id;
  project = setAreaStyle(project, spreadId, 0, { mode });
  const used = new Set<string>();
  for (let count = 1, guard = 0; count <= 12 && guard < 400; guard += 1) {
    const free = project.assets.filter((asset) => !used.has(asset.id));
    const asset = free[Math.floor(random() * free.length)];
    let target: DropTarget | null = { areaIndex: 0, itemId: null, zone: "area" };
    if (count > 1) {
      const outer = areaGeometry(project, project.spreads[0], 0).outer;
      target = resolveDropTarget(areasOf(project, 0), outer.x + random() * outer.w, outer.y + random() * outer.h);
      if (!target || target.areaIndex !== 0) continue;
    }
    const plan = dropOnSpreadPlanned(project, spreadId, target, { kind: "assets", assetIds: [asset.id] });
    const next = plan.project;
    if (next === project || next.spreads[0].areas[0].items.length !== count) continue;
    used.add(asset.id);
    project = next;
    onStep(project, count, plan.rebuilt);
    count += 1;
  }
  return project;
}

test("riempire una pagina a mano non lascia mai una cella sotto la soglia", () => {
  let worst = Infinity;
  let trials = 0;
  let rebuilds = 0;
  for (const mode of ["fit", "fill"] as const) for (const split of ["half", "third"] as const) for (let trial = 1; trial <= 40; trial += 1) {
    const last = fillByDrops(mode, split, trial, (project, count, rebuilt) => {
      assertProjectInvariants(project, `${mode} ${split} prova ${trial} foto ${count}`);
      const side = smallestCellMm(project, project.spreads[0], 0);
      worst = Math.min(worst, side);
      assert.ok(side >= MIN_CELL_MM - SIDE_TOLERANCE_MM, `${mode} ${split} prova ${trial}: con ${count} foto la cella più piccola è ${side.toFixed(1)} mm (soglia ${MIN_CELL_MM})`);
      if (rebuilt) rebuilds += 1;
    });
    assert.equal(last.spreads[0].areas[0].items.length, 12, "la pagina arriva a 12 foto");
    trials += 1;
  }
  assert.equal(trials, 160);
  // Il test non gira a vuoto: senza la rete di sicurezza molti di questi rilasci avrebbero lasciato celle di pochi millimetri.
  assert.ok(rebuilds >= 20, `la pagina è stata ridisposta solo ${rebuilds} volte`);
  assert.ok(worst > 0);
});

test("rilasci da punti casuali (bordo, tra due foto, centro, foto dello spread) mantengono gli invarianti e non perdono foto", () => {
  for (let seed = 1; seed <= 6; seed += 1) {
    const random = mulberry32(seed * 104729);
    let project = makeProject(40);
    project = addSpread(project, 0, "half");
    project = addSpread(project, 1, "third");
    for (let step = 0; step < 140; step += 1) {
      const spreadIndex = Math.floor(random() * project.spreads.length);
      const spread = project.spreads[spreadIndex];
      const sheet = project.settings.sheet;
      const target = resolveDropTarget(areasOf(project, spreadIndex), random() * sheet.widthCm * 20, random() * sheet.heightCm * 10);
      if (!target) continue;
      const items = spread.areas.flatMap((area) => area.items);
      const dragged = items.length > 0 && random() < 0.4 ? items[Math.floor(random() * items.length)] : null;
      if (dragged && target.itemId === dragged.id) continue;
      const total = (p: Project) => p.spreads.reduce((sum, s) => sum + s.areas.reduce((n, a) => n + a.items.length, 0), 0);
      const before = total(project);
      const next = dragged
        ? dropOnSpread(project, spread.id, target, { kind: "item", itemId: dragged.id })
        : dropOnSpread(project, spread.id, target, { kind: "assets", assetIds: [project.assets[Math.floor(random() * project.assets.length)].id] });
      assertProjectInvariants(next, `seme ${seed} passo ${step} (${target.zone}${target.node !== undefined ? " ramo" : ""})`);
      if (dragged) assert.equal(total(next), before, `seme ${seed} passo ${step}: spostare una foto non cambia il totale`);
      assert.ok(total(next) >= before, "un rilascio non toglie foto");
      project = next;
    }
  }
});

test("la soglia non tocca ciò che non è stato toccato: pagine bloccate, libere, con una sola foto o già piccole prima", () => {
  let project = makeProject(8);
  project = addSpread(project, 0, "half");
  const id = project.spreads[0].id;
  project = appendAssets(project, id, 0, project.assets.map((asset) => asset.id));
  const spread = project.spreads[0];
  // Nessun cambiamento: nulla da correggere.
  assert.equal(settleCellFloor(project, project).rebuilt, false);
  assert.equal(ensureCellFloor(project, spread, 0, Infinity), spread.areas[0], "una pagina in regola resta la stessa");
  // Una pagina bloccata non si ridispone mai, nemmeno se una cella è minuscola.
  const squeezed: Project = { ...project, spreads: project.spreads.map((s) => ({ ...s, areas: s.areas.map((area, index) => (index === 0 ? { ...area, locked: true, layout: squeeze(area.layout!) } : area)) })) };
  assert.ok(smallestCellMm(squeezed, squeezed.spreads[0], 0) < MIN_CELL_MM, "la prova parte da una cella minuscola");
  assert.equal(ensureCellFloor(squeezed, squeezed.spreads[0], 0, Infinity), squeezed.spreads[0].areas[0], "bloccata: resta com'è");
  // Una pagina già piccola prima dell'operazione e che non peggiora non si ridispone.
  const unlocked: Project = { ...squeezed, spreads: squeezed.spreads.map((s) => ({ ...s, areas: s.areas.map((area) => { const { locked: _locked, ...rest } = area; return rest; }) })) };
  const side = smallestCellMm(unlocked, unlocked.spreads[0], 0);
  assert.equal(ensureCellFloor(unlocked, unlocked.spreads[0], 0, side).layout, unlocked.spreads[0].areas[0].layout, "non è peggiorata: non si tocca");
  assert.notEqual(ensureCellFloor(unlocked, unlocked.spreads[0], 0, Infinity).layout, unlocked.spreads[0].areas[0].layout, "è appena peggiorata: si ridispone");
});

/** Rende minuscola la prima cella del layout con rapporti al minimo, uno dentro l'altro. */
function squeeze(node: LayoutNode): LayoutNode {
  return node.kind === "leaf" ? node : { ...node, ratio: 0.08, first: squeeze(node.first), second: node.second };
}

test("stili estremi: margine e spazio si fermano dove le foto restano visibili", () => {
  const LONG = [0.2, 5, 0.2, 5, 0.25, 4, 0.2, 5, 0.3, 3.5, 0.2, 5];
  const base = (split: AlbumSplitMode, count: number, aspects?: readonly number[]): { project: Project; id: string } => {
    let project = makeProject(count);
    if (aspects) project = { ...project, assets: aspects.slice(0, count).map((aspect, index) => makeAsset(index, { width: Math.round(aspect * 4000), height: 4000, aspectRatio: aspect })) };
    project = addSpread(project, 0, split);
    const id = project.spreads[0].id;
    return { project: appendAssets(project, id, 0, project.assets.map((asset) => asset.id)), id };
  };
  // Margine al massimo su un terzo di foglio: l'area utile conserva almeno MIN_INNER_MM per lato.
  const third = base("third", 4);
  const padded = setAreaStyle(third.project, third.id, 0, { paddingCm: 10 });
  const inner = areaGeometry(padded, padded.spreads[0], 0).inner;
  assert.ok(Math.min(inner.w, inner.h) >= MIN_INNER_MM - 0.5, `area utile ${inner.w.toFixed(0)}×${inner.h.toFixed(0)} mm`);
  assert.ok(padded.spreads[0].areas[0].style.paddingCm < 10 && padded.spreads[0].areas[0].style.paddingCm > third.project.spreads[0].areas[0].style.paddingCm);
  assertProjectInvariants(padded, "margine al massimo");
  // Spazio al massimo con dodici foto molto allungate su un foglio intero: nessuna cella scende sotto la soglia.
  const crowded = base("full", 12, LONG);
  const spaced = setAreaStyle(crowded.project, crowded.id, 0, { gapCm: 3 });
  assert.ok(smallestCellMm(spaced, spaced.spreads[0], 0) >= MIN_CELL_MM - SIDE_TOLERANCE_MM, `spazio al massimo: ${smallestCellMm(spaced, spaced.spreads[0], 0).toFixed(1)} mm`);
  assert.ok(spaced.spreads[0].areas[0].style.gapCm < 3 && spaced.spreads[0].areas[0].style.gapCm > crowded.project.spreads[0].areas[0].style.gapCm, "il valore è stato fermato a metà strada");
  assertProjectInvariants(spaced, "spazio al massimo");
  // Diminuire passa sempre, e tornare a un valore sicuro rende esattamente quello chiesto.
  const back = setAreaStyle(spaced, crowded.id, 0, { gapCm: 0.2 });
  assert.equal(back.spreads[0].areas[0].style.gapCm, 0.2);
  // Un valore sicuro non viene toccato.
  const mild = setAreaStyle(crowded.project, crowded.id, 0, { gapCm: 0.4, paddingCm: 1 });
  assert.equal(mild.spreads[0].areas[0].style.gapCm, 0.4);
  assert.equal(mild.spreads[0].areas[0].style.paddingCm, 1);
  // Pagine collegate: lo stile resta uguale su entrambe, vale il limite più stretto.
  let linked = addSpread(makeProject(14), 0, "two-thirds");
  const linkedId = linked.spreads[0].id;
  linked = appendAssets(linked, linkedId, 0, linked.assets.slice(0, 6).map((asset) => asset.id));
  linked = appendAssets(linked, linkedId, 1, linked.assets.slice(6, 8).map((asset) => asset.id));
  linked = setLinked(linked, linkedId, true);
  linked = setAreaStyle(linked, linkedId, 0, { paddingCm: 10 });
  assert.equal(linked.spreads[0].areas[0].style.paddingCm, linked.spreads[0].areas[1].style.paddingCm, "collegate: stesso margine");
  assertProjectInvariants(linked, "collegate");
  // «Applica a tutto l'album» non porta lo spazio al massimo su pagine piene.
  const album = applyStyleToAlbum(setAreaStyle(crowded.project, crowded.id, 0, { gapCm: 3 }), crowded.id, 0);
  assertProjectInvariants(album, "applica all'album");
  assert.ok(smallestCellMm(album, album.spreads[0], 0) >= MIN_CELL_MM - SIDE_TOLERANCE_MM, "applica all'album: celle sopra la soglia");
  // La funzione pura: senza foto contano solo i limiti della pagina.
  const empty = addSpread(makeProject(2), 0, "third");
  const wanted = usableStyle(empty, empty.spreads[0], 0, { ...empty.spreads[0].areas[0].style, paddingCm: 10 });
  assert.ok(wanted.paddingCm <= 7.5, `margine ${wanted.paddingCm}`);
});

test("scambiare foto in una pagina fitta non lascia celle sotto la soglia", () => {
  const random = mulberry32(2024);
  let project = makeProject(30);
  project = addSpread(project, 0, "half");
  const id = project.spreads[0].id;
  project = appendAssets(project, id, 0, project.assets.slice(0, 12).map((asset) => asset.id));
  for (let step = 0; step < 80; step += 1) {
    const items = project.spreads[0].areas[0].items;
    const a = items[Math.floor(random() * items.length)];
    const b = items[Math.floor(random() * items.length)];
    if (a.id === b.id) continue;
    const next = dropOnSpread(project, id, { areaIndex: 0, itemId: b.id, zone: "center" }, { kind: "item", itemId: a.id });
    assertProjectInvariants(next, `scambio ${step}`);
    assert.ok(smallestCellMm(next, next.spreads[0], 0) >= MIN_CELL_MM - SIDE_TOLERANCE_MM, `scambio ${step}: ${smallestCellMm(next, next.spreads[0], 0).toFixed(1)} mm`);
    project = next;
  }
});

test("il lucchetto della pagina protegge anche da «Togli dallo spread»", () => {
  let project = makeProject(6);
  project = addSpread(project, 0, "full");
  const id = project.spreads[0].id;
  project = appendAssets(project, id, 0, project.assets.slice(0, 4).map((asset) => asset.id));
  const victim = project.spreads[0].areas[0].items[1].id;
  const locked = setAreaLocked(project, id, 0, true);
  assert.match(removeRefusal(locked, victim) ?? "", /Layout bloccato/);
  assert.equal(removeItem(locked, victim), locked, "pagina bloccata: la foto resta");
  assert.equal(removeRefusal(project, victim), null);
  assert.equal(removeItem(project, victim).spreads[0].areas[0].items.length, 3);
  // Una foto bloccata si protegge da sola.
  const pinned = toggleItemLock(project, victim);
  assert.match(removeRefusal(pinned, victim) ?? "", /bloccata/);
  assert.equal(removeItem(pinned, victim), pinned);
  // Ma togliere la foto dall'album la toglie comunque anche dalla pagina bloccata: non può restare un riferimento a una foto che non c'è più.
  const gone = removeAssets(locked, [locked.spreads[0].areas[0].items[1].assetId]);
  assertProjectInvariants(gone, "foto tolta dall'album");
  assert.equal(gone.spreads[0].areas[0].items.length, 3);
  assert.equal(gone.spreads[0].areas[0].locked, true, "la pagina resta bloccata");
});

test("sbloccare una pagina riallinea le foto (forma scelta mentre era bloccata)", () => {
  let project = makeProject(3);
  project = addSpread(project, 0, "full");
  const id = project.spreads[0].id;
  project = appendAssets(project, id, 0, project.assets.map((asset) => asset.id));
  project = setAreaStyle(project, id, 0, { mode: "fit" });
  project = setAreaLocked(project, id, 0, true);
  const itemId = project.spreads[0].areas[0].items[1].id;
  project = setItemView(project, itemId, { shape: 4 });
  const layoutOf = (p: Project) => JSON.stringify(p.spreads[0].areas[0].layout);
  const withoutLock = (p: Project): Project => ({ ...p, spreads: p.spreads.map((s) => ({ ...s, areas: s.areas.map(({ locked: _locked, ...rest }) => rest) })) });
  const expected = layoutOf(alignFitAreas(withoutLock(project), id));
  assert.notEqual(expected, layoutOf(project), "con il lucchetto le divisioni non seguono la forma: serve riallineare");
  const unlocked = setAreaLocked(project, id, 0, false);
  assert.equal(layoutOf(unlocked), expected, "sbloccata: le foto sono riallineate come con «Allinea foto»");
  assertProjectInvariants(unlocked, "dopo lo sblocco");
  // Uno spread finito non si riadatta, come per lo stile.
  const done = setAreaLocked(setSpreadDone(project, id, true), id, 0, false);
  assert.equal(layoutOf(done), layoutOf(project), "spread finito: nessun riadattamento");
  // Bloccare di nuovo non cambia il layout.
  assert.equal(setAreaLocked(unlocked, id, 0, true).spreads[0].areas[0].layout, unlocked.spreads[0].areas[0].layout);
});

test("una foto bloccata non si ruota, nemmeno da un altro spread", () => {
  let project = makeProject(3);
  project = addSpread(project, 0, "full");
  project = addSpread(project, 1, "full");
  const shared = project.assets[0].id;
  project = appendAssets(project, project.spreads[0].id, 0, [shared]);
  project = appendAssets(project, project.spreads[1].id, 0, [shared, project.assets[1].id]);
  assert.equal(rotationRefusal(project, shared), null);
  const pinned = toggleItemLock(project, project.spreads[1].areas[0].items[0].id);
  assert.match(rotationRefusal(pinned, shared) ?? "", /spread 2/);
  assert.equal(rotateAssetQuarter(pinned, shared, 1), pinned, "la rotazione è rifiutata per intero");
  assert.equal(rotateAssetQuarter(pinned, project.assets[1].id, 1).assets[1].rotationDegrees, 90, "le altre foto si ruotano");
  const free = toggleItemLock(pinned, pinned.spreads[1].areas[0].items[0].id);
  assert.equal(rotateAssetQuarter(free, shared, 1).assets[0].rotationDegrees, 90);
  assertProjectInvariants(rotateAssetQuarter(free, shared, 1), "dopo la rotazione");
});

test("il controllo prima dell'export segnala una foto schiacciata a pochi millimetri", () => {
  let project = makeProject(3);
  project = addSpread(project, 0, "full");
  const id = project.spreads[0].id;
  project = appendAssets(project, id, 0, project.assets.map((asset) => asset.id));
  project = setAreaStyle(project, id, 0, { mode: "fill" });
  assert.equal(preflightReport(project).stats.tooSmall, 0, "layout normale: nessuna segnalazione");
  // Una persona può ancora trascinare i separatori fino al minimo: la pagina resta valida, ma il controllo avvisa.
  const [first, second, third] = project.spreads[0].areas[0].items.map((item) => ({ kind: "leaf", itemId: item.id }) as const);
  const squeezed: LayoutNode = { kind: "split", dir: "column", ratio: 0.08, first: { kind: "split", dir: "column", ratio: 0.08, first, second }, second: third };
  const tiny: Project = { ...project, spreads: project.spreads.map((s) => ({ ...s, areas: s.areas.map((area) => ({ ...area, layout: squeezed })) })) };
  const report = preflightReport(tiny);
  assert.ok(report.stats.tooSmall >= 1, "foto minuscola segnalata");
  assert.ok(report.issues.some((issue) => issue.level === "warning" && /mm sul lato corto/.test(issue.message)));
  assert.equal(report.errors, 0, "è un avviso, non un blocco");
});

test("le foto di prova hanno proporzioni diverse (il test non gira a vuoto)", () => {
  const shapes = new Set(Array.from({ length: 10 }, (_, index) => makeAsset(index).aspectRatio.toFixed(2)));
  assert.ok(shapes.size >= 4, "serve una miscela di orizzontali, verticali e quadrate");
  const crowded = shuffleArea(makeProject(0), "x", 0);
  assert.equal(crowded.spreads.length, 0);
});
