import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import type {
  DesktopPhotoToolHandoff,
  DesktopPhotoToolHandoffFile,
  DesktopPhotoToolHandoffRequest,
  DesktopPhotoToolHandoffSendResult,
  DesktopPhotoToolHandoffTargetToolId,
  DesktopToolId,
} from "@photo-tools/desktop-contracts";

const DEFAULT_HANDOFF_TTL_MS = 10 * 60_000;
const MAX_HANDOFF_TTL_MS = 60 * 60_000;
const MAX_HANDOFF_BYTES = 256 * 1024;
const MAX_PATH_LENGTH = 32_768;
const CLOCK_SKEW_TOLERANCE_MS = 30_000;
const DEFAULT_ACKNOWLEDGEMENT_TIMEOUT_MS = 20_000;
const MAX_ACKNOWLEDGEMENT_TIMEOUT_MS = 60_000;
const DEFAULT_ACKNOWLEDGEMENT_POLL_INTERVAL_MS = 75;
const MAX_ACKNOWLEDGEMENT_BYTES = 4 * 1024;
const HANDOFF_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HANDOFF_FILE_PATTERN = /^photo-tool-handoff-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/i;
const ACKNOWLEDGEMENT_FILE_PATTERN = /^photo-tool-handoff-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.ack\.json$/i;
const ACKNOWLEDGEMENT_SECRET_PATTERN = /^[0-9a-f]{64}$/;
const ACKNOWLEDGEMENT_PROOF_PATTERN = /^[0-9a-f]{64}$/;
const ACKNOWLEDGEMENT_DOMAIN = "FileX/photo-tool-handoff/ack/v1";

const ALL_DESKTOP_TOOL_IDS = new Set<DesktopToolId>([
  "suite-launcher",
  "image-party-frame",
  "batch-print-layout",
  "id-photo",
  "archivio-flow",
  "image-converter",
  "image-file-finder",
  "cache-sweep",
  "filex-send",
  "backup-guard",
  "photo-selector-app",
]);

const TARGET_CARDINALITY: Record<
  DesktopPhotoToolHandoffTargetToolId,
  { minimum: number; maximum: number }
> = {
  "image-party-frame": { minimum: 1, maximum: 500 },
  "batch-print-layout": { minimum: 1, maximum: 500 },
  "id-photo": { minimum: 1, maximum: 1 },
};

type LaunchTool = (
  toolId: DesktopPhotoToolHandoffTargetToolId,
  launchArgs: string[],
) => Promise<{ ok: boolean; message: string }>;

export interface PhotoToolHandoffManagerOptions {
  storageRoot: string;
  currentToolId: DesktopToolId;
  launchTool?: LaunchTool;
  now?: () => number;
  ttlMs?: number;
  acknowledgementTimeoutMs?: number;
  acknowledgementPollIntervalMs?: number;
  wait?: (delayMs: number) => Promise<void>;
}

interface StoredPhotoToolHandoff extends Omit<DesktopPhotoToolHandoff, "schemaVersion"> {
  schemaVersion: 2;
  acknowledgementSecret: string;
}

interface StoredPhotoToolHandoffAcknowledgement {
  schemaVersion: 1;
  handoffId: string;
  targetToolId: DesktopPhotoToolHandoffTargetToolId;
  consumedAt: string;
  proof: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(record).every((key) => allowed.has(key));
}

function isTargetToolId(value: unknown): value is DesktopPhotoToolHandoffTargetToolId {
  return typeof value === "string" && Object.hasOwn(TARGET_CARDINALITY, value);
}

function isDesktopToolId(value: unknown): value is DesktopToolId {
  return typeof value === "string" && ALL_DESKTOP_TOOL_IDS.has(value as DesktopToolId);
}

function normalizeForComparison(value: string): string {
  const normalized = resolve(value);
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function pathsMatch(left: string, right: string): boolean {
  return normalizeForComparison(left) === normalizeForComparison(right);
}

/**
 * Mantiene le richieste --open-project finché il renderer non conferma di
 * averle gestite. La testa può essere riletta dopo un reload, ma viene
 * rimossa soltanto da acknowledge().
 */
export class OpenProjectRequestQueue {
  readonly #paths: string[] = [];
  #rendererReady = false;
  #inFlightPath: string | null = null;

  enqueue(projectPath: string): void {
    this.#paths.push(projectPath);
  }

  peek(): string | null {
    return this.#paths[0] ?? null;
  }

  consumePending(): string | null {
    const head = this.peek();
    if (head && !this.#inFlightPath) {
      this.#inFlightPath = head;
    }
    return head;
  }

  markRendererReady(): void {
    this.#rendererReady = true;
  }

  resetRenderer(): void {
    this.#rendererReady = false;
    this.#inFlightPath = null;
  }

  takeForDelivery(): string | null {
    if (!this.#rendererReady || this.#inFlightPath) {
      return null;
    }
    const head = this.peek();
    if (head) {
      this.#inFlightPath = head;
    }
    return head;
  }

  acknowledge(projectPath: string): boolean {
    const head = this.peek();
    if (!head || !pathsMatch(head, projectPath)) {
      return false;
    }
    this.#paths.shift();
    this.#inFlightPath = null;
    return true;
  }

  get size(): number {
    return this.#paths.length;
  }
}

function isStrictDescendant(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(rootPath, candidatePath);
  return relativePath.length > 0
    && relativePath !== ".."
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath);
}

function assertUsableAbsolutePath(value: unknown, label: string): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAX_PATH_LENGTH
    || value.includes("\0")
    || !isAbsolute(value)
  ) {
    throw new Error(`${label} deve essere un percorso assoluto valido.`);
  }
  return resolve(value);
}

async function assertRealPathWithoutLinks(
  inputPath: string,
  expectedType: "directory" | "file",
): Promise<{ resolvedPath: string; size: number; lastModified: number }> {
  let pathStat;
  let canonicalPath: string;
  try {
    pathStat = await lstat(inputPath);
    canonicalPath = await realpath(inputPath);
  } catch {
    throw new Error(`Il percorso non esiste o non è accessibile: ${inputPath}`);
  }

  if (pathStat.isSymbolicLink() || !pathsMatch(inputPath, canonicalPath)) {
    throw new Error(`I collegamenti simbolici non sono ammessi nell'handoff: ${inputPath}`);
  }
  if (expectedType === "directory" && !pathStat.isDirectory()) {
    throw new Error(`La radice sorgente non è una cartella: ${inputPath}`);
  }
  if (expectedType === "file" && !pathStat.isFile()) {
    throw new Error(`La selezione contiene un elemento che non è un file: ${inputPath}`);
  }

  return {
    resolvedPath: resolve(canonicalPath),
    size: pathStat.size,
    lastModified: Math.trunc(pathStat.mtimeMs),
  };
}

function assertCardinality(
  targetToolId: DesktopPhotoToolHandoffTargetToolId,
  count: number,
): void {
  const rule = TARGET_CARDINALITY[targetToolId];
  if (count < rule.minimum || count > rule.maximum) {
    if (targetToolId === "id-photo") {
      throw new Error("FileX ID Photo accetta esattamente una foto per ogni passaggio.");
    }
    throw new Error(`Il tool selezionato accetta da 1 a ${rule.maximum} foto per ogni passaggio.`);
  }
}

async function validateSelection(
  targetToolId: DesktopPhotoToolHandoffTargetToolId,
  sourceRootValue: unknown,
  absolutePathValues: unknown,
): Promise<{ sourceRoot: string; files: DesktopPhotoToolHandoffFile[] }> {
  if (!Array.isArray(absolutePathValues)) {
    throw new Error("La selezione foto non è valida.");
  }
  assertCardinality(targetToolId, absolutePathValues.length);

  const requestedRoot = assertUsableAbsolutePath(sourceRootValue, "La radice sorgente");
  const rootInfo = await assertRealPathWithoutLinks(requestedRoot, "directory");
  const files: DesktopPhotoToolHandoffFile[] = [];
  const uniquePaths = new Set<string>();

  for (const value of absolutePathValues) {
    const requestedPath = assertUsableAbsolutePath(value, "Ogni foto selezionata");
    const fileInfo = await assertRealPathWithoutLinks(requestedPath, "file");
    if (!isStrictDescendant(rootInfo.resolvedPath, fileInfo.resolvedPath)) {
      throw new Error(`La foto selezionata è esterna alla radice sorgente: ${requestedPath}`);
    }

    const comparisonKey = normalizeForComparison(fileInfo.resolvedPath);
    if (uniquePaths.has(comparisonKey)) {
      throw new Error(`La selezione contiene due volte la stessa foto: ${requestedPath}`);
    }
    uniquePaths.add(comparisonKey);

    files.push({
      absolutePath: fileInfo.resolvedPath,
      relativePath: relative(rootInfo.resolvedPath, fileInfo.resolvedPath),
      fileName: basename(fileInfo.resolvedPath),
      size: fileInfo.size,
      lastModified: fileInfo.lastModified,
    });
  }

  return { sourceRoot: rootInfo.resolvedPath, files };
}

function parseManifest(value: unknown): StoredPhotoToolHandoff {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, [
      "schemaVersion",
      "handoffId",
      "sourceToolId",
      "targetToolId",
      "sourceRoot",
      "files",
      "createdAt",
      "expiresAt",
      "acknowledgementSecret",
    ])
    || value.schemaVersion !== 2
    || typeof value.handoffId !== "string"
    || !HANDOFF_ID_PATTERN.test(value.handoffId)
    || !isDesktopToolId(value.sourceToolId)
    || !isTargetToolId(value.targetToolId)
    || typeof value.sourceRoot !== "string"
    || !Array.isArray(value.files)
    || typeof value.createdAt !== "string"
    || typeof value.expiresAt !== "string"
    || typeof value.acknowledgementSecret !== "string"
    || !ACKNOWLEDGEMENT_SECRET_PATTERN.test(value.acknowledgementSecret)
  ) {
    throw new Error("Il passaggio foto non ha un formato riconosciuto.");
  }

  const files: DesktopPhotoToolHandoffFile[] = value.files.map((entry) => {
    if (
      !isRecord(entry)
      || !hasOnlyKeys(entry, ["absolutePath", "relativePath", "fileName", "size", "lastModified"])
      || typeof entry.absolutePath !== "string"
      || typeof entry.relativePath !== "string"
      || typeof entry.fileName !== "string"
      || typeof entry.size !== "number"
      || !Number.isSafeInteger(entry.size)
      || entry.size < 0
      || typeof entry.lastModified !== "number"
      || !Number.isSafeInteger(entry.lastModified)
      || entry.lastModified < 0
    ) {
      throw new Error("Il passaggio foto contiene un riferimento file non valido.");
    }
    return {
      absolutePath: entry.absolutePath,
      relativePath: entry.relativePath,
      fileName: entry.fileName,
      size: entry.size,
      lastModified: entry.lastModified,
    };
  });

  return {
    schemaVersion: 2,
    handoffId: value.handoffId,
    sourceToolId: value.sourceToolId,
    targetToolId: value.targetToolId,
    sourceRoot: value.sourceRoot,
    files,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    acknowledgementSecret: value.acknowledgementSecret,
  };
}

function manifestsReferenceSameFiles(
  manifest: StoredPhotoToolHandoff,
  validated: { sourceRoot: string; files: DesktopPhotoToolHandoffFile[] },
): boolean {
  if (!pathsMatch(manifest.sourceRoot, validated.sourceRoot) || manifest.files.length !== validated.files.length) {
    return false;
  }
  return manifest.files.every((file, index) => {
    const current = validated.files[index];
    return pathsMatch(file.absolutePath, current.absolutePath)
      && file.relativePath === current.relativePath
      && file.fileName === current.fileName
      && file.size === current.size
      && file.lastModified === current.lastModified;
  });
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}

function acknowledgementPath(storageRoot: string, handoffId: string): string {
  return join(storageRoot, `photo-tool-handoff-${handoffId}.ack.json`);
}

function acknowledgementProof(
  manifest: StoredPhotoToolHandoff,
  consumedAt: string,
): string {
  return createHmac("sha256", Buffer.from(manifest.acknowledgementSecret, "hex"))
    .update(ACKNOWLEDGEMENT_DOMAIN, "utf8")
    .update("\0", "utf8")
    .update(manifest.handoffId, "utf8")
    .update("\0", "utf8")
    .update(manifest.sourceToolId, "utf8")
    .update("\0", "utf8")
    .update(manifest.targetToolId, "utf8")
    .update("\0", "utf8")
    .update(consumedAt, "utf8")
    .digest("hex");
}

function parseAcknowledgement(value: unknown): StoredPhotoToolHandoffAcknowledgement {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, ["schemaVersion", "handoffId", "targetToolId", "consumedAt", "proof"])
    || value.schemaVersion !== 1
    || typeof value.handoffId !== "string"
    || !HANDOFF_ID_PATTERN.test(value.handoffId)
    || !isTargetToolId(value.targetToolId)
    || typeof value.consumedAt !== "string"
    || typeof value.proof !== "string"
    || !ACKNOWLEDGEMENT_PROOF_PATTERN.test(value.proof)
  ) {
    throw new Error("La ricevuta del passaggio foto non ha un formato riconosciuto.");
  }
  return {
    schemaVersion: 1,
    handoffId: value.handoffId,
    targetToolId: value.targetToolId,
    consumedAt: value.consumedAt,
    proof: value.proof,
  };
}

function securelyMatchesHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function toPublicManifest(manifest: StoredPhotoToolHandoff): DesktopPhotoToolHandoff {
  return {
    schemaVersion: 1,
    handoffId: manifest.handoffId,
    sourceToolId: manifest.sourceToolId,
    targetToolId: manifest.targetToolId,
    sourceRoot: manifest.sourceRoot,
    files: manifest.files,
    createdAt: manifest.createdAt,
    expiresAt: manifest.expiresAt,
  };
}

function defaultWait(delayMs: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
}

export class PhotoToolHandoffManager {
  readonly #storageRoot: string;
  readonly #currentToolId: DesktopToolId;
  readonly #launchTool?: LaunchTool;
  readonly #now: () => number;
  readonly #ttlMs: number;
  readonly #acknowledgementTimeoutMs: number;
  readonly #acknowledgementPollIntervalMs: number;
  readonly #wait: (delayMs: number) => Promise<void>;

  constructor(options: PhotoToolHandoffManagerOptions) {
    this.#storageRoot = assertUsableAbsolutePath(options.storageRoot, "La cartella handoff");
    if (!isDesktopToolId(options.currentToolId)) {
      throw new Error("Tool FileX corrente non riconosciuto.");
    }
    this.#currentToolId = options.currentToolId;
    this.#launchTool = options.launchTool;
    this.#now = options.now ?? Date.now;
    const ttlMs = options.ttlMs ?? DEFAULT_HANDOFF_TTL_MS;
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_HANDOFF_TTL_MS) {
      throw new Error("Durata handoff non valida.");
    }
    this.#ttlMs = ttlMs;

    const acknowledgementTimeoutMs = options.acknowledgementTimeoutMs
      ?? Math.min(DEFAULT_ACKNOWLEDGEMENT_TIMEOUT_MS, Math.max(1, ttlMs - 1));
    if (
      !Number.isSafeInteger(acknowledgementTimeoutMs)
      || acknowledgementTimeoutMs <= 0
      || acknowledgementTimeoutMs > MAX_ACKNOWLEDGEMENT_TIMEOUT_MS
      || acknowledgementTimeoutMs > ttlMs
    ) {
      throw new Error("Timeout di conferma handoff non valido.");
    }
    this.#acknowledgementTimeoutMs = acknowledgementTimeoutMs;

    const acknowledgementPollIntervalMs = options.acknowledgementPollIntervalMs
      ?? Math.min(DEFAULT_ACKNOWLEDGEMENT_POLL_INTERVAL_MS, acknowledgementTimeoutMs);
    if (
      !Number.isSafeInteger(acknowledgementPollIntervalMs)
      || acknowledgementPollIntervalMs <= 0
      || acknowledgementPollIntervalMs > acknowledgementTimeoutMs
    ) {
      throw new Error("Intervallo di conferma handoff non valido.");
    }
    this.#acknowledgementPollIntervalMs = acknowledgementPollIntervalMs;
    this.#wait = options.wait ?? defaultWait;
  }

  async #ensureStorageRoot(): Promise<string> {
    await mkdir(this.#storageRoot, { recursive: true, mode: 0o700 });
    const rootInfo = await assertRealPathWithoutLinks(this.#storageRoot, "directory");
    return rootInfo.resolvedPath;
  }

  async #purgeExpiredArtifacts(storageRoot: string): Promise<void> {
    const now = this.#now();
    let entries;
    try {
      entries = await readdir(storageRoot, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(entries.map(async (entry) => {
      const isManifest = HANDOFF_FILE_PATTERN.test(entry.name);
      const isAcknowledgement = ACKNOWLEDGEMENT_FILE_PATTERN.test(entry.name);
      const isTemporary = entry.name.startsWith(".photo-tool-handoff-")
        || entry.name.startsWith(".consuming-photo-tool-handoff-");
      if (!isManifest && !isAcknowledgement && !isTemporary) return;

      const entryPath = join(storageRoot, entry.name);
      try {
        const entryStat = await lstat(entryPath);
        if (entryStat.isSymbolicLink()) {
          await rm(entryPath, { force: true });
          return;
        }
        if (!entryStat.isFile()) return;
        if (isTemporary && now - entryStat.mtimeMs > this.#ttlMs * 2) {
          await rm(entryPath, { force: true });
          return;
        }
        if (isAcknowledgement && now - entryStat.mtimeMs > this.#ttlMs * 2) {
          await rm(entryPath, { force: true });
          return;
        }
        if (!isManifest || entryStat.size > MAX_HANDOFF_BYTES) return;
        const parsed = JSON.parse(await readFile(entryPath, "utf8")) as unknown;
        if (isRecord(parsed) && typeof parsed.expiresAt === "string") {
          const expiresAt = Date.parse(parsed.expiresAt);
          if (Number.isFinite(expiresAt) && expiresAt < now) {
            await rm(entryPath, { force: true });
          }
        }
      } catch {
        // La pulizia è best effort: la validazione completa avverrà al consumo.
      }
    }));
  }

  async #writeAcknowledgement(
    storageRoot: string,
    manifest: StoredPhotoToolHandoff,
  ): Promise<void> {
    const consumedAt = new Date(this.#now()).toISOString();
    const acknowledgement: StoredPhotoToolHandoffAcknowledgement = {
      schemaVersion: 1,
      handoffId: manifest.handoffId,
      targetToolId: manifest.targetToolId,
      consumedAt,
      proof: acknowledgementProof(manifest, consumedAt),
    };
    const serialized = JSON.stringify(acknowledgement);
    const publishedPath = acknowledgementPath(storageRoot, manifest.handoffId);
    const temporaryPath = join(
      storageRoot,
      `.photo-tool-handoff-ack-${manifest.handoffId}-${randomUUID()}.tmp`,
    );
    let handle;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      // Il link pubblica la ricevuta in modo atomico e fallisce se esiste già:
      // una ricevuta precedente non può essere sovrascritta.
      await link(temporaryPath, publishedPath);
    } finally {
      await handle?.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  async #readValidAcknowledgement(
    storageRoot: string,
    manifest: StoredPhotoToolHandoff,
  ): Promise<boolean> {
    const publishedPath = acknowledgementPath(storageRoot, manifest.handoffId);
    let acknowledgementStat;
    let canonicalPath: string;
    try {
      acknowledgementStat = await lstat(publishedPath);
      canonicalPath = await realpath(publishedPath);
    } catch (error) {
      if (isNodeErrorWithCode(error, "ENOENT")) return false;
      return false;
    }
    if (
      acknowledgementStat.isSymbolicLink()
      || !acknowledgementStat.isFile()
      || !pathsMatch(publishedPath, canonicalPath)
      || acknowledgementStat.size <= 0
      || acknowledgementStat.size > MAX_ACKNOWLEDGEMENT_BYTES
    ) {
      await rm(publishedPath, { force: true }).catch(() => undefined);
      return false;
    }

    try {
      const acknowledgement = parseAcknowledgement(
        JSON.parse(await readFile(publishedPath, "utf8")) as unknown,
      );
      const consumedAt = Date.parse(acknowledgement.consumedAt);
      const createdAt = Date.parse(manifest.createdAt);
      const expiresAt = Date.parse(manifest.expiresAt);
      const expectedProof = acknowledgementProof(manifest, acknowledgement.consumedAt);
      return acknowledgement.handoffId === manifest.handoffId
        && acknowledgement.targetToolId === manifest.targetToolId
        && Number.isFinite(consumedAt)
        && consumedAt >= createdAt - CLOCK_SKEW_TOLERANCE_MS
        && consumedAt <= expiresAt + CLOCK_SKEW_TOLERANCE_MS
        && securelyMatchesHex(acknowledgement.proof, expectedProof);
    } catch {
      return false;
    }
  }

  async #waitForAcknowledgement(
    storageRoot: string,
    manifest: StoredPhotoToolHandoff,
  ): Promise<boolean> {
    const deadline = this.#now() + this.#acknowledgementTimeoutMs;
    while (true) {
      if (await this.#readValidAcknowledgement(storageRoot, manifest)) {
        return true;
      }
      const remainingMs = deadline - this.#now();
      if (remainingMs <= 0) {
        return false;
      }
      await this.#wait(Math.min(this.#acknowledgementPollIntervalMs, remainingMs));
    }
  }

  async sendPhotoSelectionToTool(
    request: DesktopPhotoToolHandoffRequest,
  ): Promise<DesktopPhotoToolHandoffSendResult> {
    if (!isRecord(request) || !hasOnlyKeys(request, ["targetToolId", "sourceRoot", "absolutePaths"])) {
      throw new Error("Richiesta di passaggio foto non valida.");
    }
    if (!isTargetToolId(request.targetToolId)) {
      throw new Error("Il tool di destinazione non supporta il passaggio foto.");
    }
    if (!this.#launchTool) {
      throw new Error("L'avvio del tool di destinazione non è disponibile.");
    }

    const selection = await validateSelection(
      request.targetToolId,
      request.sourceRoot,
      request.absolutePaths,
    );
    const storageRoot = await this.#ensureStorageRoot();
    await this.#purgeExpiredArtifacts(storageRoot);

    const now = this.#now();
    const handoffId = randomUUID();
    const manifest: StoredPhotoToolHandoff = {
      schemaVersion: 2,
      handoffId,
      sourceToolId: this.#currentToolId,
      targetToolId: request.targetToolId,
      sourceRoot: selection.sourceRoot,
      files: selection.files,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.#ttlMs).toISOString(),
      acknowledgementSecret: randomBytes(32).toString("hex"),
    };
    const serialized = JSON.stringify(manifest);
    if (Buffer.byteLength(serialized, "utf8") > MAX_HANDOFF_BYTES) {
      throw new Error("La selezione è troppo grande per essere passata in sicurezza.");
    }

    const handoffPath = join(storageRoot, `photo-tool-handoff-${handoffId}.json`);
    const receiptPath = acknowledgementPath(storageRoot, handoffId);
    const temporaryPath = join(storageRoot, `.photo-tool-handoff-${handoffId}-${process.pid}.tmp`);
    let handle;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, handoffPath);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }

    let launchResult: { ok: boolean; message: string };
    try {
      launchResult = await this.#launchTool(request.targetToolId, ["--open-project", handoffPath]);
    } catch (error) {
      launchResult = {
        ok: false,
        message: error instanceof Error ? error.message : "Impossibile avviare il tool di destinazione.",
      };
    }

    if (!launchResult.ok) {
      await rm(handoffPath, { force: true }).catch(() => undefined);
      await rm(receiptPath, { force: true }).catch(() => undefined);
      return {
        ok: false,
        message: launchResult.message || "Impossibile avviare il tool di destinazione.",
        fileCount: manifest.files.length,
        targetToolId: manifest.targetToolId,
      };
    }

    const acknowledgementReceived = await this.#waitForAcknowledgement(storageRoot, manifest);
    await rm(receiptPath, { force: true }).catch(() => undefined);
    if (!acknowledgementReceived) {
      await rm(handoffPath, { force: true }).catch(() => undefined);
      return {
        ok: false,
        message: "Il tool è stato avviato, ma non ha confermato la ricezione delle foto entro il tempo previsto. Il passaggio non è stato completato.",
        fileCount: manifest.files.length,
        targetToolId: manifest.targetToolId,
      };
    }

    return {
      ok: true,
      message: `${manifest.files.length} foto inviate a ${manifest.targetToolId}.`,
      fileCount: manifest.files.length,
      targetToolId: manifest.targetToolId,
      handoffPath,
    };
  }

  async consumePhotoSelectionHandoff(projectPathValue: string): Promise<DesktopPhotoToolHandoff | null> {
    if (!isTargetToolId(this.#currentToolId)) {
      throw new Error("Questo tool non può ricevere una selezione foto.");
    }
    const requestedPath = assertUsableAbsolutePath(projectPathValue, "Il file handoff");
    const storageRoot = await this.#ensureStorageRoot();
    await this.#purgeExpiredArtifacts(storageRoot);
    if (!pathsMatch(dirname(requestedPath), storageRoot)) {
      throw new Error("Il file handoff è esterno all'area condivisa FileX.");
    }
    const match = HANDOFF_FILE_PATTERN.exec(basename(requestedPath));
    if (!match) {
      throw new Error("Il percorso non identifica un handoff FileX valido.");
    }

    try {
      const requestedStat = await lstat(requestedPath);
      const requestedRealPath = await realpath(requestedPath);
      if (requestedStat.isSymbolicLink() || !requestedStat.isFile() || !pathsMatch(requestedPath, requestedRealPath)) {
        throw new Error("Il file handoff non è un file regolare sicuro.");
      }
    } catch (error) {
      if (isNodeErrorWithCode(error, "ENOENT")) return null;
      throw error;
    }

    const claimedPath = join(
      storageRoot,
      `.consuming-photo-tool-handoff-${match[1]}-${randomUUID()}.json`,
    );
    try {
      await rename(requestedPath, claimedPath);
    } catch (error) {
      if (isNodeErrorWithCode(error, "ENOENT")) return null;
      throw error;
    }

    try {
      const claimedStat = await lstat(claimedPath);
      const claimedRealPath = await realpath(claimedPath);
      if (
        claimedStat.isSymbolicLink()
        || !claimedStat.isFile()
        || !pathsMatch(claimedPath, claimedRealPath)
        || claimedStat.size <= 0
        || claimedStat.size > MAX_HANDOFF_BYTES
      ) {
        throw new Error("Il file handoff non è un manifest regolare valido.");
      }

      let parsedValue: unknown;
      try {
        parsedValue = JSON.parse(await readFile(claimedPath, "utf8")) as unknown;
      } catch {
        throw new Error("Il manifest del passaggio foto non è leggibile.");
      }
      const manifest = parseManifest(parsedValue);
      if (manifest.handoffId.toLocaleLowerCase("en-US") !== match[1].toLocaleLowerCase("en-US")) {
        throw new Error("L'identità del manifest non corrisponde al file handoff.");
      }
      if (manifest.targetToolId !== this.#currentToolId) {
        throw new Error("Il passaggio foto è destinato a un altro tool FileX.");
      }

      const createdAt = Date.parse(manifest.createdAt);
      const expiresAt = Date.parse(manifest.expiresAt);
      const now = this.#now();
      if (
        !Number.isFinite(createdAt)
        || !Number.isFinite(expiresAt)
        || expiresAt <= createdAt
        || expiresAt - createdAt > this.#ttlMs
        || createdAt > now + CLOCK_SKEW_TOLERANCE_MS
      ) {
        throw new Error("La validità temporale del passaggio foto non è corretta.");
      }
      if (expiresAt < now) {
        return null;
      }

      const validated = await validateSelection(
        manifest.targetToolId,
        manifest.sourceRoot,
        manifest.files.map((file) => file.absolutePath),
      );
      if (!manifestsReferenceSameFiles(manifest, validated)) {
        throw new Error("Una o più foto sono cambiate dopo la creazione del passaggio.");
      }

      await this.#writeAcknowledgement(storageRoot, manifest);
      return toPublicManifest(manifest);
    } finally {
      await rm(claimedPath, { force: true }).catch(() => undefined);
    }
  }
}
