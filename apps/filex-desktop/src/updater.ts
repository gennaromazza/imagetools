import * as electron from "electron";
import { execFileSync, spawn } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { unlink, readFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { dirname, join } from "node:path";
import type {
  DesktopReleaseChannel,
  DesktopReleaseManifest,
  DesktopToolId,
  DesktopToolInstallState,
  DesktopToolReleaseEntry,
  DesktopToolUpdateCheckResult,
  DesktopToolUpdateJob,
} from "@photo-tools/desktop-contracts";
import { launchToolUpdateAndRestartSuite } from "./filex-process-coordinator.js";
import { desktopToolManifest, getSuiteManagedTools, type DesktopToolDescriptor } from "./tool-manifest.js";

const { app } = electron;

const ALLOWED_RELEASE_HOSTS = new Set([
  "github.com",
  "api.github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "raw.githubusercontent.com",
]);
const UPDATE_RETRY_LIMIT = 2;
const updateJobs = new Map<string, DesktopToolUpdateJob>();

function now(): number {
  return Date.now();
}

function sanitizeChannel(channel: DesktopReleaseChannel | undefined): DesktopReleaseChannel {
  if (channel === "beta") return "beta";
  return "stable";
}

function normalizeVersion(value: string | null | undefined): number[] {
  const clean = (value ?? "").replace(/^v/i, "").trim();
  if (!clean) return [0];
  return clean
    .split(".")
    .map((part) => Number.parseInt(part.replace(/[^\d].*$/g, ""), 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function compareVersions(left: string | null | undefined, right: string | null | undefined): number {
  const leftParts = normalizeVersion(left);
  const rightParts = normalizeVersion(right);
  const maxLength = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < maxLength; index += 1) {
    const a = leftParts[index] ?? 0;
    const b = rightParts[index] ?? 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

function getReleaseManifestUrl(channel: DesktopReleaseChannel): string {
  const explicitForChannel =
    channel === "beta"
      ? process.env.FILEX_RELEASE_MANIFEST_BETA_URL
      : process.env.FILEX_RELEASE_MANIFEST_STABLE_URL;
  if (explicitForChannel?.trim()) {
    return explicitForChannel.trim();
  }

  const generic = process.env.FILEX_RELEASE_MANIFEST_URL?.trim();
  if (generic) {
    return generic.replace("{channel}", channel);
  }

  return `https://github.com/gennaromazza/imagetools/releases/latest/download/${channel}.json`;
}

function isAllowedReleaseUrl(urlValue: string): boolean {
  try {
    const parsed = new URL(urlValue);
    if (parsed.protocol !== "https:") return false;
    return ALLOWED_RELEASE_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function requestJson(urlValue: string, redirectCount = 0): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlValue);
    const client = parsed.protocol === "http:" ? http : https;
    const request = client.get(
      parsed,
      {
        headers: {
          "User-Agent": "FileX-Suite-Updater/1.0",
          Accept: "application/json",
        },
      },
      (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
          const location = response.headers.location;
          if (!location || redirectCount >= 5) {
            reject(new Error("Manifest redirect non valido"));
            return;
          }
          const redirectedUrl = new URL(location, parsed).toString();
          if (!isAllowedReleaseUrl(redirectedUrl)) {
            reject(new Error("Manifest redirect non autorizzato"));
            return;
          }
          response.resume();
          requestJson(redirectedUrl, redirectCount + 1).then(resolve, reject);
          return;
        }
        if (!response.statusCode || response.statusCode >= 400) {
          reject(new Error(`Manifest request failed (${response.statusCode ?? "unknown"})`));
          return;
        }
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          try {
            const text = Buffer.concat(chunks).toString("utf8");
            resolve(JSON.parse(text) as unknown);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("error", reject);
  });
}

function isDesktopReleaseManifest(value: unknown): value is DesktopReleaseManifest {
  const manifest = value as DesktopReleaseManifest;
  return (
    Boolean(manifest) &&
    manifest.schemaVersion === 1 &&
    Array.isArray(manifest.channels) &&
    Array.isArray(manifest.releases) &&
    manifest.releases.every((release) =>
      Array.isArray(release.highlights)
      && release.highlights.length > 0
      && release.highlights.every((item) => typeof item === "string" && item.trim().length > 0),
    )
  );
}

function verifyManifestIntegrity(manifest: DesktopReleaseManifest): boolean {
  const payload = JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    generatedAt: manifest.generatedAt,
    generatedBy: manifest.generatedBy,
    channels: manifest.channels,
    releases: manifest.releases,
  });
  const payloadSha256 = createHash("sha256").update(payload).digest("hex");
  if (manifest.payloadSha256 && manifest.payloadSha256 !== payloadSha256) {
    return false;
  }

  if (manifest.payloadSignature && manifest.signatureAlgorithm === "hmac-sha256") {
    const signatureKey = process.env.FILEX_MANIFEST_HMAC_KEY?.trim();
    if (!signatureKey) {
      return false;
    }
    const expectedSignature = createHmac("sha256", signatureKey)
      .update(payload)
      .digest("hex");
    if (manifest.payloadSignature !== expectedSignature) {
      return false;
    }
  }

  return true;
}

export async function loadReleaseManifest(channelInput?: DesktopReleaseChannel): Promise<DesktopReleaseManifest> {
  const channel = sanitizeChannel(channelInput);
  const urlValue = getReleaseManifestUrl(channel);
  if (isAllowedReleaseUrl(urlValue)) {
    try {
      const raw = await requestJson(urlValue);
      // An empty remote manifest is valid JSON but cannot power the Suite
      // installer. Fall through to the bundled manifest while a release is
      // being published or when the remote index is temporarily stale.
      if (isDesktopReleaseManifest(raw) && verifyManifestIntegrity(raw) && raw.releases.length > 0) {
        return raw;
      }
    } catch {
      // fallback to bundled manifest
    }
  }

  const localManifestPath = app.isPackaged
    ? join(process.resourcesPath, "release-manifests", `${channel}.json`)
    : join(app.getAppPath(), "release-manifests", `${channel}.json`);
  const localManifestRaw = JSON.parse(await readFile(localManifestPath, "utf8")) as unknown;
  if (!isDesktopReleaseManifest(localManifestRaw) || !verifyManifestIntegrity(localManifestRaw)) {
    throw new Error("Release manifest non valido");
  }
  return localManifestRaw;
}

function resolveExecutableCandidates(toolId: DesktopToolId): string[] {
  const descriptor: DesktopToolDescriptor = desktopToolManifest[toolId];
  const candidates = new Set<string>();

  if (toolId === desktopToolManifest["suite-launcher"].id && app.isPackaged) {
    candidates.add(process.execPath);
  }
  if (toolId !== "suite-launcher") {
    const thisRequestedToolId = process.env.FILEX_TOOL as DesktopToolId | undefined;
    if (thisRequestedToolId === toolId && app.isPackaged) {
      candidates.add(process.execPath);
    }
  }

  // NSIS installations and older FileX releases used both display names and
  // executable-safe names for their folders. Try every known combination so
  // Suite tools can discover one another across upgrades.
  const folderNames = Array.from(new Set([
    descriptor.productName,
    descriptor.executableName,
    ...(descriptor.legacyUpgradeDisplayNames ?? []),
    ...(descriptor.legacyExecutableNames ?? []),
  ]));
  const executableNames = Array.from(new Set([
    descriptor.executableName,
    ...(descriptor.legacyExecutableNames ?? []),
  ])).map((name) => name.toLowerCase().endsWith(".exe") ? name : `${name}.exe`);

  const installRoots = new Set<string>();
  if (process.env.LOCALAPPDATA) installRoots.add(join(process.env.LOCALAPPDATA, "Programs"));
  if (process.env.ProgramFiles) installRoots.add(process.env.ProgramFiles);
  if (process.env["ProgramFiles(x86)"]) installRoots.add(process.env["ProgramFiles(x86)"]!);
  if (app.isPackaged) installRoots.add(dirname(dirname(process.execPath)));

  for (const installRoot of installRoots) {
    for (const folderName of folderNames) {
      for (const executableName of executableNames) {
        candidates.add(join(installRoot, folderName, executableName));
      }
    }
  }

  return Array.from(candidates);
}

function readExecutableVersion(executablePath: string): string | null {
  if (process.platform !== "win32") return null;
  try {
    const packagePath = join(dirname(executablePath), "resources", "app.asar", "package.json");
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown };
    if (typeof packageJson.version === "string" && packageJson.version.trim()) {
      return packageJson.version.trim();
    }
  } catch {
    // Fall back to the Windows executable metadata for older installations.
  }
  try {
    const escapedPath = executablePath.replace(/'/g, "''");
    const output = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", `(Get-Item -LiteralPath '${escapedPath}').VersionInfo.ProductVersion`],
      { encoding: "utf8", windowsHide: true, timeout: 4000 },
    ).trim();
    return output || null;
  } catch {
    return null;
  }
}

function detectInstalledExecutable(toolId: DesktopToolId): { path: string | null; version: string | null } {
  for (const candidate of resolveExecutableCandidates(toolId)) {
    try {
      if (!candidate || !existsSync(candidate)) continue;
      const stats = statSync(candidate);
      if (!stats.isFile()) continue;
      return {
        path: candidate,
        version: readExecutableVersion(candidate),
      };
    } catch {
      // keep scanning next candidate
    }
  }
  return { path: null, version: null };
}

function pickLatestRelease(
  manifest: DesktopReleaseManifest,
  toolId: DesktopToolId,
  channel: DesktopReleaseChannel,
): DesktopToolReleaseEntry | null {
  const candidates = manifest.releases
    .filter((release) => release.toolId === toolId && release.channel === channel)
    .sort((left, right) => compareVersions(right.version, left.version));
  return candidates[0] ?? null;
}

export async function listAvailableTools(channelInput?: DesktopReleaseChannel): Promise<DesktopToolInstallState[]> {
  const channel = sanitizeChannel(channelInput);
  const manifest = await loadReleaseManifest(channel);

  return getSuiteManagedTools().map((tool) => {
    const installed = detectInstalledExecutable(tool.id);
    const latest = pickLatestRelease(manifest, tool.id, channel);
    const hasUpdate =
      Boolean(installed.path) &&
      Boolean(latest?.version) &&
      (!installed.version || compareVersions(latest?.version, installed.version) > 0);
    return {
      toolId: tool.id,
      toolName: tool.displayName,
      productName: tool.productName,
      installed: Boolean(installed.path),
      executablePath: installed.path,
      installedVersion: installed.version,
      latestVersion: latest?.version ?? null,
      releaseHighlights: Array.isArray(latest?.highlights)
        ? latest.highlights.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [],
      status: hasUpdate ? "update-available" : installed.path ? "installed" : "not-installed",
    };
  });
}

export async function checkToolUpdate(
  toolId: DesktopToolId,
  currentVersionInput?: string | null,
  channelInput?: DesktopReleaseChannel,
): Promise<DesktopToolUpdateCheckResult> {
  const channel = sanitizeChannel(channelInput);
  const manifest = await loadReleaseManifest(channel);
  const release = pickLatestRelease(manifest, toolId, channel);
  const installed = detectInstalledExecutable(toolId);
  const currentVersion = currentVersionInput ?? installed.version;
  if (!release) {
    return {
      toolId,
      channel,
      currentVersion,
      available: false,
      release: null,
      reason: "not-found",
    };
  }
  if (!installed.path && !currentVersionInput) {
    return {
      toolId,
      channel,
      currentVersion,
      available: true,
      release,
      reason: "not-installed",
    };
  }
  const updateAvailable = compareVersions(release.version, currentVersion) > 0;
  return {
    toolId,
    channel,
    currentVersion,
    available: updateAvailable,
    release,
    reason: updateAvailable ? "new-version" : "up-to-date",
  };
}

function getUpdateCacheDirectory(): string {
  const directory = join(app.getPath("userData"), "updates");
  mkdirSync(directory, { recursive: true });
  return directory;
}

function createJob(toolId: DesktopToolId, channel: DesktopReleaseChannel): DesktopToolUpdateJob {
  const timestamp = now();
  const job: DesktopToolUpdateJob = {
    id: `${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    toolId,
    channel,
    status: "queued",
    installerPath: null,
    releaseVersion: null,
    downloadedBytes: 0,
    totalBytes: null,
    checksumVerified: false,
    retries: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  updateJobs.set(job.id, job);
  return job;
}

function patchJob(jobId: string, partial: Partial<DesktopToolUpdateJob>): DesktopToolUpdateJob {
  const current = updateJobs.get(jobId);
  if (!current) {
    throw new Error(`Update job non trovato: ${jobId}`);
  }
  const next = {
    ...current,
    ...partial,
    updatedAt: now(),
  };
  updateJobs.set(jobId, next);
  return next;
}

function downloadFile(
  urlValue: string,
  destinationPath: string,
  onProgress: (downloaded: number, total: number | null) => void,
  redirectCount = 0,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error("Troppi redirect durante il download"));
      return;
    }
    const parsed = new URL(urlValue);
    const client = parsed.protocol === "http:" ? http : https;
    const request = client.get(
      parsed,
      {
        headers: {
          "User-Agent": "FileX-Suite-Updater/1.0",
          Accept: "application/octet-stream",
        },
      },
      (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
          const location = response.headers.location;
          response.resume();
          if (!location) {
            reject(new Error("Redirect senza destinazione"));
            return;
          }
          downloadFile(new URL(location, parsed).toString(), destinationPath, onProgress, redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }
        if (!response.statusCode || response.statusCode >= 400) {
          reject(new Error(`Download failed (${response.statusCode ?? "unknown"})`));
          return;
        }
        const total = response.headers["content-length"] ? Number.parseInt(response.headers["content-length"], 10) : null;
        let downloaded = 0;
        const writeStream = createWriteStream(destinationPath, { flags: "w" });
        response.on("data", (chunk) => {
          downloaded += chunk.length;
          onProgress(downloaded, Number.isFinite(total) ? total : null);
        });
        response.pipe(writeStream);
        writeStream.on("error", reject);
        writeStream.on("finish", () => resolve());
      },
    );
    request.on("error", reject);
  });
}

async function verifySha256(filePath: string, expectedHex: string): Promise<boolean> {
  const buffer = await readFile(filePath);
  const hash = createHash("sha256").update(buffer).digest("hex");
  return hash.toLowerCase() === expectedHex.trim().toLowerCase();
}

export async function downloadToolUpdate(
  toolId: DesktopToolId,
  channelInput?: DesktopReleaseChannel,
): Promise<DesktopToolUpdateJob> {
  const channel = sanitizeChannel(channelInput);
  const job = createJob(toolId, channel);

  try {
    const check = await checkToolUpdate(toolId, null, channel);
    if (!check.release) {
      return patchJob(job.id, {
        status: "failed",
        error: "Nessuna release trovata",
      });
    }
    const release = check.release;
    if (!isAllowedReleaseUrl(release.installerUrl)) {
      return patchJob(job.id, {
        status: "failed",
        releaseVersion: release.version,
        error: "Installer URL non autorizzata",
      });
    }

    const destinationPath = join(
      getUpdateCacheDirectory(),
      `${toolId}-${release.version}-${channel}-setup.exe`,
    );
    patchJob(job.id, {
      status: "downloading",
      releaseVersion: release.version,
      installerPath: destinationPath,
    });

    let attempt = 0;
    for (;;) {
      try {
        await downloadFile(release.installerUrl, destinationPath, (downloaded, total) => {
          patchJob(job.id, {
            status: "downloading",
            downloadedBytes: downloaded,
            totalBytes: total,
            retries: attempt,
          });
        });
        break;
      } catch (error) {
        attempt += 1;
        if (attempt > UPDATE_RETRY_LIMIT) {
          return patchJob(job.id, {
            status: "failed",
            retries: attempt - 1,
            error: `Download fallito: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
        patchJob(job.id, {
          status: "queued",
          retries: attempt,
          error: `Retry download (${attempt}/${UPDATE_RETRY_LIMIT})`,
        });
      }
    }

    patchJob(job.id, { status: "verifying" });
    const verified = await verifySha256(destinationPath, release.installerSha256);
    if (!verified) {
      await unlink(destinationPath).catch(() => undefined);
      return patchJob(job.id, {
        status: "failed",
        checksumVerified: false,
        error: "Checksum non valido",
      });
    }

    return patchJob(job.id, {
      status: "ready-to-apply",
      checksumVerified: true,
    });
  } catch (error) {
    return patchJob(job.id, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function applyToolUpdate(jobId: string): Promise<DesktopToolUpdateJob> {
  const job = updateJobs.get(jobId);
  if (!job) {
    throw new Error("Update job non trovato");
  }
  if (!job.installerPath || !existsSync(job.installerPath)) {
    return patchJob(jobId, {
      status: "failed",
      error: "Installer non disponibile",
    });
  }

  patchJob(jobId, { status: "applying" });
  try {
    await launchToolUpdateAndRestartSuite(job.installerPath);
  } catch (error) {
    return patchJob(jobId, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return patchJob(jobId, {
    status: "completed",
  });
}

export function getUpdateJob(jobId: string): DesktopToolUpdateJob | null {
  return updateJobs.get(jobId) ?? null;
}

export function openInstalledTool(
  toolId: DesktopToolId,
  launchArgs?: string[],
): Promise<{ ok: boolean; message: string }> {
  const installed = detectInstalledExecutable(toolId);
  if (!installed.path) {
    return Promise.resolve({ ok: false, message: "Tool non installato" });
  }

  const filteredArgs = Array.isArray(launchArgs)
    ? launchArgs.filter((value) => typeof value === "string" && value.trim().length > 0)
    : [];
  const safeArgs: string[] = [];
  for (let index = 0; index < filteredArgs.length; index += 1) {
    const argument = filteredArgs[index]!;
    const nextArgument = filteredArgs[index + 1];
    if ((argument === "--open-folder" || argument === "--open-project") && nextArgument) {
      // A single key=value argument survives Electron's Windows
      // second-instance forwarding more reliably than a flag/path pair.
      safeArgs.push(`${argument}=${nextArgument}`);
      index += 1;
    } else {
      safeArgs.push(argument);
    }
  }

  const launchEnv: NodeJS.ProcessEnv = { ...process.env, FILEX_TOOL: toolId };
  delete launchEnv.ELECTRON_RUN_AS_NODE;

  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(installed.path!, safeArgs, {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
        env: launchEnv,
      });
    } catch (error) {
      resolve({
        ok: false,
        message: error instanceof Error ? error.message : "Impossibile avviare il tool",
      });
      return;
    }
    child.once("error", (error) => {
      resolve({ ok: false, message: error.message || "Impossibile avviare il tool" });
    });
    child.once("spawn", () => {
      child.unref();
      resolve({ ok: true, message: "Tool avviato" });
    });
  });
}
