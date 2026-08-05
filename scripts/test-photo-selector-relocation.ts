import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DesktopPhotoSelectorProjectFile } from "@photo-tools/desktop-contracts";
import {
  readPhotoSelectorProjectFileDesktop,
  relocatePhotoSelectorProjectFileDesktop,
  resolvePhotoSelectorProjectDesktop,
} from "../apps/filex-desktop/src/native-folder-service";

const temporaryRoot = await mkdtemp(join(tmpdir(), "photo-selector-relocation-"));
const targetRoot = join(temporaryRoot, "Wedding");
await mkdir(targetRoot);
const sourceProject: DesktopPhotoSelectorProjectFile = {
  schemaVersion: 1,
  app: "image-select-pro",
  projectMode: "master",
  projectId: "project-test",
  projectName: "Container",
  projectRootFolderName: "Container",
  createdAt: 1,
  updatedAt: 1,
  folderState: { activeAssetIds: ["old"], assetStates: [] },
};
const legacyTarget: DesktopPhotoSelectorProjectFile = {
  schemaVersion: 1,
  app: "image-select-pro",
  projectName: "Legacy",
  updatedAt: 1,
  folderState: { activeAssetIds: [], assetStates: [] },
};
const relocatedProject: DesktopPhotoSelectorProjectFile = {
  ...sourceProject,
  projectName: "Wedding",
  projectRootFolderName: "Wedding",
  folderState: { activeAssetIds: ["new"], assetStates: [] },
};

try {
  await writeFile(join(temporaryRoot, ".image-select-pro.json"), JSON.stringify(sourceProject), "utf8");
  await writeFile(join(targetRoot, ".image-select-pro.json"), JSON.stringify(legacyTarget), "utf8");
  const result = await relocatePhotoSelectorProjectFileDesktop(
    temporaryRoot,
    targetRoot,
    relocatedProject,
  );
  assert.equal(result.ok, true);
  assert.ok(result.sourceBackupPath);
  assert.ok(result.targetBackupPath);
  assert.equal(await readFile(result.sourceBackupPath, "utf8").then(Boolean), true);
  assert.equal(await readFile(result.targetBackupPath, "utf8").then(Boolean), true);
  assert.equal(await resolvePhotoSelectorProjectDesktop(temporaryRoot), null);
  assert.equal((await resolvePhotoSelectorProjectDesktop(targetRoot))?.rootPath, targetRoot);
  const saved = await readPhotoSelectorProjectFileDesktop(targetRoot);
  assert.equal(saved?.projectName, "Wedding");
  assert.deepEqual(saved?.folderState?.activeAssetIds, ["new"]);
  console.log("PhotoSelector master relocation: PASS");
} finally {
  await rm(temporaryRoot, { recursive: true });
}
