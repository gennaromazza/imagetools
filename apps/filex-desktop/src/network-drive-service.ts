import { shell } from "electron";
import { mkdir, readdir, stat, statfs, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  NetworkDriveCheckStatus,
  NetworkDriveConfig,
  NetworkDriveDiagnosticItem,
  NetworkDriveEnvironmentReport,
  NetworkDriveHealth,
  NetworkDriveRepairResult,
  NetworkDriveSpaceInfo,
  NetworkDriveStatusReport,
} from "@photo-tools/desktop-contracts";
import {
  deleteDriveMapping,
  extractUncHost,
  getLocalComputerName,
  getLocalSmbShares,
  getMappedUncPath,
  getMappedNetworkDrives,
  launchDetached,
  mapDrive,
  pingHost,
  refreshDriveMapping,
} from "./network-drive-commands.js";
import {
  getNetworkDriveConfig,
  saveNetworkDriveConfig,
  saveNetworkDriveReport,
} from "./network-drive-config.js";
import { NetworkDriveLogger } from "./network-drive-logger.js";

const FS_TIMEOUT_MS = 4500;

type TimedResult<T> =
  | { ok: true; value: T; durationMs: number }
  | { ok: false; error: string; timedOut: boolean; durationMs: number };

function driveRoot(driveLetter: string): string {
  return `${driveLetter}\\`;
}

function compactError(error: unknown): string {
  if (error instanceof Error) {
    const code = "code" in error ? String((error as NodeJS.ErrnoException).code ?? "") : "";
    return code ? `${code}: ${error.message}` : error.message;
  }
  return String(error);
}

async function withTimeout<T>(operation: () => Promise<T>, timeoutMs = FS_TIMEOUT_MS): Promise<TimedResult<T>> {
  const startedAt = Date.now();
  let timer: NodeJS.Timeout | null = null;
  try {
    const value = await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
    return { ok: true, value, durationMs: Date.now() - startedAt };
  } catch (error) {
    const timedOut = error instanceof Error && error.message === "timeout";
    return {
      ok: false,
      error: timedOut ? `Timeout dopo ${timeoutMs} ms` : compactError(error),
      timedOut,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function item(
  id: string,
  label: string,
  status: NetworkDriveCheckStatus,
  message: string,
  durationMs?: number,
): NetworkDriveDiagnosticItem {
  return { id, label, status, message, durationMs };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "n/d";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function replayLogEntry(logger: NetworkDriveLogger, level: "info" | "warn" | "error", message: string): void {
  if (level === "error") {
    logger.error(message);
  } else if (level === "warn") {
    logger.warn(message);
  } else {
    logger.info(message);
  }
}

function resolveHealth(params: {
  configured: boolean;
  mappingPresent: boolean;
  mappingReadable: boolean;
  mappingNavigable: boolean;
  mappingWritable: boolean;
  mappingTimedOut: boolean;
  uncReachable: boolean;
}): NetworkDriveHealth {
  if (!params.configured) {
    return "misconfigured";
  }
  if (params.mappingTimedOut) {
    return "ghost-mapping";
  }
  if (!params.mappingPresent) {
    return params.uncReachable ? "missing-mapping" : "unreachable";
  }
  if (!params.mappingReadable || !params.mappingNavigable) {
    return params.uncReachable ? "ghost-mapping" : "unreachable";
  }
  if (!params.mappingWritable) {
    return "read-only";
  }
  return "healthy";
}

function buildHumanReport(
  config: NetworkDriveConfig,
  health: NetworkDriveHealth,
  space: NetworkDriveSpaceInfo | null,
  environment: NetworkDriveEnvironmentReport,
): { summary: string; humanReport: string } {
  const drive = config.driveLetter;
  const shareHint = environment.localShares[0]
    ? ` Questo PC condivide gia' ${environment.localShares[0].uncPath}.`
    : "";
  switch (health) {
    case "healthy":
      return {
        summary: `${drive} connesso`,
        humanReport: `${drive} e' collegato, navigabile e scrivibile.${space ? ` Spazio libero: ${formatBytes(space.availableBytes)} su ${formatBytes(space.totalBytes)}.` : ""}`,
      };
    case "missing-mapping":
      return {
        summary: `${drive} non mappato`,
        humanReport: `${drive} non e' mappato, ma il percorso rete configurato risponde. Puoi rimappare il disco.`,
      };
    case "ghost-mapping":
      return {
        summary: `${drive} bloccato o non risponde`,
        humanReport: `${drive} risulta presente ma non risponde entro il timeout. Probabile mapping fantasma Windows/SMB: usa Ripara disco quando nessun altro processo sta usando la cartella.`,
      };
    case "read-only":
      return {
        summary: `${drive} senza scrittura`,
        humanReport: `${drive} e' collegato ma non posso scrivere nella cartella. Probabile causa: permessi Windows/SMB o credenziali non corrette.`,
      };
    case "unreachable":
      return {
        summary: "Percorso rete non raggiungibile",
        humanReport: `Il percorso rete per ${drive} non risponde. Verifica che il PC/NAS sia acceso, nella stessa rete e che la condivisione sia attiva.`,
      };
    case "misconfigured":
      return {
        summary: "Configurazione incompleta",
        humanReport: environment.localShares.length > 0
          ? `Ho trovato cartelle condivise su questo PC. Se questo e' il PC archivio, usa una UNC suggerita e configura l'altro PC con lo stesso percorso.${shareHint}`
          : `Configura una lettera disco e un percorso UNC valido, per esempio \\\\NOME-PC\\Archivio. Se questo e' il PC archivio, prima condividi la cartella fotografica.`,
      };
    default:
      return {
        summary: "Stato non verificato",
        humanReport: "Esegui un controllo del disco per ottenere una diagnosi.",
      };
  }
}

async function buildEnvironmentReport(logger: NetworkDriveLogger): Promise<NetworkDriveEnvironmentReport> {
  const computerName = getLocalComputerName();
  const [rawShares, mappedDrives] = await Promise.all([
    getLocalSmbShares(),
    getMappedNetworkDrives(),
  ]);
  const localShares = await Promise.all(rawShares.map(async (share) => {
    const writableCheck = await withTimeout(async () => {
      const markerPath = join(share.path, ".network-drive-doctor-local-share-test.tmp");
      await writeFile(markerPath, `Network Drive Doctor ${new Date().toISOString()}\n`, "utf8");
      await unlink(markerPath);
    }, 2500);
    return {
      ...share,
      uncPath: computerName ? `\\\\${computerName}\\${share.name}` : `\\\\NOME-PC\\${share.name}`,
      writable: writableCheck.ok ? true : writableCheck.timedOut ? null : false,
    };
  }));

  let roleHint: NetworkDriveEnvironmentReport["roleHint"] = "unknown";
  if (localShares.length > 0 && mappedDrives.length > 0) {
    roleHint = "mixed";
  } else if (localShares.length > 0) {
    roleHint = "server";
  } else if (mappedDrives.length > 0) {
    roleHint = "client";
  }

  const setupHints: string[] = [];
  if (localShares.length > 0) {
    setupHints.push("Questo PC ha cartelle condivise: puo' essere il PC archivio/server.");
    setupHints.push("Sull'altro PC usa la UNC suggerita e mappala sulla stessa lettera disco.");
  } else {
    setupHints.push("Non ho trovato cartelle condivise non amministrative su questo PC.");
    setupHints.push("Se questo PC contiene l'archivio, condividi la cartella foto da Proprieta > Condivisione.");
  }
  if (mappedDrives.length > 0) {
    setupHints.push("Questo PC ha gia' dischi di rete mappati: verifica che puntino alla share corretta.");
  } else {
    setupHints.push("Non ho trovato dischi di rete mappati: se questo e' il PC client, configura il percorso UNC e premi Ripara disco.");
  }

  logger.info(`PC locale: ${computerName || "nome non rilevato"}`);
  logger.info(localShares.length > 0
    ? `Cartelle condivise locali trovate: ${localShares.map((share) => share.uncPath).join(", ")}`
    : "Nessuna cartella condivisa locale trovata");
  logger.info(mappedDrives.length > 0
    ? `Dischi rete mappati: ${mappedDrives.map((drive) => `${drive.driveLetter} -> ${drive.uncPath}`).join(", ")}`
    : "Nessun disco rete mappato trovato");

  return {
    computerName,
    localShares,
    mappedDrives,
    roleHint,
    setupHints,
  };
}

async function checkPath(
  targetPath: string,
  labelPrefix: string,
  diagnostics: NetworkDriveDiagnosticItem[],
  logger: NetworkDriveLogger,
): Promise<{
  readable: boolean;
  navigable: boolean;
  writable: boolean;
  timedOut: boolean;
  space: NetworkDriveSpaceInfo | null;
}> {
  let timedOut = false;
  const statResult = await withTimeout(() => stat(targetPath));
  if (statResult.ok && statResult.value.isDirectory()) {
    logger.info(`${labelPrefix} leggibile`);
    diagnostics.push(item(`${labelPrefix}-stat`, "Cartella leggibile", "ok", `${targetPath} risponde`, statResult.durationMs));
  } else {
    timedOut ||= !statResult.ok && statResult.timedOut;
    const status = !statResult.ok && statResult.timedOut ? "timeout" : "error";
    logger.warn(`${labelPrefix} non leggibile: ${statResult.ok ? "non e' una cartella" : statResult.error}`);
    diagnostics.push(item(`${labelPrefix}-stat`, "Cartella leggibile", status, statResult.ok ? "Il percorso non e' una cartella" : statResult.error, statResult.durationMs));
    return { readable: false, navigable: false, writable: false, timedOut, space: null };
  }

  const readdirResult = await withTimeout(() => readdir(targetPath));
  const navigable = readdirResult.ok;
  timedOut ||= !readdirResult.ok && readdirResult.timedOut;
  diagnostics.push(item(
    `${labelPrefix}-readdir`,
    "Cartella navigabile",
    readdirResult.ok ? "ok" : readdirResult.timedOut ? "timeout" : "error",
    readdirResult.ok ? `${readdirResult.value.length} elementi letti` : readdirResult.error,
    readdirResult.durationMs,
  ));
  logger[readdirResult.ok ? "info" : "warn"](
    readdirResult.ok ? `${labelPrefix} navigabile` : `${labelPrefix} non navigabile: ${readdirResult.error}`,
  );

  const healthDir = join(targetPath, ".healthcheck");
  const mkdirResult = await withTimeout(() => mkdir(healthDir, { recursive: true }));
  const writeBase = mkdirResult.ok ? healthDir : targetPath;
  const markerPath = join(writeBase, ".network-drive-doctor-test.tmp");
  const writeResult = await withTimeout(async () => {
    await writeFile(markerPath, `Network Drive Doctor ${new Date().toISOString()}\n`, "utf8");
    await unlink(markerPath);
  });
  const writable = writeResult.ok;
  timedOut ||= !writeResult.ok && writeResult.timedOut;
  diagnostics.push(item(
    `${labelPrefix}-write`,
    "Test scrittura",
    writable ? "ok" : writeResult.timedOut ? "timeout" : "error",
    writable ? `File marker creato e cancellato in ${writeBase}` : writeResult.error,
    writeResult.durationMs,
  ));
  logger[writable ? "info" : "warn"](
    writable ? "Test scrittura riuscito" : `Test scrittura fallito: ${writeResult.error}`,
  );

  const spaceResult = await withTimeout(async () => {
    const stats = await statfs(targetPath);
    return {
      availableBytes: Number(stats.bavail) * Number(stats.bsize),
      totalBytes: Number(stats.blocks) * Number(stats.bsize),
    };
  });
  const spaceInfo = spaceResult.ok ? spaceResult.value : null;
  timedOut ||= !spaceResult.ok && spaceResult.timedOut;
  diagnostics.push(item(
    `${labelPrefix}-space`,
    "Spazio disco",
    spaceResult.ok ? "ok" : spaceResult.timedOut ? "timeout" : "warning",
    spaceInfo
      ? `${formatBytes(spaceInfo.availableBytes)} disponibili su ${formatBytes(spaceInfo.totalBytes)}`
      : (!spaceResult.ok ? spaceResult.error : "Spazio non rilevabile"),
    spaceResult.durationMs,
  ));

  return {
    readable: true,
    navigable,
    writable,
    timedOut,
    space: spaceInfo,
  };
}

export async function diagnoseNetworkDrive(dataDir: string): Promise<NetworkDriveStatusReport> {
  const config = getNetworkDriveConfig(dataDir);
  const diagnostics: NetworkDriveDiagnosticItem[] = [];
  const logger = new NetworkDriveLogger();
  const rootPath = driveRoot(config.driveLetter);
  const configured = config.uncPath.startsWith("\\\\");
  const environment = await buildEnvironmentReport(logger);

  diagnostics.push(item(
    "local-shares",
    "Cartelle condivise locali",
    environment.localShares.length > 0 ? "ok" : "warning",
    environment.localShares.length > 0
      ? environment.localShares.map((share) => share.uncPath).join(", ")
      : "Nessuna cartella condivisa rilevata su questo PC",
  ));
  diagnostics.push(item(
    "mapped-drives",
    "Dischi rete mappati",
    environment.mappedDrives.length > 0 ? "ok" : "warning",
    environment.mappedDrives.length > 0
      ? environment.mappedDrives.map((drive) => `${drive.driveLetter} -> ${drive.uncPath}`).join(", ")
      : "Nessun disco di rete mappato rilevato",
  ));

  logger.info(`Controllo ${config.driveLetter}`);
  const mappedUnc = await getMappedUncPath(config.driveLetter);
  const mappingPresent = Boolean(mappedUnc);
  diagnostics.push(item(
    "mapping",
    "Mapping presente",
    mappingPresent ? "ok" : "warning",
    mappingPresent ? `Mapping trovato: ${mappedUnc}` : `${config.driveLetter} non risulta mappato come disco di rete`,
  ));
  logger[mappingPresent ? "info" : "warn"](
    mappingPresent ? `Mapping trovato: ${mappedUnc}` : `Mapping mancante: ${config.driveLetter}`,
  );

  let uncReachable = false;
  if (configured) {
    const host = extractUncHost(config.uncPath);
    if (host) {
      const ping = await pingHost(host);
      diagnostics.push(item(
        "host",
        "Host raggiungibile",
        ping.ok ? "ok" : ping.timedOut ? "timeout" : "warning",
        ping.ok ? `Host ${host} raggiungibile` : `Ping ${host} non riuscito`,
      ));
      logger[ping.ok ? "info" : "warn"](ping.ok ? `Host ${host} raggiungibile` : `Host ${host} non raggiungibile via ping`);
    }

    const uncStat = await withTimeout(() => stat(config.uncPath));
    uncReachable = uncStat.ok && uncStat.value.isDirectory();
    diagnostics.push(item(
      "unc",
      "Percorso UNC diretto",
      uncReachable ? "ok" : uncStat.ok ? "error" : uncStat.timedOut ? "timeout" : "error",
      uncReachable ? `${config.uncPath} accessibile` : uncStat.ok ? "Il percorso UNC non e' una cartella" : uncStat.error,
      uncStat.durationMs,
    ));
    logger[uncReachable ? "info" : "warn"](
      uncReachable ? `Percorso rete accessibile: ${config.uncPath}` : `Percorso rete non accessibile: ${config.uncPath}`,
    );
  } else {
    diagnostics.push(item("unc", "Percorso UNC diretto", "skipped", "Percorso UNC non configurato"));
    logger.warn("Percorso UNC non configurato");
  }

  const driveCheck = mappingPresent
    ? await checkPath(rootPath, "drive", diagnostics, logger)
    : { readable: false, navigable: false, writable: false, timedOut: false, space: null };

  const health = resolveHealth({
    configured,
    mappingPresent,
    mappingReadable: driveCheck.readable,
    mappingNavigable: driveCheck.navigable,
    mappingWritable: driveCheck.writable,
    mappingTimedOut: driveCheck.timedOut,
    uncReachable,
  });
  const reportText = buildHumanReport(config, health, driveCheck.space, environment);
  logger.info(reportText.humanReport);

  const report: NetworkDriveStatusReport = {
    config,
    checkedAt: Date.now(),
    health,
    ...reportText,
    mappedUnc,
    mappingPresent,
    mappingReadable: driveCheck.readable,
    mappingNavigable: driveCheck.navigable,
    mappingWritable: driveCheck.writable,
    mappingTimedOut: driveCheck.timedOut,
    uncReachable,
    space: driveCheck.space,
    environment,
    diagnostics,
    logs: logger.list(),
  };
  saveNetworkDriveReport(dataDir, report);
  return report;
}

export async function repairNetworkDrive(dataDir: string): Promise<NetworkDriveRepairResult> {
  const logger = new NetworkDriveLogger();
  const before = await diagnoseNetworkDrive(dataDir);
  for (const entry of before.logs) {
    replayLogEntry(logger, entry.level, entry.message);
  }

  const uncPath = before.config.uncPath || before.mappedUnc || "";
  if (!uncPath.startsWith("\\\\")) {
    const status = before;
    const message = "Percorso UNC non configurato: impossibile rimappare il disco.";
    logger.error(message);
    return { ok: false, message, status, logs: logger.list() };
  }

  if (!before.uncReachable) {
    const message = "Il percorso UNC non risponde: non rimappo il disco finche' la share non torna raggiungibile.";
    logger.error(message);
    return { ok: false, message, status: before, logs: logger.list() };
  }

  logger.info(`Refresh mapping ${before.config.driveLetter}`);
  await refreshDriveMapping(before.config.driveLetter);
  const afterRefresh = await diagnoseNetworkDrive(dataDir);
  if (afterRefresh.health === "healthy" || afterRefresh.health === "read-only") {
    const message = afterRefresh.health === "healthy"
      ? "Disco ripristinato con refresh mapping."
      : "Mapping ripristinato, ma resta un problema di scrittura.";
    logger.info(message);
    return { ok: afterRefresh.health === "healthy", message, status: afterRefresh, logs: logger.list() };
  }

  logger.warn(`Rimuovo mapping ${before.config.driveLetter}`);
  await deleteDriveMapping(before.config.driveLetter);
  logger.info(`Rimappo ${before.config.driveLetter} -> ${uncPath}`);
  const mapped = await mapDrive(before.config.driveLetter, uncPath);
  if (!mapped.ok) {
    logger.error(mapped.timedOut ? "Rimappatura scaduta per timeout" : `Rimappatura fallita: ${mapped.stderr || mapped.stdout}`);
  }

  const finalStatus = await diagnoseNetworkDrive(dataDir);
  const ok = finalStatus.health === "healthy";
  const message = ok
    ? "Disco rimappato e verificato."
    : finalStatus.humanReport;
  logger[ok ? "info" : "warn"](message);
  return {
    ok,
    message,
    status: finalStatus,
    logs: logger.list(),
  };
}

export function getStoredNetworkDriveConfig(dataDir: string): NetworkDriveConfig {
  return getNetworkDriveConfig(dataDir);
}

export function updateNetworkDriveConfig(
  dataDir: string,
  config: Partial<NetworkDriveConfig>,
): NetworkDriveConfig {
  return saveNetworkDriveConfig(dataDir, config);
}

export async function openNetworkDriveTarget(
  dataDir: string,
  target: "drive" | "unc" | "credentials" | "network-settings" | "sharing-settings",
): Promise<{ ok: boolean; message?: string }> {
  const config = getNetworkDriveConfig(dataDir);
  let shellError = "";
  if (target === "drive") {
    shellError = await shell.openPath(driveRoot(config.driveLetter));
  } else if (target === "unc") {
    if (!config.uncPath) {
      return { ok: false, message: "Percorso UNC non configurato" };
    }
    shellError = await shell.openPath(config.uncPath);
  } else if (target === "credentials") {
    launchDetached("control.exe", ["/name", "Microsoft.CredentialManager"]);
  } else if (target === "sharing-settings") {
    launchDetached("control.exe", ["/name", "Microsoft.NetworkAndSharingCenter"]);
  } else {
    await shell.openExternal("ms-settings:network");
  }

  return shellError ? { ok: false, message: shellError } : { ok: true };
}
