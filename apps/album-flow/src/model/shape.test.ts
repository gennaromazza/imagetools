import { test } from "node:test";
import assert from "node:assert/strict";
import { appendAssets, resetItemView, setItemView, swapItems } from "./items";
import { addSpread } from "./spreads";
import { setAreaStyle } from "./areas";
import { itemAspect, spreadGeometry, type Project } from "./project";
import { assertProjectInvariants, makeProject } from "./fixtures";
import { placeItem } from "./placement";
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
      assert.ok(Math.abs(ratio / preset.ratio - 1) < 1e-4, `${preset.id}: rapporto ${ratio}`);
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
