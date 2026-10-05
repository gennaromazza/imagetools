import assert from "node:assert/strict";
import type { AlbumAssetV2 } from "@photo-tools/shared-types";
import type { Rect } from "../engine/geometry";
import { leafIds, validateTree } from "../engine/tree";
import { parseAlbumProject, serializeAlbumProject } from "./portability";
import { areaGeometry, createEmptyProject, hasFreeLayout, type Project } from "./project";

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

function assertInside(inner: Rect, rect: Rect, label: string) {
  assert.ok(rect.x >= inner.x - EPS && rect.y >= inner.y - EPS && rect.x + rect.w <= inner.x + inner.w + EPS && rect.y + rect.h <= inner.y + inner.h + EPS, `${label}: cella fuori dall'area`);
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
      }
      const geometry = areaGeometry(project, spread, areaIndex);
      assert.equal(geometry.cells.length, area.items.length, `${where}: celle diverse dalle foto`);
      const overlapAllowed = hasFreeLayout(area);
      geometry.cells.forEach((cell, i) => {
        assert.ok(cell.rect.w > 0 && cell.rect.h > 0, `${where}: cella vuota`);
        assertInside(geometry.inner, cell.rect, where);
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
