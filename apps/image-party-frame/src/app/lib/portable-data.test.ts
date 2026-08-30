import assert from "node:assert/strict";
import test from "node:test";

import type { CustomTemplate } from "../contexts/ProjectContext";
import {
  assertPortablePackageSize,
  validatePortableProjectPackage,
} from "./portablePackages";
import { normalizeRecentProjectRecords } from "./recentProjects";
import {
  createSavedTemplateId,
  decodePortableImageAsset,
  disposePreparedSavedTemplatesPackageImport,
  findUnreferencedAssetKeys,
  isSavedTemplatesImportGenerationCurrent,
  MAX_PORTABLE_PACKAGE_BYTES,
  normalizePortableCustomTemplate,
  normalizePortableImageFileName,
  normalizeSavedTemplateRecords,
  prepareSavedTemplatesPackageImport,
  reserveSavedTemplatesImportGeneration,
  type SavedTemplateRecord,
} from "./savedTemplates";

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from(PNG_SIGNATURE).toString("base64")}`;

function validTemplate(): CustomTemplate {
  return {
    id: "custom",
    name: "Cornice Evento",
    variants: {
      vertical: {
        widthCm: 10,
        heightCm: 15,
        dpi: 300,
        widthPx: 1181,
        heightPx: 1772,
        photoAreaX: 100,
        photoAreaY: 100,
        photoAreaWidth: 600,
        photoAreaHeight: 800,
        lockAspectRatio: true,
        photoAspectRatio: 0.75,
        borderSizePx: 10,
        borderColor: "#ffffff",
      },
      horizontal: {
        widthCm: 15,
        heightCm: 10,
        dpi: 300,
        widthPx: 1772,
        heightPx: 1181,
        photoAreaX: 100,
        photoAreaY: 100,
        photoAreaWidth: 800,
        photoAreaHeight: 600,
        lockAspectRatio: true,
        photoAspectRatio: 4 / 3,
        borderSizePx: 10,
        borderColor: "#ffffff",
      },
    },
  };
}

function validRecord(id = "tpl_valid"): SavedTemplateRecord {
  const template = validTemplate();
  template.libraryTemplateId = id;
  template.variants.vertical.backgroundFileName = "frame.png";
  template.variants.vertical.backgroundAssetKey = "shared:vertical";
  return {
    id,
    name: template.name,
    createdAt: "2026-08-30T12:00:00.000Z",
    summary: "ignored and rebuilt",
    template,
  };
}

test("portable image assets require strict image MIME, base64, signature and safe file names", () => {
  const file = decodePortableImageAsset({
    fileName: "frame.png",
    mimeType: "image/png",
    dataUrl: PNG_DATA_URL,
  }, PNG_SIGNATURE.length);
  assert.equal(file.size, PNG_SIGNATURE.length);
  assert.equal(file.type, "image/png");

  assert.throws(() => decodePortableImageAsset({
    fileName: "frame.png",
    mimeType: "application/json",
    dataUrl: "data:application/json;base64,e30=",
  }), /non e supportato/);
  assert.throws(() => decodePortableImageAsset({
    fileName: "frame.png",
    mimeType: "image/png",
    dataUrl: PNG_DATA_URL.replace("image/png", "image/jpeg"),
  }), /non corrisponde/);
  assert.throws(() => decodePortableImageAsset({
    fileName: "frame.png",
    mimeType: "image/png",
    dataUrl: `${PNG_DATA_URL} `,
  }), /base64/);
  assert.throws(() => decodePortableImageAsset({
    fileName: "frame.png",
    mimeType: "image/png",
    dataUrl: PNG_DATA_URL.replace(/o=$/, "p="),
  }), /base64/);
  assert.throws(() => decodePortableImageAsset({
    fileName: "frame.png",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,QUJD",
  }), /firma binaria/);

  for (const unsafeName of ["../frame.png", "CON.png", "CON.backup.png", "frame.png ", `${"a".repeat(181)}.png`]) {
    assert.equal(normalizePortableImageFileName(unsafeName, "image/png"), null);
  }
});

test("oversized decoded data is rejected before atob allocates", () => {
  const originalAtob = globalThis.atob;
  let decoderCalled = false;
  globalThis.atob = ((value: string) => {
    decoderCalled = true;
    return originalAtob(value);
  }) as typeof globalThis.atob;
  try {
    assert.throws(() => decodePortableImageAsset({
      fileName: "frame.png",
      mimeType: "image/png",
      dataUrl: PNG_DATA_URL,
    }, PNG_SIGNATURE.length - 1), /limite/);
    assert.equal(decoderCalled, false);
  } finally {
    globalThis.atob = originalAtob;
  }
});

test("custom templates are accepted only when both variants satisfy builder geometry", () => {
  assert.ok(normalizePortableCustomTemplate(validTemplate()));

  const missingVariant = validTemplate() as CustomTemplate & { variants: Record<string, unknown> };
  delete missingVariant.variants.horizontal;
  assert.equal(normalizePortableCustomTemplate(missingVariant), null);

  const outsideCanvas = validTemplate();
  outsideCanvas.variants.vertical.photoAreaX = outsideCanvas.variants.vertical.widthPx;
  assert.equal(normalizePortableCustomTemplate(outsideCanvas), null);

  const excessiveCanvas = validTemplate();
  excessiveCanvas.variants.vertical.widthPx = 12_000;
  excessiveCanvas.variants.vertical.heightPx = 12_000;
  assert.equal(normalizePortableCustomTemplate(excessiveCanvas), null);

  const invalidBorder = validTemplate();
  invalidBorder.variants.horizontal.borderSizePx = 300;
  assert.equal(normalizePortableCustomTemplate(invalidBorder), null);
});

test("corrupt saved records are filtered individually and transient data is removed", () => {
  const valid = validRecord();
  valid.createdAt = "not-a-date";
  valid.template.variants.vertical.backgroundPreviewUrl = "blob:stale";
  valid.template.variants.vertical.backgroundDataUrl = PNG_DATA_URL;
  const duplicate = validRecord();
  duplicate.name = "Duplicate that must not replace the first";

  const normalized = normalizeSavedTemplateRecords([
    null,
    { id: "broken", template: { id: "custom" } },
    valid,
    duplicate,
  ]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].id, "tpl_valid");
  assert.equal(normalized[0].createdAt, "1970-01-01T00:00:00.000Z");
  assert.equal(normalized[0].template.variants.vertical.backgroundPreviewUrl, undefined);
  assert.equal(normalized[0].template.variants.vertical.backgroundDataUrl, undefined);
  assert.equal(normalized[0].template.variants.vertical.backgroundAssetKey, "shared:vertical");
});

test("one corrupt recent-project snapshot does not discard the valid records", () => {
  const validRecent = {
    projectId: "project_alpha",
    name: "Evento",
    date: "30 ago 2026",
    template: "Cornice Evento",
    snapshot: {
      projectId: "project_alpha",
      name: "Evento",
      template: "custom",
      sourcePath: "C:\\Evento",
      outputPath: "C:\\Evento\\Export",
      customTemplate: validTemplate(),
      images: [],
    },
  };
  const normalized = normalizeRecentProjectRecords([
    { projectId: "broken", snapshot: { template: "custom", customTemplate: {}, images: [] } },
    validRecent,
    { ...validRecent, name: "duplicate" },
  ]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].projectId, "project_alpha");
  assert.equal(normalized[0].name, "Evento");
});

test("template IDs remain unique inside the same millisecond", () => {
  const ids = new Set(Array.from({ length: 100 }, () => createSavedTemplateId(1_777_777_777_777)));
  assert.equal(ids.size, 100);
});

test("shared duplicate assets are deleted only after the final reference disappears", () => {
  const original = validRecord("tpl_original");
  const duplicate = validRecord("tpl_duplicate");
  duplicate.template.variants.vertical.backgroundAssetKey = original.template.variants.vertical.backgroundAssetKey;

  assert.deepEqual(findUnreferencedAssetKeys([original], [duplicate]), []);
  assert.deepEqual(findUnreferencedAssetKeys([duplicate], []), ["shared:vertical"]);
});

test("template package preparation is side-effect free, strips imported keys and rejects duplicates", () => {
  const generation = reserveSavedTemplatesImportGeneration();
  const record = validRecord();
  record.template.variants.vertical.backgroundPreviewUrl = "blob:untrusted";
  record.template.variants.vertical.backgroundDataUrl = PNG_DATA_URL;
  const payload = {
    version: 1,
    exportedAt: "2026-08-30T12:00:00.000Z",
    templates: [{
      record,
      assets: {
        vertical: { fileName: "frame.png", mimeType: "image/png", dataUrl: PNG_DATA_URL },
      },
    }],
  };
  const prepared = prepareSavedTemplatesPackageImport(payload, "merge", generation);
  assert.equal(prepared.records.length, 1);
  assert.equal(prepared.stagedAssets.length, 1);
  assert.notEqual(prepared.records[0].template.variants.vertical.backgroundAssetKey, "shared:vertical");
  assert.equal(prepared.records[0].template.variants.vertical.backgroundPreviewUrl, undefined);
  assert.equal(prepared.records[0].template.variants.vertical.backgroundDataUrl, undefined);
  disposePreparedSavedTemplatesPackageImport(prepared);

  assert.throws(() => prepareSavedTemplatesPackageImport({
    ...payload,
    templates: [payload.templates[0], payload.templates[0]],
  }), /duplicato/);
  assert.throws(() => prepareSavedTemplatesPackageImport({ ...payload, version: 99 }), /versione/);
});

test("library import generations make the latest request authoritative", () => {
  const first = reserveSavedTemplatesImportGeneration();
  const second = reserveSavedTemplatesImportGeneration();
  assert.equal(isSavedTemplatesImportGenerationCurrent(first), false);
  assert.equal(isSavedTemplatesImportGenerationCurrent(second), true);
});

test("project packages validate their version, image count and complete custom template before commit", () => {
  const projectPackage = {
    version: 1,
    exportedAt: "2026-08-30T12:00:00.000Z",
    project: {
      name: "Evento",
      template: "custom",
      sourcePath: "",
      outputPath: "",
      customTemplate: validTemplate(),
      images: [],
    },
  };
  const validated = validatePortableProjectPackage(projectPackage);
  assert.equal(validated.project.name, "Evento");
  assert.ok(validated.project.customTemplate);

  const invalidTemplate = structuredClone(projectPackage);
  delete (invalidTemplate.project.customTemplate as Partial<CustomTemplate>).variants?.horizontal;
  assert.throws(() => validatePortableProjectPackage(invalidTemplate), /template custom/);
  assert.throws(() => validatePortableProjectPackage({ ...projectPackage, version: 2 }), /versione/);
});

test("portable package size is checked without allocating its declared payload", () => {
  assert.doesNotThrow(() => assertPortablePackageSize(MAX_PORTABLE_PACKAGE_BYTES));
  assert.throws(() => assertPortablePackageSize(MAX_PORTABLE_PACKAGE_BYTES + 1), /100 MB/);
  assert.throws(() => assertPortablePackageSize(0), /vuoto/);
});
