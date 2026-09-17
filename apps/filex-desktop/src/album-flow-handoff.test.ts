import assert from "node:assert/strict";
import test from "node:test";
import { parseAlbumFlowManifest } from "./album-flow-handoff.js";

function manifest(overrides: Record<string, unknown> = {}): any {
  return {
    schemaVersion: 1, handoffId: "handoff-1", sourceToolId: "photo-selector-app",
    sourceRoot: "C:/Foto", projectId: "p1", projectName: "Matrimonio",
    createdAt: "2026-09-14T10:00:00.000Z", expiresAt: "2026-09-14T10:10:00.000Z",
    labels: [{ id: "custom:Famiglia%20%26%20amici", name: "Famiglia & amici", source: "selector-custom", color: "#b89a63" }],
    assets: [{ assetId: "a1", relativePath: "IMG_0001.JPG", absolutePath: "C:/Foto/IMG_0001.JPG", fileName: "IMG_0001.JPG", width: 4000, height: 3000, aspectRatio: 1.333, orientation: "horizontal", selected: true, selectionOrder: 0, rating: 5, pickStatus: "picked", colorLabel: null, customLabels: ["Famiglia & amici"], labelIds: ["custom:Famiglia%20%26%20amici"], size: 100 }],
    ...overrides,
  };
}

test("accepts a complete Unicode-labelled manifest", () => {
  const parsed = parseAlbumFlowManifest(manifest());
  assert.equal(parsed.assets[0]?.selectionOrder, 0);
  assert.equal(parsed.labels[0]?.name, "Famiglia & amici");
});

test("rejects traversal and invalid selection order", () => {
  assert.throws(() => parseAlbumFlowManifest(manifest({ assets: [{ ...manifest().assets[0], relativePath: "../outside.jpg" }] })));
  assert.throws(() => parseAlbumFlowManifest(manifest({ assets: [{ ...manifest().assets[0], selectionOrder: 4 }] })));
});
