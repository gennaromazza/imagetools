import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

const MODAL = "apps/photo-selector-app/src/components/PhotoQuickPreviewModal.tsx";

test("con zoom attivo le frecce sinistra e destra cambiano foto, lo spostamento usa Alt", () => {
  const modal = source(MODAL);
  const zoomedBlock = modal.slice(
    modal.indexOf("if (!compareMode && zoomLevel > 1.05) {"),
    modal.indexOf('if (event.key === "Enter" && activePage'),
  );
  assert.match(zoomedBlock, /event\.altKey && event\.key === "ArrowLeft"/);
  assert.match(zoomedBlock, /event\.altKey && event\.key === "ArrowRight"/);
  assert.doesNotMatch(zoomedBlock, /if \(event\.key === "ArrowLeft"\) \{\s*event\.preventDefault\(\);\s*panBy/);
  assert.match(zoomedBlock, /handleNavigate\("previous"\)/);
  assert.match(zoomedBlock, /handleNavigate\("next"\)/);
});

test("lo zoom richiede la qualità piena e mostra l'indicatore di caricamento", () => {
  const modal = source(MODAL);
  assert.match(modal, /FULL_QUALITY_PREVIEW_MAX_DIMENSION = 8000/);
  assert.match(modal, /detailPreviewMaxDimension = FULL_QUALITY_PREVIEW_MAX_DIMENSION/);
  assert.match(modal, /quick-preview__quality-badge/);
});

test("per i RAW lo stage detail usa il JPEG incorporato più grande", () => {
  const service = source("apps/filex-desktop/src/native-image-service.ts");
  assert.match(service, /async function tryExtractLargestEmbeddedPreviewWithExifTool/);
  assert.match(service, /rawPath && stage === "detail"/);
  assert.equal((service.match(/request\.stage,/g) ?? []).length >= 2, true);
});
