import { resolve } from "node:path";
import {
  listPhotoSelectorLegacyProjectsDesktop,
  readPhotoSelectorProjectFileDesktop,
  relocatePhotoSelectorProjectFileDesktop,
  reopenFolderDesktop,
  resolvePhotoSelectorProjectDesktop,
} from "../apps/filex-desktop/src/native-folder-service";
import {
  buildPlaceholderAssets,
  getAssetAbsolutePath,
  type FolderOpenResult,
} from "../apps/photo-selector-app/src/services/folder-access";
import { buildMasterProject } from "../apps/photo-selector-app/src/services/project-workflow";

const positional = process.argv.slice(2).filter((argument) => argument !== "--apply");
const shouldApply = process.argv.includes("--apply");
if (positional.length !== 2) {
  throw new Error("Uso: tsx scripts/correct-photo-selector-master.ts <master-attuale> <nuovo-master> [--apply]");
}

const sourceRoot = resolve(positional[0]);
const targetRoot = resolve(positional[1]);
const currentProject = await readPhotoSelectorProjectFileDesktop(sourceRoot);
if (currentProject?.projectMode !== "master") {
  throw new Error("Il percorso di origine non contiene un progetto master attivo.");
}

const scanned = await reopenFolderDesktop(targetRoot, {
  recursive: true,
  relativePathMode: "legacy",
});
if (!scanned || scanned.entries.length === 0) {
  throw new Error("La cartella di destinazione non contiene fotografie supportate.");
}
const folder: FolderOpenResult = {
  name: scanned.name,
  rootPath: scanned.rootPath,
  entries: scanned.entries,
};
const assets = buildPlaceholderAssets(folder.entries);
const legacyProjects = await listPhotoSelectorLegacyProjectsDesktop(targetRoot);
const merge = buildMasterProject(
  folder.name,
  currentProject.projectName ?? folder.name,
  assets,
  getAssetAbsolutePath,
  [...legacyProjects, { rootPath: sourceRoot, project: currentProject }],
);
const sourceFolderName = sourceRoot.split(/[\\/]+/).filter(Boolean).at(-1) ?? sourceRoot;
const targetSegments = targetRoot.split(/[\\/]+/).filter(Boolean);
const targetFolderName = targetSegments.at(-1) ?? targetRoot;
const targetSuggestedName = targetFolderName.toLocaleUpperCase() === "FOTO_SD" && targetSegments.at(-2)
  ? targetSegments.at(-2) as string
  : targetFolderName;
const currentProjectName = (currentProject.projectName ?? sourceFolderName).trim();
const correctedProjectName = currentProjectName.toLocaleLowerCase() === sourceFolderName.toLocaleLowerCase()
  ? targetSuggestedName
  : currentProjectName;
const relocatedProject = {
  ...merge.project,
  projectId: currentProject.projectId ?? merge.project.projectId,
  createdAt: currentProject.createdAt ?? merge.project.createdAt,
  projectName: correctedProjectName,
};

console.log(JSON.stringify({
  mode: shouldApply ? "apply" : "dry-run",
  sourceRoot,
  targetRoot,
  scannedFiles: scanned.entries.length,
  groupedAssets: assets.length,
  currentSelections: currentProject.folderState?.activeAssetIds?.length ?? 0,
  recoveredSelections: merge.migratedSelectionCount,
  recoveredMetadata: merge.migratedMetadataCount,
  legacyProjects: merge.legacyProjectCount,
}, null, 2));

if (!shouldApply) {
  process.exit(0);
}

const relocation = await relocatePhotoSelectorProjectFileDesktop(
  sourceRoot,
  targetRoot,
  relocatedProject,
);
if (!relocation.ok) {
  throw new Error(relocation.message ?? "Correzione non riuscita.");
}

const [sourceResolution, targetResolution, savedProject] = await Promise.all([
  resolvePhotoSelectorProjectDesktop(sourceRoot),
  resolvePhotoSelectorProjectDesktop(targetRoot),
  readPhotoSelectorProjectFileDesktop(targetRoot),
]);
if (sourceResolution !== null) {
  throw new Error("Il vecchio master risulta ancora attivo dopo la correzione.");
}
if (targetResolution?.rootPath.toLocaleLowerCase() !== targetRoot.toLocaleLowerCase()) {
  throw new Error("Il nuovo master non viene risolto dalla cartella di destinazione.");
}
if (savedProject?.projectMode !== "master") {
  throw new Error("Il nuovo file progetto non è leggibile come master.");
}

console.log(JSON.stringify({
  ok: true,
  sourceBackupPath: relocation.sourceBackupPath,
  targetBackupPath: relocation.targetBackupPath,
  savedAssets: savedProject.folderState?.assetStates?.length ?? 0,
  savedSelections: savedProject.folderState?.activeAssetIds?.length ?? 0,
}, null, 2));
