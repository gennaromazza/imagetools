import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();

async function source(relativePath) {
  return readFile(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const coordinator = await source("apps/filex-desktop/src/filex-process-coordinator.ts");
const builder = await source("apps/filex-desktop/electron-builder.config.mjs");
const shutdownArgument = "--filex-update-shutdown";

assert(
  coordinator.includes("requestCooperativeShutdown(processNames)")
    && coordinator.includes("listRunningExecutablePaths(processNames)")
    && coordinator.includes("Get-Process -Name $names -ErrorAction SilentlyContinue")
    && coordinator.includes("Select-Object -ExpandProperty Path")
    && coordinator.includes("TOOL_COOPERATIVE_SHUTDOWN_TIMEOUT_MS")
    && coordinator.indexOf("requestCooperativeShutdown(processNames)") < coordinator.indexOf("terminateProcess(name, false)"),
  "L'updater non tenta prima la chiusura cooperativa del solo tool selezionato.",
);
assert(
  coordinator.includes("processNames.includes(normalizeProcessName(basename(executablePath)))")
    && coordinator.includes("mai FileX Suite o altri prodotti FileX"),
  "La chiusura cooperativa non e' limitata all'eseguibile atteso del tool.",
);
assert(
  builder.includes("guid: `2D3D396A-2B09-4B4E-9C18-${createHash")
    && builder.includes('update(requestedTool.id).digest("hex").slice(0, 12).toUpperCase()'),
  "Gli installer non hanno un'identita' NSIS stabile e distinta per tool.",
);

for (const relativePath of [
  "apps/filex-desktop/src/main.ts",
  "apps/cache-sweep/electron/main.ts",
  "apps/filex-send/electron/main.ts",
  "apps/backup-guard/electron/main.ts",
]) {
  const content = await source(relativePath);
  assert(
    content.includes(shutdownArgument) && content.includes('app.quit();'),
    `${relativePath} non riconosce la richiesta di chiusura per aggiornamento.`,
  );
}

console.log("FileX cooperative update shutdown: PASS");
