import { test } from "node:test";
import assert from "node:assert/strict";
import { describeSize, imageBox, placeItem } from "../model/placement";
import { addSpread } from "../model/spreads";
import { appendAssets, setItemView } from "../model/items";
import { setAreaStyle } from "../model/areas";
import { assertProjectInvariants, makeAsset, makeProject } from "../model/fixtures";
import { findSpread, itemAspect, type Project } from "../model/project";
import { renderSpreadSvg, spreadSizeWithBleedMm } from "./spread-svg";

const cell = { x: 10, y: 20, w: 200, h: 100 };
const item = { zoom: 1, cx: 0.5, cy: 0.5 };
const fill = { borderCm: 0, mode: "fill" as const, align: "center" as const };

test("posizionamento: con «riempi» la foto copre la cella senza deformarsi", () => {
  for (const asset of [makeAsset(0), makeAsset(1), makeAsset(5), makeAsset(7)]) {
    const placement = placeItem(cell, item, asset, fill);
    const image = placement.image;
    assert.ok(Math.abs(image.w / image.h - itemAspect(asset)) < 1e-6, `proporzioni di ${asset.id}`);
    assert.ok(image.x <= cell.x + 1e-6 && image.y <= cell.y + 1e-6 && image.x + image.w >= cell.x + cell.w - 1e-6 && image.y + image.h >= cell.y + cell.h - 1e-6, "la foto copre tutta la cella");
  }
});

test("posizionamento: zoom ingrandisce, il centro sposta e non si esce mai dall'immagine", () => {
  const asset = makeAsset(0); // 3:2
  const base = placeItem(cell, item, asset, fill).image;
  const zoomed = placeItem(cell, { zoom: 2, cx: 0.5, cy: 0.5 }, asset, fill).image;
  assert.ok(Math.abs(zoomed.w - base.w * 2) < 1e-6);
  const edge = placeItem(cell, { zoom: 2, cx: 5, cy: -5 }, asset, fill);
  assert.ok(edge.image.x <= cell.x + 1e-6 && edge.image.x + edge.image.w >= cell.x + cell.w - 1e-6, "il bordo dell'immagine non entra mai nella cella");
  assert.ok(edge.crop.cropLeft >= 0 && edge.crop.cropLeft + edge.crop.cropWidth <= 1 + 1e-9);
  const moved = placeItem(cell, { zoom: 2, cx: 0.8, cy: 0.5 }, asset, fill).image;
  assert.ok(moved.x < zoomed.x, "il centro a destra sposta l'immagine a sinistra");
  const live = placeItem(cell, item, asset, fill, { zoom: 3 });
  assert.ok(live.image.w > zoomed.w, "la vista provvisoria ha la precedenza");
});

test("posizionamento: «adatta» mostra la foto intera e l'allineamento ne decide la posizione", () => {
  const asset = makeAsset(1); // verticale in una cella larga: spazio ai lati
  const style = (align: "start" | "center" | "end") => ({ borderCm: 0, mode: "fit" as const, align });
  const start = placeItem(cell, item, asset, style("start")).image;
  const center = placeItem(cell, item, asset, style("center")).image;
  const end = placeItem(cell, item, asset, style("end")).image;
  assert.ok(Math.abs(start.h - cell.h) < 1e-6, "occupa tutta l'altezza");
  assert.ok(Math.abs(start.x - cell.x) < 1e-6);
  assert.ok(Math.abs(center.x - (cell.x + (cell.w - center.w) / 2)) < 1e-6);
  assert.ok(Math.abs(end.x + end.w - (cell.x + cell.w)) < 1e-6);
  const wide = placeItem({ x: 0, y: 0, w: 100, h: 200 }, item, makeAsset(0), style("end")).image;
  assert.ok(Math.abs(wide.y + wide.h - 200) < 1e-6, "in una cella alta l'allineamento è verticale");
  assert.deepEqual(placeItem(cell, item, asset, style("center")).crop, { cropLeft: 0, cropTop: 0, cropWidth: 1, cropHeight: 1 });
});

test("posizionamento: il bordo restringe il contenuto e non supera un quarto della cella", () => {
  const placement = placeItem(cell, item, makeAsset(0), { borderCm: 0.5, mode: "fill", align: "center" });
  assert.equal(placement.borderMm, 5);
  assert.deepEqual(placement.content, { x: 15, y: 25, w: 190, h: 90 });
  assert.equal(placeItem(cell, item, makeAsset(0), { borderCm: 10, mode: "fill", align: "center" }).borderMm, 25, "limite: un quarto del lato corto");
  assert.ok(placeItem({ x: 0, y: 0, w: 2, h: 2 }, item, makeAsset(0), { borderCm: 1, mode: "fill", align: "center" }).content.w > 0);
});

test("posizionamento: risoluzione effettiva coerente con la cella e con le misure reali", () => {
  const asset = makeAsset(0, { width: 3000, height: 2000, aspectRatio: 1.5 });
  const big = placeItem({ x: 0, y: 0, w: 254, h: 254 }, item, asset, fill);
  assert.ok(Math.abs(big.dpi - 200) < 1, `dpi ${big.dpi}: 2000 px visibili su 10 pollici`);
  assert.ok(placeItem({ x: 0, y: 0, w: 50, h: 50 }, item, asset, fill).dpi > big.dpi);
  assert.equal(placeItem(cell, item, undefined, fill).dpi, Infinity);
});

test("rotazione: l'elemento ruotato ha dimensioni scambiate e stesso centro", () => {
  const container = { x: 0, y: 0, w: 100, h: 100 };
  const straight = imageBox(container, { x: 10, y: 20, w: 60, h: 40 }, 0);
  assert.deepEqual([straight.left, straight.top, straight.width, straight.height, straight.rotate], [10, 20, 60, 40, 0]);
  const turned = imageBox(container, { x: 10, y: 20, w: 60, h: 40 }, 90);
  assert.equal(turned.rotate, 90);
  assert.equal(turned.width, 40);
  assert.equal(turned.height, 60);
  assert.ok(Math.abs(turned.left + turned.width / 2 - 40) < 1e-9 && Math.abs(turned.top + turned.height / 2 - 40) < 1e-9, "stesso centro");
  assert.equal(imageBox(container, { x: 0, y: 0, w: 10, h: 10 }, -90).rotate, 270);
  assert.equal(imageBox(container, { x: 0, y: 0, w: 10, h: 10 }, 450).rotate, 90);
  assert.equal(itemAspect(makeAsset(0, { rotationDegrees: 90 })), 1 / 1.5, "una foto ruotata di 90° scambia le proporzioni");
});

// ------------------------------------------------------------------ SVG

function built(split: "half" | "full" = "half", photos = 3): Project {
  let project = addSpread(makeProject(photos + 2), 0, split);
  const id = project.spreads[0].id;
  project = appendAssets(project, id, 0, Array.from({ length: photos }, (_, i) => `a${i}`));
  if (split === "half") project = appendAssets(project, id, 1, [`a${photos}`]);
  const withImages = { ...project, assets: project.assets.map((asset) => ({ ...asset, previewUrl: `data:image/jpeg;base64,AAAA${asset.id}` })) };
  assertProjectInvariants(withImages, "svg");
  return withImages;
}

test("SVG: spread con abbondanza, sfondi fino al bordo e una cornice di ritaglio per foto", () => {
  const project = built();
  const spread = project.spreads[0];
  const svg = renderSpreadSvg(project, spread, undefined, { forPrint: true });
  assert.match(svg, /viewBox="-3 -3 606 306"/);
  assert.match(svg, /width="606mm" height="306mm"/);
  assert.equal(svg.match(/<clipPath/g)?.length, 4);
  assert.equal(svg.match(/<image /g)?.length, 4);
  const backgrounds = svg.match(/<rect x="[^"]+" y="-3"[^>]+fill="#ffffff"\/>/g) ?? [];
  assert.equal(backgrounds.length, 2, "uno sfondo per area");
  assert.ok(backgrounds[0].includes('x="-3"') && backgrounds[1].includes('width="303"'), "gli sfondi esterni arrivano fino all'abbondanza");
  assert.equal(spreadSizeWithBleedMm(project).width, 606);
  assert.ok(!svg.includes("data-safe-area") && !svg.includes("data-fold"), "niente guide in stampa");
});

test("SVG: guide di anteprima, stile per area, bordo, bianco e nero e fogli interi", () => {
  let project = built();
  const id = project.spreads[0].id;
  project = setAreaStyle(project, id, 0, { background: "#101010", borderCm: 0.3, borderColor: "#ff0000", mono: true });
  project = setAreaStyle(project, id, 1, { background: "#eeeeee" });
  const svg = renderSpreadSvg(project, project.spreads[0], undefined, { showGuides: true });
  assert.equal(svg.match(/data-safe-area/g)?.length, 2);
  assert.ok(svg.includes("data-fold"));
  assert.ok(svg.includes('fill="#101010"') && svg.includes('fill="#eeeeee"'));
  assert.ok(svg.includes('fill="#ff0000"'), "cornice del bordo");
  assert.ok(svg.includes('<filter id="mono"') && svg.includes('filter="url(#mono)"'));
  assert.equal(svg.match(/filter="url\(#mono\)"/g)?.length, 3, "solo le foto dell'area in bianco e nero");
  const plain = renderSpreadSvg(built(), built().spreads[0], undefined, { forPrint: true });
  assert.ok(!plain.includes("mono"), "nessun filtro se nessuna area è in bianco e nero");

  const full = built("full", 2);
  const fullSvg = renderSpreadSvg(full, full.spreads[0], undefined, { forPrint: true });
  assert.equal(fullSvg.match(/<rect x="-3" y="-3" width="606"/g)?.length, 1, "un solo sfondo che copre l'intero foglio e l'abbondanza");
});

test("SVG: foto ruotate, segnaposto senza immagine e immagini non incorporate escluse dalla stampa", () => {
  let project = built("half", 2);
  project = { ...project, assets: project.assets.map((asset) => (asset.id === "a0" ? { ...asset, rotationDegrees: 90 as const } : asset)) };
  const svg = renderSpreadSvg(project, project.spreads[0], undefined, { forPrint: true });
  assert.match(svg, /transform="rotate\(90 /);

  const noImage = { ...project, assets: project.assets.map((asset) => ({ ...asset, previewUrl: undefined })) };
  const placeholder = renderSpreadSvg(noImage, noImage.spreads[0], undefined, { forPrint: true });
  assert.ok(!placeholder.includes("<image"));
  assert.ok(placeholder.includes('fill="#d8d2c6"'));

  const blob = { ...project, assets: project.assets.map((asset) => ({ ...asset, previewUrl: "blob:http://x/1" })) };
  assert.ok(!renderSpreadSvg(blob, blob.spreads[0], undefined, { forPrint: true }).includes("blob:"), "in stampa solo data URL");
  assert.ok(renderSpreadSvg(blob, blob.spreads[0], undefined, { forPrint: false }).includes("blob:"), "in anteprima va bene");
});

test("SVG: valori speciali negli attributi vengono protetti e un formato non valido è rifiutato", () => {
  const project = built("half", 1);
  const hostile = { ...project, assets: project.assets.map((asset) => ({ ...asset, previewUrl: 'data:image/png;base64,"><script>x</script>' })) };
  const svg = renderSpreadSvg(hostile, hostile.spreads[0], undefined, { forPrint: true });
  assert.ok(!svg.includes("<script>"));
  assert.ok(svg.includes("&quot;&gt;&lt;script&gt;"));
  const broken = { ...project, settings: { ...project.settings, sheet: { ...project.settings.sheet, widthCm: Number.NaN } } };
  assert.throws(() => renderSpreadSvg(broken, project.spreads[0]), /non valide/);
  assert.ok(findSpread(project, project.spreads[0].id));
});

test("SVG: foto libere ruotate attorno al loro centro e disegnate dal livello più basso al più alto", () => {
  let project = makeProject(4);
  project = addSpread(project);
  const id = project.spreads[0].id;
  project = appendAssets(project, id, 0, ["a0", "a1", "a2"]);
  const area = project.spreads[0].areas[0];
  const ids = area.items.map((item) => item.id);
  const frames = [{ x: 0.02, y: 0.02, w: 0.9, h: 0.9, rotation: 0, z: 5 }, { x: 0.5, y: 0.5, w: 0.4, h: 0.4, rotation: 12, z: 1 }, { x: 0.1, y: 0.1, w: 0.3, h: 0.3, rotation: -8, z: 9 }];
  const free = { ...project, assets: project.assets.map((asset) => ({ ...asset, previewUrl: `data:image/jpeg;base64,AAAA${asset.id}` })), spreads: [{ ...project.spreads[0], areas: [{ ...area, free: Object.fromEntries(ids.map((itemId, i) => [itemId, frames[i]])) }, project.spreads[0].areas[1]] }] } as Project;
  assertProjectInvariants(free, "libero");
  const svg = renderSpreadSvg(free, free.spreads[0], undefined, { forPrint: true });
  assert.equal((svg.match(/<g transform="rotate\(/g) ?? []).length, 2, "solo le foto ruotate hanno una rotazione");
  assert.ok(svg.includes("rotate(12 ") && svg.includes("rotate(-8 "));
  const order = [...svg.matchAll(/base64,AAAA(a\d)/g)].map((m) => m[1]);
  assert.deepEqual(order, ["a1", "a0", "a2"], "dal livello 1 al 9: la foto con z più alto è l'ultima disegnata, cioè sopra");
});

test("misura di una foto: centimetri della parte visibile e giudizio sui dpi", () => {
  const rect = { x: 0, y: 0, w: 230, h: 300 };
  const make = (dpi: number) => describeSize({ content: rect, dpi });
  assert.deepEqual(make(300), { widthCm: 23, heightCm: 30, dpi: 300, level: "ok" });
  assert.equal(make(240).level, "ok");
  assert.equal(make(239.6).level, "warn");
  assert.equal(make(150).level, "warn");
  assert.equal(make(149).level, "bad");
  assert.equal(describeSize({ content: { x: 0, y: 0, w: 123.4, h: 87.65 }, dpi: Number.NaN }).level, "bad");
  assert.deepEqual([describeSize({ content: { x: 0, y: 0, w: 123.4, h: 87.65 }, dpi: 200 }).widthCm, describeSize({ content: { x: 0, y: 0, w: 123.4, h: 87.65 }, dpi: 200 }).heightCm], [12.3, 8.8]);
});

test("bordo con «foto intera»: sta attorno alla foto, non attorno all'intera cella", () => {
  const frame = { x: 0, y: 0, w: 200, h: 300 };
  const asset = makeAsset(0, { width: 6000, height: 4000, aspectRatio: 1.5, orientation: "horizontal" });   // orizzontale in una cella verticale
  const fit = placeItem(frame, { zoom: 1, cx: 0.5, cy: 0.5 }, asset, { borderCm: 0.5, mode: "fit", align: "center" });
  assert.deepEqual(fit.content, fit.image, "la parte visibile coincide con la foto");
  assert.ok(fit.content.h < frame.h - 2 * fit.borderMm, "la foto è più bassa della cella: ci sono bande vuote");
  assert.ok(Math.abs(fit.content.w / fit.content.h - 1.5) < 1e-6, "proporzioni intatte");
  assert.ok(fit.content.x - fit.borderMm >= frame.x - 1e-9 && fit.content.x + fit.content.w + fit.borderMm <= frame.x + frame.w + 1e-9, "il bordo resta dentro la cella");
  // «riempi»: invariato, il contenuto è la cella meno il bordo
  const fill = placeItem(frame, { zoom: 1, cx: 0.5, cy: 0.5 }, asset, { borderCm: 0.5, mode: "fill", align: "center" });
  assert.deepEqual(fill.content, { x: 5, y: 5, w: 190, h: 290 });
  // SVG: il rettangolo del bordo circonda la foto
  let project = addSpread(makeProject(1));
  project = appendAssets(project, project.spreads[0].id, 0, ["a0"]);
  project = setAreaStyle(project, project.spreads[0].id, 0, { mode: "fit", borderCm: 0.3, borderColor: "#112233" });
  const svg = renderSpreadSvg(project, project.spreads[0], undefined, { forPrint: true });
  const border = svg.match(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)" fill="#112233"\/>/)!;
  assert.ok(border, "rettangolo del bordo presente");
  const cellGeometry = project.spreads[0].areas[0].items.length;
  assert.equal(cellGeometry, 1);
  assert.ok(Number(border[3]) > 0 && Number(border[4]) > 0);
});

test("SVG: la foto raddrizzata ruota dentro un ritaglio che resta dritto", () => {
  let project = built();
  const id = project.spreads[0].id;
  project = setAreaStyle(project, id, 0, { mode: "fill" });
  const item = project.spreads[0].areas[0].items[0];
  const plain = renderSpreadSvg(project, project.spreads[0], undefined, { forPrint: true });
  assert.ok(!plain.includes("<g clip-path"), "senza inclinazione l'SVG non cambia");
  const tilted = setItemView(project, item.id, { angle: 6 });
  const svg = renderSpreadSvg(tilted, tilted.spreads[0], undefined, { forPrint: true });
  assert.equal(svg.match(/<g clip-path="url\(#c0-[^)]+\)"><g transform="rotate\(6 /g)?.length, 1);
  assert.equal(svg.match(/<image /g)?.length, plain.match(/<image /g)?.length);
});
