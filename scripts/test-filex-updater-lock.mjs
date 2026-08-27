import { createPackage, extractFile } from "@electron/asar";
import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workspaceRoot = process.cwd();
const temporaryRoot = await mkdtemp(join(tmpdir(), "filex-asar-lock-test-"));

try {
  const sourceDirectory = join(temporaryRoot, "source");
  const archivePath = join(temporaryRoot, "app.asar");
  const movedArchivePath = join(temporaryRoot, "app-moved.asar");
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(
    join(sourceDirectory, "package.json"),
    JSON.stringify({ name: "filex-lock-test", version: "9.8.7" }),
    "utf8",
  );
  await createPackage(sourceDirectory, archivePath);

  const packageJson = JSON.parse(
    extractFile(archivePath, "package.json").toString("utf8"),
  );
  if (packageJson.version !== "9.8.7") {
    throw new Error("La versione estratta dall'archivio ASAR non coincide.");
  }

  // Su Windows la rename fallisce se il reader lascia app.asar aperto.
  await rename(archivePath, movedArchivePath);

  const updaterSource = await readFile(
    join(workspaceRoot, "apps/filex-desktop/src/updater.ts"),
    "utf8",
  );
  const mainSource = await readFile(
    join(workspaceRoot, "apps/filex-desktop/src/main.ts"),
    "utf8",
  );
  const builderConfig = await readFile(
    join(workspaceRoot, "apps/filex-desktop/electron-builder.config.mjs"),
    "utf8",
  );

  const virtualAsarRead = 'readFileSync(join(archivePath, "package.json"), "utf8")';
  const explicitAsarFallback = 'extractFile(archivePath, "package.json")';
  const virtualReadIndex = updaterSource.indexOf(virtualAsarRead);
  const fallbackIndex = updaterSource.indexOf(explicitAsarFallback);
  if (virtualReadIndex >= 0) {
    throw new Error("L'updater usa ancora il filesystem ASAR virtuale che mantiene aperti i tool installati.");
  }
  if (fallbackIndex < 0 || !updaterSource.includes("uncache(archivePath);")) {
    throw new Error("L'updater non usa il reader ASAR esplicito con invalidazione della cache.");
  }
  if (!mainSource.includes("Promise.allSettled([")) {
    throw new Error("La chiusura desktop non attende i servizi nativi.");
  }
  if (!builderConfig.includes("!macro customUnInstallCheck")) {
    throw new Error("L'installer non gestisce gli errori NSIS senza modale bloccante.");
  }

  console.log("FileX updater ASAR lock regression: PASS");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
