import { resolve } from "node:path";
import {
  readPhotoSelectorProjectFileDesktop,
  writePhotoSelectorProjectFileDesktop,
} from "../apps/filex-desktop/src/native-folder-service";

const [rootArgument, ...nameParts] = process.argv.slice(2);
const projectName = nameParts.join(" ").trim();
if (!rootArgument || !projectName) {
  throw new Error("Uso: tsx scripts/rename-photo-selector-project.ts <cartella-master> <nuovo-nome>");
}

const rootPath = resolve(rootArgument);
const project = await readPhotoSelectorProjectFileDesktop(rootPath);
if (project?.projectMode !== "master") {
  throw new Error("La cartella non contiene un progetto master attivo.");
}
const written = await writePhotoSelectorProjectFileDesktop(rootPath, {
  ...project,
  projectName,
  updatedAt: Date.now(),
});
if (!written) {
  throw new Error("Rinomina del progetto non riuscita.");
}
const verified = await readPhotoSelectorProjectFileDesktop(rootPath);
if (verified?.projectName !== projectName) {
  throw new Error("La verifica della rinomina non è riuscita.");
}
console.log(JSON.stringify({
  ok: true,
  rootPath,
  projectName: verified.projectName,
  assets: verified.folderState?.assetStates?.length ?? 0,
  selections: verified.folderState?.activeAssetIds?.length ?? 0,
}, null, 2));
