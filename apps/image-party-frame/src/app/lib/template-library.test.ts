import assert from "node:assert/strict";
import test from "node:test";

import type { CustomTemplate } from "../contexts/ProjectContext";
import type { SavedTemplateRecord } from "./savedTemplates";
import {
  areCustomTemplatesEquivalent,
  buildTemplateLibrary,
  preserveCustomTemplateLibraryIdentity,
  resolveCustomTemplateSelectionValue,
} from "./templateLibrary";

function customTemplate(libraryTemplateId?: string): CustomTemplate {
  return {
    id: "custom",
    ...(libraryTemplateId ? { libraryTemplateId } : {}),
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
        backgroundFileName: "vertical.png",
        backgroundPreviewUrl: "blob:vertical-saved",
        ...(libraryTemplateId ? { backgroundAssetKey: `${libraryTemplateId}:vertical` } : {}),
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
        backgroundFileName: "horizontal.png",
        backgroundPreviewUrl: "blob:horizontal-saved",
        ...(libraryTemplateId ? { backgroundAssetKey: `${libraryTemplateId}:horizontal` } : {}),
        borderSizePx: 10,
        borderColor: "#ffffff",
      },
    },
  };
}

function savedRecord(id = "tpl_saved"): SavedTemplateRecord {
  const template = customTemplate(id);
  delete template.variants.vertical.backgroundPreviewUrl;
  delete template.variants.horizontal.backgroundPreviewUrl;
  template.variants.vertical.backgroundAssetKey = `${id}:vertical`;
  template.variants.horizontal.backgroundAssetKey = `${id}:horizontal`;
  return {
    id,
    name: template.name,
    createdAt: "2026-08-30T12:00:00.000Z",
    summary: "Verticale 10x15 cm | Orizzontale 15x10 cm",
    template,
  };
}

test("using a just-saved template preserves its library identity and renders one entry", () => {
  const currentSavedTemplate = customTemplate("tpl_saved");
  const rebuiltByBuilder = customTemplate();
  const committed = preserveCustomTemplateLibraryIdentity(rebuiltByBuilder, currentSavedTemplate);

  assert.equal(committed.libraryTemplateId, "tpl_saved");
  assert.equal(committed.variants.vertical.backgroundAssetKey, "tpl_saved:vertical");
  assert.equal(committed.variants.horizontal.backgroundAssetKey, "tpl_saved:horizontal");
  assert.equal(resolveCustomTemplateSelectionValue(committed, [savedRecord()]), "custom:tpl_saved");
  const items = buildTemplateLibrary([], [savedRecord()], committed);
  assert.deepEqual(items.map((item) => item.value), ["custom:tpl_saved"]);
});

test("transient preview and IndexedDB fields do not create a duplicate library entry", () => {
  const current = customTemplate("tpl_saved");
  const record = savedRecord();

  assert.equal(areCustomTemplatesEquivalent(current, record.template), true);
  assert.equal(buildTemplateLibrary([], [record], current).some((item) => item.kind === "custom-draft"), false);
});

test("real edits detach the library identity and keep the current draft visible", () => {
  const currentSavedTemplate = customTemplate("tpl_saved");
  const editedDraft = customTemplate();
  editedDraft.variants.vertical.borderSizePx = 20;
  const committed = preserveCustomTemplateLibraryIdentity(editedDraft, currentSavedTemplate);

  assert.equal(committed.libraryTemplateId, undefined);
  const items = buildTemplateLibrary([], [savedRecord()], committed);
  assert.deepEqual(items.map((item) => item.kind), ["custom-draft", "custom"]);
  assert.equal(items[0].label, "Cornice Evento");
  assert.equal(resolveCustomTemplateSelectionValue(committed, [savedRecord()]), "custom-draft");
});

test("replacing a background with a new preview does not masquerade as the saved version", () => {
  const currentSavedTemplate = customTemplate("tpl_saved");
  const editedDraft = customTemplate();
  editedDraft.variants.vertical.backgroundPreviewUrl = "blob:vertical-replaced";

  assert.equal(
    preserveCustomTemplateLibraryIdentity(editedDraft, currentSavedTemplate).libraryTemplateId,
    undefined
  );
});

test("a stale linked ID cannot hide unsaved geometry changes", () => {
  const staleLinkedDraft = customTemplate("tpl_saved");
  staleLinkedDraft.variants.horizontal.photoAreaWidth = 700;
  const items = buildTemplateLibrary([], [savedRecord()], staleLinkedDraft);

  assert.deepEqual(items.map((item) => item.kind), ["custom-draft", "custom"]);
  assert.match(items[0].meta, /Modifiche correnti/);
  assert.equal(resolveCustomTemplateSelectionValue(staleLinkedDraft, [savedRecord()]), "custom-draft");
});
