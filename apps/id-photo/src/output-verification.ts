import type { DesktopFileFingerprint } from "@photo-tools/desktop-contracts";
import type { PersistedIdPhotoExport, PersistedIdPhotoPendingExport } from "./job-store";

export type FingerprintFiles = (absolutePaths: string[]) => Promise<DesktopFileFingerprint[]>;
export type OutputVerificationStatus = "valid" | "invalid" | "unavailable";

export type PersistedExportVerifier = ((record: PersistedIdPhotoExport) => Promise<OutputVerificationStatus>) & {
  verifyPendingOutput: (record: PersistedIdPhotoPendingExport) => Promise<PendingOutputVerificationResult>;
};

export type PendingOutputVerificationResult =
  | { status: "valid"; exportRecord: PersistedIdPhotoExport }
  | { status: "invalid" }
  | { status: "unavailable" };

export interface PersistedExportVerifierOptions {
  timeoutMs?: number;
}

export function outputFilePath(directoryPath: string, fileName: string): string {
  const separator = directoryPath.includes("\\") ? "\\" : "/";
  return `${directoryPath.replace(/[\\/]+$/, "")}${separator}${fileName}`;
}

function comparablePath(absolutePath: string): string {
  return /^[a-z]:[\\/]/i.test(absolutePath) || absolutePath.startsWith("\\\\")
    ? absolutePath.replaceAll("/", "\\").toLocaleLowerCase("en-US")
    : absolutePath;
}

export async function verifyPersistedExport(
  record: PersistedIdPhotoExport,
  fingerprintFiles: FingerprintFiles | undefined,
): Promise<OutputVerificationStatus> {
  if (!record.outputDirectoryPath || record.files.length === 0) return "invalid";
  if (!fingerprintFiles) return "unavailable";
  const expectedPaths = record.files.map((fileName) => outputFilePath(record.outputDirectoryPath!, fileName));
  if (record.verifiedFiles.length !== expectedPaths.length) return "invalid";
  const expectedByPath = new Map(record.verifiedFiles.map((file) => [comparablePath(file.absolutePath), file]));
  if (expectedPaths.some((path) => !expectedByPath.has(comparablePath(path)))) return "invalid";
  let current: DesktopFileFingerprint[];
  try {
    current = await fingerprintFiles(expectedPaths);
  } catch {
    return "unavailable";
  }
  if (current.length !== expectedPaths.length) return "invalid";
  const matches = current.every((file) => {
    const expected = expectedByPath.get(comparablePath(file.absolutePath));
    return Boolean(expected)
      && file.size === expected!.size
      && file.lastModified === expected!.lastModified
      && file.sha256.toLocaleLowerCase() === expected!.sha256.toLocaleLowerCase();
  });
  return matches ? "valid" : "invalid";
}

function verificationKey(record: PersistedIdPhotoExport): string {
  return JSON.stringify([
    record.completedAt,
    record.contextFingerprint,
    record.outputDirectoryPath,
    record.files,
    record.verifiedFiles.map((file) => [file.absolutePath, file.size, file.lastModified, file.sha256]),
  ]);
}

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutValue: T,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return operation;
  return new Promise((resolveValue) => {
    const timeout = setTimeout(() => resolveValue(timeoutValue), timeoutMs);
    void operation.then(
      (value) => {
        clearTimeout(timeout);
        resolveValue(value);
      },
      () => {
        clearTimeout(timeout);
        resolveValue(timeoutValue);
      },
    );
  });
}

function pendingVerificationKey(record: PersistedIdPhotoPendingExport): string {
  return JSON.stringify([
    "pending",
    record.completedAt,
    record.contextFingerprint,
    record.outputDirectoryPath,
    record.files,
    record.format,
    record.sheetId,
    record.copies,
    record.expectedFiles.map((file) => [file.fileName, file.size, file.sha256]),
  ]);
}

export function promotePendingIdPhotoExport(
  record: PersistedIdPhotoPendingExport,
  verifiedFiles: DesktopFileFingerprint[],
): PersistedIdPhotoExport | null {
  const expectedPaths = record.files.map((fileName) => outputFilePath(record.outputDirectoryPath, fileName));
  if (record.expectedFiles.length !== expectedPaths.length
    || verifiedFiles.length !== expectedPaths.length) return null;
  if (verifiedFiles.some((file) => (
    !Number.isFinite(file.size)
    || file.size < 0
    || !Number.isFinite(file.lastModified)
    || typeof file.sha256 !== "string"
    || !/^[a-f0-9]{64}$/i.test(file.sha256)
  ))) return null;
  const verifiedByPath = new Map(verifiedFiles.map((file) => [comparablePath(file.absolutePath), file]));
  if (verifiedByPath.size !== expectedPaths.length
    || expectedPaths.some((path) => !verifiedByPath.has(comparablePath(path)))) return null;
  const bytesMatch = expectedPaths.every((path, index) => {
    const expected = record.expectedFiles[index];
    const verified = verifiedByPath.get(comparablePath(path));
    return Boolean(expected && verified)
      && expected.fileName === record.files[index]
      && expected.size === verified!.size
      && expected.sha256.toLocaleLowerCase() === verified!.sha256.toLocaleLowerCase();
  });
  if (!bytesMatch) return null;
  return {
    completedAt: record.completedAt,
    contextFingerprint: record.contextFingerprint,
    format: record.format,
    files: record.files,
    verifiedFiles,
    outputDirectoryPath: record.outputDirectoryPath,
    sheetId: record.sheetId,
    copies: record.copies,
  };
}

export function createPersistedExportVerifier(
  fingerprintFiles: FingerprintFiles | undefined,
  options: PersistedExportVerifierOptions = {},
): PersistedExportVerifier {
  const timeoutMs = options.timeoutMs ?? 12_000;
  let active: { key: string; operation: Promise<unknown> } | null = null;

  const runCoordinated = <T>(key: string, start: () => Promise<T>, timeoutValue: T): Promise<T> => {
    if (active) {
      if (active.key === key) return active.operation as Promise<T>;
      return active.operation.then(
        () => runCoordinated(key, start, timeoutValue),
        () => runCoordinated(key, start, timeoutValue),
      );
    }

    const operation = withTimeout(Promise.resolve().then(start), timeoutMs, timeoutValue);
    const entry = { key, operation: operation as Promise<unknown> };
    active = entry;
    void operation.then(
      () => {
        if (active === entry) active = null;
      },
      () => {
        if (active === entry) active = null;
      },
    );
    return operation;
  };

  const verifier = ((record: PersistedIdPhotoExport) => runCoordinated(
    `verify:${verificationKey(record)}`,
    () => verifyPersistedExport(record, fingerprintFiles),
    "unavailable",
  )) as PersistedExportVerifier;

  verifier.verifyPendingOutput = (record) => runCoordinated(
    pendingVerificationKey(record),
    async (): Promise<PendingOutputVerificationResult> => {
      if (!fingerprintFiles) return { status: "unavailable" };
      try {
        const absolutePaths = record.files.map((fileName) => outputFilePath(record.outputDirectoryPath, fileName));
        const verifiedFiles = await fingerprintFiles(absolutePaths);
        const exportRecord = promotePendingIdPhotoExport(record, verifiedFiles);
        return exportRecord ? { status: "valid", exportRecord } : { status: "invalid" };
      } catch {
        return { status: "unavailable" };
      }
    },
    { status: "unavailable" },
  );

  return verifier;
}
