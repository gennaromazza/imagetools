import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAlbumProject, serializeAlbumProject } from "./project-portability";
const project = { schemaVersion: 1, projectId: "p1", projectName: "Test", sourceFolderPath: "", createdAt: "now", updatedAt: "now", assets: [], labels: [], chapters: [], pages: [], settings: { sheet: { presetId: "x", label: "Test", widthCm: 30, heightCm: 20, dpi: 300, marginCm: 1, gapCm: 0 }, defaultFitMode: "fit", cropStrategy: "balanced", outputFormat: "jpg" } } as any;
test("serializza e ricarica un progetto", () => assert.deepEqual(parseAlbumProject(serializeAlbumProject(project)), project));
test("rifiuta JSON corrotto, versione e struttura incomplete", () => {
  assert.throws(() => parseAlbumProject("{"));
  assert.throws(() => parseAlbumProject(JSON.stringify({ format: "filex-album-project", version: 2 })));
  assert.throws(() => parseAlbumProject(JSON.stringify({ format: "filex-album-project", version: 1, project: { schemaVersion: 2 } })));
  assert.throws(() => parseAlbumProject(serializeAlbumProject({ ...project, assets: [{ id: "a", fileName: "a.jpg", path: "a.jpg" }] } as any)));
});
