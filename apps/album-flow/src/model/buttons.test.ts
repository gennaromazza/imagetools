import { test } from "node:test";
import assert from "node:assert/strict";
import type { AlbumSplitMode } from "@photo-tools/shared-types";
import { mulberry32 } from "../engine/rng";
import { alignFitAreas, applyCandidate, applyCandidateByNumber, applyStyleToSpread, layoutChoices, mirrorArea, setAreaStyle, setLinked, shuffleArea, shuffleSpread } from "./areas";
import { alignArea, appendAssets, removeItem, resetItemView, setItemBorder, setItemView, toggleItemLock } from "./items";
import { makeAreaFree, restoreAutomatic, setAreaLocked } from "./layoutLock";
import { rotateAssetQuarter } from "./library";
import { MAX_ZOOM } from "./defaults";
import { assertProjectInvariants, makeAsset, makeProject } from "./fixtures";
import { areaGeometry, hasFreeLayout, placementStyle, type Project } from "./project";
import { placeItem } from "./placement";
import { SHAPE_PRESETS } from "./shapes";
import { addSpread, clearSpread, setSpreadDone, setSplitMode, splitRefusal, swapAreas } from "./spreads";
import { baseCrop } from "../slot-geometry";

/**
 * Prova di tutti i pulsanti di uno spread e delle loro combinazioni: strisce laterali (Mescola, Layout, Spazio, Margine, Bordo, Modo,
 * Allinea, Dividi, Collega, Scambia), barra della foto (ritaglio, forma, rotazione, bordo, blocco, elimina), barra inferiore (Mescola
 * lo spread, B/N, Svuota, Finito, Specchia) e layout proposti (tasti 1-9).
 *
 * Contratti verificati dopo ogni azione:
 *  1. gli invarianti del progetto (nessuna foto deformata, celle che non si sovrappongono, salvataggio fedele);
 *  2. «Mescola» cambia davvero il layout quando ce n'è più d'uno, e resta ferma (stesso oggetto) con layout bloccato o spread finito;
 *  3. il ritaglio fatto a mano resta: dopo Mescola o un layout proposto la nuova cella mostra ancora tutta la parte che si vedeva;
 *  4. una foto con forma scelta mantiene quella proporzione;
 *  5. una foto bloccata non cambia inquadratura con nessun comando di layout.
 */

const ASPECTS = [3 / 2, 2 / 3, 1, 4 / 3, 3 / 4, 16 / 9, 5 / 4, 2 / 3];
const SPLITS: AlbumSplitMode[] = ["full", "half", "third", "two-thirds"];

function album(count: number, split: AlbumSplitMode, mode: "fit" | "fill"): { project: Project; id: string } {
  let project = makeProject(count + 4);
  project = { ...project, assets: Array.from({ length: count + 4 }, (_, i) => makeAsset(i, { width: Math.round(ASPECTS[i % ASPECTS.length] * 4000), height: 4000, aspectRatio: ASPECTS[i % ASPECTS.length] })) };
  project = addSpread(project, 0, split);
  const id = project.spreads[0].id;
  project = appendAssets(project, id, 0, Array.from({ length: count }, (_, i) => `a${i}`));
  project = setAreaStyle(project, id, 0, { mode, gapCm: 0.2, paddingCm: 0.6 });
  return { project, id };
}

interface View { crop: { cropLeft: number; cropTop: number; cropWidth: number; cropHeight: number }; windowAspect: number; cellAspect: number; imageAspect: number }

/** Parte visibile della foto nella sua cella (con lo stile di posa dell'area). */
function viewOf(project: Project, itemId: string): View | null {
  for (const spread of project.spreads) {
    for (let areaIndex = 0; areaIndex < spread.areas.length; areaIndex += 1) {
      const area = spread.areas[areaIndex];
      const item = area.items.find((candidate) => candidate.id === itemId);
      if (!item) continue;
      const cell = areaGeometry(project, spread, areaIndex).cells.find((candidate) => candidate.itemId === itemId);
      const asset = project.assets.find((candidate) => candidate.id === item.assetId);
      if (!cell || !asset) return null;
      const placement = placeItem(cell.rect, item, asset, placementStyle(area, cell), null, cell.anchor);
      const quarter = asset.rotationDegrees === 90 || asset.rotationDegrees === 270;
      const imageAspect = quarter ? asset.height / asset.width : asset.width / asset.height;
      return { crop: placement.crop, windowAspect: placement.content.w / placement.content.h, cellAspect: cell.rect.w / cell.rect.h, imageAspect };
    }
  }
  return null;
}

const allItems = (project: Project) => project.spreads.flatMap((spread) => spread.areas.flatMap((area, areaIndex) => area.items.map((item) => ({ spread, area, areaIndex, item }))));

/** Una foto è «tagliata a mano» quando la parte visibile non è quella di base della cella (zoom o centro spostati). */
function deliberateCrop(project: Project, itemId: string): boolean {
  const found = allItems(project).find((entry) => entry.item.id === itemId);
  if (!found) return false;
  const view = viewOf(project, itemId);
  if (!view) return false;
  const base = baseCrop(view.imageAspect, view.windowAspect);
  const near = (a: number, b: number) => Math.abs(a - b) < 0.002;
  return !(near(view.crop.cropLeft, base.cropLeft) && near(view.crop.cropTop, base.cropTop) && near(view.crop.cropWidth, base.cropWidth) && near(view.crop.cropHeight, base.cropHeight));
}

/** Dopo un cambio di layout: ogni foto tagliata a mano deve mostrare ancora almeno ciò che mostrava, quando la nuova finestra lo permette. */
function assertCropsKept(before: Project, after: Project, label: string): void {
  for (const entry of allItems(before)) {
    const now = allItems(after).find((candidate) => candidate.item.id === entry.item.id);
    if (!now || now.spread.id !== entry.spread.id || now.areaIndex !== entry.areaIndex) continue;
    const old = viewOf(before, entry.item.id);
    const next = viewOf(after, entry.item.id);
    if (!old || !next) continue;
    if (entry.item.locked) {
      assert.deepEqual([now.item.zoom, now.item.cx, now.item.cy], [entry.item.zoom, entry.item.cx, entry.item.cy], `${label}: una foto bloccata non cambia inquadratura`);
      continue;
    }
    if (entry.item.shape) {
      const shape = now.item.shape ?? 0;
      assert.ok(Math.abs(next.windowAspect / shape - 1) < 0.01, `${label}: la forma scelta (${shape}) si mantiene (finestra ${next.windowAspect})`);
      continue;
    }
    if ((entry.item.angle ?? 0) !== 0 || !deliberateCrop(before, entry.item.id)) continue;
    const base = baseCrop(next.imageAspect, next.windowAspect);
    const feasible = old.crop.cropWidth <= base.cropWidth + 1e-6 && old.crop.cropHeight <= base.cropHeight + 1e-6;
    if (!feasible) continue; // la nuova finestra è più stretta del taglio: si mostra il massimo possibile
    const eps = 0.012;
    assert.ok(next.crop.cropLeft <= old.crop.cropLeft + eps && next.crop.cropTop <= old.crop.cropTop + eps, `${label}: il ritaglio perde il lato sinistro/alto di ciò che si vedeva`);
    assert.ok(next.crop.cropLeft + next.crop.cropWidth >= old.crop.cropLeft + old.crop.cropWidth - eps && next.crop.cropTop + next.crop.cropHeight >= old.crop.cropTop + old.crop.cropHeight - eps, `${label}: il ritaglio perde il lato destro/basso di ciò che si vedeva`);
  }
}

// ------------------------------------------------------------------ casi mirati

test("Mescola dopo un ritaglio: la foto tagliata mostra ancora la parte scelta", () => {
  for (const mode of ["fill", "fit"] as const) {
    for (const count of [2, 3, 4, 6]) {
      const { project, id } = album(count, "half", mode);
      const target = project.spreads[0].areas[0].items[0].id;
      let current = setItemView(project, target, { zoom: 2.2, cx: 0.3, cy: 0.35 });
      assertProjectInvariants(current, `${mode}/${count}: ritaglio`);
      for (let step = 0; step < 8; step += 1) {
        const next = shuffleArea(current, id, 0, 1);
        assertProjectInvariants(next, `${mode}/${count}: mescola ${step}`);
        assertCropsKept(current, next, `${mode}/${count}: mescola ${step}`);
        current = next;
      }
    }
  }
});

test("il ritaglio resta anche con layout proposti, tasti 1-9, mescola dello spread e frecce indietro", () => {
  const { project, id } = album(4, "half", "fill");
  const target = project.spreads[0].areas[0].items[1].id;
  const cropped = setItemView(project, target, { zoom: 3, cx: 0.7, cy: 0.4 });
  const choices = layoutChoices(cropped, cropped.spreads[0], 0, []);
  for (let index = 0; index < choices.length; index += 1) {
    const next = applyCandidate(cropped, id, 0, index);
    assertProjectInvariants(next, `layout proposto ${index}`);
    assertCropsKept(cropped, next, `layout proposto ${index}`);
  }
  for (let number = 1; number <= 9; number += 1) assertCropsKept(cropped, applyCandidateByNumber(cropped, id, 0, number), `tasto ${number}`);
  assertCropsKept(cropped, shuffleSpread(cropped, id, 1), "mescola spread");
  assertCropsKept(cropped, shuffleArea(cropped, id, 0, -1), "freccia giù");
});

test("una foto con forma scelta (taglio a formato) non blocca Mescola e mantiene la forma", () => {
  for (const mode of ["fill", "fit"] as const) {
    for (const count of [2, 3, 5]) {
      for (const preset of [SHAPE_PRESETS[0], SHAPE_PRESETS[3], SHAPE_PRESETS[6]]) {
        const { project, id } = album(count, "half", mode);
        const target = project.spreads[0].areas[0].items[0].id;
        let current = setItemView(project, target, { shape: preset.ratio });
        const seen = new Set<string>([JSON.stringify(current.spreads[0].areas[0].layout)]);
        for (let step = 0; step < 6; step += 1) {
          const available = layoutChoices(current, current.spreads[0], 0, []).length;
          const next = shuffleArea(current, id, 0, 1);
          if (available >= 2) assert.notEqual(next, current, `${mode}/${count}/${preset.id}: con ${available} layout Mescola non può restare ferma`);
          assertProjectInvariants(next, `${mode}/${count}/${preset.id}: mescola ${step}`);
          assertCropsKept(current, next, `${mode}/${count}/${preset.id}: mescola ${step}`);
          seen.add(JSON.stringify(next.spreads[0].areas[0].layout));
          current = next;
        }
        assert.ok(seen.size >= 2, `${mode}/${count}/${preset.id}: dopo il formato Mescola propone più di un layout`);
      }
    }
  }
});

test("Mescola resta ferma con layout bloccato o spread finito, e cambia altrimenti", () => {
  const { project, id } = album(4, "half", "fill");
  const locked = setAreaLocked(project, id, 0, true);
  assert.equal(shuffleArea(locked, id, 0, 1), locked, "layout bloccato");
  const done = setSpreadDone(project, id, true);
  assert.equal(shuffleArea(done, id, 0, 1), done, "spread finito");
  assert.equal(shuffleSpread(done, id, 1), done, "mescola spread finito");
  assert.notEqual(shuffleArea(project, id, 0, 1), project, "libero: cambia");
  assert.notEqual(shuffleSpread(project, id, 1), project, "spread libero: cambia");
});

test("una foto bloccata non cambia inquadratura con nessun comando di layout", () => {
  const { project, id } = album(4, "half", "fill");
  const target = project.spreads[0].areas[0].items[2].id;
  let current = setItemView(project, target, { zoom: 2, cx: 0.2, cy: 0.8 });
  current = toggleItemLock(current, target);
  assert.equal(setItemView(current, target, { zoom: 4 }), current, "setItemView su foto bloccata non fa nulla");
  for (const command of [(p: Project) => shuffleArea(p, id, 0, 1), (p: Project) => shuffleSpread(p, id), (p: Project) => applyCandidate(p, id, 0, 1), (p: Project) => mirrorArea(p, id, 0, "horizontal"), (p: Project) => setAreaStyle(p, id, 0, { mode: "fit" }, true)]) {
    const next = command(current);
    assertProjectInvariants(next, "foto bloccata");
    assertCropsKept(current, next, "foto bloccata");
  }
});

test("Modo: ogni passaggio Riempi ↔ Foto intera tiene le foto, con e senza taglio, forma, blocco e fine", () => {
  for (const count of [1, 2, 3, 6]) {
    for (const prepare of ["niente", "ritaglio", "forma", "blocco-area", "finito"] as const) {
      const { project, id } = album(count, "half", "fill");
      const target = project.spreads[0].areas[0].items[0].id;
      let current = project;
      if (prepare === "ritaglio") current = setItemView(current, target, { zoom: 2, cx: 0.4, cy: 0.4 });
      if (prepare === "forma") current = setItemView(current, target, { shape: 1 });
      if (prepare === "blocco-area") current = setAreaLocked(current, id, 0, true);
      if (prepare === "finito") current = setSpreadDone(current, id, true);
      for (const [mode, relayout] of [["fit", false], ["fill", false], ["fit", true], ["fill", true]] as const) {
        const next = setAreaStyle(current, id, 0, { mode }, relayout);
        assertProjectInvariants(next, `${count}/${prepare}: modo ${mode}${relayout ? " + Alt" : ""}`);
        assert.equal(next.spreads[0].areas[0].style.mode, mode, "il modo cambia sempre nello stile");
        assert.equal(next.spreads[0].areas[0].items.length, count, "nessuna foto persa");
        current = next;
      }
    }
  }
});

// ------------------------------------------------------------------ tutti i pulsanti, tutte le combinazioni

type Operation = { name: string; run: (project: Project, id: string, random: () => number) => Project; layout?: boolean };

const pick = <T,>(list: readonly T[], random: () => number): T => list[Math.floor(random() * list.length) % list.length];
const someItem = (project: Project, id: string, random: () => number): string | null => {
  const items = (project.spreads.find((spread) => spread.id === id)?.areas ?? []).flatMap((area) => area.items.map((item) => item.id));
  return items.length ? pick(items, random) : null;
};
const areaOf = (project: Project, id: string, random: () => number): number => Math.floor(random() * (project.spreads.find((spread) => spread.id === id)?.areas.length ?? 1));

let lastShuffledArea = 0;
const OPERATIONS: Operation[] = [
  { name: "Mescola ↑ (striscia)", layout: true, run: (p, id, r) => { lastShuffledArea = areaOf(p, id, r); return shuffleArea(p, id, lastShuffledArea, 1); } },
  { name: "Mescola ↓ (freccia giù)", layout: true, run: (p, id, r) => shuffleArea(p, id, areaOf(p, id, r), -1) },
  { name: "Mescola spread (barra)", layout: true, run: (p, id) => shuffleSpread(p, id, 1) },
  { name: "Layout proposto 1-9", layout: true, run: (p, id, r) => applyCandidateByNumber(p, id, areaOf(p, id, r), 1 + Math.floor(r() * 9)) },
  { name: "Modo Riempi", run: (p, id, r) => setAreaStyle(p, id, areaOf(p, id, r), { mode: "fill" }) },
  { name: "Modo Foto intera", run: (p, id, r) => setAreaStyle(p, id, areaOf(p, id, r), { mode: "fit" }) },
  { name: "Modo + Alt (ridisegna)", run: (p, id, r) => { const index = areaOf(p, id, r); const mode = p.spreads.find((s) => s.id === id)!.areas[index].style.mode === "fill" ? "fit" : "fill"; return setAreaStyle(p, id, index, { mode }, true); } },
  { name: "Spazio", run: (p, id, r) => setAreaStyle(p, id, areaOf(p, id, r), { gapCm: Math.round(r() * 60) / 20 }) },
  { name: "Margine", run: (p, id, r) => setAreaStyle(p, id, areaOf(p, id, r), { paddingCm: Math.round(r() * 80) / 20 }) },
  { name: "Bordo", run: (p, id, r) => setAreaStyle(p, id, areaOf(p, id, r), { borderCm: Math.round(r() * 40) / 100 }) },
  { name: "Colore del bordo", run: (p, id, r) => setAreaStyle(p, id, areaOf(p, id, r), { borderColor: pick(["#000000", "#ffffff", "#b89a63"], r) }) },
  { name: "B/N", run: (p, id, r) => { const index = areaOf(p, id, r); return setAreaStyle(p, id, index, { mono: !p.spreads.find((s) => s.id === id)!.areas[index].style.mono }); } },
  { name: "Allinea", run: (p, id, r) => alignArea(p, id, areaOf(p, id, r), pick(["start", "center", "end"] as const, r)) },
  { name: "Dividi", run: (p, id, r) => { const mode = pick(SPLITS, r); return splitRefusal(p, id, mode) ? p : setSplitMode(p, id, mode); } },
  { name: "Collega", run: (p, id, r) => setLinked(p, id, r() < 0.5) },
  { name: "Scambia pagine", run: (p, id) => swapAreas(p, id) },
  { name: "Blocca/sblocca layout", run: (p, id, r) => setAreaLocked(p, id, areaOf(p, id, r), r() < 0.5) },
  { name: "Sposta liberamente", run: (p, id, r) => makeAreaFree(p, id, areaOf(p, id, r)) },
  { name: "Torna al layout automatico", run: (p, id, r) => restoreAutomatic(p, id, areaOf(p, id, r)) },
  { name: "Specchia", layout: true, run: (p, id, r) => mirrorArea(p, id, areaOf(p, id, r), pick(["horizontal", "vertical"] as const, r)) },
  { name: "Stile a tutto lo spread", run: (p, id, r) => applyStyleToSpread(p, id, areaOf(p, id, r)) },
  { name: "Allinea le foto", run: (p, id) => alignFitAreas(p, id) },
  { name: "Ritaglio (zoom e centro)", run: (p, id, r) => { const item = someItem(p, id, r); return item ? setItemView(p, item, { zoom: 1 + r() * (MAX_ZOOM - 2), cx: r(), cy: r() }) : p; } },
  { name: "Ritaglio: azzera", run: (p, id, r) => { const item = someItem(p, id, r); return item ? resetItemView(p, item) : p; } },
  { name: "Forma della foto", run: (p, id, r) => { const item = someItem(p, id, r); return item ? setItemView(p, item, { shape: r() < 0.25 ? null : pick(SHAPE_PRESETS, r).ratio }) : p; } },
  { name: "Raddrizza", run: (p, id, r) => { const item = someItem(p, id, r); return item ? setItemView(p, item, { angle: Math.round((r() * 10 - 5) * 10) / 10 }) : p; } },
  { name: "Bordo della foto", run: (p, id, r) => { const item = someItem(p, id, r); return item ? setItemBorder(p, item, r() < 0.3 ? { cm: null, color: null } : { cm: Math.round(r() * 30) / 100, color: "#ffffff" }) : p; } },
  { name: "Blocca foto", run: (p, id, r) => { const item = someItem(p, id, r); return item ? toggleItemLock(p, item) : p; } },
  { name: "Ruota 90°", run: (p, id, r) => { const item = someItem(p, id, r); const asset = item ? p.spreads.flatMap((s) => s.areas.flatMap((a) => a.items)).find((i) => i.id === item)?.assetId : null; return asset ? rotateAssetQuarter(p, asset, r() < 0.5 ? 1 : -1) : p; } },
  { name: "Elimina foto", run: (p, id, r) => { const item = someItem(p, id, r); return item ? removeItem(p, item) : p; } },
  { name: "Aggiungi foto", run: (p, id, r) => { const used = new Set(p.spreads.flatMap((s) => s.areas.flatMap((a) => a.items.map((i) => i.assetId)))); const free = p.assets.find((asset) => !used.has(asset.id)); return free ? appendAssets(p, id, areaOf(p, id, r), [free.id]) : p; } },
  { name: "Svuota spread", run: (p, id, r) => (r() < 0.15 ? clearSpread(p, id) : p) },
  { name: "Segna finito / riapri", run: (p, id) => setSpreadDone(p, id, !p.spreads.find((s) => s.id === id)!.done) },
];

test("tutti i pulsanti, combinati a caso: invarianti, Mescola viva, ritaglio, forma e blocchi rispettati", () => {
  let steps = 0;
  const used = new Set<string>();
  for (let seed = 1; seed <= 40; seed += 1) {
    const random = mulberry32(seed * 7919);
    const split = pick(SPLITS, random);
    const { project: start, id } = album(2 + Math.floor(random() * 9), split, random() < 0.5 ? "fill" : "fit");
    let current = start;
    // partenza varia: qualche foto già tagliata, con forma o bloccata
    for (const entry of allItems(current)) {
      const roll = random();
      if (roll < 0.25) current = setItemView(current, entry.item.id, { zoom: 1.5 + random() * 2, cx: random(), cy: random() });
      else if (roll < 0.35) current = setItemView(current, entry.item.id, { shape: pick(SHAPE_PRESETS, random).ratio });
      else if (roll < 0.4) current = toggleItemLock(current, entry.item.id);
    }
    for (let step = 0; step < 50; step += 1) {
      const operation = pick(OPERATIONS, random);
      const label = `seme ${seed}, passo ${step}, «${operation.name}»`;
      let next: Project;
      try { next = operation.run(current, id, random); } catch (error) { assert.fail(`${label}: ${(error as Error).message}`); }
      assertProjectInvariants(next, label);
      if (operation.layout) {
        const spread = current.spreads.find((candidate) => candidate.id === id);
        // Mescola non è mai una sparizione silenziosa: se si può cambiare layout e nulla lo impedisce, cambia.
        if (operation.name.startsWith("Mescola ↑") && spread && !spread.done) {
          const index = Math.min(lastShuffledArea, spread.areas.length - 1);
          const area = spread.areas[index];
          if (!area.locked && area.items.length > 0 && !hasFreeLayout(area) && layoutChoices(current, spread, index, []).length >= 2) {
            const shuffled = shuffleArea(current, id, index, 1);
            assert.notEqual(shuffled, current, `${label}: ci sono almeno due layout ma Mescola non cambia nulla`);
            assertCropsKept(current, shuffled, `${label} (controllo Mescola)`);
          }
        }
        if (next !== current && !operation.name.startsWith("Specchia")) assertCropsKept(current, next, label);
      }
      used.add(operation.name);
      current = next;
      steps += 1;
    }
  }
  assert.ok(steps >= 2000, `eseguiti ${steps} passi`);
  assert.equal(used.size, OPERATIONS.length, `ogni pulsante è stato provato (mancano: ${OPERATIONS.filter((operation) => !used.has(operation.name)).map((operation) => operation.name).join(", ")})`);
});
