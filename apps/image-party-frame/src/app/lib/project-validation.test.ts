import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyProjectState, normalizeProjectState } from "../contexts/ProjectContext";
import { validateProjectForWorkspace } from "./projectValidation";

test("an empty project cannot enter the workspace", () => {
  const result = validateProjectForWorkspace(createEmptyProjectState());

  assert.equal(result.canContinue, false);
  assert.ok(result.errorCount >= 2);
});

test("missing session files block a browser-only project", () => {
  const project = normalizeProjectState({
    ...createEmptyProjectState(),
    name: "Evento",
    images: [{
      id: "legacy",
      path: "IMG_0001.jpg",
      orientation: "horizontal",
      approval: "pending",
      crop: { x: 0, y: 0, zoom: 100 },
    }],
  });

  const result = validateProjectForWorkspace(project, () => false);
  assert.equal(result.canContinue, false);
  assert.ok(result.checks.some((check) => check.code === "source-files" && check.severity === "error"));
});

test("a native path passes only after the current session verifies the file", () => {
  const project = normalizeProjectState({
    ...createEmptyProjectState(),
    name: "Evento",
    images: [{
      id: "legacy",
      path: "IMG_0001.jpg",
      relativePath: "IMG_0001.jpg",
      absolutePath: "C:\\Evento\\IMG_0001.jpg",
      orientation: "horizontal",
      approval: "pending",
      crop: { x: 0, y: 0, zoom: 100 },
    }],
  });

  const staleResult = validateProjectForWorkspace(project, () => false);
  assert.equal(staleResult.canContinue, false);

  const result = validateProjectForWorkspace(project, () => true);
  assert.equal(result.canContinue, true);
});
