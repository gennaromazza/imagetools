import { app, shell } from "electron";
import { createHash, createHmac } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { unlink, readFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { join } from "node:path";
import type {
  DesktopReleaseChannel,
  DesktopReleaseManifest,
  DesktopToolId,
  DesktopToolInstallState,
  DesktopToolReleaseEntry,
  DesktopToolUpdateCheckResult,
  DesktopToolUpdateJob,
} from "@photo-tools/desktop-contracts";
import { desktopToolManifest, getSuiteManagedTools } from "./tool-manifest.js";

const ALLOWED_RELEASE_HOSTS = new Set([
  "github.com",
  "api.github.com",
  "objects.githubusercontent.com",
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

  return `https://raw.githubusercontent.com/gennaromazza/imagetools/main/apps/filex-desktop/release-manifests/${channel}.json`;
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

function requestJson(urlValue: string): Promise<unknown> {
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
    Array.isArray(manifest.releases)
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
      if (isDesktopReleaseManifest(raw) && verifyManifestIntegrity(raw)) {
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
  const descriptor = desktopToolManifest[toolId];
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

  const localPrograms = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "Programs", descriptor.productName, `${descriptor.executableName}.exe`)
    : "";
  if (localPrograms) candidates.add(localPrograms);

  const programFiles = process.env.ProgramFiles
    ? join(process.env.ProgramFiles, descriptor.productName, `${descriptor.executableName}.exe`)
    : "";
  if (programFiles) candidates.add(programFiles);

  const programFilesX86 = process.env["ProgramFiles(x86)"]
    ? join(process.env["ProgramFiles(x86)"], descriptor.productName, `${descriptor.executableName}.exe`)
    : "";
  if (programFilesX86) candidates.add(programFilesX86);

  return Array.from(candidates);
}

function detectInstalledExecutable(toolId: DesktopToolId): { path: string | null; version: string | null } {
  for (const candidate of resolveExecutableCandidates(toolId)) {
    try {
      if (!candidate || !existsSync(candidate)) continue;
      const stats = statSync(candidate);
      if (!stats.isFile()) continue;
      return {
        path: candidate,
        version: null,
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
      compareVersions(latest?.version, installed.version) > 0;
    return {
      toolId: tool.id,
      toolName: tool.displayName,
      productName: tool.productName,
      installed: Boolean(installed.path),
      executablePath: installed.path,
      installedVersion: installed.version,
      latestVersion: latest?.version ?? null,
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

function downloadFile(urlValue: string, destinationPath: string, onProgress: (downloaded: number, total: number | null) => void): Promise<void> {
  return new Promise((resolve, reject) => {
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
  const result = await shell.openPath(job.installerPath);
  if (result) {
    return patchJob(jobId, {
      status: "failed",
      error: result,
    });
  }

  return patchJob(jobId, {
    status: "completed",
  });
}

export function getUpdateJob(jobId: string): DesktopToolUpdateJob | null {
  return updateJobs.get(jobId) ?? null;
}

export function openInstalledTool(toolId: DesktopToolId): Promise<{ ok: boolean; message: string }> {
  const installed = detectInstalledExecutable(toolId);
  if (!installed.path) {
    return Promise.resolve({ ok: false, message: "Tool non installato" });
  }
  return shell.openPath(installed.path).then((result) => {
    if (result) {
      return { ok: false, message: result };
    }
    return { ok: true, message: "Tool avviato" };
  });
}
