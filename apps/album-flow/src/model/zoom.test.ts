import { test } from "node:test";
import assert from "node:assert/strict";
import { SHAPE_PRESETS } from "./shapes";
import { placeItem, clampAngle, nextWheelZoom, wheelNotches, type Placement } from "./placement";
import { appendAssets, resetItemView, setItemView } from "./items";
import { addSpread } from "./spreads";
import { setAreaStyle, setDividerRatio } from "./areas";
import { assertProjectInvariants, makeAsset, makeProject } from "./fixtures";
import { spreadGeometry, type Project } from "./project";

import type { Rect } from "../engine/geometry";

// Audit mirato: rapporto tra zoom, raddrizzamento, forma e dimensione della cella. Casi casuali ma ripetibili.

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

interface Case {
  frame: Rect;
  item: { zoom: number; cx: number; cy: number; angle?: number; shape?: number };
  asset: ReturnType<typeof makeAsset>;
  style: { borderCm: number; mode: "fit" | "fill"; align: "start" | "center" | "end" };
  anchor?: { x: number; y: number };
}

function randomCase(random: () => number): Case {
  const mode = random() < 0.5 ? "fit" : "fill";
  return {
    frame: { x: random() * 100, y: random() * 100, w: 30 + random() * 300, h: 30 + random() * 300 },
    item: {
      zoom: random() < 0.3 ? 1 : 1 + random() * 5,
      cx: random(),
      cy: random(),
      ...(random() < 0.4 ? { angle: (random() - 0.5) * 60 } : {}),
      ...(random() < 0.3 ? { shape: SHAPE_PRESETS[Math.floor(random() * SHAPE_PRESETS.length)].ratio } : {}),
    },
    asset: makeAsset(Math.floor(random() * 10), random() < 0.2 ? { rotationDegrees: 90 as const } : {}),
    style: { borderCm: random() < 0.4 ? random() * 0.4 : 0, mode, align: (["start", "center", "end"] as const)[Math.floor(random() * 3)] },
    anchor: random() < 0.5 ? { x: [0, 0.5, 1][Math.floor(random() * 3)], y: [0, 0.5, 1][Math.floor(random() * 3)] } : undefined,
  };
}

const place = (c: Case, override: Partial<Case["item"]> = {}) => placeItem(c.frame, { ...c.item, ...override }, c.asset, c.style, null, c.anchor);
const EPS = 1e-6;

const inside = (inner: Rect, outer: Rect, eps = EPS) => inner.x >= outer.x - eps && inner.y >= outer.y - eps && inner.x + inner.w <= outer.x + outer.w + eps && inner.y + inner.h <= outer.y + outer.h + eps;

test("audit zoom — la parte visibile sta sempre dentro la cella e il bordo la lascia intatta", () => {
  const random = rng(1);
  for (let i = 0; i < 2000; i += 1) {
    const c = randomCase(random);
    const p = place(c);
    assert.ok(inside(p.content, p.frame), `caso ${i}: la parte visibile esce dalla cella`);
    assert.ok(p.content.w > 0 && p.content.h > 0 && Number.isFinite(p.dpi) || p.dpi === Infinity, `caso ${i}: misure non valide`);
  }
});

test("audit zoom — l'immagine copre sempre la parte visibile, anche raddrizzata (nessun angolo vuoto)", () => {
  const random = rng(2);
  for (let i = 0; i < 3000; i += 1) {
    const c = randomCase(random);
    const p = place(c);
    const cx = p.content.x + p.content.w / 2;
    const cy = p.content.y + p.content.h / 2;
    const rad = (p.angle * Math.PI) / 180;
    // gli angoli della parte visibile, riportati nel riferimento dell'immagine (che ruota di `angle` attorno al centro)
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const dx = (sx * p.content.w) / 2;
      const dy = (sy * p.content.h) / 2;
      const x = cx + dx * Math.cos(rad) + dy * Math.sin(rad);
      const y = cy - dx * Math.sin(rad) + dy * Math.cos(rad);
      assert.ok(x >= p.image.x - 1e-4 && x <= p.image.x + p.image.w + 1e-4 && y >= p.image.y - 1e-4 && y <= p.image.y + p.image.h + 1e-4,
        `caso ${i}: angolo (${sx},${sy}) fuori dall'immagine (angolo ${p.angle}°, zoom ${p.zoom})`);
    }
  }
});

test("audit zoom — ritaglio, immagine e parte visibile sono coerenti tra loro (senza raddrizzamento)", () => {
  const random = rng(3);
  for (let i = 0; i < 3000; i += 1) {
    const c = randomCase(random);
    c.item.angle = undefined;
    const p = place(c);
    assert.ok(Math.abs(p.content.w / p.image.w - p.crop.cropWidth) < 1e-6, `caso ${i}: larghezza del ritaglio ${p.crop.cropWidth} ≠ ${p.content.w / p.image.w}`);
    assert.ok(Math.abs(p.content.h / p.image.h - p.crop.cropHeight) < 1e-6, `caso ${i}: altezza del ritaglio`);
    assert.ok(p.crop.cropLeft >= -EPS && p.crop.cropTop >= -EPS && p.crop.cropLeft + p.crop.cropWidth <= 1 + EPS && p.crop.cropTop + p.crop.cropHeight <= 1 + EPS, `caso ${i}: ritaglio fuori dall'immagine`);
    // nessuna deformazione: il rettangolo d'immagine ha le proporzioni della foto
    const turned = c.asset.rotationDegrees === 90 || c.asset.rotationDegrees === 270;
    const aspect = turned ? c.asset.height / c.asset.width : c.asset.width / c.asset.height;
    assert.ok(Math.abs(p.image.w / p.image.h / aspect - 1) < 1e-6, `caso ${i}: foto deformata`);
  }
});

test("audit zoom — ingrandendo la parte visibile non cambia di colpo (continuità) e il ritaglio non cresce mai", () => {
  const random = rng(4);
  for (let i = 0; i < 3000; i += 1) {
    const c = randomCase(random);
    c.item.angle = undefined;
    const a = place(c, { zoom: 1 });
    const b = place(c, { zoom: 1.0001 });
    const sameWindow = (["x", "y", "w", "h"] as const).every((key) => Math.abs(a.content[key] - b.content[key]) < 1e-2);
    assert.ok(sameWindow, `caso ${i} (${c.style.mode}, forma ${c.item.shape ?? "nessuna"}): da zoom 1 a 1,0001 la foto salta da ${JSON.stringify(a.content)} a ${JSON.stringify(b.content)}`);
    let previous = Infinity;
    for (const zoom of [1, 1.3, 2, 3.5, 6]) {
      const p = place(c, { zoom });
      const area = p.crop.cropWidth * p.crop.cropHeight;
      assert.ok(area <= previous + 1e-9, `caso ${i}: lo zoom ${zoom} mostra più immagine del precedente`);
      previous = area;
    }
  }
});

test("audit zoom — la risoluzione effettiva è quella vera dell'immagine anche raddrizzata, e scende ingrandendo", () => {
  const random = rng(5);
  for (let i = 0; i < 3000; i += 1) {
    const c = randomCase(random);
    const p = place(c);
    const turned = c.asset.rotationDegrees === 90 || c.asset.rotationDegrees === 270;
    const widthPx = turned ? c.asset.height : c.asset.width;
    const real = widthPx / (p.image.w / 25.4);
    assert.ok(Math.abs(p.dpi / real - 1) < 1e-6, `caso ${i}: dpi ${p.dpi.toFixed(1)} ≠ reali ${real.toFixed(1)} (angolo ${p.angle}°)`);
  }
  const base = randomCase(rng(55));
  base.item.angle = undefined;
  let last = Infinity;
  for (const zoom of [1, 1.5, 2, 3, 6]) {
    const dpi = place(base, { zoom }).dpi;
    assert.ok(dpi <= last + 1e-9, "ingrandendo la risoluzione non può salire");
    last = dpi;
  }
});

test("audit zoom — ridimensionare la cella senza cambiarne la forma lascia identico il ritaglio (lo zoom non dipende dalla misura)", () => {
  const random = rng(6);
  for (let i = 0; i < 1500; i += 1) {
    const c = randomCase(random);
    const k = 0.3 + random() * 3;
    const p = place(c);
    const scaled = placeItem({ x: c.frame.x * k, y: c.frame.y * k, w: c.frame.w * k, h: c.frame.h * k }, c.item, c.asset, { ...c.style, borderCm: 0 }, null, c.anchor);
    const reference = placeItem(c.frame, c.item, c.asset, { ...c.style, borderCm: 0 }, null, c.anchor);
    for (const key of ["cropLeft", "cropTop", "cropWidth", "cropHeight"] as const) {
      assert.ok(Math.abs(scaled.crop[key] - reference.crop[key]) < 1e-6, `caso ${i}: ${key} cambia con la misura (${scaled.crop[key]} vs ${reference.crop[key]})`);
    }
    assert.ok(Math.abs(scaled.zoom - reference.zoom) < 1e-6);
    assert.ok(p.content.w > 0);
  }
});

test("audit zoom — gli angoli oltre i limiti si riportano nell'intervallo e a zero spariscono", () => {
  assert.equal(clampAngle(99), 45);
  assert.equal(clampAngle(-99), -45);
  assert.equal(clampAngle(0.004), 0);
  assert.equal(clampAngle(Number.NaN), 0);
  assert.equal(clampAngle(undefined), 0);
});

function album(photos = 3, mode: "fit" | "fill" = "fill"): Project {
  let project = addSpread(makeProject(photos + 2), 0, "half");
  const id = project.spreads[0].id;
  project = appendAssets(project, id, 0, Array.from({ length: photos }, (_, i) => `a${i}`));
  return setAreaStyle(project, id, 0, { mode });
}
const itemsOf = (project: Project) => project.spreads[0].areas[0].items;
const placed = (project: Project, index = 0): Placement => {
  const area = project.spreads[0].areas[0];
  const item = area.items[index];
  const cell = spreadGeometry(project, project.spreads[0])[0].cells.find((candidate) => candidate.itemId === item.id)!;
  return placeItem(cell.rect, item, project.assets.find((asset) => asset.id === item.assetId), area.style, null, cell.anchor);
};

test("audit zoom — «Foto intera»: una foto verticale in una cella larga non salta a riempirla ingrandendo o raddrizzando di poco", () => {
  const asset = makeAsset(1); // verticale 4000x6000
  const style = { borderCm: 0, mode: "fit" as const, align: "center" as const };
  const wide = { x: 0, y: 0, w: 288, h: 120 };
  const whole = placeItem(wide, { zoom: 1, cx: 0.5, cy: 0.5 }, asset, style, null);
  assert.ok(whole.content.w < 100, "intera: solo la parte che la foto occupa davvero");
  const zoomed = placeItem(wide, { zoom: 1.1, cx: 0.5, cy: 0.5 }, asset, style, null);
  assert.deepEqual(zoomed.content, whole.content, "zoom 1,1: la finestra non cambia, cambia solo l'immagine dentro");
  assert.ok(zoomed.crop.cropWidth < 1 && zoomed.crop.cropHeight < 1, "e l'immagine è ingrandita");
  const turned = placeItem(wide, { zoom: 1, cx: 0.5, cy: 0.5, angle: 2 }, asset, style, null);
  assert.deepEqual(turned.content, whole.content, "raddrizzare non cambia la finestra");
  assert.ok(turned.zoom > 1, "si ingrandisce da sola quanto serve a coprirla");
  // la risoluzione scende in modo continuo ingrandendo
  assert.ok(zoomed.dpi < whole.dpi && zoomed.dpi > whole.dpi / 1.2);
});

test("audit zoom — la rotella: si ingrandisce da ciò che si vede, si riduce dallo zoom salvato, e restano nei limiti", () => {
  assert.ok(Math.abs(nextWheelZoom(1, 1, true) - 1.1) < 1e-12);
  assert.equal(nextWheelZoom(1, 1, false), 1, "sotto 1 non si scende");
  assert.ok(Math.abs(nextWheelZoom(2, 2, false) - 2 / 1.1) < 1e-12);
  assert.ok(Math.abs(nextWheelZoom(1, 1.4, true) - 1.54) < 1e-12, "raddrizzata: ingrandire parte dallo zoom applicato (1,4)");
  assert.equal(nextWheelZoom(1, 1.4, false), 1, "raddrizzata: ridurre non gonfia lo zoom salvato");
  assert.equal(nextWheelZoom(6, 6, true), 6, "oltre il massimo non si va");
  // andata e ritorno senza raddrizzamento: stesso zoom
  let zoom = 1;
  for (let i = 0; i < 12; i += 1) zoom = nextWheelZoom(zoom, zoom, true);
  for (let i = 0; i < 12; i += 1) zoom = nextWheelZoom(zoom, zoom, false);
  assert.ok(Math.abs(zoom - 1) < 1e-9);
});

test("audit zoom — raddrizzare e tornare a 0° rimette la foto esattamente dov'era (zoom e centro salvati non cambiano)", () => {
  for (const mode of ["fill", "fit"] as const) {
    let project = album(3, mode);
    const id = itemsOf(project)[0].id;
    project = setItemView(project, id, { zoom: 2.5, cx: 0.97, cy: 0.04 });
    const before = { ...itemsOf(project)[0] };
    for (const angle of [3, 17, -25, 44]) {
      const tilted = setItemView(project, id, { angle });
      assert.equal(itemsOf(tilted)[0].zoom, before.zoom, `${mode} ${angle}°: lo zoom salvato non cambia`);
      assert.equal(itemsOf(tilted)[0].cx, before.cx, `${mode} ${angle}°: il centro salvato non cambia`);
      assert.equal(itemsOf(tilted)[0].cy, before.cy);
      const back = setItemView(tilted, id, { angle: 0 });
      assert.deepEqual({ ...itemsOf(back)[0] }, before, `${mode}: tornando a 0° da ${angle}° la foto è come prima`);
      assertProjectInvariants(tilted, `${mode} ${angle}°`);
    }
  }
});

test("audit zoom — ridimensionare le celle, cambiare modo o stile non tocca zoom e centro salvati e la foto resta valida", () => {
  let project = album(4, "fill");
  const id = project.spreads[0].id;
  const target = itemsOf(project)[1];
  project = setItemView(project, target.id, { zoom: 3, cx: 0.2, cy: 0.7, angle: 5 });
  const saved = { zoom: 3, cx: itemsOf(project)[1].cx, cy: itemsOf(project)[1].cy, angle: 5 };
  const check = (p: Project, label: string) => {
    const item = itemsOf(p).find((candidate) => candidate.id === target.id)!;
    assert.deepEqual({ zoom: item.zoom, cx: item.cx, cy: item.cy, angle: item.angle }, saved, `${label}: zoom e centro salvati cambiati`);
    assertProjectInvariants(p, label);
  };
  const dividerPath = spreadGeometry(project, project.spreads[0])[0].dividers[0].path;
  for (const ratio of [0.2, 0.35, 0.5, 0.65, 0.8]) check(setDividerRatio(project, id, 0, dividerPath, ratio), `separatore ${ratio}`);
  check(setAreaStyle(project, id, 0, { mode: "fit" }), "«foto intera»");
  check(setAreaStyle(setAreaStyle(project, id, 0, { mode: "fit" }), id, 0, { mode: "fill" }), "avanti e indietro");
  for (const borderCm of [0, 0.3, 1.5]) check(setAreaStyle(project, id, 0, { borderCm }), `bordo ${borderCm}`);
  for (const gapCm of [0, 0.5, 2]) check(setAreaStyle(project, id, 0, { gapCm }), `spazio ${gapCm}`);
});

test("audit zoom — «Ripristina» riporta zoom, centro, raddrizzamento e forma ai valori iniziali in ogni modo", () => {
  for (const mode of ["fill", "fit"] as const) {
    let project = album(3, mode);
    const target = itemsOf(project)[0];
    project = setItemView(project, target.id, { zoom: 4, cx: 0.9, cy: 0.1, angle: 9, shape: 1 });
    const reset = resetItemView(project, target.id);
    const item = itemsOf(reset)[0];
    assert.equal(item.zoom, 1);
    assert.equal(item.angle, undefined);
    assert.equal(item.shape, undefined);
    assert.ok(Math.abs(item.cx - 0.5) < 1e-9 && Math.abs(item.cy - 0.5) < 1e-9);
    assert.ok(placed(reset).crop.cropWidth >= 0.999 || placed(reset).crop.cropHeight >= 0.999, "senza zoom si vede tutta una dimensione dell'immagine");
    assertProjectInvariants(reset, `ripristina ${mode}`);
  }
});

test("audit zoom — 500 sequenze casuali di zoom, raddrizzamento, forma e spostamento mantengono sempre le regole del posizionamento", () => {
  const random = rng(77);
  for (let run = 0; run < 25; run += 1) {
    let project = album(2 + Math.floor(random() * 4), random() < 0.5 ? "fit" : "fill");
    const id = project.spreads[0].id;
    project = setAreaStyle(project, id, 0, { borderCm: random() < 0.5 ? 0 : random() * 0.5, gapCm: random() * 0.8 });
    for (let step = 0; step < 20; step += 1) {
      const items = itemsOf(project);
      const item = items[Math.floor(random() * items.length)];
      const kind = Math.floor(random() * 6);
      if (kind === 0) project = setItemView(project, item.id, { zoom: 1 + random() * 5 });
      else if (kind === 1) project = setItemView(project, item.id, { angle: (random() - 0.5) * 100 });
      else if (kind === 2) project = setItemView(project, item.id, { cx: random(), cy: random() });
      else if (kind === 3) project = setItemView(project, item.id, { shape: random() < 0.3 ? null : SHAPE_PRESETS[Math.floor(random() * SHAPE_PRESETS.length)].ratio });
      else if (kind === 4) project = setAreaStyle(project, id, 0, { mode: random() < 0.5 ? "fit" : "fill" });
      else project = resetItemView(project, item.id);
      assertProjectInvariants(project, `sequenza ${run}.${step}`);
    }
  }
});

test("audit zoom — touchpad e rotelle a scorrimento fluido: tanti piccoli eventi valgono quanto uno scatto, uno scatto classico vale 1", () => {
  assert.equal(wheelNotches(100), 1);
  assert.equal(wheelNotches(-120), 1, "oltre lo scatto classico non si accelera");
  assert.equal(wheelNotches(0), 1, "evento senza spostamento: uno scatto");
  assert.equal(wheelNotches(Number.NaN), 1);
  assert.ok(Math.abs(wheelNotches(10) - 0.1) < 1e-12);
  assert.equal(wheelNotches(1), 0.05, "gli eventi minuscoli hanno un minimo");
  // dieci eventi da 10 danno lo stesso zoom di uno scatto da 100
  let fine = 1;
  for (let i = 0; i < 10; i += 1) fine = nextWheelZoom(fine, fine, true, wheelNotches(10));
  assert.ok(Math.abs(fine - nextWheelZoom(1, 1, true, wheelNotches(100))) < 1e-9);
  // e in senso opposto si torna al punto di partenza
  let back = fine;
  for (let i = 0; i < 10; i += 1) back = nextWheelZoom(back, back, false, wheelNotches(10));
  assert.ok(Math.abs(back - 1) < 1e-9);
});
