import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, readdir, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, parse, resolve } from "node:path";

const TRANSACTION_ID_PATTERN = /^[a-f0-9]{32}$/;
const STAGING_DIRECTORY_PATTERN = /^\.filex-stage-([a-f0-9]{32})$/;
const STAGED_FILE_PATTERN = /^\d{8}-[a-f0-9]{32}\.tmp$/;
const TRANSACTION_MANIFEST_FILE_NAME = ".filex-transaction.json";
const PUBLISH_INTENT_FILE_PATTERN = /^\.filex-publish-(\d{12})\.json$/;
const ROLLBACK_INTENT_FILE_PATTERN = /^\.filex-rollback-(\d{12})\.json$/;
const ROLLBACK_QUARANTINE_FILE_PATTERN = /^\.filex-rollback-(\d{12})\.tmp$/;
const ACKNOWLEDGED_MARKER_FILE_NAME = ".filex-acknowledged";
const WINDOWS_RESERVED_FILE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const MAX_FILE_NAME_LENGTH = 220;
const MAX_NAME_ATTEMPTS = 999_999;
export const DEFAULT_STALE_TRANSACTION_AGE_MS = 24 * 60 * 60 * 1000;

type TransactionState = "open" | "committing" | "failed" | "published" | "acknowledged" | "rolled-back";

interface AtomicOutputTransactionManifest {
  schemaVersion: 1;
  transactionId: string;
  ownerProcessId: number;
  createdAt: number;
}

interface AtomicOutputPublishIntent {
  schemaVersion: 1;
  transactionId: string;
  sequence: number;
  stagedFileName: string;
  destinationFileName: string;
  fileIdentity: string;
}

interface AtomicOutputAcknowledgement {
  schemaVersion: 1;
  transactionId: string;
  acknowledgedAt: number;
}

interface AtomicOutputRollbackIntent {
  schemaVersion: 1;
  transactionId: string;
  sequence: number;
  destinationFileName: string;
  expectedFileIdentity: string;
  quarantineFileName: string;
}

interface RecoverableStagingDirectory {
  manifest: AtomicOutputTransactionManifest;
  acknowledgement: AtomicOutputAcknowledgement | null;
  publishIntents: AtomicOutputPublishIntent[];
  rollbackIntents: AtomicOutputRollbackIntent[];
  rollbackQuarantineFileNames: string[];
  stagedFileNames: string[];
}

export interface AtomicOutputPathInfo {
  kind: "directory" | "file" | "symlink" | "other";
  modifiedAt: number;
}

export interface AtomicOutputRecoveryResult {
  removed: string[];
  preserved: string[];
  rejected: string[];
}

export interface AtomicOutputFinalizeRecovery {
  directoryPath: string;
  expectedFileNames: string[];
}

interface StagedOutputFile {
  requestedFileName: string;
  stagedPath: string;
}

interface PublishedOutputFile {
  destinationPath: string;
  stagedPath: string;
  fileIdentity: string;
  publishIntentSequence: number;
}

interface AtomicOutputTransaction {
  id: string;
  ownerId: number;
  directoryPath: string;
  stagingDirectoryPath: string;
  stagedFiles: StagedOutputFile[];
  publishedFiles: PublishedOutputFile[];
  nextPublishIntentSequence: number;
  state: TransactionState;
  operation: Promise<void>;
}

export interface AtomicOutputTransactionDependencies {
  createTransactionId: () => string;
  isDirectory: (directoryPath: string) => Promise<boolean>;
  pathExists: (path: string) => Promise<boolean>;
  getFileIdentity: (path: string) => Promise<string | null>;
  getPathInfo: (path: string) => Promise<AtomicOutputPathInfo | null>;
  listDirectoryNames: (directoryPath: string) => Promise<string[]>;
  createDirectory: (directoryPath: string) => Promise<void>;
  writeFileExclusive: (filePath: string, bytes: Uint8Array) => Promise<void>;
  writeTextFileExclusive: (filePath: string, contents: string) => Promise<void>;
  readTextFile: (filePath: string) => Promise<string>;
  publishFile: (stagedPath: string, destinationPath: string) => Promise<void>;
  movePath: (sourcePath: string, destinationPath: string) => Promise<void>;
  removePath: (path: string, recursive: boolean) => Promise<void>;
  removeEmptyDirectory: (directoryPath: string) => Promise<void>;
  isProcessActive: (processId: number) => Promise<boolean>;
  now: () => number;
  processId: number;
  staleTransactionAgeMs: number;
  caseInsensitiveFileNames: boolean;
}

export class AtomicOutputRollbackError extends Error {
  readonly remnantPaths: string[];

  constructor(remnantPaths: string[]) {
    super(`Rollback output incompleto. Percorsi residui: ${remnantPaths.join(", ")}`);
    this.name = "AtomicOutputRollbackError";
    this.remnantPaths = [...remnantPaths];
  }
}

export class AtomicOutputUnsupportedFileSystemError extends Error {
  readonly code = "FILEX_ATOMIC_LINK_UNSUPPORTED";

  constructor(destinationPath: string, cause: unknown) {
    super(
      `Il filesystem della cartella di output non supporta la pubblicazione atomica senza sovrascrittura (${basename(destinationPath)}). Scegli un disco NTFS/APFS/ext4 o un volume che supporti hard link.`,
      { cause },
    );
    this.name = "AtomicOutputUnsupportedFileSystemError";
  }
}

function hasErrorCode(error: unknown, codes: readonly string[]): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && typeof error.code === "string"
    && codes.includes(error.code),
  );
}

async function pathExistsOnDisk(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (hasErrorCode(error, ["ENOENT"])) return false;
    throw error;
  }
}

async function getPathInfoOnDisk(path: string): Promise<AtomicOutputPathInfo | null> {
  try {
    const entry = await lstat(path);
    const kind = entry.isSymbolicLink()
      ? "symlink"
      : entry.isDirectory()
        ? "directory"
        : entry.isFile()
          ? "file"
          : "other";
    return { kind, modifiedAt: entry.mtimeMs };
  } catch (error) {
    if (hasErrorCode(error, ["ENOENT", "ENOTDIR"])) return null;
    throw error;
  }
}

async function isProcessActiveOnHost(processId: number): Promise<boolean> {
  if (!Number.isSafeInteger(processId) || processId <= 0) return true;
  if (processId === process.pid) return true;
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if (hasErrorCode(error, ["ESRCH"])) return false;
    // Access denied and platform-specific probe failures are treated as active:
    // recovery must be conservative and must never delete uncertain work.
    return true;
  }
}

export function createNodeAtomicOutputTransactionDependencies(): AtomicOutputTransactionDependencies {
  return {
    createTransactionId: () => randomUUID().replaceAll("-", ""),
    isDirectory: async (directoryPath) => {
      try {
        return (await stat(directoryPath)).isDirectory();
      } catch (error) {
        if (hasErrorCode(error, ["ENOENT", "ENOTDIR"])) return false;
        throw error;
      }
    },
    pathExists: pathExistsOnDisk,
    getFileIdentity: async (path) => {
      try {
        const entry = await lstat(path, { bigint: true });
        return entry.isFile() ? `${entry.dev}:${entry.ino}` : null;
      } catch (error) {
        if (hasErrorCode(error, ["ENOENT", "ENOTDIR"])) return null;
        throw error;
      }
    },
    getPathInfo: getPathInfoOnDisk,
    listDirectoryNames: async (directoryPath) => readdir(directoryPath),
    createDirectory: async (directoryPath) => {
      await mkdir(directoryPath);
    },
    writeFileExclusive: async (filePath, bytes) => {
      const handle = await open(filePath, "wx");
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
    },
    writeTextFileExclusive: async (filePath, contents) => {
      const handle = await open(filePath, "wx");
      try {
        await handle.writeFile(contents, { encoding: "utf8" });
        // Publication journals and acknowledgement markers must reach the
        // filesystem before the corresponding hard-link can become visible.
        await handle.sync();
      } finally {
        await handle.close();
      }
    },
    readTextFile: async (filePath) => readFile(filePath, "utf8"),
    publishFile: async (stagedPath, destinationPath) => {
      try {
        // A hard link publishes the already-complete staged file atomically and
        // refuses to overwrite a file created between the collision check and
        // this call. Both names are on the same filesystem by construction.
        await link(stagedPath, destinationPath);
      } catch (error) {
        if (hasErrorCode(error, ["EPERM", "ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EXDEV"])) {
          throw new AtomicOutputUnsupportedFileSystemError(destinationPath, error);
        }
        throw error;
      }
    },
    movePath: async (sourcePath, destinationPath) => {
      await rename(sourcePath, destinationPath);
    },
    removePath: async (path, recursive) => {
      await rm(path, { recursive, force: true });
    },
    removeEmptyDirectory: async (directoryPath) => {
      await rmdir(directoryPath);
    },
    isProcessActive: isProcessActiveOnHost,
    now: () => Date.now(),
    processId: process.pid,
    staleTransactionAgeMs: DEFAULT_STALE_TRANSACTION_AGE_MS,
    caseInsensitiveFileNames: process.platform === "win32",
  };
}

export function normalizeAtomicOutputFileName(value: unknown): string {
  const fileName = typeof value === "string" ? value.trim() : "";
  if (
    !fileName
    || fileName === "."
    || fileName === ".."
    || fileName.length > MAX_FILE_NAME_LENGTH
    || basename(fileName) !== fileName
    || /[\\/:*?"<>|\u0000-\u001f]/.test(fileName)
    || WINDOWS_RESERVED_FILE_NAMES.test(fileName)
  ) {
    throw new Error("Nome file di output non valido.");
  }
  return fileName;
}

function normalizeTransactionId(value: unknown): string {
  const transactionId = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!TRANSACTION_ID_PATTERN.test(transactionId)) {
    throw new Error("Transazione output non valida.");
  }
  return transactionId;
}

function parseTransactionManifest(raw: string, expectedTransactionId: string): AtomicOutputTransactionManifest | null {
  try {
    const value = JSON.parse(raw) as Partial<AtomicOutputTransactionManifest>;
    if (
      value.schemaVersion !== 1
      || value.transactionId !== expectedTransactionId
      || !Number.isSafeInteger(value.ownerProcessId)
      || Number(value.ownerProcessId) <= 0
      || !Number.isFinite(value.createdAt)
      || Number(value.createdAt) <= 0
    ) {
      return null;
    }
    return {
      schemaVersion: 1,
      transactionId: expectedTransactionId,
      ownerProcessId: Number(value.ownerProcessId),
      createdAt: Number(value.createdAt),
    };
  } catch {
    return null;
  }
}

function serializeTransactionManifest(manifest: AtomicOutputTransactionManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function sameTransactionManifest(
  left: AtomicOutputTransactionManifest,
  right: AtomicOutputTransactionManifest,
): boolean {
  return left.schemaVersion === right.schemaVersion
    && left.transactionId === right.transactionId
    && left.ownerProcessId === right.ownerProcessId
    && left.createdAt === right.createdAt;
}

function serializePublishIntent(intent: AtomicOutputPublishIntent): string {
  return `${JSON.stringify(intent, null, 2)}\n`;
}

function serializeAcknowledgement(acknowledgement: AtomicOutputAcknowledgement): string {
  return `${JSON.stringify(acknowledgement, null, 2)}\n`;
}

function serializeRollbackIntent(intent: AtomicOutputRollbackIntent): string {
  return `${JSON.stringify(intent, null, 2)}\n`;
}

function parseAcknowledgement(raw: string, expectedTransactionId: string): AtomicOutputAcknowledgement | null {
  try {
    const value = JSON.parse(raw) as Partial<AtomicOutputAcknowledgement>;
    if (
      value.schemaVersion !== 1
      || value.transactionId !== expectedTransactionId
      || !Number.isFinite(value.acknowledgedAt)
      || Number(value.acknowledgedAt) <= 0
    ) {
      return null;
    }
    return {
      schemaVersion: 1,
      transactionId: expectedTransactionId,
      acknowledgedAt: Number(value.acknowledgedAt),
    };
  } catch {
    return null;
  }
}

function parsePublishIntent(
  raw: string,
  expectedTransactionId: string,
  expectedSequence: number,
): AtomicOutputPublishIntent | null {
  try {
    const value = JSON.parse(raw) as Partial<AtomicOutputPublishIntent>;
    if (
      value.schemaVersion !== 1
      || value.transactionId !== expectedTransactionId
      || value.sequence !== expectedSequence
      || !Number.isSafeInteger(value.sequence)
      || Number(value.sequence) <= 0
      || typeof value.stagedFileName !== "string"
      || !STAGED_FILE_PATTERN.test(value.stagedFileName)
      || typeof value.destinationFileName !== "string"
      || normalizeAtomicOutputFileName(value.destinationFileName) !== value.destinationFileName
      || typeof value.fileIdentity !== "string"
      || value.fileIdentity.length === 0
      || value.fileIdentity.length > 256
      || /[\u0000-\u001f]/.test(value.fileIdentity)
    ) {
      return null;
    }
    return {
      schemaVersion: 1,
      transactionId: expectedTransactionId,
      sequence: expectedSequence,
      stagedFileName: value.stagedFileName,
      destinationFileName: value.destinationFileName,
      fileIdentity: value.fileIdentity,
    };
  } catch {
    return null;
  }
}

function parseRollbackIntent(
  raw: string,
  expectedTransactionId: string,
  expectedSequence: number,
): AtomicOutputRollbackIntent | null {
  try {
    const value = JSON.parse(raw) as Partial<AtomicOutputRollbackIntent>;
    const expectedQuarantineFileName = `.filex-rollback-${String(expectedSequence).padStart(12, "0")}.tmp`;
    if (
      value.schemaVersion !== 1
      || value.transactionId !== expectedTransactionId
      || value.sequence !== expectedSequence
      || !Number.isSafeInteger(value.sequence)
      || Number(value.sequence) <= 0
      || typeof value.destinationFileName !== "string"
      || normalizeAtomicOutputFileName(value.destinationFileName) !== value.destinationFileName
      || typeof value.expectedFileIdentity !== "string"
      || value.expectedFileIdentity.length === 0
      || value.expectedFileIdentity.length > 256
      || /[\u0000-\u001f]/.test(value.expectedFileIdentity)
      || value.quarantineFileName !== expectedQuarantineFileName
    ) {
      return null;
    }
    return {
      schemaVersion: 1,
      transactionId: expectedTransactionId,
      sequence: expectedSequence,
      destinationFileName: value.destinationFileName,
      expectedFileIdentity: value.expectedFileIdentity,
      quarantineFileName: expectedQuarantineFileName,
    };
  } catch {
    return null;
  }
}

function sameRecoverableStagingDirectory(
  left: RecoverableStagingDirectory,
  right: RecoverableStagingDirectory,
): boolean {
  return sameTransactionManifest(left.manifest, right.manifest)
    && JSON.stringify(left.acknowledgement) === JSON.stringify(right.acknowledgement)
    && JSON.stringify(left.stagedFileNames) === JSON.stringify(right.stagedFileNames)
    && JSON.stringify(left.publishIntents) === JSON.stringify(right.publishIntents)
    && JSON.stringify(left.rollbackIntents) === JSON.stringify(right.rollbackIntents)
    && JSON.stringify(left.rollbackQuarantineFileNames) === JSON.stringify(right.rollbackQuarantineFileNames);
}

function collisionKey(fileName: string, caseInsensitive: boolean): string {
  return caseInsensitive ? fileName.toLocaleLowerCase("en-US") : fileName;
}

function candidateFileName(requestedFileName: string, attempt: number): string {
  if (attempt === 1) return requestedFileName;
  const parsed = parse(requestedFileName);
  return `${parsed.name}-${attempt}${parsed.ext}`;
}

export class AtomicOutputTransactionManager {
  private readonly dependencies: AtomicOutputTransactionDependencies;
  private readonly transactions = new Map<string, AtomicOutputTransaction>();
  private commitQueue: Promise<void> = Promise.resolve();

  constructor(dependencies: Partial<AtomicOutputTransactionDependencies> = {}) {
    this.dependencies = {
      ...createNodeAtomicOutputTransactionDependencies(),
      ...dependencies,
    };
  }

  async recoverStaleTransactions(directoryPathInput: string): Promise<AtomicOutputRecoveryResult> {
    const directoryPath = resolve(directoryPathInput);
    if (!isAbsolute(directoryPathInput) || !await this.dependencies.isDirectory(directoryPath)) {
      throw new Error("Cartella di output non valida o non disponibile.");
    }

    const result: AtomicOutputRecoveryResult = { removed: [], preserved: [], rejected: [] };
    const directoryNames = await this.dependencies.listDirectoryNames(directoryPath);
    for (const name of directoryNames) {
      const match = STAGING_DIRECTORY_PATTERN.exec(name);
      if (!match) continue;
      const transactionId = match[1];
      const stagingDirectoryPath = resolve(directoryPath, name);
      if (dirname(stagingDirectoryPath) !== directoryPath) {
        result.rejected.push(stagingDirectoryPath);
        continue;
      }
      if (this.transactions.has(transactionId)) {
        result.preserved.push(stagingDirectoryPath);
        continue;
      }

      const firstInspection = await this.inspectRecoverableStagingDirectory(stagingDirectoryPath, transactionId);
      if (!firstInspection) {
        const emptyDirectoryRemoved = await this.removeEmptyStagingDirectoryIfSafe(stagingDirectoryPath);
        if (emptyDirectoryRemoved) {
          result.removed.push(stagingDirectoryPath);
          continue;
        }
        result.rejected.push(stagingDirectoryPath);
        continue;
      }
      const ageMs = this.dependencies.now() - firstInspection.manifest.createdAt;
      const hasPublicationJournal = Boolean(
        firstInspection.acknowledgement || firstInspection.publishIntents.length > 0,
      );
      if (
        !Number.isFinite(ageMs)
        || ageMs < 0
        || (!hasPublicationJournal && ageMs < this.dependencies.staleTransactionAgeMs)
      ) {
        result.preserved.push(stagingDirectoryPath);
        continue;
      }
      let processIsActive = true;
      try {
        processIsActive = await this.dependencies.isProcessActive(firstInspection.manifest.ownerProcessId);
      } catch {
        // An inconclusive process probe must preserve data.
        processIsActive = true;
      }
      if (processIsActive) {
        result.preserved.push(stagingDirectoryPath);
        continue;
      }

      // Re-read both the directory type and manifest immediately before the
      // destructive step. If anything changed, preserve it as untrusted.
      const secondInspection = await this.inspectRecoverableStagingDirectory(stagingDirectoryPath, transactionId);
      if (!secondInspection || !sameRecoverableStagingDirectory(firstInspection, secondInspection)) {
        result.rejected.push(stagingDirectoryPath);
        continue;
      }

      if (!secondInspection.acknowledgement) {
        const rollbackComplete = await this.rollbackRecoveredPublications(
          directoryPath,
          stagingDirectoryPath,
          secondInspection,
        );
        if (!rollbackComplete) {
          result.preserved.push(stagingDirectoryPath);
          continue;
        }
      }

      const cleanupComplete = secondInspection.acknowledgement
        ? await this.cleanupAcknowledgedStagingDirectoryBestEffort(stagingDirectoryPath)
        : await this.cleanupStagingDirectoryBestEffort(stagingDirectoryPath);
      if (cleanupComplete) {
        result.removed.push(stagingDirectoryPath);
      } else {
        result.preserved.push(stagingDirectoryPath);
      }
    }
    return result;
  }

  async begin(directoryPathInput: string, ownerId: number): Promise<string> {
    const directoryPath = resolve(directoryPathInput);
    if (!isAbsolute(directoryPathInput) || !Number.isSafeInteger(ownerId) || ownerId < 0) {
      throw new Error("Richiesta di transazione output non valida.");
    }
    if (!await this.dependencies.isDirectory(directoryPath)) {
      throw new Error("Cartella di output non valida o non disponibile.");
    }
    await this.recoverStaleTransactions(directoryPath);

    for (let attempt = 0; attempt < 16; attempt += 1) {
      const id = normalizeTransactionId(this.dependencies.createTransactionId());
      const stagingDirectoryPath = resolve(directoryPath, `.filex-stage-${id}`);
      if (dirname(stagingDirectoryPath) !== directoryPath || this.transactions.has(id)) continue;
      try {
        await this.dependencies.createDirectory(stagingDirectoryPath);
      } catch (error) {
        if (hasErrorCode(error, ["EEXIST"])) continue;
        throw error;
      }

      const manifestPath = resolve(stagingDirectoryPath, TRANSACTION_MANIFEST_FILE_NAME);
      try {
        await this.dependencies.writeTextFileExclusive(
          manifestPath,
          serializeTransactionManifest({
            schemaVersion: 1,
            transactionId: id,
            ownerProcessId: this.dependencies.processId,
            createdAt: this.dependencies.now(),
          }),
        );
      } catch (error) {
        await this.dependencies.removePath(stagingDirectoryPath, true).catch(() => undefined);
        if (await this.dependencies.pathExists(stagingDirectoryPath)) {
          throw new AggregateError(
            [error, new AtomicOutputRollbackError([stagingDirectoryPath])],
            "Creazione manifest output fallita e staging non eliminato.",
          );
        }
        throw error;
      }

      this.transactions.set(id, {
        id,
        ownerId,
        directoryPath,
        stagingDirectoryPath,
        stagedFiles: [],
        publishedFiles: [],
        nextPublishIntentSequence: 1,
        state: "open",
        operation: Promise.resolve(),
      });
      return id;
    }

    throw new Error("Impossibile inizializzare una transazione output sicura.");
  }

  async stage(ownerId: number, transactionIdInput: string, fileNameInput: unknown, bytes: Uint8Array): Promise<void> {
    const transaction = this.requireOwnedTransaction(ownerId, transactionIdInput);
    return this.enqueue(transaction, async () => {
      if (transaction.state !== "open") {
        throw new Error("La transazione output non accetta altri file.");
      }
      const requestedFileName = normalizeAtomicOutputFileName(fileNameInput);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
        throw new Error(`${requestedFileName} non contiene dati.`);
      }

      const fileIndex = transaction.stagedFiles.length + 1;
      const stagedPath = resolve(
        transaction.stagingDirectoryPath,
        `${String(fileIndex).padStart(8, "0")}-${randomUUID().replaceAll("-", "")}.tmp`,
      );
      if (dirname(stagedPath) !== transaction.stagingDirectoryPath) {
        throw new Error("Percorso di staging output non sicuro.");
      }
      await this.dependencies.writeFileExclusive(stagedPath, bytes);
      transaction.stagedFiles.push({ requestedFileName, stagedPath });
    });
  }

  async commit(ownerId: number, transactionIdInput: string): Promise<string[]> {
    const transaction = this.requireOwnedTransaction(ownerId, transactionIdInput);
    return this.enqueue(transaction, async () => this.withCommitLock(async () => {
      if (transaction.state !== "open") {
        throw new Error("La transazione output non puo' essere confermata.");
      }
      if (transaction.stagedFiles.length === 0) {
        throw new Error("La transazione output non contiene file.");
      }
      transaction.state = "committing";

      const reservedNames = new Set<string>();
      const savedFileNames: string[] = [];
      try {
        for (const item of transaction.stagedFiles) {
          const savedFileName = await this.publishStagedFile(transaction, item, reservedNames);
          savedFileNames.push(savedFileName);
        }

        await this.assertPublishedFilesUnchanged(transaction);
        // This is the publication commit point. The staging hard-links and the
        // durable journal intentionally remain in place until the renderer has
        // persisted its pending-output record and explicitly acknowledges it.
        transaction.state = "published";
        return savedFileNames;
      } catch (error) {
        transaction.state = "failed";
        try {
          await this.rollbackTransaction(transaction);
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "Commit output fallito e rollback incompleto.",
          );
        }
        throw error;
      }
    }));
  }

  async finalize(
    ownerId: number,
    transactionIdInput: string,
    recovery?: AtomicOutputFinalizeRecovery,
  ): Promise<boolean> {
    const transactionId = normalizeTransactionId(transactionIdInput);
    const transaction = this.transactions.get(transactionId);
    if (!transaction) {
      if (!recovery) return true;
      return this.withCommitLock(() => this.finalizeRecoveredTransaction(transactionId, recovery));
    }
    if (transaction.ownerId !== ownerId) {
      throw new Error("La transazione output appartiene a un altro processo.");
    }

    return this.enqueue(transaction, async () => {
      if (transaction.state === "acknowledged") return true;
      if (transaction.state !== "published") {
        throw new Error("La transazione output non puo' essere finalizzata prima della pubblicazione.");
      }

      const markerPath = resolve(transaction.stagingDirectoryPath, ACKNOWLEDGED_MARKER_FILE_NAME);
      if (dirname(markerPath) !== transaction.stagingDirectoryPath) {
        throw new Error("Percorso marker output non sicuro.");
      }
      await this.writeAcknowledgementMarker(
        transaction.stagingDirectoryPath,
        transaction.id,
      );

      // Once the durable acknowledgement exists, recovery must preserve every
      // final name. Cleanup is therefore housekeeping only: a locked directory
      // must never turn an already acknowledged commit into an application error.
      transaction.state = "acknowledged";
      this.transactions.delete(transaction.id);
      await this.cleanupAcknowledgedStagingDirectoryBestEffort(transaction.stagingDirectoryPath);
      return true;
    });
  }

  private async finalizeRecoveredTransaction(
    transactionId: string,
    recovery: AtomicOutputFinalizeRecovery,
  ): Promise<boolean> {
    const directoryPath = resolve(recovery.directoryPath);
    if (
      !isAbsolute(recovery.directoryPath)
      || !await this.dependencies.isDirectory(directoryPath)
      || !Array.isArray(recovery.expectedFileNames)
      || recovery.expectedFileNames.length === 0
      || recovery.expectedFileNames.length > 10_000
    ) {
      throw new Error("Dati di recupero della transazione output non validi.");
    }
    const expectedFileNames = recovery.expectedFileNames.map(normalizeAtomicOutputFileName);
    if (new Set(expectedFileNames.map((name) => collisionKey(name, this.dependencies.caseInsensitiveFileNames))).size
      !== expectedFileNames.length) {
      throw new Error("I nomi attesi della transazione output non sono univoci.");
    }

    const stagingDirectoryPath = resolve(directoryPath, `.filex-stage-${transactionId}`);
    if (dirname(stagingDirectoryPath) !== directoryPath) {
      throw new Error("Percorso di recupero della transazione output non sicuro.");
    }
    if (!await this.dependencies.pathExists(stagingDirectoryPath)) {
      // Il finalize precedente può avere scritto l'ack e già eliminato lo
      // staging prima del crash. La fingerprint successiva decide se i finali
      // sono davvero quelli attesi.
      return true;
    }

    const firstInspection = await this.inspectRecoverableStagingDirectory(stagingDirectoryPath, transactionId);
    if (!firstInspection) {
      throw new Error("La transazione output da recuperare non è valida.");
    }
    if (firstInspection.acknowledgement) {
      await this.cleanupAcknowledgedStagingDirectoryBestEffort(stagingDirectoryPath);
      return true;
    }
    if (
      firstInspection.rollbackIntents.length > 0
      || firstInspection.rollbackQuarantineFileNames.length > 0
    ) {
      throw new Error("La transazione output contiene un rollback interrotto e non può essere finalizzata.");
    }
    if (firstInspection.stagedFileNames.length !== expectedFileNames.length) {
      throw new Error("La transazione output non coincide con il record pending salvato.");
    }
    const stagedNames = new Set(firstInspection.stagedFileNames);
    if (stagedNames.size !== firstInspection.stagedFileNames.length) {
      throw new Error("Il journal della transazione output è incompleto.");
    }

    const processIsActive = await this.dependencies.isProcessActive(firstInspection.manifest.ownerProcessId)
      .catch(() => true);
    if (processIsActive) {
      throw new Error("La transazione output risulta ancora gestita da un altro processo FileX.");
    }

    const livePublishIntents: AtomicOutputPublishIntent[] = [];
    for (const intent of firstInspection.publishIntents) {
      const stagedPath = resolve(stagingDirectoryPath, intent.stagedFileName);
      const destinationPath = resolve(directoryPath, intent.destinationFileName);
      if (
        !stagedNames.has(intent.stagedFileName)
        || dirname(stagedPath) !== stagingDirectoryPath
        || dirname(destinationPath) !== directoryPath
      ) {
        throw new Error("Il journal della transazione output contiene percorsi non sicuri.");
      }
      const [stagedIdentity, destinationIdentity] = await Promise.all([
        this.dependencies.getFileIdentity(stagedPath),
        this.dependencies.getFileIdentity(destinationPath),
      ]);
      if (stagedIdentity !== intent.fileIdentity) {
        throw new Error("Lo staging non coincide più con la transazione pending.");
      }
      // Un intent viene scritto prima del link. Le collisioni EEXIST lasciano
      // quindi nel journal tentativi senza un hard-link finale FileX: vengono
      // ignorati, mentre ogni pubblicazione ancora viva deve comparire nel
      // pending con lo stesso nome definitivo.
      if (destinationIdentity === intent.fileIdentity) {
        livePublishIntents.push(intent);
      }
    }
    const liveDestinationNames = livePublishIntents.map((intent) => intent.destinationFileName);
    const liveStagedNames = livePublishIntents.map((intent) => intent.stagedFileName);
    const expectedKeys = new Set(expectedFileNames.map(
      (name) => collisionKey(name, this.dependencies.caseInsensitiveFileNames),
    ));
    const liveDestinationKeys = new Set(liveDestinationNames.map(
      (name) => collisionKey(name, this.dependencies.caseInsensitiveFileNames),
    ));
    if (
      livePublishIntents.length !== expectedFileNames.length
      || liveDestinationKeys.size !== expectedKeys.size
      || [...expectedKeys].some((name) => !liveDestinationKeys.has(name))
      || new Set(liveStagedNames).size !== stagedNames.size
      || [...stagedNames].some((name) => !liveStagedNames.includes(name))
    ) {
      throw new Error("I file pubblicati non coincidono più con la transazione pending.");
    }

    const secondInspection = await this.inspectRecoverableStagingDirectory(stagingDirectoryPath, transactionId);
    if (!secondInspection || !sameRecoverableStagingDirectory(firstInspection, secondInspection)) {
      throw new Error("La transazione output è cambiata durante il recupero.");
    }
    const markerPath = resolve(stagingDirectoryPath, ACKNOWLEDGED_MARKER_FILE_NAME);
    if (dirname(markerPath) !== stagingDirectoryPath) {
      throw new Error("Percorso marker output non sicuro.");
    }
    await this.writeAcknowledgementMarker(stagingDirectoryPath, transactionId);
    await this.cleanupAcknowledgedStagingDirectoryBestEffort(stagingDirectoryPath);
    return true;
  }

  async rollback(ownerId: number, transactionIdInput: string): Promise<boolean> {
    const transactionId = normalizeTransactionId(transactionIdInput);
    const transaction = this.transactions.get(transactionId);
    if (!transaction) return true;
    if (transaction.ownerId !== ownerId) {
      throw new Error("La transazione output appartiene a un altro processo.");
    }

    return this.enqueue(transaction, async () => {
      if (transaction.state === "acknowledged" || transaction.state === "rolled-back") return true;
      if (await this.hasDurableAcknowledgement(transaction.stagingDirectoryPath, transaction.id)) {
        transaction.state = "acknowledged";
        this.transactions.delete(transaction.id);
        await this.cleanupAcknowledgedStagingDirectoryBestEffort(transaction.stagingDirectoryPath);
        return true;
      }
      await this.rollbackTransaction(transaction);
      return true;
    });
  }

  async rollbackOwner(ownerId: number): Promise<void> {
    const ownedTransactions = Array.from(this.transactions.values())
      .filter((transaction) => transaction.ownerId === ownerId);
    const outcomes = await Promise.allSettled(
      ownedTransactions.map((transaction) => this.rollback(ownerId, transaction.id)),
    );
    const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure) => failure.reason),
        "Rollback delle transazioni output del renderer incompleto.",
      );
    }
  }

  async rollbackAll(): Promise<void> {
    const transactions = Array.from(this.transactions.values());
    const outcomes = await Promise.allSettled(
      transactions.map((transaction) => this.rollback(transaction.ownerId, transaction.id)),
    );
    const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure) => failure.reason),
        "Rollback globale delle transazioni output incompleto.",
      );
    }
  }

  private requireOwnedTransaction(ownerId: number, transactionIdInput: string): AtomicOutputTransaction {
    const transactionId = normalizeTransactionId(transactionIdInput);
    const transaction = this.transactions.get(transactionId);
    if (!transaction || transaction.ownerId !== ownerId) {
      throw new Error("Transazione output non trovata o non autorizzata.");
    }
    return transaction;
  }

  private async inspectRecoverableStagingDirectory(
    stagingDirectoryPath: string,
    expectedTransactionId: string,
  ): Promise<RecoverableStagingDirectory | null> {
    try {
      const directoryInfo = await this.dependencies.getPathInfo(stagingDirectoryPath);
      if (!directoryInfo || directoryInfo.kind !== "directory") return null;
      const manifestPath = resolve(stagingDirectoryPath, TRANSACTION_MANIFEST_FILE_NAME);
      if (dirname(manifestPath) !== stagingDirectoryPath) return null;
      const manifestInfo = await this.dependencies.getPathInfo(manifestPath);
      if (!manifestInfo || manifestInfo.kind !== "file") return null;
      const childNames = (await this.dependencies.listDirectoryNames(stagingDirectoryPath)).sort();
      const stagedFileNames: string[] = [];
      const publishIntents: AtomicOutputPublishIntent[] = [];
      const rollbackIntents: AtomicOutputRollbackIntent[] = [];
      const rollbackQuarantineFileNames: string[] = [];
      let acknowledgement: AtomicOutputAcknowledgement | null = null;
      for (const childName of childNames) {
        if (childName === TRANSACTION_MANIFEST_FILE_NAME) continue;
        const childPath = resolve(stagingDirectoryPath, childName);
        if (dirname(childPath) !== stagingDirectoryPath) return null;
        const childInfo = await this.dependencies.getPathInfo(childPath);
        if (!childInfo) return null;

        if (ROLLBACK_QUARANTINE_FILE_PATTERN.test(childName)) {
          // A replacement can race with the identity check immediately before
          // rename. Non-file objects are therefore recognized but never
          // deleted automatically; recovery keeps the staging for inspection.
          rollbackQuarantineFileNames.push(childName);
          continue;
        }
        if (childInfo.kind !== "file") return null;

        if (STAGED_FILE_PATTERN.test(childName)) {
          stagedFileNames.push(childName);
          continue;
        }
        if (childName === ACKNOWLEDGED_MARKER_FILE_NAME) {
          acknowledgement = parseAcknowledgement(
            await this.dependencies.readTextFile(childPath),
            expectedTransactionId,
          );
          if (!acknowledgement) return null;
          continue;
        }
        const publishIntentMatch = PUBLISH_INTENT_FILE_PATTERN.exec(childName);
        if (publishIntentMatch) {
          const sequence = Number(publishIntentMatch[1]);
          if (sequence !== publishIntents.length + 1) return null;
          const intent = parsePublishIntent(
            await this.dependencies.readTextFile(childPath),
            expectedTransactionId,
            sequence,
          );
          if (!intent) return null;
          publishIntents.push(intent);
          continue;
        }
        const rollbackIntentMatch = ROLLBACK_INTENT_FILE_PATTERN.exec(childName);
        if (!rollbackIntentMatch) return null;
        const sequence = Number(rollbackIntentMatch[1]);
        if (rollbackIntents.some((intent) => intent.sequence === sequence)) return null;
        const rollbackIntent = parseRollbackIntent(
          await this.dependencies.readTextFile(childPath),
          expectedTransactionId,
          sequence,
        );
        if (!rollbackIntent) return null;
        rollbackIntents.push(rollbackIntent);
      }
      const manifest = parseTransactionManifest(
        await this.dependencies.readTextFile(manifestPath),
        expectedTransactionId,
      );
      if (!manifest) return null;
      rollbackIntents.sort((left, right) => left.sequence - right.sequence);
      rollbackQuarantineFileNames.sort();
      return {
        manifest,
        acknowledgement,
        publishIntents,
        rollbackIntents,
        rollbackQuarantineFileNames,
        stagedFileNames,
      };
    } catch {
      return null;
    }
  }

  private async cleanupStagingDirectoryBestEffort(stagingDirectoryPath: string): Promise<boolean> {
    try {
      await this.dependencies.removePath(stagingDirectoryPath, true);
    } catch {
      // Verification below distinguishes a completed cleanup from a remnant.
    }
    try {
      return !await this.dependencies.pathExists(stagingDirectoryPath);
    } catch {
      return false;
    }
  }

  private async removeEmptyStagingDirectoryIfSafe(stagingDirectoryPath: string): Promise<boolean> {
    try {
      const info = await this.dependencies.getPathInfo(stagingDirectoryPath);
      if (!info || info.kind !== "directory") return false;
      if ((await this.dependencies.listDirectoryNames(stagingDirectoryPath)).length !== 0) return false;
      await this.dependencies.removeEmptyDirectory(stagingDirectoryPath);
      return !await this.dependencies.pathExists(stagingDirectoryPath);
    } catch {
      return false;
    }
  }

  private async hasDurableAcknowledgement(
    stagingDirectoryPath: string,
    transactionId: string,
  ): Promise<boolean> {
    const markerPath = resolve(stagingDirectoryPath, ACKNOWLEDGED_MARKER_FILE_NAME);
    if (dirname(markerPath) !== stagingDirectoryPath) return false;
    try {
      return Boolean(parseAcknowledgement(
        await this.dependencies.readTextFile(markerPath),
        transactionId,
      ));
    } catch {
      return false;
    }
  }

  private async writeAcknowledgementMarker(
    stagingDirectoryPath: string,
    transactionId: string,
  ): Promise<void> {
    const markerPath = resolve(stagingDirectoryPath, ACKNOWLEDGED_MARKER_FILE_NAME);
    if (dirname(markerPath) !== stagingDirectoryPath) {
      throw new Error("Percorso marker output non sicuro.");
    }
    try {
      await this.dependencies.writeTextFileExclusive(markerPath, serializeAcknowledgement({
        schemaVersion: 1,
        transactionId,
        acknowledgedAt: this.dependencies.now(),
      }));
    } catch (error) {
      // Una write può aver raggiunto disco e poi fallire soltanto in close().
      // In quel caso l'ack autenticato è già il commit point e non va mai
      // seguito da un rollback dei nomi finali.
      if (!await this.hasDurableAcknowledgement(stagingDirectoryPath, transactionId)) {
        throw error;
      }
    }
  }

  private async cleanupAcknowledgedStagingDirectoryBestEffort(
    stagingDirectoryPath: string,
  ): Promise<boolean> {
    // L'ack è la prova durabile che i nomi finali non devono più essere
    // ritirati. Viene eliminato soltanto dopo tutti gli altri figli: una
    // pulizia parziale lascia quindi sempre una prova valida al recovery.
    let childNames: string[];
    try {
      childNames = await this.dependencies.listDirectoryNames(stagingDirectoryPath);
    } catch {
      try {
        return !await this.dependencies.pathExists(stagingDirectoryPath);
      } catch {
        return false;
      }
    }

    if (!childNames.includes(ACKNOWLEDGED_MARKER_FILE_NAME)) return false;
    const manifestName = TRANSACTION_MANIFEST_FILE_NAME;
    const removableNames = childNames.filter(
      (childName) => childName !== ACKNOWLEDGED_MARKER_FILE_NAME && childName !== manifestName,
    );
    if (childNames.includes(manifestName)) removableNames.push(manifestName);
    for (const childName of removableNames) {
      const childPath = resolve(stagingDirectoryPath, childName);
      if (dirname(childPath) !== stagingDirectoryPath) return false;
      try {
        await this.dependencies.removePath(childPath, false);
        if (await this.dependencies.pathExists(childPath)) return false;
      } catch {
        return false;
      }
    }

    const markerPath = resolve(stagingDirectoryPath, ACKNOWLEDGED_MARKER_FILE_NAME);
    if (dirname(markerPath) !== stagingDirectoryPath) return false;
    try {
      await this.dependencies.removePath(markerPath, false);
      if (await this.dependencies.pathExists(markerPath)) return false;
      await this.dependencies.removeEmptyDirectory(stagingDirectoryPath);
    } catch {
      // Se il marker è già stato rimosso, lo staging può essere soltanto vuoto:
      // non esistono più journal in grado di causare un rollback dei finali.
    }
    try {
      return !await this.dependencies.pathExists(stagingDirectoryPath);
    } catch {
      return false;
    }
  }

  private async rollbackRecoveredPublications(
    directoryPath: string,
    stagingDirectoryPath: string,
    inspection: RecoverableStagingDirectory,
  ): Promise<boolean> {
    if (dirname(stagingDirectoryPath) !== directoryPath) return false;
    const stagedNames = new Set(inspection.stagedFileNames);
    const publishIntentsBySequence = new Map(
      inspection.publishIntents.map((intent) => [intent.sequence, intent]),
    );
    const rollbackIntentsBySequence = new Map(
      inspection.rollbackIntents.map((intent) => [intent.sequence, intent]),
    );
    const expectedQuarantineNames = new Set(
      inspection.rollbackIntents.map((intent) => intent.quarantineFileName),
    );
    if (
      rollbackIntentsBySequence.size !== inspection.rollbackIntents.length
      || inspection.rollbackQuarantineFileNames.some((name) => !expectedQuarantineNames.has(name))
    ) {
      return false;
    }

    // Complete any quarantine operation that was durably announced before a
    // previous process stopped. A third-party regular file is relinked to its
    // original name before its quarantine link can be removed.
    for (const rollbackIntent of [...inspection.rollbackIntents].reverse()) {
      const publishIntent = publishIntentsBySequence.get(rollbackIntent.sequence);
      if (
        !publishIntent
        || publishIntent.destinationFileName !== rollbackIntent.destinationFileName
        || publishIntent.fileIdentity !== rollbackIntent.expectedFileIdentity
      ) {
        return false;
      }
      const destinationPath = resolve(directoryPath, rollbackIntent.destinationFileName);
      if (dirname(destinationPath) !== directoryPath) return false;
      if (!await this.resumeRollbackQuarantine(
        stagingDirectoryPath,
        destinationPath,
        rollbackIntent.expectedFileIdentity,
        rollbackIntent.quarantineFileName,
      )) {
        return false;
      }
    }

    for (const intent of [...inspection.publishIntents].reverse()) {
      const stagedPath = resolve(stagingDirectoryPath, intent.stagedFileName);
      const destinationPath = resolve(directoryPath, intent.destinationFileName);
      if (
        !stagedNames.has(intent.stagedFileName)
        || dirname(stagedPath) !== stagingDirectoryPath
        || dirname(destinationPath) !== directoryPath
      ) {
        return false;
      }

      let stagedIdentity: string | null;
      let destinationIdentity: string | null;
      try {
        [stagedIdentity, destinationIdentity] = await Promise.all([
          this.dependencies.getFileIdentity(stagedPath),
          this.dependencies.getFileIdentity(destinationPath),
        ]);
      } catch {
        return false;
      }

      if (destinationIdentity === null) {
        try {
          if (!await this.dependencies.pathExists(destinationPath)) continue;
        } catch {
          return false;
        }
        // Un symlink, una directory o un tipo sconosciuto sul nome finale non
        // è mai trattato come un output FileX e viene lasciato intatto.
        continue;
      }

      if (destinationIdentity !== intent.fileIdentity) {
        // Collisione preesistente o sostituzione successiva: appartiene a terzi.
        continue;
      }
      if (stagedIdentity !== intent.fileIdentity) {
        // Senza il secondo hard-link non esiste una prova sufficiente per
        // eliminare il nome finale, anche se il journal dichiara la stessa ID.
        return false;
      }

      if (!await this.quarantinePublishedDestination(
        stagingDirectoryPath,
        inspection.manifest.transactionId,
        intent.sequence,
        destinationPath,
        intent.fileIdentity,
      )) return false;
    }

    return true;
  }

  private async quarantinePublishedDestination(
    stagingDirectoryPath: string,
    transactionId: string,
    publishIntentSequence: number,
    destinationPath: string,
    expectedIdentity: string,
  ): Promise<boolean> {
    const paddedSequence = String(publishIntentSequence).padStart(12, "0");
    const quarantineFileName = `.filex-rollback-${paddedSequence}.tmp`;
    const rollbackIntentPath = resolve(stagingDirectoryPath, `.filex-rollback-${paddedSequence}.json`);
    const quarantinePath = resolve(stagingDirectoryPath, quarantineFileName);
    if (
      dirname(rollbackIntentPath) !== stagingDirectoryPath
      || dirname(quarantinePath) !== stagingDirectoryPath
    ) return false;

    const rollbackIntent: AtomicOutputRollbackIntent = {
      schemaVersion: 1,
      transactionId,
      sequence: publishIntentSequence,
      destinationFileName: basename(destinationPath),
      expectedFileIdentity: expectedIdentity,
      quarantineFileName,
    };

    try {
      // The recovery record is synced before rename. Consequently, even if a
      // replacement wins the identity-check race and the process stops just
      // after rename, the next process can restore that exact file.
      await this.dependencies.writeTextFileExclusive(
        rollbackIntentPath,
        serializeRollbackIntent(rollbackIntent),
      );
    } catch (error) {
      try {
        const persistedIntent = parseRollbackIntent(
          await this.dependencies.readTextFile(rollbackIntentPath),
          transactionId,
          publishIntentSequence,
        );
        if (!persistedIntent || JSON.stringify(persistedIntent) !== JSON.stringify(rollbackIntent)) return false;
      } catch {
        return false;
      }
    }

    return this.resumeRollbackQuarantine(
      stagingDirectoryPath,
      destinationPath,
      expectedIdentity,
      quarantineFileName,
    );
  }

  private async resumeRollbackQuarantine(
    stagingDirectoryPath: string,
    destinationPath: string,
    expectedIdentity: string,
    quarantineFileName: string,
  ): Promise<boolean> {
    const quarantinePath = resolve(stagingDirectoryPath, quarantineFileName);
    if (
      dirname(quarantinePath) !== stagingDirectoryPath
      || dirname(destinationPath) === stagingDirectoryPath
    ) return false;

    let quarantineExists: boolean;
    try {
      quarantineExists = await this.dependencies.pathExists(quarantinePath);
    } catch {
      return false;
    }
    if (!quarantineExists) {
      let destinationIdentity: string | null;
      try {
        destinationIdentity = await this.dependencies.getFileIdentity(destinationPath);
      } catch {
        return false;
      }
      // The output was already removed, or a replacement still occupies its
      // original name. Neither state requires moving external data.
      if (destinationIdentity !== expectedIdentity) return true;
      try {
        await this.dependencies.movePath(destinationPath, quarantinePath);
      } catch {
        // rename may have completed before returning an error. The durable
        // intent makes a later recovery unambiguous, so keep the staging.
        return false;
      }
    }

    let quarantinedIdentity: string | null;
    try {
      quarantinedIdentity = await this.dependencies.getFileIdentity(quarantinePath);
    } catch {
      return false;
    }
    if (!quarantinedIdentity) {
      // A raced symlink/directory is retained together with its journal. Node
      // has no portable rename-without-overwrite primitive for these objects.
      return false;
    }
    if (quarantinedIdentity === expectedIdentity) {
      return this.removeQuarantineFileBestEffort(quarantinePath);
    }

    let destinationIdentity: string | null;
    try {
      destinationIdentity = await this.dependencies.getFileIdentity(destinationPath);
    } catch {
      return false;
    }
    if (destinationIdentity !== quarantinedIdentity) {
      try {
        if (await this.dependencies.pathExists(destinationPath)) return false;
      } catch {
        return false;
      }
      try {
        // Hard-link first and delete the quarantine name only after verifying
        // the original name. This makes restoration itself crash-safe.
        await this.dependencies.publishFile(quarantinePath, destinationPath);
      } catch {
        return false;
      }
      try {
        destinationIdentity = await this.dependencies.getFileIdentity(destinationPath);
      } catch {
        return false;
      }
    }
    if (destinationIdentity !== quarantinedIdentity) return false;
    return this.removeQuarantineFileBestEffort(quarantinePath);
  }

  private async removeQuarantineFileBestEffort(quarantinePath: string): Promise<boolean> {
    try {
      await this.dependencies.removePath(quarantinePath, false);
    } catch {
      // A removal can complete before reporting a close/flush error.
    }
    try {
      return !await this.dependencies.pathExists(quarantinePath);
    } catch {
      return false;
    }
  }

  private async publishStagedFile(
    transaction: AtomicOutputTransaction,
    item: StagedOutputFile,
    reservedNames: Set<string>,
  ): Promise<string> {
    const fileIdentity = await this.dependencies.getFileIdentity(item.stagedPath);
    if (!fileIdentity) {
      throw new Error(`File di staging non disponibile o non sicuro: ${item.requestedFileName}.`);
    }

    for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt += 1) {
      const fileName = candidateFileName(item.requestedFileName, attempt);
      const key = collisionKey(fileName, this.dependencies.caseInsensitiveFileNames);
      if (reservedNames.has(key)) continue;
      const destinationPath = resolve(transaction.directoryPath, fileName);
      if (dirname(destinationPath) !== transaction.directoryPath) {
        throw new Error("Percorso finale output non sicuro.");
      }
      if (await this.dependencies.pathExists(destinationPath)) continue;
      if (await this.dependencies.getFileIdentity(item.stagedPath) !== fileIdentity) {
        throw new Error(`Il file di staging e' cambiato durante il commit: ${item.requestedFileName}.`);
      }

      const publishIntentSequence = await this.writePublishIntent(transaction, {
        stagedFileName: basename(item.stagedPath),
        destinationFileName: fileName,
        fileIdentity,
      });
      if (await this.dependencies.getFileIdentity(item.stagedPath) !== fileIdentity) {
        throw new Error(`Il file di staging e' cambiato durante il journal: ${item.requestedFileName}.`);
      }

      try {
        await this.dependencies.publishFile(item.stagedPath, destinationPath);
      } catch (error) {
        if (hasErrorCode(error, ["EEXIST", "ENOTEMPTY"])) continue;
        throw error;
      }

      // Keep the staged hard-link alive until every publication has completed.
      // Its identity is the rollback guard: a destination replaced by another
      // process must never be unlinked as if it were still our output.
      transaction.publishedFiles.push({
        destinationPath,
        stagedPath: item.stagedPath,
        fileIdentity,
        publishIntentSequence,
      });
      if (await this.dependencies.getFileIdentity(destinationPath) !== fileIdentity) {
        throw new Error(`Il file pubblicato e' cambiato durante il commit: ${fileName}.`);
      }
      reservedNames.add(key);
      return fileName;
    }
    throw new Error(`Impossibile riservare un nome per ${item.requestedFileName}.`);
  }

  private async writePublishIntent(
    transaction: AtomicOutputTransaction,
    input: Pick<AtomicOutputPublishIntent, "stagedFileName" | "destinationFileName" | "fileIdentity">,
  ): Promise<number> {
    const sequence = transaction.nextPublishIntentSequence;
    if (!Number.isSafeInteger(sequence) || sequence <= 0 || sequence > 999_999_999_999) {
      throw new Error("Il journal di pubblicazione ha superato il limite sicuro.");
    }
    const intentPath = resolve(
      transaction.stagingDirectoryPath,
      `.filex-publish-${String(sequence).padStart(12, "0")}.json`,
    );
    if (dirname(intentPath) !== transaction.stagingDirectoryPath) {
      throw new Error("Percorso journal output non sicuro.");
    }
    await this.dependencies.writeTextFileExclusive(intentPath, serializePublishIntent({
      schemaVersion: 1,
      transactionId: transaction.id,
      sequence,
      stagedFileName: input.stagedFileName,
      destinationFileName: input.destinationFileName,
      fileIdentity: input.fileIdentity,
    }));
    transaction.nextPublishIntentSequence += 1;
    return sequence;
  }

  private async assertPublishedFilesUnchanged(transaction: AtomicOutputTransaction): Promise<void> {
    for (const publishedFile of transaction.publishedFiles) {
      const [stagedIdentity, destinationIdentity] = await Promise.all([
        this.dependencies.getFileIdentity(publishedFile.stagedPath),
        this.dependencies.getFileIdentity(publishedFile.destinationPath),
      ]);
      if (
        stagedIdentity !== publishedFile.fileIdentity
        || destinationIdentity !== publishedFile.fileIdentity
      ) {
        throw new Error(
          `Integrita' output cambiata prima del completamento: ${basename(publishedFile.destinationPath)}.`,
        );
      }
    }
  }

  private async rollbackTransaction(transaction: AtomicOutputTransaction): Promise<void> {
    const remnantPaths: string[] = [];

    for (const publishedFile of [...transaction.publishedFiles].reverse()) {
      let stagedIdentity: string | null;
      let destinationIdentity: string | null;
      try {
        [stagedIdentity, destinationIdentity] = await Promise.all([
          this.dependencies.getFileIdentity(publishedFile.stagedPath),
          this.dependencies.getFileIdentity(publishedFile.destinationPath),
        ]);
      } catch {
        // An inconclusive identity check must preserve the destination.
        remnantPaths.push(publishedFile.destinationPath);
        continue;
      }

      if (destinationIdentity === null) {
        try {
          // Un nome presente ma non-file è una sostituzione esterna: l'output
          // FileX non occupa più la destinazione e non deve essere toccato.
          await this.dependencies.pathExists(publishedFile.destinationPath);
        } catch {
          remnantPaths.push(publishedFile.destinationPath);
        }
        continue;
      }

      if (stagedIdentity !== publishedFile.fileIdentity) {
        remnantPaths.push(publishedFile.destinationPath);
        continue;
      }
      if (destinationIdentity !== publishedFile.fileIdentity) continue;

      if (!await this.quarantinePublishedDestination(
        transaction.stagingDirectoryPath,
        transaction.id,
        publishedFile.publishIntentSequence,
        publishedFile.destinationPath,
        publishedFile.fileIdentity,
      )) {
        remnantPaths.push(publishedFile.destinationPath);
      }
    }

    if (remnantPaths.length === 0) {
      try {
        await this.dependencies.removePath(transaction.stagingDirectoryPath, true);
      } catch {
        // Verification below reports the staging path only if it is still present.
      }
      try {
        if (await this.dependencies.pathExists(transaction.stagingDirectoryPath)) {
          remnantPaths.push(transaction.stagingDirectoryPath);
        }
      } catch {
        remnantPaths.push(transaction.stagingDirectoryPath);
      }
    }

    if (remnantPaths.length > 0) {
      throw new AtomicOutputRollbackError(Array.from(new Set(remnantPaths)));
    }
    transaction.state = "rolled-back";
    this.transactions.delete(transaction.id);
  }

  private async assertNoRemnants(paths: string[]): Promise<void> {
    const uniquePaths = Array.from(new Set(paths));
    const existence = await Promise.all(uniquePaths.map(async (path) => ({
      path,
      exists: await this.dependencies.pathExists(path),
    })));
    const remnants = existence.filter((entry) => entry.exists).map((entry) => entry.path);
    if (remnants.length > 0) throw new AtomicOutputRollbackError(remnants);
  }

  private async enqueue<T>(transaction: AtomicOutputTransaction, operation: () => Promise<T>): Promise<T> {
    const previous = transaction.operation;
    let resolveCurrent!: () => void;
    transaction.operation = new Promise<void>((resolveOperation) => {
      resolveCurrent = resolveOperation;
    });
    await previous;
    try {
      return await operation();
    } finally {
      resolveCurrent();
    }
  }

  private async withCommitLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.commitQueue;
    let release!: () => void;
    this.commitQueue = new Promise<void>((resolveQueue) => {
      release = resolveQueue;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
