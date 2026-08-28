import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

function cssBlock(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `Selettore CSS non trovato: ${selector}`);
  const end = css.indexOf("\n}", start);
  assert.notEqual(end, -1, `Blocco CSS non chiuso: ${selector}`);
  return css.slice(start, end + 2);
}

test("le pipeline usano code indicizzate e coordinamento condiviso", () => {
  const thumbnail = source("apps/photo-selector-app/src/services/thumbnail-pipeline.ts");
  const preview = source("apps/photo-selector-app/src/services/preview-warmup-pipeline.ts");
  for (const pipeline of [thumbnail, preview]) {
    assert.match(pipeline, /IndexedPriorityQueue/);
    assert.match(pipeline, /schedulePerformanceWork/);
    assert.doesNotMatch(pipeline, /\.sort\s*\(/);
    assert.doesNotMatch(pipeline, /\.shift\s*\(/);
    assert.doesNotMatch(pipeline, /\.unshift\s*\(/);
  }
});

test("gli aggiornamenti thumbnail restano per-ID e senza layout forzato", () => {
  const app = source("apps/photo-selector-app/src/App.tsx");
  const card = source("apps/photo-selector-app/src/components/PhotoCard.tsx");
  const store = source("apps/photo-selector-app/src/services/thumbnail-view-store.ts");
  assert.doesNotMatch(app, /assetsWithThumbnailViews|thumbnailViewVersion/);
  assert.match(card, /useThumbnailView\(photo\.id\)/);
  assert.doesNotMatch(card, /offsetWidth|offsetHeight|getBoundingClientRect\(\).*flash/);
  assert.match(store, /subscribeThumbnailView/);
  assert.match(store, /notifyThumbnailViewListeners\(id\)/);
});

test("gli overlay fullscreen non usano blur o transizioni della griglia", () => {
  const css = source("apps/photo-selector-app/src/styles.css");
  const quickPreview = cssBlock(css, ".quick-preview");
  const compareOverlay = cssBlock(css, ".compare-modal__overlay");
  const imageWrapper = cssBlock(css, ".photo-card__image-wrapper");
  assert.doesNotMatch(quickPreview, /backdrop-filter|transition:\s*grid-template-columns/);
  assert.doesNotMatch(compareOverlay, /backdrop-filter/);
  assert.doesNotMatch(imageWrapper, /translateZ|backface-visibility/);
});

test("il pan della Quick Preview resta fuori dal render React durante il drag", () => {
  const quickPreview = source("apps/photo-selector-app/src/components/PhotoQuickPreviewModal.tsx");
  const clampStart = quickPreview.indexOf("const clampPan");
  const clampEnd = quickPreview.indexOf("const commitPanOffset", clampStart);
  const pointerMoveStart = quickPreview.indexOf("onPointerMove=");
  const pointerMoveEnd = quickPreview.indexOf("onPointerUp=", pointerMoveStart);
  assert.notEqual(clampStart, -1);
  assert.notEqual(clampEnd, -1);
  assert.notEqual(pointerMoveStart, -1);
  assert.notEqual(pointerMoveEnd, -1);
  assert.doesNotMatch(quickPreview.slice(clampStart, clampEnd), /clientWidth|clientHeight|getBoundingClientRect/);
  assert.doesNotMatch(quickPreview.slice(pointerMoveStart, pointerMoveEnd), /setPanOffset/);
  assert.match(quickPreview, /resizeObserver\.observe\(element\)[\s\S]{0,320}\}, \[asset\?\.id, compareMode\]\)/);
  assert.match(quickPreview, /mainImageRef\.current\.style\.transform/);
  assert.match(quickPreview, /if \(isPanning\) \{[\s\S]{0,240}clearTimeout/);
  assert.doesNotMatch(quickPreview, /isPanning \|\| zoomLevel <= 1\.05/);
  assert.match(quickPreview, /draggable=\{canExternalDrag && zoomLevel <= 1\.05\}/);
  assert.match(quickPreview, /onDragStart=\{\(event\) => \{[\s\S]{0,180}zoomLevel > 1\.05[\s\S]{0,100}event\.preventDefault\(\)/);
  assert.match(quickPreview, /decoding="async"/);
});

test("il warmup Quick Preview non satura la decodifica RAW durante la navigazione", () => {
  const quickPreview = source("apps/photo-selector-app/src/components/PhotoQuickPreviewModal.tsx");
  const nativeImages = source("apps/filex-desktop/src/native-image-service.ts");
  const warmStart = nativeImages.indexOf("export async function warmDesktopQuickPreviewFrames");
  const warmEnd = nativeImages.indexOf("export function releaseDesktopQuickPreviewFrames", warmStart);
  assert.notEqual(warmStart, -1);
  assert.notEqual(warmEnd, -1);
  assert.match(quickPreview, /warmOffsets = navigationDirection < 0 \? \[-1, -2, 1\] : \[1, 2, -1\]/);
  assert.match(nativeImages, /quickPreviewWarmGeneration/);
  assert.match(nativeImages.slice(warmStart, warmEnd), /for \(const request of uniqueRequests\)/);
  assert.match(nativeImages.slice(warmStart, warmEnd), /warmGeneration !== quickPreviewWarmGeneration/);
  assert.doesNotMatch(nativeImages.slice(warmStart, warmEnd), /Promise\.all|Promise\.allSettled/);
});

test("cache e impostazioni mantengono budget, lock e risposte complete", () => {
  const diskCache = source("apps/filex-desktop/src/thumbnail-disk-cache.ts");
  const main = source("apps/filex-desktop/src/main.ts");
  const app = source("apps/photo-selector-app/src/App.tsx");
  const selector = source("apps/photo-selector-app/src/components/PhotoSelector.tsx");
  const preferences = source("apps/photo-selector-app/src/services/photo-selector-preferences.ts");
  const contracts = source("packages/desktop-contracts/src/index.ts");
  assert.match(diskCache, /AsyncReadWriteGate/);
  assert.match(diskCache, /selectDiskCacheEntriesToPrune/);
  assert.match(diskCache, /setDiskCacheBudgetPreset/);
  assert.match(diskCache, /delete settings\.thumbnailCacheDirectory/);
  assert.match(diskCache, /CACHE_ACCESS_TOUCH_MIN_INTERVAL_MS/);
  assert.match(diskCache, /!app\.isPackaged && process\.env\.FILEX_RENDERER_MODE === "dev"/);
  assert.match(diskCache, /"FileX", "Development", "ThumbnailCache"/);
  assert.match(diskCache, /DEVELOPMENT_SETTINGS_FILE_NAME/);
  assert.match(main, /clearDesktopImageMemoryCaches\(\)/);
  assert.match(main, /filex:set-disk-cache-budget-preset/);
  assert.match(selector, /subscribePhotoSelectorPreferenceSaveFailures/);
  assert.match(selector, /isSettingsPanelOpen[\s\S]*setInterval/);
  assert.match(selector, /desktopPerformanceFeedback[\s\S]*role="status"[\s\S]*aria-live="polite"/);
  assert.match(app, /Budget RAM applicato:[\s\S]{0,500}addToast\(message, "success"/);
  assert.match(app, /Limite cache su disco applicato:[\s\S]{0,500}addToast\(message, "success"/);
  assert.match(app, /Budget RAM applicato:[^`]*Attivo subito, non serve riavviare/);
  assert.match(app, /Limite cache su disco applicato:[^`]*Attivo subito, non serve riavviare/);
  assert.match(selector, /Budget RAM, profilo anteprime e limite cache si applicano subito: non serve riavviare il software/);
  assert.match(preferences, /preferenceSaveQueue/);
  assert.match(preferences, /confirmedPreferences/);
  assert.match(contracts, /DesktopDiskCacheBudgetPreset/);
  assert.match(contracts, /setDiskCacheBudgetPreset/);
});

test("la pagina prodotto documenta le garanzie prestazionali", () => {
  const page = source("website/strumenti/image-select-pro/index.html");
  assert.match(page, /Prestazioni progettate per cataloghi grandi/);
  assert.match(page, /Priorità dinamica del viewport/);
  assert.match(page, /budget su disco da 2, 8 o 24 GB/);
  assert.match(page, /50\.000 immagini/);
});
