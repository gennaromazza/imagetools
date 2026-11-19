import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopPhotoSelectorProjectFile } from "@photo-tools/desktop-contracts";
import { updatePhotoSelectorProjectFile } from "./desktop-store";
import { buildProjectFileAutosave } from "./workspace-mode";

const master: DesktopPhotoSelectorProjectFile = {
  schemaVersion: 1,
  app: "image-select-pro",
  updatedAt: 1,
  projectMode: "master",
  projectId: "progetto-1",
  projectRootFolderName: "Matrimonio",
  createdAt: 100,
  projectName: "Vecchio nome",
  folderState: { activeAssetIds: ["a"], assetStates: [] },
};

const patch = { projectName: "Nuovo nome", activeAssetIds: ["b", "c"], assetStates: [], updatedAt: 2 };

test("il salvataggio automatico aggiorna lo stato e conserva i campi del progetto master", () => {
  const next = buildProjectFileAutosave(master, patch);
  assert.ok(next);
  assert.equal(next.projectMode, "master");
  assert.equal(next.projectId, "progetto-1");
  assert.equal(next.projectRootFolderName, "Matrimonio");
  assert.equal(next.createdAt, 100);
  assert.equal(next.projectName, "Nuovo nome");
  assert.equal(next.updatedAt, 2);
  assert.deepEqual(next.folderState?.activeAssetIds, ["b", "c"]);
});

test("se il file progetto non si è letto (assente, rotto o bloccato) il salvataggio automatico non lo riscrive", () => {
  assert.equal(buildProjectFileAutosave(null, patch), null);
});

function stubDesktopApi(readResult: DesktopPhotoSelectorProjectFile | null) {
  const writes: DesktopPhotoSelectorProjectFile[] = [];
  (globalThis as { window?: unknown }).window = {
    filexDesktop: {
      readPhotoSelectorProjectFile: async () => readResult,
      writePhotoSelectorProjectFile: async (_root: string, project: DesktopPhotoSelectorProjectFile) => {
        writes.push(project);
        return true;
      },
    },
  };
  return writes;
}

test("updatePhotoSelectorProjectFile non scrive quando chi aggiorna rifiuta (null) e restituisce false", async () => {
  const writes = stubDesktopApi(null);
  const saved = await updatePhotoSelectorProjectFile("C:/foto", (existing) => buildProjectFileAutosave(existing, patch));
  assert.equal(saved, false);
  assert.equal(writes.length, 0);
});

test("updatePhotoSelectorProjectFile scrive quando il file si è letto", async () => {
  const writes = stubDesktopApi(master);
  const saved = await updatePhotoSelectorProjectFile("C:/foto", (existing) => buildProjectFileAutosave(existing, patch));
  assert.equal(saved, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.projectId, "progetto-1");
});

test("i flussi espliciti (creazione master, rinomina) possono ancora creare il file da zero", async () => {
  const writes = stubDesktopApi(null);
  const saved = await updatePhotoSelectorProjectFile("C:/foto", () => master);
  assert.equal(saved, true);
  assert.equal(writes.length, 1);
});
