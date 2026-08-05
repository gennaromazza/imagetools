import { resolve } from "node:path";
import {
  readPhotoSelectorProjectFileDesktop,
  reopenFolderDesktop,
  resolvePhotoSelectorProjectDesktop,
} from "../apps/filex-desktop/src/native-folder-service";
import { buildPlaceholderAssets } from "../apps/photo-selector-app/src/services/folder-access";

const rootArgument = process.argv[2];
if (!rootArgument) {
  throw new Error("Uso: tsx scripts/verify-photo-selector-project.ts <cartella-master>");
}
const rootPath = resolve(rootArgument);
const [project, location, scanned] = await Promise.all([
  readPhotoSelectorProjectFileDesktop(rootPath),
  resolvePhotoSelectorProjectDesktop(rootPath),
  reopenFolderDesktop(rootPath, { recursive: true, relativePathMode: "legacy" }),
]);
if (project?.projectMode !== "master" || !scanned) {
  throw new Error("Il progetto master non è leggibile.");
}
const assets = buildPlaceholderAssets(scanned.entries);
const assetIds = new Set(assets.map((asset) => asset.id));
const activeIds = project.folderState?.activeAssetIds ?? [];
const missingActiveIds = activeIds.filter((assetId) => !assetIds.has(assetId));
const stateById = new Map((project.folderState?.assetStates ?? []).map((state) => [state.assetId, state]));
console.log(JSON.stringify({
  rootPath,
  resolvedRoot: location?.rootPath ?? null,
  projectName: project.projectName,
  scannedFiles: scanned.entries.length,
  groupedAssets: assets.length,
  savedStates: project.folderState?.assetStates?.length ?? 0,
  savedSelections: activeIds.length,
  loadableSelections: activeIds.length - missingActiveIds.length,
  missingSelections: missingActiveIds.map((assetId) => ({
    assetId,
    relativePath: stateById.get(assetId)?.relativePath,
    absolutePath: stateById.get(assetId)?.absolutePath,
  })),
}, null, 2));
