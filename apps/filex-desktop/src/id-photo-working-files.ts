import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, realpath, rm, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, parse, resolve } from "node:path";
import type {
  DesktopIdPhotoWorkingCleanupResult,
  DesktopIdPhotoWorkingCopyRequest,
  DesktopIdPhotoWorkingCopyResult,
} from "@photo-tools/desktop-contracts";

const WORKING_ROOT_SEGMENTS = ["id-photo", "working"] as const;
const JOB_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,63})$/;
const MAX_COPY_ATTEMPTS = 32;
const MAX_SAFE_STEM_LENGTH = 72;
const SAFE_EXTENSION_PATTERN = /^\.[a-z0-9]{1,12}$/i;

export interface IdPhotoWorkingFileDependencies {
  createUniqueId?: () => string;
}

export function resolveIdPhotoDataRoot(
  platform: NodeJS.Platform,
  homePath: string,
  userDataPath: string,
): string {
  const selectedRoot = platform === "win32" ? homePath : userDataPath;
  if (typeof selectedRoot !== "string" || !selectedRoot.trim() || !isAbsolute(selectedRoot)) {
    throw new Error("Cartella dati FileX non valida.");
  }
  return platform === "win32"
    ? resolve(selectedRoot, "FileX-ID-Photo-Data")
    : resolve(selectedRoot, "id-photo-data");
}

function normalizeJobId(jobId: unknown): string {
  if (typeof jobId !== "string" || !JOB_ID_PATTERN.test(jobId)) {
    throw new Error("ID commessa non valido: usa solo lettere minuscole, numeri, trattino o underscore (massimo 64 caratteri).");
  }
  return jobId;
}

function resolveWorkingRoot(userDataPath: string): string {
  if (typeof userDataPath !== "string" || !userDataPath.trim() || !isAbsolute(userDataPath)) {
    throw new Error("Cartella dati FileX non valida.");
  }
  return resolve(userDataPath, ...WORKING_ROOT_SEGMENTS);
}

export function resolveIdPhotoWorkingDirectory(userDataPath: string, jobId: string): string {
  const rootPath = resolveWorkingRoot(userDataPath);
  const normalizedJobId = normalizeJobId(jobId);
  const jobDirectoryPath = resolve(rootPath, `job-${normalizedJobId}`);

  // The job id is intentionally restricted, but keep this structural guard as
  // the final boundary before any recursive cleanup is allowed.
  if (dirname(jobDirectoryPath) !== rootPath || jobDirectoryPath === rootPath) {
    throw new Error("Percorso di lavoro della commessa non sicuro.");
  }
  return jobDirectoryPath;
}

function normalizeSourcePath(sourcePath: unknown): string {
  if (typeof sourcePath !== "string" || !sourcePath.trim() || !isAbsolute(sourcePath)) {
    throw new Error("Il file sorgente deve avere un percorso assoluto valido.");
  }
  return resolve(sourcePath);
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLocaleLowerCase("en-US") === normalizedRight.toLocaleLowerCase("en-US")
    : normalizedLeft === normalizedRight;
}

async function assertDirectManagedDirectory(
  parentPath: string,
  childPath: string,
  label: string,
): Promise<string> {
  if (dirname(childPath) !== resolve(parentPath)) {
    throw new Error(`${label} fuori dalla gerarchia gestita FileX.`);
  }

  const childStat = await lstat(childPath);
  if (childStat.isSymbolicLink() || !childStat.isDirectory()) {
    throw new Error(`${label} non sicura.`);
  }

  const [realParentPath, realChildPath] = await Promise.all([
    realpath(parentPath),
    realpath(childPath),
  ]);
  if (dirname(realChildPath) !== realParentPath) {
    throw new Error(`${label} fuori dall'area dati reale di FileX.`);
  }
  return realChildPath;
}

async function ensureDirectManagedDirectory(
  parentPath: string,
  childPath: string,
  label: string,
): Promise<string> {
  try {
    await mkdir(childPath);
  } catch (error) {
    if (!isAlreadyExistingError(error)) throw error;
  }
  return assertDirectManagedDirectory(parentPath, childPath, label);
}

function sanitizeSourceStem(sourcePath: string): string {
  const sourceStem = parse(basename(sourcePath)).name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, MAX_SAFE_STEM_LENGTH);
  return sourceStem || "photo";
}

function safeSourceExtension(sourcePath: string): string {
  const extension = extname(sourcePath);
  return SAFE_EXTENSION_PATTERN.test(extension) ? extension : "";
}

function normalizeUniqueId(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 64);
  if (!normalized) {
    throw new Error("Identificatore copia di lavoro non valido.");
  }
  return normalized;
}

function isAlreadyExistingError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

function isMissingError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

export async function createIdPhotoWorkingCopy(
  userDataPath: string,
  request: DesktopIdPhotoWorkingCopyRequest,
  dependencies: IdPhotoWorkingFileDependencies = {},
): Promise<DesktopIdPhotoWorkingCopyResult> {
  if (!request || typeof request !== "object") {
    throw new Error("Richiesta copia di lavoro non valida.");
  }

  const jobId = normalizeJobId(request.jobId);
  const sourcePath = normalizeSourcePath(request.sourcePath);
  const sourceStat = await stat(sourcePath);
  if (!sourceStat.isFile()) {
    throw new Error("La sorgente selezionata non è un file.");
  }

  const workingRootPath = resolveWorkingRoot(userDataPath);
  const idPhotoRootPath = dirname(workingRootPath);
  const normalizedUserDataPath = dirname(idPhotoRootPath);
  const workingDirectoryPath = resolveIdPhotoWorkingDirectory(userDataPath, jobId);
  await mkdir(normalizedUserDataPath, { recursive: true });
  await ensureDirectManagedDirectory(normalizedUserDataPath, idPhotoRootPath, "Cartella ID Photo");
  await ensureDirectManagedDirectory(idPhotoRootPath, workingRootPath, "Radice delle copie ID Photo");
  await ensureDirectManagedDirectory(workingRootPath, workingDirectoryPath, "Cartella della commessa ID Photo");

  const sourceStem = sanitizeSourceStem(sourcePath);
  const sourceExtension = safeSourceExtension(sourcePath);
  const createUniqueId = dependencies.createUniqueId ?? randomUUID;

  for (let attempt = 0; attempt < MAX_COPY_ATTEMPTS; attempt += 1) {
    const uniqueId = normalizeUniqueId(createUniqueId());
    const workingPath = join(
      workingDirectoryPath,
      `${sourceStem}-filex-work-${uniqueId}${sourceExtension}`,
    );

    if (dirname(workingPath) !== workingDirectoryPath || samePath(sourcePath, workingPath)) {
      throw new Error("FileX ha bloccato una copia di lavoro che coincide con la sorgente.");
    }

    try {
      await copyFile(sourcePath, workingPath, constants.COPYFILE_EXCL);
      return {
        jobId,
        sourcePath,
        workingPath,
        createdAt: Date.now(),
      };
    } catch (error) {
      if (isAlreadyExistingError(error)) continue;
      throw error;
    }
  }

  throw new Error("Impossibile creare un nome univoco per la copia di lavoro.");
}

export async function cleanupIdPhotoWorkingFiles(
  userDataPath: string,
  jobId: string,
): Promise<DesktopIdPhotoWorkingCleanupResult> {
  const normalizedJobId = normalizeJobId(jobId);
  const workingRootPath = resolveWorkingRoot(userDataPath);
  const idPhotoRootPath = dirname(workingRootPath);
  const normalizedUserDataPath = dirname(idPhotoRootPath);
  const workingDirectoryPath = resolveIdPhotoWorkingDirectory(userDataPath, normalizedJobId);

  if (dirname(workingDirectoryPath) !== workingRootPath || workingDirectoryPath === workingRootPath) {
    throw new Error("Pulizia FileX bloccata: destinazione non sicura.");
  }

  let realWorkingRootPath: string;
  try {
    await assertDirectManagedDirectory(normalizedUserDataPath, idPhotoRootPath, "Cartella ID Photo");
    realWorkingRootPath = await assertDirectManagedDirectory(
      idPhotoRootPath,
      workingRootPath,
      "Radice delle copie ID Photo",
    );
  } catch (error) {
    if (isMissingError(error)) {
      return { jobId: normalizedJobId, removed: false };
    }
    throw error;
  }

  let directoryStat;
  try {
    directoryStat = await lstat(workingDirectoryPath);
  } catch (error) {
    if (isMissingError(error)) {
      return { jobId: normalizedJobId, removed: false };
    }
    throw error;
  }

  if (directoryStat.isSymbolicLink()) {
    // Never recurse through a link placed inside the managed root.
    await unlink(workingDirectoryPath);
    return { jobId: normalizedJobId, removed: true };
  }
  if (!directoryStat.isDirectory()) {
    throw new Error("Pulizia FileX bloccata: la destinazione gestita non è una cartella.");
  }

  const realWorkingDirectoryPath = await realpath(workingDirectoryPath);
  if (dirname(realWorkingDirectoryPath) !== realWorkingRootPath) {
    throw new Error("Pulizia FileX bloccata: cartella commessa fuori dalla radice gestita.");
  }

  await rm(workingDirectoryPath, { recursive: true, force: false, maxRetries: 2, retryDelay: 50 });
  return { jobId: normalizedJobId, removed: true };
}
