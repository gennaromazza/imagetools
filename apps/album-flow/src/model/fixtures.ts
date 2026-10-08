import assert from "node:assert/strict";
import type { AlbumAssetV2 } from "@photo-tools/shared-types";
import type { Rect } from "../engine/geometry";
import { leafIds, validateTree } from "../engine/tree";
import { parseAlbumProject, serializeAlbumProject } from "./portability";
import { areaGeometry, createEmptyProject, hasFreeLayout, itemAspect, type Project } from "./project";
import { SHAPE_SNAP, placeItem } from "./placement";

/** Dati di prova e controlli di coerenza condivisi dai test del modello v2 (non usato dall'app). */

const SHAPES: ReadonlyArray<[number, number]> = [[6000, 4000], [4000, 6000], [6000, 4000], [6000, 4000], [4000, 6000], [6000, 6000], [4800, 6000], [6000, 3375], [4000, 6000], [6000, 4000]];
const BASE_TIME = Date.UTC(2026, 5, 5, 8, 0, 0);

export function makeAsset(index: number, overrides: Partial<AlbumAssetV2> = {}): AlbumAssetV2 {
  const [width, height] = SHAPES[index % SHAPES.length];
  return {
    id: `a${index}`,
    fileName: `DSC${String(1000 + index).padStart(5, "0")}.jpg`,
    path: `DSC${String(1000 + index).padStart(5, "0")}.jpg`,
    absolutePath: `C:\\Foto\\Rossi\\DSC${String(1000 + index).padStart(5, "0")}.jpg`,
    width,
    height,
    aspectRatio: width / height,
    orientation: width > height ? "horizontal" : width < height ? "vertical" : "square",
    rating: index % 6,
    captureTimeMs: BASE_TIME + index * 90_000,
    size: 8_000_000 + index,
    ...overrides,
  };
}

export function makeProject(photoCount: number, overrides: Partial<Project> = {}): Project {
  const base = createEmptyProject("Matrimonio Rossi");
  return { ...base, assets: Array.from({ length: photoCount }, (_, index) => makeAsset(index)), ...overrides };
}

const EPS = 1e-6;

/** Una foto di una disposizione libera può uscire in parte dall'area (come i testi), ma almeno un quarto per lato resta dentro (`sanitizeFrame`). */
function assertMostlyInside(inner: Rect, rect: Rect, label: string) {
  const insideW = Math.min(rect.x + rect.w, inner.x + inner.w) - Math.max(rect.x, inner.x);
  const insideH = Math.min(rect.y + rect.h, inner.y + inner.h) - Math.max(rect.y, inner.y);
  assert.ok(insideW >= rect.w * 0.25 - EPS && insideH >= rect.h * 0.25 - EPS, `${label}: cella quasi tutta fuori dall'area`);
}

function assertInside(inner: Rect, rect: Rect, label: string) {
  assert.ok(rect.x >= inner.x - EPS && rect.y >= inner.y - EPS && rect.x + rect.w <= inner.x + inner.w + EPS && rect.y + rect.h <= inner.y + inner.h + EPS, `${label}: cella fuori dall'area`);
}

/**
 * Regole che valgono per ogni foto di ogni progetto, qualunque sia la strada con cui ci si è arrivati: la parte visibile sta dentro la cella,
 * l'immagine la copre (anche raddrizzata) senza deformarsi, la risoluzione è quella vera, la forma scelta è rispettata e ingrandire o
 * raddrizzare di pochissimo non fa saltare la foto.
 */
export function assertPlacement(project: Project, style: Parameters<typeof placeItem>[3], cell: { rect: Rect; anchor?: { x: number; y: number } }, item: Project["spreads"][number]["areas"][number]["items"][number], where: string): void {
  const asset = project.assets.find((candidate) => candidate.id === item.assetId);
  const p = placeItem(cell.rect, item, asset, style, null, cell.anchor);
  assertInside(cell.rect, p.content, `${where} (parte visibile)`);
  assert.ok(p.content.w > 0 && p.content.h > 0, `${where}: parte visibile vuota`);
  // l'immagine copre la parte visibile anche inclinata
  const cx = p.content.x + p.content.w / 2;
  const cy = p.content.y + p.content.h / 2;
  const rad = (p.angle * Math.PI) / 180;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const dx = (sx * p.content.w) / 2;
    const dy = (sy * p.content.h) / 2;
    const x = cx + dx * Math.cos(rad) + dy * Math.sin(rad);
    const y = cy - dx * Math.sin(rad) + dy * Math.cos(rad);
    assert.ok(x >= p.image.x - 1e-3 && x <= p.image.x + p.image.w + 1e-3 && y >= p.image.y - 1e-3 && y <= p.image.y + p.image.h + 1e-3, `${where}: angolo vuoto (angolo ${p.angle}°, zoom ${p.zoom})`);
  }
  // nessuna deformazione
  assert.ok(Math.abs(p.image.w / p.image.h / itemAspect(asset) - 1) < 1e-6, `${where}: foto deformata`);
  // risoluzione vera
  if (asset && asset.width > 0 && asset.height > 0) {
    const widthPx = asset.rotationDegrees === 90 || asset.rotationDegrees === 270 ? asset.height : asset.width;
    assert.ok(Math.abs(p.dpi / (widthPx / (p.image.w / 25.4)) - 1) < 1e-6, `${where}: risoluzione non vera`);
  }
  // forma scelta: la finestra ha quella forma, oppure la cella la ha già quasi (la foto la riempie)
  if (item.shape) {
    const window = p.content.w / p.content.h;
    const cell = (p.frame.w - p.borderMm * 2) / (p.frame.h - p.borderMm * 2);
    assert.ok(Math.abs(window / item.shape - 1) < 1e-6 || (Math.abs(cell / item.shape - 1) < SHAPE_SNAP && Math.abs(window / cell - 1) < 1e-6), `${where}: la forma ${item.shape} non è rispettata (finestra ${window})`);
  }
  // continuità: un piccolo zoom o un piccolo raddrizzamento non cambiano la finestra
  const near = (a: Rect, b: Rect) => ["x", "y", "w", "h"].every((key) => Math.abs(a[key as keyof Rect] - b[key as keyof Rect]) < 1e-2);
  if (item.zoom < 5.99) assert.ok(near(p.content, placeItem(cell.rect, { ...item, zoom: item.zoom + 1e-4 }, asset, style, null, cell.anchor).content), `${where}: la foto salta cambiando di pochissimo lo zoom`);
  if (!item.angle) assert.ok(near(p.content, placeItem(cell.rect, { ...item, angle: 0.01 }, asset, style, null, cell.anchor).content), `${where}: la foto salta raddrizzando di pochissimo`);
}

/** Invarianti che devono valere dopo QUALSIASI operazione: identificativi, alberi, geometria, riferimenti, salvataggio. */
export function assertProjectInvariants(project: Project, label = ""): void {
  const assetIds = new Set(project.assets.map((asset) => asset.id));
  assert.equal(assetIds.size, project.assets.length, `${label}: foto duplicate`);
  if (project.coverAssetId !== undefined) assert.ok(assetIds.has(project.coverAssetId), `${label}: la copertina punta a una foto che non esiste`);
  const spreadIds = new Set<string>();
  const areaIds = new Set<string>();
  const itemIds = new Set<string>();
  project.spreads.forEach((spread, spreadIndex) => {
    const at = `${label} spread ${spreadIndex + 1}`;
    assert.ok(!spreadIds.has(spread.id), `${at}: id spread duplicato`);
    spreadIds.add(spread.id);
    assert.equal(spread.areas.length, spread.split === "full" ? 1 : 2, `${at}: aree incoerenti con la divisione`);
    spread.areas.forEach((area, areaIndex) => {
      const where = `${at} area ${areaIndex + 1}`;
      assert.ok(!areaIds.has(area.id), `${where}: id area duplicato`);
      areaIds.add(area.id);
      const ids = area.items.map((item) => item.id);
      for (const id of ids) { assert.ok(!itemIds.has(id), `${where}: elemento duplicato`); itemIds.add(id); }
      assert.deepEqual(leafIds(area.layout), ids, `${where}: ordine delle foto diverso dall'ordine delle foglie`);
      assert.deepEqual(validateTree(area.layout, ids), [], `${where}: albero non valido`);
      assert.equal(area.layout === null, area.items.length === 0, `${where}: layout presente solo se ci sono foto`);
      for (const item of area.items) {
        assert.ok(assetIds.has(item.assetId), `${where}: foto inesistente`);
        assert.ok(item.zoom >= 1 && item.zoom <= 6, `${where}: zoom fuori limite`);
        assert.ok(item.cx >= 0 && item.cx <= 1 && item.cy >= 0 && item.cy <= 1, `${where}: centro fuori limite`);
        if (item.shape !== undefined) assert.ok(item.shape >= 0.2 && item.shape <= 5, `${where}: forma fuori limite`);
        if (item.borderCm !== undefined) assert.ok(item.borderCm >= 0 && item.borderCm <= 1.5, `${where}: bordo della foto fuori limite`);
      }
      const geometry = areaGeometry(project, spread, areaIndex);
      assert.equal(geometry.cells.length, area.items.length, `${where}: celle diverse dalle foto`);
      const overlapAllowed = hasFreeLayout(area);
      geometry.cells.forEach((cell, i) => {
        assert.ok(cell.rect.w > 0 && cell.rect.h > 0, `${where}: cella vuota`);
        if (overlapAllowed) assertMostlyInside(geometry.inner, cell.rect, where);
        else assertInside(geometry.inner, cell.rect, where);
        const item = area.items.find((candidate) => candidate.id === cell.itemId)!;
        assertPlacement(project, area.style, cell, item, `${where} foto ${i + 1}`);
        for (let j = i + 1; !overlapAllowed && j < geometry.cells.length; j += 1) {
          const other = geometry.cells[j].rect;
          const overlapX = Math.min(cell.rect.x + cell.rect.w, other.x + other.w) - Math.max(cell.rect.x, other.x);
          const overlapY = Math.min(cell.rect.y + cell.rect.h, other.y + other.h) - Math.max(cell.rect.y, other.y);
          assert.ok(!(overlapX > EPS && overlapY > EPS), `${where}: celle sovrapposte`);
        }
      });
    });
  });
  const assigned = new Set<string>();
  for (const chapter of project.chapters) {
    for (const id of chapter.assetIds) {
      assert.ok(assetIds.has(id), `${label}: capitolo con foto inesistente`);
      assert.ok(!assigned.has(id), `${label}: foto in più capitoli`);
      assigned.add(id);
    }
  }
  // Il salvataggio deve essere fedele.
  assert.deepEqual(parseAlbumProject(serializeAlbumProject(project)), JSON.parse(JSON.stringify(project)), `${label}: salvataggio non fedele`);
}
