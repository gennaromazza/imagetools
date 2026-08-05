import assert from "node:assert/strict";
import type {
  DesktopCloudPhotoState,
  DesktopFolderCatalogAssetState,
  DesktopPhotoSelectorProjectLocation,
} from "@photo-tools/desktop-contracts";
import type { ImageAsset } from "@photo-tools/shared-types";
import { mapCloudProjectToAssets } from "../apps/photo-selector-app/src/services/cloud-project-mapping";
import { buildMasterProject } from "../apps/photo-selector-app/src/services/project-workflow";

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

console.log("PhotoSelector workflow cases: PASS");
