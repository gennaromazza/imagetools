import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProjectImageId,
  clearImageFiles,
  createEmptyProjectState,
  getImageFile,
  normalizeProjectState,
  planProjectImageRelink,
  setImageFiles,
} from "./ProjectContext.js";
import { saveRecentProject, upsertRecentProjectList, type RecentProject } from "../lib/recentProjects.js";

test("bug hunt: il conteggio immagini viene ricostruito e non usa dati salvati obsoleti", () => {
  const normalized = normalizeProjectState({
    images: [
      { id: "v", path: "v.jpg", orientation: "vertical", approval: "pending", crop: { x: 0, y: 0, zoom: 100 } },
      { id: "h", path: "h.jpg", orientation: "horizontal", approval: "approved", crop: { x: 0, y: 0, zoom: 100 } },
    ],
    imageCount: { total: 999, vertical: 999, horizontal: 0 },
  });
  assert.deepEqual(normalized.imageCount, { total: 2, vertical: 1, horizontal: 1 });
});

test("bug hunt: valori crop legacy non finiti non contaminano il progetto", () => {
  const normalized = normalizeProjectState({
    images: [{
      id: "broken",
      path: "broken.jpg",
      orientation: "vertical",
      approval: "pending",
      crop: { x: Number.NaN, y: Number.POSITIVE_INFINITY, zoom: -1 },
    }],
  });
  assert.deepEqual(normalized.images[0]?.crop, { offsetX: 0, offsetY: 0, zoom: 100 });
});

test("bug hunt: impostazioni export legacy o corrotte vengono rese coerenti", () => {
  const normalized = normalizeProjectState({
    exportSettings: {
      format: "jpeg",
      quality: 9,
      colorProfile: "AdobeRGB",
      namingPattern: "   ",
      onlyApproved: true,
      embedColorProfile: false,
      createSubfolder: true,
      overwrite: false,
    } as never,
  });

  assert.deepEqual(normalized.exportSettings, {
    format: "jpeg",
    quality: 60,
    colorProfile: "sRGB",
    namingPattern: "original_frame",
    onlyApproved: true,
    embedColorProfile: true,
    createSubfolder: true,
    overwrite: false,
  });
});

test("regressione crop legacy: gli offset in pixel restano disponibili per la migrazione una tantum", () => {
  const normalized = normalizeProjectState({
    images: [{
      id: "legacy-crop",
      path: "legacy.jpg",
      orientation: "horizontal",
      approval: "approved",
      crop: { x: 24, y: -9, zoom: 125 },
    }],
  });

  assert.deepEqual(normalized.images[0]?.crop, {
    offsetX: 0,
    offsetY: 0,
    zoom: 125,
    legacyX: 24,
    legacyY: -9,
  });
  assert.equal(normalized.images[0]?.approvedRevision, normalized.images[0]?.cropRevision);
});

test("regressione progetti: gli snapshot legacy ricevono identita e ID immagine stabili", () => {
  const legacySnapshot = {
    name: "Festa",
    sourcePath: "C:/foto/festa",
    images: [
      { id: "img_001", path: "ospiti/a.jpg", orientation: "vertical" as const, approval: "pending" as const, crop: { x: 1, y: 2, zoom: 110 } },
    ],
  };

  const first = normalizeProjectState(legacySnapshot);
  const second = normalizeProjectState(legacySnapshot);
  assert.equal(first.projectId, second.projectId);
  assert.equal(first.images[0]?.id, second.images[0]?.id);
  assert.match(first.images[0]?.id ?? "", new RegExp(`^${first.projectId}::`));
});

test("regressione progetti: nuovi progetti e immagini non condividono lo stesso scope", () => {
  const first = createEmptyProjectState();
  const second = createEmptyProjectState();
  assert.notEqual(first.projectId, second.projectId);
  assert.notEqual(
    buildProjectImageId(first.projectId, "a.jpg"),
    buildProjectImageId(second.projectId, "a.jpg")
  );
});

test("regressione file: due progetti non condividono File e una nuova selezione rimpiazza i riferimenti obsoleti", () => {
  const firstProjectId = "project_files_one";
  const secondProjectId = "project_files_two";
  const firstFile = new File(["first"], "same.jpg");
  const secondFile = new File(["second"], "same.jpg");

  setImageFiles([firstFile], ["shared-image"], firstProjectId);
  setImageFiles([secondFile], ["shared-image"], secondProjectId);
  assert.strictEqual(getImageFile("shared-image", firstProjectId), firstFile);
  assert.strictEqual(getImageFile("shared-image", secondProjectId), secondFile);

  const replacement = new File(["replacement"], "replacement.jpg");
  setImageFiles([replacement], ["replacement-image"], firstProjectId);
  assert.equal(getImageFile("shared-image", firstProjectId), undefined);
  assert.strictEqual(getImageFile("replacement-image", firstProjectId), replacement);

  clearImageFiles(firstProjectId);
  clearImageFiles(secondProjectId);
});

test("regressione relink: path esatto preserva ID, approvazione e oggetto crop", () => {
  const project = normalizeProjectState({
    projectId: "project_relink_exact",
    images: [
      { id: "legacy", path: "gruppi/a.jpg", orientation: "vertical", approval: "approved", crop: { x: 12, y: -4, zoom: 135 } },
    ],
  });
  const originalImage = project.images[0]!;
  const plan = planProjectImageRelink(project, [{
    path: "gruppi/a.jpg",
    relativePath: "gruppi/a.jpg",
    absolutePath: "D:/foto/gruppi/a.jpg",
    size: 123,
    lastModified: 456,
    orientation: "horizontal",
  }]);

  assert.equal(plan.missingImageIds.length, 0);
  assert.equal(plan.images[0]?.id, originalImage.id);
  assert.equal(plan.images[0]?.approval, "approved");
  assert.strictEqual(plan.images[0]?.crop, originalImage.crop);
  assert.equal(plan.images[0]?.absolutePath, "D:/foto/gruppi/a.jpg");
  assert.equal(plan.images[0]?.relativePath, "gruppi/a.jpg");
});

test("regressione relink: il basename e usato solo se univoco e i file mancanti bloccano il commit", () => {
  const project = normalizeProjectState({
    projectId: "project_relink_names",
    images: [
      { id: "one", path: "prima/a.jpg", orientation: "vertical", approval: "approved", crop: { x: 1, y: 2, zoom: 103 } },
      { id: "two", path: "seconda/a.jpg", orientation: "horizontal", approval: "pending", crop: { x: 3, y: 4, zoom: 104 } },
      { id: "three", path: "prima/b.jpg", orientation: "vertical", approval: "needs-adjustment", crop: { x: 5, y: 6, zoom: 105 } },
    ],
  });

  const ambiguous = planProjectImageRelink(project, [
    { path: "nuova/a.jpg", orientation: "vertical" },
    { path: "spostata/b.jpg", orientation: "horizontal" },
  ]);

  assert.equal(ambiguous.matchedImageIds.length, 1);
  assert.equal(ambiguous.missingImageIds.length, 2);
  assert.equal(ambiguous.images[1]?.id, project.images[2]?.id);
  assert.strictEqual(ambiguous.images[1]?.crop, project.images[2]?.crop);
});

test("regressione recenti: il salvataggio sostituisce per projectId e non per nome", () => {
  const firstProject = normalizeProjectState({ projectId: "project_recent_one", name: "Festa" });
  const secondProject = normalizeProjectState({ projectId: "project_recent_two", name: "Festa" });
  const asRecent = (project: typeof firstProject): RecentProject => ({
    projectId: project.projectId,
    name: project.name,
    date: "",
    images: project.images.length,
    template: project.template,
    snapshot: project,
  });

  const sameName = upsertRecentProjectList([asRecent(firstProject)], asRecent(secondProject));
  assert.equal(sameName.length, 2);

  const renamedFirst = normalizeProjectState({ ...firstProject, name: "Festa rinominata" });
  const replaced = upsertRecentProjectList(sameName, asRecent(renamedFirst));
  assert.equal(replaced.length, 2);
  assert.equal(replaced[0]?.name, "Festa rinominata");
  assert.equal(replaced.filter((item) => item.projectId === firstProject.projectId).length, 1);
});

test("regressione recenti: un errore localStorage viene restituito al chiamante", () => {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: () => null,
        setItem: () => { throw new Error("quota esaurita"); },
      },
      dispatchEvent: () => true,
    },
  });
  try {
    const result = saveRecentProject(normalizeProjectState({
      projectId: "project_unsaved",
      name: "Da conservare",
      template: "classic-gold",
    }));
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.message, /quota esaurita/);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: previousWindow,
    });
  }
});
