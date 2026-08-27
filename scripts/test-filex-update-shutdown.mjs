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
const snapshotCache = await source("apps/filex-desktop/src/process-snapshot-cache.ts");
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
  coordinator.includes('promisify(execFile)')
    && coordinator.includes('const execFileAsync = promisify(execFile)')
    && !coordinator.includes("execFileSync")
    && coordinator.includes("SAFE_PROCESS_NAME = /^[a-z0-9_.-]+$/i")
    && snapshotCache.includes("export class ProcessSnapshotCache")
    && coordinator.includes("processSnapshotCache.get(listRunningProcessNames)")
    && coordinator.includes("openInstallerWithRetry")
    && coordinator.includes("taskkill non riuscito"),
  "Il coordinatore usa ancora chiamate sincrone o non protegge il fallback taskkill.",
);
assert(
  coordinator.includes("processNames.includes(normalizeProcessName(basename(executablePath)))")
    && coordinator.includes("mai FileX Suite o altri prodotti FileX"),
  "La chiusura cooperativa non e' limitata all'eseguibile atteso del tool.",
);
assert(
  builder.includes('guid: requestedTool.id === "filex-send"')
    && builder.includes("? undefined")
    && builder.includes(': `2D3D396A-2B09-4B4E-9C18-${createHash')
    && builder.includes('update(requestedTool.id).digest("hex").slice(0, 12).toUpperCase()'),
  "Gli installer non preservano l'identita' NSIS storica di FileX Send e quella distinta degli altri tool.",
);
assert(
  builder.includes("const shellAssociationRefreshLine = shouldInstallExplorerContextMenu")
    && builder.includes("${shellAssociationRefreshLine}"),
  "Gli installer senza associazioni Explorer possono ancora invocare il plugin NSIS System.dll non necessario.",
);
assert(
  builder.includes('const filexSendPerUserInstallSeed = tool.id === "filex-send"')
    && builder.includes('WriteRegStr HKCU "Software\\\\\\${APP_GUID}" "InstallLocation" "$LOCALAPPDATA\\\\Programs\\\\FileX-Send"'),
  "La prima installazione FileX Send non evita il resolver Known Folder incompatibile.",
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
