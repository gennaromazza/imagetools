import { test } from "node:test";
import assert from "node:assert/strict";
import { appendAssets, dropOnSpread, moveToNewSpread, moveToSpread, previewDropRect, replaceItemAsset, resetItemView, setItemView, shapeKeepsAlignment, swapItems, toggleItemLock } from "./items";
import { addSpread, duplicateSpread } from "./spreads";
import { renderSpreadSvg } from "../render/spread-svg";
import { applyCandidate, areaCandidates, setAreaStyle } from "./areas";
import { areaPhotos, effectiveAspect, itemAspect, spreadGeometry, type Project } from "./project";
import { assertProjectInvariants, makeProject } from "./fixtures";
import { SHAPE_SNAP, placeItem } from "./placement";
import { SHAPE_PRESETS, presetForShape } from "./shapes";
import { parseAlbumProject, serializeAlbumProject } from "./portability";

function album(photos = 3, mode: "fill" | "fit" = "fill"): Project {
  let project = addSpread(makeProject(photos + 2), 0, "half");
  const id = project.spreads[0].id;
  project = appendAssets(project, id, 0, Array.from({ length: photos }, (_, i) => `a${i}`));
  return setAreaStyle(project, id, 0, { mode });
}

const itemsOf = (project: Project) => project.spreads[0].areas[0].items;

function placed(project: Project, index = 0) {
  const area = project.spreads[0].areas[0];
  const item = area.items[index];
  const cell = spreadGeometry(project, project.spreads[0])[0].cells.find((candidate) => candidate.itemId === item.id)!;
  return { item, cell, placement: placeItem(cell.rect, item, project.assets.find((asset) => asset.id === item.assetId), area.style, null, cell.anchor) };
}

for (const mode of ["fill", "fit"] as const) {
  test(`forma per foto (${mode}): la finestra ha il rapporto scelto, sta dentro la cella e la foto non si deforma`, () => {
    let project = album(3, mode);
    for (const preset of SHAPE_PRESETS) {
      project = setItemView(project, itemsOf(project)[0].id, { shape: preset.ratio });
      assert.equal(itemsOf(project)[0].shape !== undefined, true, `${preset.id} salvata`);
      const { cell, placement, item } = placed(project);
      const ratio = placement.content.w / placement.content.h;
      const cellRatio = cell.rect.w / cell.rect.h;
      const snapped = Math.abs(cellRatio / preset.ratio - 1) < SHAPE_SNAP;
      assert.ok(Math.abs(ratio / (snapped ? cellRatio : preset.ratio) - 1) < 1e-4, `${preset.id}: rapporto ${ratio}`);
      const frame = cell.rect;
      assert.ok(placement.content.x >= frame.x - 1e-6 && placement.content.y >= frame.y - 1e-6, `${preset.id}: dentro la cella`);
      assert.ok(placement.content.x + placement.content.w <= frame.x + frame.w + 1e-6 && placement.content.y + placement.content.h <= frame.y + frame.h + 1e-6, `${preset.id}: dentro la cella (lato opposto)`);
      // la parte di immagine che si vede ha le proporzioni della foto: niente deformazione
      const asset = project.assets.find((candidate) => candidate.id === item.assetId)!;
      const visible = (placement.crop.cropWidth * itemAspect(asset)) / placement.crop.cropHeight;
      assert.ok(Math.abs(visible / ratio - 1) < 1e-4, `${preset.id}: ritaglio ${visible} ≠ ${ratio}`);
      assertProjectInvariants(project, `forma ${preset.id}`);
    }
  });
}

test("forma per foto: shapeKeepsAlignment dice se la forma lascia le foto allineate (cella con quella forma) e vale sempre per foto sola o pagina libera", () => {
  for (const mode of ["fit", "fill"] as const) {
    for (const count of [2, 3, 4, 5]) {
      const base = album(count, mode);
      for (const preset of SHAPE_PRESETS) {
        for (const item of itemsOf(base)) {
          const changed = setItemView(base, item.id, { shape: preset.ratio });
          assertProjectInvariants(changed, `${mode}/${count}/${preset.id}`);
          const cell = spreadGeometry(changed, changed.spreads[0]).flatMap((geometry) => geometry.cells).find((candidate) => candidate.itemId === item.id)!;
          const aligned = Math.abs(cell.rect.w / cell.rect.h / preset.ratio - 1) < SHAPE_SNAP;
          assert.equal(shapeKeepsAlignment(base, item.id, preset.ratio), aligned, `${mode}/${count}/${preset.id}: la risposta non corrisponde alla cella`);
        }
      }
    }
  }
});

test("forma per foto: una foto sola nella pagina o una disposizione libera non hanno vincoli di allineamento", () => {
  const single = album(1, "fit");
  for (const preset of SHAPE_PRESETS) assert.equal(shapeKeepsAlignment(single, itemsOf(single)[0].id, preset.ratio), true);
  assert.equal(shapeKeepsAlignment(single, "nessuna", 1), true);
});

test("forma per foto: le altre foto non cambiano, «Come la cella» e il ripristino la tolgono", () => {
  const base = album(3, "fit");
  const withShape = setItemView(base, itemsOf(base)[1].id, { shape: 1 });
  assert.equal(itemsOf(withShape)[0].shape, undefined);
  assert.equal(itemsOf(withShape)[2].shape, undefined);
  assert.equal(placed(withShape, 0).placement.crop.cropWidth, 1, "le altre restano intere in «foto intera»");
  const cleared = setItemView(withShape, itemsOf(withShape)[1].id, { shape: null });
  assert.equal("shape" in itemsOf(cleared)[1], false);
  assert.deepEqual(itemsOf(cleared), itemsOf(base));
  assert.deepEqual(itemsOf(resetItemView(withShape, itemsOf(withShape)[1].id)), itemsOf(base), "«ripristina» toglie anche la forma");
  assert.equal(setItemView(withShape, itemsOf(withShape)[1].id, { shape: 1 }), withShape, "stessa forma: nessun cambiamento");
});

test("forma per foto: zoom, spostamento e raddrizzamento valgono dentro la finestra", () => {
  let project = album(2);
  const id = itemsOf(project)[0].id;
  project = setItemView(project, id, { shape: 1, zoom: 2, cx: 0.8, cy: 0.5 });
  const zoomed = placed(project).placement;
  assert.ok(zoomed.crop.cropWidth < 1 || zoomed.crop.cropHeight < 1);
  project = setItemView(project, id, { angle: 7 });
  const turned = placed(project).placement;
  assert.equal(turned.angle, 7);
  assert.ok(Math.abs(turned.content.w / turned.content.h - 1) < 1e-6, "la finestra resta quadrata anche raddrizzando");
  assert.ok(turned.zoom >= 1);
  assertProjectInvariants(project, "forma + zoom + angolo");
});

test("forma per foto: i valori fuori limite si riportano nell'intervallo e la forma segue la foto quando si scambiano", () => {
  let project = album(3);
  const [a, b] = itemsOf(project);
  project = setItemView(project, a.id, { shape: 99 });
  assert.equal(itemsOf(project)[0].shape, 5);
  project = setItemView(project, a.id, { shape: 0.001 });
  assert.equal(itemsOf(project)[0].shape, 0.2);
  project = setItemView(project, a.id, { shape: 1 });
  const swapped = swapItems(project, a.id, b.id);
  assert.equal(itemsOf(swapped)[0].shape, undefined, "la prima cella non ha più forma");
  assert.equal(itemsOf(swapped)[1].shape, 1, "la forma viaggia con la foto");
  assertProjectInvariants(swapped, "scambio con forma");
});

test("forma per foto: salvataggio e riapertura; un valore non valido viene rifiutato", () => {
  const base = album(2);
  const project = setItemView(base, itemsOf(base)[0].id, { shape: 4 / 5 });
  const raw = serializeAlbumProject(project);
  assert.equal(itemsOf(parseAlbumProject(raw))[0].shape, 0.8);
  const broken = raw.replace('"shape": 0.8', '"shape": 42').replace('"shape":0.8', '"shape":42');
  assert.notEqual(broken, raw, "la prova deve toccare il valore");
  assert.throws(() => parseAlbumProject(broken));
});

test("forme predefinite: rapporti distinti e riconoscimento con tolleranza", () => {
  assert.equal(new Set(SHAPE_PRESETS.map((preset) => preset.id)).size, SHAPE_PRESETS.length);
  assert.ok(SHAPE_PRESETS.some((preset) => preset.ratio === 1) && SHAPE_PRESETS.some((preset) => preset.ratio > 1) && SHAPE_PRESETS.some((preset) => preset.ratio < 1), "quadrata, orizzontale e verticale");
  assert.equal(presetForShape(1.0004)?.id, "1:1");
  assert.equal(presetForShape(0.8)?.id, "4:5");
  assert.equal(presetForShape(1.1), null);
  assert.equal(presetForShape(undefined), null);
});

test("forma per foto: i layout proposti la trattano con la forma scelta, non con quella dell'originale", () => {
  let project = album(4);
  const target = itemsOf(project)[0];
  const asset = project.assets.find((candidate) => candidate.id === target.assetId)!;
  assert.ok(itemAspect(asset) > 1, "la foto di prova è orizzontale");
  const before = areaCandidates(project, project.spreads[0], 0, 24);
  project = setItemView(project, target.id, { shape: 0.5 });
  const area = project.spreads[0].areas[0];
  const photo = areaPhotos(project, area).find((candidate) => candidate.id === target.id)!;
  assert.equal(photo.aspect, 0.5, "il generatore riceve la forma scelta");
  assert.equal(effectiveAspect(itemsOf(project)[0], asset), 0.5);
  assert.equal(effectiveAspect(itemsOf(project)[1], asset), itemAspect(asset), "le altre restano con l'originale");
  const after = areaCandidates(project, project.spreads[0], 0, 24);
  assert.notEqual(JSON.stringify(after.map((candidate) => candidate.tree)), JSON.stringify(before.map((candidate) => candidate.tree)), "i layout cambiano");
  // la foto verticale riceve nel miglior layout una cella più stretta di quella che avrebbe da orizzontale
  const ratioOf = (candidates: typeof after) => {
    const spread = { ...project.spreads[0], areas: [{ ...area, layout: candidates[0].tree as never }, project.spreads[0].areas[1]] };
    const rect = spreadGeometry({ ...project, spreads: [spread] }, spread)[0].cells.find((c) => c.itemId === target.id)!.rect;
    return rect.w / rect.h;
  };
  assert.ok(ratioOf(after) < ratioOf(before), `cella più alta che larga rispetto a prima: ${ratioOf(after)} vs ${ratioOf(before)}`);
});

test("forma per foto: se la cella ha già quasi la forma scelta la foto la riempie, senza fasce bianche; altrimenti resta la finestra", () => {
  const style = { borderCm: 0, mode: "fit" as const, align: "center" as const };
  const asset = makeProject(1).assets[0];
  const item = { zoom: 1, cx: 0.5, cy: 0.5, shape: 0.75 };
  // cella 0,67 e forma 3:4 (come nello spread dell'utente): la foto riempie la cella
  const near = placeItem({ x: 0, y: 0, w: 331, h: 491 }, item, asset, style, null);
  assert.deepEqual([near.content.w, near.content.h], [331, 491]);
  for (const mode of ["fit", "fill"] as const) {
    const wide = placeItem({ x: 0, y: 0, w: 288, h: 213 }, item, asset, { ...style, mode }, null);
    assert.ok(Math.abs(wide.content.w / wide.content.h / 0.75 - 1) < 1e-6, `${mode}: cella larga, resta la finestra 3:4`);
    assert.ok(wide.content.w < 288);
  }
});

test("forma per foto: cambiando la forma le celle si adattano; passando a «riempi» la foto riempie la sua cella", () => {
  const base = album(3, "fit");
  const id = base.spreads[0].id;
  const target = itemsOf(base)[0];
  const count = areaCandidates(base, base.spreads[0], 0, 24).length;
  for (let k = 0; k < count; k += 1) {
    const shaped = setItemView(applyCandidate(base, id, 0, k), target.id, { shape: 3 / 4 });
    const filled = setAreaStyle(shaped, id, 0, { mode: "fill" });
    assert.deepEqual(filled.spreads[0].areas[0].layout, shaped.spreads[0].areas[0].layout, `layout ${k}: passando a «riempi» la disposizione non cambia`);
    const { cell, placement } = placed(filled);
    const cellRatio = cell.rect.w / cell.rect.h;
    // la foto riempie la cella oppure, se la cella è molto diversa, mostra la finestra della forma scelta
    const fillsCell = placement.content.w >= cell.rect.w * 0.999 && placement.content.h >= cell.rect.h * 0.999;
    assert.ok(fillsCell || Math.abs(placement.content.w / placement.content.h / 0.75 - 1) < 1e-6, `layout ${k}: ${cellRatio}`);
    assertProjectInvariants(filled, `forma + riempi (${k})`);
  }
});

test("audit — celle, pulsanti e casi d'uso con la forma: duplica spread, sostituzione foto, svuota, esportazione e anteprima del rilascio", () => {
  let project = album(3, "fit");
  const id = project.spreads[0].id;
  const target = itemsOf(project)[0];
  project = setItemView(project, target.id, { shape: 1, zoom: 2, cx: 0.7, cy: 0.4 });
  // duplicare lo spread porta con sé forma, zoom e centro
  const copy = duplicateSpread(project, id);
  assert.equal(copy.spreads[1].areas[0].items[0].shape, 1);
  assert.equal(copy.spreads[1].areas[0].items[0].zoom, 2);
  assertProjectInvariants(copy, "duplica con forma");
  // sostituire la foto nella cella tiene la forma (è la forma della cella), azzera l'inquadratura
  const replaced = replaceItemAsset(project, target.id, "a4");
  assert.equal(itemsOf(replaced)[0].shape, 1);
  assert.equal(itemsOf(replaced)[0].zoom, 1);
  assertProjectInvariants(replaced, "sostituzione con forma");
  // una foto bloccata non cambia forma
  const locked = toggleItemLock(project, target.id);
  assert.equal(setItemView(locked, target.id, { shape: 2 }), locked);
  // spostare la foto in uno spread nuovo o su un altro spread le lascia la forma (e non la duplica)
  const moved = moveToNewSpread(project, 1, { kind: "item", itemId: target.id }).project;
  const shapedAfterNew = moved.spreads.flatMap((s) => s.areas.flatMap((a) => a.items)).filter((item) => item.shape);
  assert.equal(shapedAfterNew.length, 1);
  assert.equal(shapedAfterNew[0].assetId, target.assetId);
  assert.equal(shapedAfterNew[0].shape, 1);
  assertProjectInvariants(moved, "spostamento di una foto con forma");
  const two = addSpread(project, 1);
  const onOther = moveToSpread(two, two.spreads[1].id, { kind: "item", itemId: target.id });
  const shapedOnOther = onOther.spreads[1].areas.flatMap((a) => a.items).filter((item) => item.assetId === target.assetId);
  assert.equal(shapedOnOther.length, 1, "la foto è arrivata una volta sola");
  assert.equal(shapedOnOther[0].shape, 1, "la forma segue la foto");
  assertProjectInvariants(onOther, "foto con forma su un altro spread");
  // l'anteprima del rilascio coincide col risultato reale anche in «riempi» con foto in forma
  const filled = setAreaStyle(project, id, 0, { mode: "fill" });
  const assets = new Map(filled.assets.map((asset) => [asset.id, asset]));
  const droppedOn = itemsOf(filled)[1];
  const dropTarget = { areaIndex: 0, itemId: droppedOn.id, zone: "right" as const };
  const preview = previewDropRect(filled.settings.sheet, filled.spreads[0], assets, dropTarget, { assetId: "a4" });
  const after = dropOnSpread(filled, id, dropTarget, { kind: "assets", assetIds: ["a4"] });
  const added = itemsOf(after).find((item) => !itemsOf(filled).some((old) => old.id === item.id))!;
  const real = spreadGeometry(after, after.spreads[0])[0].cells.find((cell) => cell.itemId === added.id)!.rect;
  assert.ok(preview, "anteprima presente");
  for (const key of ["x", "y", "w", "h"] as const) assert.ok(Math.abs(preview![key] - real[key]) < 1e-6, `anteprima ${key}: ${preview![key]} ≠ ${real[key]}`);
  // l'esportazione SVG ritaglia nella finestra della forma
  const svg = renderSpreadSvg(project, project.spreads[0]);
  const placement = placed(project).placement;
  const clips = [...svg.matchAll(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/g)].map((m) => ({ w: Number(m[3]), h: Number(m[4]) }));
  assert.ok(clips.some((clip) => Math.abs(clip.w - placement.content.w) < 0.01 && Math.abs(clip.h - placement.content.h) < 0.01), "SVG: il riquadro della foto ha le misure della finestra");
});

test("forma per foto: se il layout attuale non permette la forma si passa a un layout che la permette, altrimenti resta", () => {
  for (const photos of [3, 4, 5]) {
    const base = album(photos, "fit");
    const id = base.spreads[0].id;
    const target = itemsOf(base)[0];
    const count = areaCandidates(base, base.spreads[0], 0, 24).length;
    let reached = 0;
    for (let k = 0; k < count; k += 1) {
      const start = applyCandidate(base, id, 0, k);
      const after = setItemView(start, target.id, { shape: 3 / 4 });
      const { cell } = placed(after);
      const ratio = cell.rect.w / cell.rect.h;
      if (Math.abs(ratio / 0.75 - 1) < SHAPE_SNAP) reached += 1;
      else assert.deepEqual(after.spreads[0].areas[0].layout !== null, true);
      assertProjectInvariants(after, `${photos} foto, layout ${k}`);
    }
    // se almeno un layout della foto la permette, da qualunque layout si parte si arriva a uno che la permette
    const possible = Array.from({ length: count }, (_, k) => {
      const probe = setItemView(applyCandidate(base, id, 0, k), target.id, { shape: 3 / 4 });
      return Math.abs(placed(probe).cell.rect.w / placed(probe).cell.rect.h / 0.75 - 1) < SHAPE_SNAP;
    }).some(Boolean);
    if (possible) assert.equal(reached, count, `${photos} foto: da ogni layout si arriva a uno con la forma`);
  }
});
