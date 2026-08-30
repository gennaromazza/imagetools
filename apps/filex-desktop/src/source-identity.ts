import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, statfs } from "node:fs/promises";
import { basename, parse, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type {
  DesktopFolderEntry,
  DesktopSourceIdentity,
  DesktopSourceVolumeInfo,
} from "@photo-tools/desktop-contracts";

const execFileAsync = promisify(execFile);
const POWERSHELL_MAX_BUFFER_BYTES = 256 * 1024;
const POWERSHELL_VOLUME_PROBE_TIMEOUT_MS = 3_000;

interface WindowsLogicalDiskRow {
  DeviceID?: string;
  VolumeName?: string;
  VolumeSerialNumber?: string;
  FileSystem?: string;
  Size?: string | number;
  DriveType?: string | number;
}

function normalizeInventoryPath(rootPath: string, absolutePath: string): string {
  const normalized = relative(rootPath, absolutePath).split(sep).join("/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function parseFiniteNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function buildDesktopSourceInventoryFingerprint(
  rootPath: string,
  entries: DesktopFolderEntry[],
): { inventoryFingerprint: string; fileCount: number; totalBytes: number } {
  const records = entries
    .map((entry) => ({
      path: normalizeInventoryPath(rootPath, entry.absolutePath),
      size: Number.isFinite(entry.size) ? Math.max(0, Math.round(entry.size)) : 0,
      lastModified: Number.isFinite(entry.lastModified) ? Math.max(0, Math.round(entry.lastModified)) : 0,
    }))
    .sort((left, right) => (left.path === right.path ? 0 : left.path < right.path ? -1 : 1));
  const totalBytes = records.reduce((total, record) => total + record.size, 0);
  const hash = createHash("sha256");
  hash.update("filex-source-inventory-v1\0");
  hash.update(String(records.length));
  hash.update("\0");
  hash.update(String(totalBytes));
  hash.update("\0");
  for (const record of records) {
    hash.update(record.path);
    hash.update("\0");
    hash.update(String(record.size));
    hash.update("\0");
    hash.update(String(record.lastModified));
    hash.update("\0");
  }
  return {
    inventoryFingerprint: hash.digest("hex"),
    fileCount: records.length,
    totalBytes,
  };
}

async function getWindowsVolumeInfo(rootPath: string): Promise<DesktopSourceVolumeInfo | null> {
  if (process.platform !== "win32") {
    return null;
  }
  const mountPath = parse(resolve(rootPath)).root;
  const deviceId = mountPath.replace(/[\\/]+$/, "");
  if (!/^[a-zA-Z]:$/.test(deviceId)) {
    return null;
  }

  const script = [
    "$ErrorActionPreference='Stop'",
    "$deviceId=$args[0]",
    "$disk=Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DeviceID -eq $deviceId } | Select-Object -First 1 DeviceID,VolumeName,VolumeSerialNumber,FileSystem,Size,DriveType",
    "if ($null -ne $disk) { $disk | ConvertTo-Json -Compress }",
  ].join("; ");

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script, deviceId],
      {
        windowsHide: true,
        maxBuffer: POWERSHELL_MAX_BUFFER_BYTES,
        timeout: POWERSHELL_VOLUME_PROBE_TIMEOUT_MS,
      },
    );
    if (!stdout.trim()) {
      return null;
    }
    const row = JSON.parse(stdout) as WindowsLogicalDiskRow;
    return {
      mountPath,
      label: row.VolumeName?.trim() || undefined,
      serialNumber: row.VolumeSerialNumber?.trim() || undefined,
      filesystem: row.FileSystem?.trim() || undefined,
      totalBytes: parseFiniteNumber(row.Size),
      isRemovable: Number(row.DriveType) === 2,
    };
  } catch {
    return null;
  }
}

async function getFallbackVolumeInfo(rootPath: string): Promise<DesktopSourceVolumeInfo | undefined> {
  const mountPath = parse(resolve(rootPath)).root;
  let totalBytes: number | undefined;
  try {
    const stats = await statfs(rootPath);
    totalBytes = parseFiniteNumber(Number(stats.blocks) * Number(stats.bsize));
  } catch {
    totalBytes = undefined;
  }
  return {
    mountPath,
    totalBytes,
  };
}

export async function probeDesktopSourceVolume(
  rootPath: string,
): Promise<{ volume?: DesktopSourceVolumeInfo; isWritable: boolean }> {
  const [windowsVolume, isWritable] = await Promise.all([
    getWindowsVolumeInfo(rootPath),
    access(rootPath, fsConstants.R_OK | fsConstants.W_OK).then(() => true, () => false),
  ]);
  return {
    volume: windowsVolume ?? await getFallbackVolumeInfo(rootPath),
    isWritable,
  };
}

export function buildDesktopSourceId(
  rootPath: string,
  inventoryFingerprint: string,
  volume?: DesktopSourceVolumeInfo,
): { sourceId: string; rootRelativePath: string } {
  const mountPath = volume?.mountPath ? resolve(volume.mountPath) : parse(resolve(rootPath)).root;
  const relativeRoot = relative(mountPath, resolve(rootPath)).split(sep).join("/");
  const rootRelativePath = process.platform === "win32"
    ? relativeRoot.toLowerCase()
    : relativeRoot;
  const serialNumber = volume?.serialNumber?.trim().toLowerCase();
  const normalizedMountPath = volume?.mountPath
    ? resolve(volume.mountPath).split(sep).join("/").toLocaleLowerCase()
    : "";
  const stableMountIdentity = /^[a-z]:\/?$/i.test(normalizedMountPath)
    ? ""
    : normalizedMountPath;
  const fallbackVolumeIdentity = volume
    ? [
        volume.label?.trim().toLocaleLowerCase() ?? "",
        volume.filesystem?.trim().toLocaleLowerCase() ?? "",
        Number.isFinite(volume.totalBytes) ? String(Math.round(volume.totalBytes!)) : "",
        volume.isRemovable === true ? "removable" : volume.isRemovable === false ? "fixed" : "unknown",
        stableMountIdentity,
      ].join("\0")
    : "";
  const identityMaterial = serialNumber
    // A real volume serial plus the root inside that volume is stable even if
    // photos are added later or Windows assigns a different drive letter.
    // The inventory fingerprint remains available for validating whether the
    // content changed, but it must not identify a source: adding or editing a
    // photo must keep the same free selection.
    ? `volume\0${serialNumber}\0${rootRelativePath}`
    : fallbackVolumeIdentity
      ? `volume-fallback\0${fallbackVolumeIdentity}\0${rootRelativePath}`
      : `inventory\0${inventoryFingerprint}`;
  return {
    sourceId: `source-${hashValue(identityMaterial)}`,
    rootRelativePath,
  };
}

export async function createDesktopSourceIdentity(
  rootPath: string,
  entries: DesktopFolderEntry[],
  probed?: { volume?: DesktopSourceVolumeInfo; isWritable: boolean },
): Promise<DesktopSourceIdentity> {
  const normalizedRootPath = resolve(rootPath);
  const inventory = buildDesktopSourceInventoryFingerprint(normalizedRootPath, entries);
  const sourceProbe = probed ?? await probeDesktopSourceVolume(normalizedRootPath);
  const sourceKey = buildDesktopSourceId(
    normalizedRootPath,
    inventory.inventoryFingerprint,
    sourceProbe.volume,
  );
  return {
    schemaVersion: 1,
    sourceId: sourceKey.sourceId,
    inventoryFingerprint: inventory.inventoryFingerprint,
    rootPath: normalizedRootPath,
    rootFolderName: basename(normalizedRootPath) || normalizedRootPath,
    rootRelativePath: sourceKey.rootRelativePath,
    fileCount: inventory.fileCount,
    totalBytes: inventory.totalBytes,
    isWritable: sourceProbe.isWritable,
    volume: sourceProbe.volume,
  };
}
