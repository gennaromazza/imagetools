import assert from "node:assert/strict";
import type {
  DesktopCloudPhotoState,
  DesktopFolderCatalogAssetState,
  DesktopPhotoSelectorProjectLocation,
} from "@photo-tools/desktop-contracts";
import type { ImageAsset } from "@photo-tools/shared-types";
import { mapCloudProjectToAssets } from "../apps/photo-selector-app/src/services/cloud-project-mapping";
import { buildMasterProject } from "../apps/photo-selector-app/src/services/project-workflow";
import {
  getRotatedContentFitScale,
  normalizeImageRotation,
  rotateImage,
} from "../apps/photo-selector-app/src/services/photo-rotation";
import {
  buildToggleAllSelection,
  countSelectionOutsideFilter,
  resolveRotationTargetIds,
  shouldApplyExternalSelectionUpdate,
  togglePhotoSelection,
} from "../apps/photo-selector-app/src/services/photo-selection";

function asset(id: string, path: string, size = 100): ImageAsset {
  return {
    id,
    fileName: path.split("/").at(-1) ?? path,
    path,
    sourceFileKey: `${path}::${size}::1`,
    width: 100,
    height: 100,
    orientation: "square",
    aspectRatio: 1,
    size,
  };
}

function state(assetId: string, relativePath: string, rating = 0): DesktopFolderCatalogAssetState {
  return {
    assetId,
    fileName: relativePath.split("/").at(-1) ?? relativePath,
    relativePath,
    rating,
    pickStatus: "unmarked",
    colorLabel: null,
    customLabels: [],
    updatedAt: rating,
  };
}

function legacyProject(
  rootPath: string,
  assetState: DesktopFolderCatalogAssetState,
  selected: boolean,
): DesktopPhotoSelectorProjectLocation {
  return {
    rootPath,
    project: {
      schemaVersion: 1,
      app: "image-select-pro",
      updatedAt: assetState.updatedAt,
      folderState: {
        assetStates: [assetState],
        activeAssetIds: selected ? [assetState.assetId] : [],
      },
    },
  };
}

function cloud(relativePath: string, fileName: string, size = 100): DesktopCloudPhotoState {
  return {
    relativePath,
    fileName,
    size,
    rating: 1,
    pickStatus: "picked",
    colorLabel: null,
    customLabels: [],
    active: true,
  };
}

const masterAssets = [
  asset("bride", "FOTO_SD/01-SPOSA/A.JPG"),
  asset("groom", "FOTO_SD/00-SPOSO/B.JPG"),
];
const merge = buildMasterProject(
  "FOTO_SD",
  "Daniele e Claudia",
  masterAssets,
  (id) => `C:/Wedding/${masterAssets.find((item) => item.id === id)?.path ?? ""}`,
  [
    legacyProject("C:/Wedding/FOTO_SD/01-SPOSA", state("old-bride", "01-SPOSA/A.JPG", 3), true),
    legacyProject("C:/Wedding/FOTO_SD/00-SPOSO", state("old-groom", "00-SPOSO/B.JPG", 5), true),
  ],
);
assert.deepEqual(new Set(merge.project.folderState?.activeAssetIds), new Set(["bride", "groom"]));
assert.equal(merge.migratedSelectionCount, 2);
assert.equal(merge.migratedMetadataCount, 2);

const duplicateNames = [
  asset("spouse-a", "FOTO_SD/01-SPOSA/DSC0001.JPG", 500),
  asset("spouse-b", "FOTO_SD/00-SPOSO/DSC0001.JPG", 500),
];
const exactMapping = mapCloudProjectToAssets(
  duplicateNames,
  [cloud("FOTO_SD/01-SPOSA/DSC0001.JPG", "DSC0001.JPG", 500)],
);
assert.equal(exactMapping.stateByAssetId.has("spouse-a"), true);
assert.equal(exactMapping.ambiguousCount, 0);

const ambiguousMapping = mapCloudProjectToAssets(
  duplicateNames,
  [cloud("ALTRO/DSC0001.JPG", "DSC0001.JPG", 500)],
);
assert.equal(ambiguousMapping.stateByAssetId.size, 0);
assert.equal(ambiguousMapping.ambiguousCount, 1);

const uniqueFallback = mapCloudProjectToAssets(
  [asset("only", "NUOVA-RADICE/UNICA.JPG", 700)],
  [cloud("VECCHIA-RADICE/UNICA.JPG", "UNICA.JPG", 700)],
);
assert.equal(uniqueFallback.stateByAssetId.has("only"), true);

const duplicateCloudRecords = mapCloudProjectToAssets(
  [asset("only", "FOTO/UNICA.JPG", 700)],
  [
    cloud("FOTO/UNICA.JPG", "UNICA.JPG", 700),
    cloud("FOTO/UNICA.JPG", "UNICA.JPG", 700),
  ],
);
assert.equal(duplicateCloudRecords.stateByAssetId.size, 1);
assert.equal(duplicateCloudRecords.ambiguousCount, 1);

assert.equal(normalizeImageRotation(undefined), 0);
assert.equal(normalizeImageRotation(-90), 270);
assert.equal(rotateImage(0, "right"), 90);
assert.equal(rotateImage(0, "left"), 270);
assert.equal(rotateImage(270, "right"), 0);
assert.equal(getRotatedContentFitScale(1600, 900, 1200, 800, 0), 1);
assert.ok(
  Math.abs(getRotatedContentFitScale(1600, 900, 1200, 800, 90) - (2 / 3)) < 0.0001,
  "La rotazione a quarto di giro deve riadattare l'immagine al contenitore senza tagliarla.",
);

let rapidSelection: string[] = [];
rapidSelection = togglePhotoSelection(rapidSelection, "photo-a");
rapidSelection = togglePhotoSelection(rapidSelection, "photo-b");
rapidSelection = togglePhotoSelection(rapidSelection, "photo-c");
assert.deepEqual(
  rapidSelection,
  ["photo-a", "photo-b", "photo-c"],
  "I click consecutivi devono accumulare la selezione usando sempre lo stato più recente.",
);
rapidSelection = togglePhotoSelection(rapidSelection, "photo-b");
assert.deepEqual(
  rapidSelection,
  ["photo-a", "photo-c"],
  "Deselezionare una card non deve ripristinare o eliminare altre selezioni.",
);

const filteredSelection = buildToggleAllSelection({
  selectAll: true,
  hasActiveFilters: true,
  selectedIds: ["hidden-1", "hidden-2", "visible-1"],
  visibleIds: ["visible-1", "visible-2"],
  allPhotoIds: ["hidden-1", "hidden-2", "visible-1", "visible-2"],
});
assert.deepEqual(
  filteredSelection,
  ["visible-1", "visible-2"],
  "Ctrl+A con filtri attivi deve sostituire la selezione ed escludere le foto nascoste.",
);
assert.equal(
  countSelectionOutsideFilter(
    ["visible-1", "visible-2", "hidden-1", "hidden-2"],
    new Set(["visible-1", "visible-2"]),
  ),
  2,
  "Il contatore deve separare le foto selezionate fuori filtro.",
);

assert.deepEqual(
  resolveRotationTargetIds("visible-1", ["visible-1", "hidden-1", "hidden-2"], "single"),
  ["visible-1"],
  "La rotazione dalla card o dall'anteprima deve riguardare soltanto la foto corrente.",
);
assert.deepEqual(
  resolveRotationTargetIds(null, ["visible-1", "hidden-1", "hidden-2"], "selection"),
  ["visible-1", "hidden-1", "hidden-2"],
  "La rotazione multipla deve essere disponibile soltanto come azione batch esplicita.",
);

assert.equal(
  shouldApplyExternalSelectionUpdate({
    sidecarLastModified: 1_000,
    persistedSelectionUpdatedAt: 900,
    localSelectionUpdatedAt: 1_100,
  }),
  false,
  "Un aggiornamento XMP tardivo non deve sovrascrivere una selezione locale più recente.",
);
assert.equal(
  shouldApplyExternalSelectionUpdate({
    sidecarLastModified: 1_200,
    persistedSelectionUpdatedAt: 900,
    localSelectionUpdatedAt: 1_100,
  }),
  true,
  "Una modifica XMP realmente più recente deve restare importabile.",
);

console.log("PhotoSelector workflow cases: PASS");
