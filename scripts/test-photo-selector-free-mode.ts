import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { DesktopFolderEntry } from "@photo-tools/desktop-contracts";
import type { ImageAsset } from "@photo-tools/shared-types";
import {
  buildDesktopSourceId,
  buildDesktopSourceInventoryFingerprint,
} from "../apps/filex-desktop/src/source-identity";
import {
  buildFallbackSourceIdentity,
  buildFreeSelectionSnapshot,
  buildWorkspaceAssetStates,
  getWorkspaceCatalogKey,
  shouldWriteProjectFile,
} from "../apps/photo-selector-app/src/services/workspace-mode";
import { getSubfolder } from "../apps/photo-selector-app/src/services/folder-access";

function desktopEntry(root: string, relativePath: string, size: number): DesktopFolderEntry {
  const separator = root.endsWith("\\") ? "" : "\\";
  return {
    name: relativePath.split(/[\\/]/).at(-1) ?? relativePath,
    relativePath: relativePath.replace(/\\/g, "/"),
    absolutePath: `${root}${separator}${relativePath}`,
    size,
    lastModified: 1_700_000_000_000,
    createdAt: 1_690_000_000_000,
  };
}

const sourceEntriesE = [
  desktopEntry("E:\\DCIM", "100CANON\\IMG_0001.CR3", 1_024),
  desktopEntry("E:\\DCIM", "100CANON\\IMG_0001.JPG", 512),
];
const sourceEntriesF = [
  desktopEntry("F:\\DCIM", "100CANON\\IMG_0001.CR3", 1_024),
  desktopEntry("F:\\DCIM", "100CANON\\IMG_0001.JPG", 512),
];
const inventoryE = buildDesktopSourceInventoryFingerprint("E:\\DCIM", sourceEntriesE);
const inventoryF = buildDesktopSourceInventoryFingerprint("F:\\DCIM", sourceEntriesF);
assert.equal(inventoryE.inventoryFingerprint, inventoryF.inventoryFingerprint);
assert.equal(inventoryE.fileCount, 2);
assert.equal(inventoryE.totalBytes, 1_536);

const volumeE = { mountPath: "E:\\", serialNumber: "CARD-123", isRemovable: true };
const volumeF = { mountPath: "F:\\", serialNumber: "CARD-123", isRemovable: true };
const stableE = buildDesktopSourceId("E:\\DCIM", inventoryE.inventoryFingerprint, volumeE);
const stableF = buildDesktopSourceId("F:\\DCIM", inventoryF.inventoryFingerprint, volumeF);
assert.equal(stableE.sourceId, stableF.sourceId, "La lettera assegnata da Windows non deve cambiare la sorgente.");
assert.equal(
  stableE.sourceId,
  buildDesktopSourceId("E:\\DCIM", "inventory-changed", volumeE).sourceId,
  "Con seriale volume disponibile, aggiungere foto non deve creare una nuova selezione libera.",
);
assert.notEqual(
  stableE.sourceId,
  buildDesktopSourceId("E:\\DCIM", inventoryE.inventoryFingerprint, {
    ...volumeE,
    serialNumber: "CARD-OTHER",
  }).sourceId,
);
const volumeWithoutSerialE = {
  mountPath: "E:\\",
  label: "FIELD CARD",
  filesystem: "exFAT",
  totalBytes: 64_000_000_000,
  isRemovable: true,
};
const volumeWithoutSerialF = { ...volumeWithoutSerialE, mountPath: "F:\\" };
assert.equal(
  buildDesktopSourceId("E:\\DCIM", inventoryE.inventoryFingerprint, volumeWithoutSerialE).sourceId,
  buildDesktopSourceId("F:\\DCIM", "inventory-changed", volumeWithoutSerialF).sourceId,
  "Anche senza seriale, il fallback del volume deve sopravvivere a cambio lettera e contenuto.",
);
assert.equal(
  buildDesktopSourceId("E:\\DCIM", inventoryE.inventoryFingerprint).sourceId,
  buildDesktopSourceId("F:\\DCIM", inventoryF.inventoryFingerprint).sourceId,
  "Senza seriale, l'inventario deve restare indipendente dal punto di montaggio.",
);

const fallbackE = buildFallbackSourceIdentity("DCIM", "E:\\DCIM", sourceEntriesE);
const fallbackF = buildFallbackSourceIdentity("DCIM", "F:\\DCIM", sourceEntriesF);
assert.equal(fallbackE.sourceId, fallbackF.sourceId);
assert.equal(
  getWorkspaceCatalogKey("free", "E:\\DCIM", fallbackE.sourceId),
  getWorkspaceCatalogKey("free", "F:\\DCIM", fallbackF.sourceId),
);
assert.notEqual(
  getWorkspaceCatalogKey("project", "E:\\DCIM", fallbackE.sourceId),
  getWorkspaceCatalogKey("project", "F:\\DCIM", fallbackF.sourceId),
);
assert.equal(shouldWriteProjectFile("project"), true);
assert.equal(shouldWriteProjectFile("free"), false);
assert.equal(shouldWriteProjectFile(null), false);
assert.equal(getSubfolder("100CANON/IMG_0001.CR3", "project-relative"), "100CANON");
assert.equal(getSubfolder("DCIM/100CANON/IMG_0001.CR3", "legacy"), "100CANON");

const asset: ImageAsset = {
  id: "asset-1",
  fileName: "IMG_0001.CR3",
  path: "100CANON/IMG_0001.CR3",
  sourceFileKey: `${fallbackE.sourceId}::100CANON/IMG_0001.CR3::1024::1700000000000`,
  size: 1_024,
  width: 100,
  height: 100,
  orientation: "square",
  aspectRatio: 1,
  rating: 5,
  pickStatus: "picked",
  colorLabel: "green",
  customLabels: ["portfolio"],
};
const assetStates = buildWorkspaceAssetStates(
  [asset],
  123,
  () => "E:\\DCIM\\100CANON\\IMG_0001.CR3",
  { activeAssetIds: [] },
);
assert.equal(assetStates[0]?.active, false);
assert.equal(assetStates[0]?.classificationUpdatedAt, 123);
assert.equal(assetStates[0]?.selectionUpdatedAt, 123);
const unchangedAssetStates = buildWorkspaceAssetStates(
  [asset],
  200,
  () => "E:\\DCIM\\100CANON\\IMG_0001.CR3",
  { activeAssetIds: [], previousStates: assetStates },
);
assert.equal(unchangedAssetStates[0]?.classificationUpdatedAt, 123);
assert.equal(unchangedAssetStates[0]?.selectionUpdatedAt, 123);
const selectedAssetStates = buildWorkspaceAssetStates(
  [asset],
  300,
  () => "E:\\DCIM\\100CANON\\IMG_0001.CR3",
  { activeAssetIds: [asset.id], previousStates: unchangedAssetStates },
);
assert.equal(selectedAssetStates[0]?.classificationUpdatedAt, 123);
assert.equal(selectedAssetStates[0]?.selectionUpdatedAt, 300);
const reclassifiedAssetStates = buildWorkspaceAssetStates(
  [{ ...asset, rating: 4 }],
  400,
  () => "E:\\DCIM\\100CANON\\IMG_0001.CR3",
  { activeAssetIds: [asset.id], previousStates: selectedAssetStates },
);
assert.equal(reclassifiedAssetStates[0]?.classificationUpdatedAt, 400);
assert.equal(reclassifiedAssetStates[0]?.selectionUpdatedAt, 300);
const emptySelectionSnapshot = buildFreeSelectionSnapshot({
  source: fallbackE,
  displayName: "Selezione sul campo",
  createdAt: 100,
  updatedAt: 123,
  activeAssetIds: [],
  assetStates,
});
assert.equal(emptySelectionSnapshot.mode, "free");
assert.deepEqual(emptySelectionSnapshot.activeAssetIds, []);
assert.equal(emptySelectionSnapshot.assetStates[0]?.rating, 5);

const [
  appSource,
  folderSource,
  driveSource,
  browserSource,
  headerSource,
  desktopStoreSource,
  nativeFolderSource,
  desktopMainSource,
  projectWorkflowSource,
] = await Promise.all([
  readFile("apps/photo-selector-app/src/App.tsx", "utf8"),
  readFile("apps/photo-selector-app/src/services/folder-access.ts", "utf8"),
  readFile("apps/filex-desktop/src/google-drive-service.ts", "utf8"),
  readFile("apps/photo-selector-app/src/components/FolderBrowser.tsx", "utf8"),
  readFile("apps/photo-selector-app/src/components/AppHeader.tsx", "utf8"),
  readFile("apps/filex-desktop/src/desktop-store.ts", "utf8"),
  readFile("apps/filex-desktop/src/native-folder-service.ts", "utf8"),
  readFile("apps/filex-desktop/src/main.ts", "utf8"),
  readFile("apps/photo-selector-app/src/services/project-workflow.ts", "utf8"),
]);
assert.match(appSource, /if \(shouldWriteProjectFile\(scheduledMode\)\)[\s\S]*updatePhotoSelectorProjectFile/);
assert.match(appSource, /else if \(scheduledSourceIdentity\)[\s\S]*saveFreeSelectionSnapshot/);
assert.match(appSource, /context\.mode === "free" \? resolvedSourceIdentity\.sourceId : undefined/);
assert.match(appSource, /reportFreePersistenceResult\(saved\)/);
assert.match(appSource, /await workspaceHydrationSettledRef\.current\.catch/);
assert.match(appSource, /workspacePersistenceStateRef\.current/);
assert.match(appSource, /onPrepareClose/);
assert.match(appSource, /completeClosePreparation/);
assert.match(appSource, /classificationUpdatedAt/);
assert.match(appSource, /selectionUpdatedAt/);
assert.match(appSource, /outgoingWorkspacePersisted: true/);
assert.match(appSource, /reopenedFolder = await reopenProjectFolder\(normalizedPath\)/);
assert.match(folderSource, /openFolder\(\{[\s\S]*recursive: true,[\s\S]*relativePathMode: "project-relative"/);
assert.match(folderSource, /diagnostics\.unreadableDirectoryCount = result\.diagnostics\?\.unreadableDirectoryCount \?\? 0/);
assert.match(folderSource, /generation === previewGeneration/);
assert.match(folderSource, /detectionGeneration === previewGeneration/);
assert.match(folderSource, /readSidecarXmpInfo/);
assert.match(driveSource, /Selezioni libere/);
assert.match(driveSource, /workspaceMode === "free"/);
assert.match(driveSource, /isUnsafeCloudSourceFileKey/);
assert.doesNotMatch(driveSource, /sourceFileKey\.split\("::", 1\)/);
assert.match(driveSource, /DRIVE_MANIFEST_READ_CONCURRENCY/);
assert.match(driveSource, /return versions\.filter\(\(version\): version is CompatibleCloudProjectVersion => version !== null\)/);
assert.match(browserSource, /Selezione libera/);
assert.match(browserSource, /Progetto master/);
assert.match(browserSource, /Consigliato per matrimoni, servizi e lavori articolati/);
assert.match(browserSource, /cartella, una scheda SD o un disco/);
assert.match(browserSource, /await handleBrowse\("resume"\)/);
assert.match(browserSource, /handleBrowse\("free"\)/);
assert.match(headerSource, /Modalità libera/);
assert.doesNotMatch(desktopStoreSource, /ALTER TABLE recent_folders ADD COLUMN mode TEXT DEFAULT 'free'/);
assert.match(desktopStoreSource, /row\.mode === "free" \? "free" : undefined/);
assert.match(desktopStoreSource, /classification_updated_at/);
assert.match(desktopStoreSource, /selectionUpdatedAt: assetRow\.selection_updated_at \?\? row\.updated_at/);
assert.match(nativeFolderSource, /if \(depth === 0\) \{\s*throw error;/);
assert.match(nativeFolderSource, /unreadableDirectoryCount \+= 1;\s*return;/);
assert.match(desktopMainSource, /filex:prepare-close/);
assert.match(desktopMainSource, /filex:complete-close-preparation/);
assert.match(desktopMainSource, /PHOTO_SELECTOR_CLOSE_PREPARATION_TIMEOUT_MS/);
assert.match(projectWorkflowSource, /classificationUpdatedAt/);
assert.match(projectWorkflowSource, /selectionUpdatedAt/);
assert.match(projectWorkflowSource, /active: selected/);

console.log("Image Select Pro free mode: PASS");
