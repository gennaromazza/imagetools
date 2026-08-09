import { execFile } from "node:child_process";
import {
  lstat,
  readdir,
  realpath,
  rmdir,
  stat,
  unlink,
} from "node:fs/promises";
import { basename, isAbsolute, join, normalize, parse, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type {
  AdobeInstallation,
  AdobeProcess,
  CacheCategory,
  CacheRisk,
  CacheSweepScanResult,
  CacheTargetSummary,
  CleanupCategoryResult,
  CleanupResult,
  OlderAdobeVersion,
  ProcessCloseResult,
  UninstallOldVersionResult,
} from "../src/contracts.js";

const execFileAsync = promisify(execFile);

type RegistrySource = AdobeInstallation["source"];

interface ProductDefinition {
  id: string;
  displayPattern: RegExp;
  processNames: string[];
  ruleIds: string[];
  sapCode?: string;
  baseVersionParts?: 2 | 3;
}

interface CacheRuleDefinition {
  ruleId: string;
  title: string;
  productIds: string[];
  risk: CacheRisk;
  selectedByDefault: boolean;
  whatIsDeleted: string;
  consequence: string;
  warning: string | null;
  processNames: string[];
  resolveTargets(): Promise<ResolvedTarget[]>;
}

interface ResolvedTarget {
  path: string;
  source: CacheTargetSummary["source"];
}

interface RegistryRecord {
  DisplayName?: string;
  DisplayVersion?: string;
  InstallLocation?: string;
  DisplayIcon?: string;
  Publisher?: string;
}

interface DeleteStats {
  deletedFiles: number;
  deletedBytes: number;
  skippedItems: number;
  errors: string[];
}

const PRODUCT_DEFINITIONS: ProductDefinition[] = [
  {
    id: "premiere-pro",
    displayPattern: /Adobe Premiere(?: Pro)?/i,
    processNames: ["Adobe Premiere Pro.exe"],
    ruleIds: ["adobe-media-cache"],
    sapCode: "PPRO",
  },
  {
    id: "media-encoder",
    displayPattern: /Adobe Media Encoder/i,
    processNames: ["Adobe Media Encoder.exe"],
    ruleIds: ["adobe-media-cache"],
    sapCode: "AME",
  },
  {
    id: "after-effects",
    displayPattern: /Adobe After Effects/i,
    processNames: ["AfterFX.exe", "aerender.exe"],
    ruleIds: ["adobe-media-cache"],
    sapCode: "AEFT",
  },
  {
    id: "lightroom-classic",
    displayPattern: /Adobe Lightroom Classic/i,
    processNames: ["Lightroom.exe"],
    ruleIds: ["camera-raw-cache", "lightroom-previews"],
    sapCode: "LTRM",
  },
  {
    id: "bridge",
    displayPattern: /Adobe Bridge/i,
    processNames: ["Bridge.exe"],
    ruleIds: ["camera-raw-cache", "bridge-cache"],
    sapCode: "KBRG",
    baseVersionParts: 3,
  },
  {
    id: "photoshop",
    displayPattern: /Adobe Photoshop/i,
    processNames: ["Photoshop.exe"],
    ruleIds: ["camera-raw-cache"],
    sapCode: "PHSP",
  },
  {
    id: "indesign",
    displayPattern: /Adobe InDesign(?! Server)/i,
    processNames: ["InDesign.exe"],
    ruleIds: ["indesign-cache"],
    sapCode: "IDSN",
  },
  {
    id: "illustrator",
    displayPattern: /Adobe Illustrator/i,
    processNames: ["Illustrator.exe"],
    ruleIds: [],
    sapCode: "ILST",
  },
  {
    id: "acrobat",
    displayPattern: /Adobe Acrobat(?! Update)/i,
    processNames: ["Acrobat.exe", "AcroRd32.exe"],
    ruleIds: [],
  },
  {
    id: "creative-cloud",
    displayPattern: /Adobe Creative Cloud/i,
    processNames: ["Creative Cloud.exe"],
    ruleIds: [],
  },
];

const PROCESS_DISPLAY_NAMES = new Map<string, string>([
  ["adobe premiere pro.exe", "Adobe Premiere Pro"],
  ["adobe media encoder.exe", "Adobe Media Encoder"],
  ["afterfx.exe", "Adobe After Effects"],
  ["aerender.exe", "After Effects Render Engine"],
  ["lightroom.exe", "Adobe Lightroom Classic"],
  ["bridge.exe", "Adobe Bridge"],
  ["photoshop.exe", "Adobe Photoshop"],
  ["indesign.exe", "Adobe InDesign"],
  ["illustrator.exe", "Adobe Illustrator"],
  ["acrobat.exe", "Adobe Acrobat"],
  ["acrord32.exe", "Adobe Acrobat Reader"],
  ["creative cloud.exe", "Adobe Creative Cloud"],
]);

function envPath(name: "APPDATA" | "LOCALAPPDATA" | "USERPROFILE"): string | null {
  const value = process.env[name]?.trim();
  return value && isAbsolute(value) ? resolve(value) : null;
}

function existingProductIds(installations: AdobeInstallation[]): Set<string> {
  return new Set(installations.map((installation) => installation.productId));
}

function defaultCacheRules(): CacheRuleDefinition[] {
  const appData = envPath("APPDATA");
  const localAppData = envPath("LOCALAPPDATA");
  const userProfile = envPath("USERPROFILE");
  const mediaProcesses = ["Adobe Premiere Pro.exe", "Adobe Media Encoder.exe", "AfterFX.exe", "aerender.exe"];

  return [
    {
      ruleId: "adobe-media-cache",
      title: "Media Cache Adobe video",
      productIds: ["premiere-pro", "media-encoder", "after-effects"],
      risk: "recommended",
      selectedByDefault: true,
      whatIsDeleted: "Audio conformato, forme d'onda, indici e file multimediali temporanei condivisi.",
      consequence: "Premiere, After Effects e Media Encoder ricreeranno i file necessari. La prima apertura dei progetti potrà essere più lenta.",
      warning: null,
      processNames: mediaProcesses,
      resolveTargets: async () => appData ? [
        { path: join(appData, "Adobe", "Common", "Media Cache"), source: "documented-default" },
        { path: join(appData, "Adobe", "Common", "Media Cache Files"), source: "documented-default" },
      ] : [],
    },
    {
      ruleId: "camera-raw-cache",
      title: "Camera Raw Cache",
      productIds: ["lightroom-classic", "bridge", "photoshop"],
      risk: "recommended",
      selectedByDefault: true,
      whatIsDeleted: "Dati temporanei usati da Camera Raw per accelerare l'apertura e lo sviluppo dei file RAW.",
      consequence: "Fotografie, cataloghi e regolazioni restano invariati. Le prime aperture RAW saranno più lente durante la ricostruzione.",
      warning: null,
      processNames: ["Lightroom.exe", "Bridge.exe", "Photoshop.exe"],
      resolveTargets: async () => localAppData ? [
        { path: join(localAppData, "Adobe", "CameraRaw", "Cache"), source: "documented-default" },
      ] : [],
    },
    {
      ruleId: "bridge-cache",
      title: "Cache locale Bridge",
      productIds: ["bridge"],
      risk: "attention",
      selectedByDefault: false,
      whatIsDeleted: "Miniature, anteprime e informazioni indicizzate nella cache locale di Bridge.",
      consequence: "Bridge ricostruirà miniature e anteprime durante la navigazione successiva.",
      warning: "Per file di sola lettura o formati senza XMP, etichette, valutazioni o rotazioni conservate soltanto nella cache potrebbero andare perse.",
      processNames: ["Bridge.exe"],
      resolveTargets: async () => appData
        ? findNamedCacheDirectories(join(appData, "Adobe"), /^Bridge/i, 2)
        : [],
    },
    {
      ruleId: "lightroom-previews",
      title: "Anteprime Lightroom",
      productIds: ["lightroom-classic"],
      risk: "advanced",
      selectedByDefault: false,
      whatIsDeleted: "Il contenuto dei pacchetti Previews.lrdata nei cataloghi trovati nella cartella Lightroom predefinita.",
      consequence: "Le fotografie e le modifiche restano intatte. Lightroom dovrà ricostruire le anteprime; quelle di originali offline non saranno subito disponibili.",
      warning: "Opzione avanzata: verifica che i dischi contenenti gli originali siano disponibili prima di usarla.",
      processNames: ["Lightroom.exe"],
      resolveTargets: async () => userProfile
        ? findLightroomPreviewDirectories(join(userProfile, "Pictures", "Lightroom"))
        : [],
    },
    {
      ruleId: "indesign-cache",
      title: "Cache locale InDesign",
      productIds: ["indesign"],
      risk: "attention",
      selectedByDefault: false,
      whatIsDeleted: "Soltanto sottocartelle denominate Cache all'interno dei dati locali versionati di InDesign.",
      consequence: "InDesign ricostruirà i dati temporanei. Preferenze, workspaces, script e cartelle Recovery sono esclusi.",
      warning: "FileX non cancella mai l'intera cartella InDesign e non entra nelle cartelle Recovery.",
      processNames: ["InDesign.exe"],
      resolveTargets: async () => localAppData
        ? findExactDirectories(join(localAppData, "Adobe", "InDesign"), "Cache", 4, ["Recovery"])
        : [],
    },
  ];
}

function findProduct(displayName: string): ProductDefinition | null {
  return PRODUCT_DEFINITIONS.find((definition) => definition.displayPattern.test(displayName)) ?? null;
}

function parseRegistryOutput(output: string): RegistryRecord[] {
  const records: RegistryRecord[] = [];
  let current: RegistryRecord | null = null;

  for (const line of output.split(/\r?\n/)) {
    if (/^HKEY_/i.test(line.trim())) {
      if (current) records.push(current);
      current = {};
      continue;
    }
    const match = line.match(/^\s+([^\s]+)\s+REG_[^\s]+\s+(.*)$/i);
    if (!current || !match) continue;
    const [, name, value] = match;
    if (["DisplayName", "DisplayVersion", "InstallLocation", "DisplayIcon", "Publisher"].includes(name)) {
      current[name as keyof RegistryRecord] = value.trim();
    }
  }
  if (current) records.push(current);
  return records;
}

async function queryRegistry(source: Exclude<RegistrySource, "running-process">): Promise<AdobeInstallation[]> {
  const isCurrentUser = source === "hkcu";
  const hive = isCurrentUser
    ? "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall"
    : "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall";
  const args = ["query", hive, "/s"];
  if (!isCurrentUser) args.push(source === "hklm-64" ? "/reg:64" : "/reg:32");

  try {
    const { stdout } = await execFileAsync("reg.exe", args, {
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    const installations: AdobeInstallation[] = [];
    for (const record of parseRegistryOutput(stdout)) {
      if (!record.DisplayName || !(/Adobe/i.test(record.Publisher ?? "") || /^Adobe\b/i.test(record.DisplayName))) continue;
      const product = findProduct(record.DisplayName);
      if (!product) continue;
      const executablePath = record.DisplayIcon
        ? record.DisplayIcon.split(",")[0].trim().replace(/^"|"$/g, "") || null
        : null;
      installations.push({
          productId: product.id,
          displayName: record.DisplayName,
          version: record.DisplayVersion || null,
          executablePath,
          installLocation: record.InstallLocation || null,
          source,
          confidence: executablePath || record.InstallLocation ? "verified" : "probable",
          supportedRuleIds: product.ruleIds,
      });
    }
    return installations;
  } catch {
    return [];
  }
}

export async function discoverAdobeInstallations(): Promise<AdobeInstallation[]> {
  if (process.platform !== "win32") return [];
  const results = (await Promise.all([
    queryRegistry("hkcu"),
    queryRegistry("hklm-64"),
    queryRegistry("hklm-32"),
  ])).flat();
  const deduplicated = new Map<string, AdobeInstallation>();
  for (const installation of results) {
    const key = [
      installation.productId,
      installation.version ?? "",
      (installation.installLocation ?? installation.executablePath ?? "").toLowerCase(),
    ].join("|");
    const existing = deduplicated.get(key);
    if (!existing || existing.confidence === "probable" && installation.confidence === "verified") {
      deduplicated.set(key, installation);
    }
  }
  return [...deduplicated.values()].sort((left, right) => left.displayName.localeCompare(right.displayName, "it"));
}

function numericVersion(value: string | null): number[] | null {
  if (!value) return null;
  const match = value.trim().match(/^\d+(?:\.\d+)*/)?.[0];
  if (!match) return null;
  const parts = match.split(".").map(Number);
  return parts.every(Number.isFinite) ? parts : null;
}

function compareVersions(left: string, right: string): number {
  const leftParts = numericVersion(left) ?? [];
  const rightParts = numericVersion(right) ?? [];
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function uninstallBaseVersion(version: string, parts: 2 | 3): string | null {
  const parsed = numericVersion(version);
  if (!parsed?.length) return null;
  return parts === 3 ? `${parsed[0]}.0.0` : `${parsed[0]}.0`;
}

function candidateId(installation: AdobeInstallation): string {
  return Buffer.from(JSON.stringify([
    installation.productId,
    installation.version,
    installation.installLocation,
    installation.source,
  ])).toString("base64url");
}

export function buildOlderVersionCandidates(installations: AdobeInstallation[]): OlderAdobeVersion[] {
  const grouped = new Map<string, AdobeInstallation[]>();
  for (const installation of installations) {
    const product = PRODUCT_DEFINITIONS.find((item) => item.id === installation.productId);
    if (!product?.sapCode || !numericVersion(installation.version)) continue;
    const group = grouped.get(installation.productId) ?? [];
    group.push(installation);
    grouped.set(installation.productId, group);
  }

  const candidates: OlderAdobeVersion[] = [];
  for (const [productId, group] of grouped) {
    const versions = [...new Set(group.flatMap((item) => item.version ? [item.version] : []))];
    const majors = [...new Set(versions.map((version) => numericVersion(version)![0]))].sort((left, right) => right - left);
    if (majors.length < 2) continue;
    const currentMajor = majors[0];
    const currentVersion = versions
      .filter((version) => numericVersion(version)?.[0] === currentMajor)
      .sort((left, right) => compareVersions(right, left))[0];
    const product = PRODUCT_DEFINITIONS.find((item) => item.id === productId)!;
    const seenBaseVersions = new Set<string>();
    for (const installation of group) {
      if (!installation.version || numericVersion(installation.version)?.[0] === currentMajor) continue;
      const baseVersion = uninstallBaseVersion(installation.version, product.baseVersionParts ?? 2);
      if (!baseVersion || seenBaseVersions.has(baseVersion)) continue;
      seenBaseVersions.add(baseVersion);
      candidates.push({
        candidateId: candidateId(installation),
        productId,
        displayName: installation.displayName,
        version: installation.version,
        currentVersion,
        sapCode: product.sapCode!,
        baseVersion,
        installLocation: installation.installLocation,
        processNames: product.processNames,
      });
    }
  }
  return candidates.sort((left, right) => left.displayName.localeCompare(right.displayName, "it"));
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  const pattern = /"((?:[^"]|"")*)"(?:,|$)/g;
  for (const match of line.matchAll(pattern)) values.push(match[1].replace(/""/g, '"'));
  return values;
}

export async function discoverAdobeProcesses(): Promise<AdobeProcess[]> {
  if (process.platform !== "win32") return [];
  try {
    const { stdout } = await execFileAsync("tasklist.exe", ["/FO", "CSV", "/NH"], {
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    const knownProcessNames = new Set(PRODUCT_DEFINITIONS.flatMap((product) => product.processNames).map((name) => name.toLowerCase()));
    return stdout.split(/\r?\n/).flatMap((line) => {
      const values = parseCsvLine(line);
      const executableName = values[0]?.trim();
      const pid = Number(values[1]);
      if (!executableName || !Number.isInteger(pid) || !knownProcessNames.has(executableName.toLowerCase())) return [];
      const involvedRuleIds = PRODUCT_DEFINITIONS
        .filter((product) => product.processNames.some((name) => name.toLowerCase() === executableName.toLowerCase()))
        .flatMap((product) => product.ruleIds);
      return [{
        pid,
        executableName,
        displayName: PROCESS_DISPLAY_NAMES.get(executableName.toLowerCase()) ?? executableName,
        involvedRuleIds: [...new Set(involvedRuleIds)],
      }];
    });
  } catch {
    return [];
  }
}

async function pathExistsAsDirectory(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    return info.isDirectory() && !info.isSymbolicLink();
  } catch {
    return false;
  }
}

async function findNamedCacheDirectories(root: string, parentPattern: RegExp, depth: number): Promise<ResolvedTarget[]> {
  if (!await pathExistsAsDirectory(root)) return [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const targets: ResolvedTarget[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !parentPattern.test(entry.name)) continue;
    const parent = join(root, entry.name);
    const found = await findExactDirectories(parent, "Cache", depth, ["Recovery"]);
    targets.push(...found);
  }
  return targets;
}

async function findExactDirectories(
  root: string,
  expectedName: string,
  maxDepth: number,
  excludedNames: string[],
): Promise<ResolvedTarget[]> {
  if (!await pathExistsAsDirectory(root)) return [];
  const results: ResolvedTarget[] = [];
  const visit = async (current: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || excludedNames.some((name) => name.toLowerCase() === entry.name.toLowerCase())) continue;
      const next = join(current, entry.name);
      if (entry.name.toLowerCase() === expectedName.toLowerCase()) {
        results.push({ path: next, source: "documented-default" });
        continue;
      }
      await visit(next, depth + 1);
    }
  };
  await visit(root, 0);
  return results;
}

async function findLightroomPreviewDirectories(root: string): Promise<ResolvedTarget[]> {
  if (!await pathExistsAsDirectory(root)) return [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && /Previews\.lrdata$/i.test(entry.name))
    .map((entry) => ({ path: join(root, entry.name), source: "discovered-catalog" as const }));
}

export function isPathWithin(parent: string, candidate: string): boolean {
  const parentPath = normalize(resolve(parent));
  const candidatePath = normalize(resolve(candidate));
  const child = relative(parentPath, candidatePath);
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

export function validateCacheTargetPath(targetPath: string, allowedRoots: string[]): boolean {
  if (!isAbsolute(targetPath)) return false;
  const normalizedTarget = normalize(resolve(targetPath));
  if (normalizedTarget === parse(normalizedTarget).root) return false;
  const name = basename(normalizedTarget);
  const allowedName = ["Media Cache", "Media Cache Files", "Cache"].some((allowed) => allowed.toLowerCase() === name.toLowerCase())
    || /Previews\.lrdata$/i.test(name);
  if (!allowedName) return false;
  return allowedRoots.some((root) => isPathWithin(root, normalizedTarget));
}

function allowedCacheRoots(): string[] {
  return [
    envPath("APPDATA"),
    envPath("LOCALAPPDATA"),
    envPath("USERPROFILE") ? join(envPath("USERPROFILE")!, "Pictures", "Lightroom") : null,
  ].filter((value): value is string => Boolean(value));
}

async function scanTarget(target: ResolvedTarget): Promise<CacheTargetSummary | null> {
  const allowedRoots = allowedCacheRoots();
  if (!validateCacheTargetPath(target.path, allowedRoots) || !await pathExistsAsDirectory(target.path)) return null;

  let fileCount = 0;
  let totalBytes = 0;
  let skippedLinks = 0;
  const scanErrors: string[] = [];
  const canonicalRoot = await realpath(target.path).catch(() => null);
  if (!canonicalRoot) return null;

  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
      scanErrors.push(`${directory}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    });
    for (const entry of entries) {
      const itemPath = join(directory, entry.name);
      try {
        const itemInfo = await lstat(itemPath);
        if (itemInfo.isSymbolicLink()) {
          skippedLinks += 1;
          continue;
        }
        const canonicalItem = await realpath(itemPath);
        if (canonicalItem !== canonicalRoot && !isPathWithin(canonicalRoot, canonicalItem)) {
          skippedLinks += 1;
          continue;
        }
        if (itemInfo.isDirectory()) await visit(itemPath);
        else if (itemInfo.isFile()) {
          fileCount += 1;
          totalBytes += itemInfo.size;
        }
      } catch (error) {
        scanErrors.push(`${itemPath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  await visit(target.path);
  return { path: target.path, source: target.source, fileCount, totalBytes, skippedLinks, scanErrors };
}

async function buildCategories(installations: AdobeInstallation[]): Promise<CacheCategory[]> {
  const productIds = existingProductIds(installations);
  const categories: CacheCategory[] = [];
  for (const rule of defaultCacheRules()) {
    const matchingProducts = rule.productIds.filter((id) => productIds.has(id));
    if (matchingProducts.length === 0) continue;
    const resolvedTargets = await rule.resolveTargets();
    const uniqueTargets = [...new Map(resolvedTargets.map((target) => [normalize(resolve(target.path)).toLowerCase(), target])).values()];
    const targets = (await Promise.all(uniqueTargets.map(scanTarget))).filter((target): target is CacheTargetSummary => target !== null);
    const applicationNames = installations
      .filter((installation) => matchingProducts.includes(installation.productId))
      .map((installation) => installation.displayName);
    categories.push({
      ruleId: rule.ruleId,
      title: rule.title,
      applications: [...new Set(applicationNames)],
      risk: rule.risk,
      selectedByDefault: rule.selectedByDefault,
      whatIsDeleted: rule.whatIsDeleted,
      consequence: rule.consequence,
      warning: rule.warning,
      processNames: rule.processNames,
      targets,
      totalBytes: targets.reduce((sum, target) => sum + target.totalBytes, 0),
      fileCount: targets.reduce((sum, target) => sum + target.fileCount, 0),
    });
  }
  return categories;
}

export async function scanCacheSweep(): Promise<CacheSweepScanResult> {
  if (process.platform !== "win32") {
    return {
      platformSupported: false,
      scannedAt: new Date().toISOString(),
      installations: [],
      runningProcesses: [],
      categories: [],
      olderVersions: [],
      warnings: ["Questa versione di FileX Adobe Cleaner supporta soltanto Windows."],
    };
  }
  const [installations, runningProcesses] = await Promise.all([
    discoverAdobeInstallations(),
    discoverAdobeProcesses(),
  ]);
  const categories = await buildCategories(installations);
  const olderVersions = buildOlderVersionCandidates(installations);
  const warnings: string[] = [];
  if (installations.length === 0) warnings.push("Non sono state rilevate applicazioni Adobe nel registro Windows.");
  return {
    platformSupported: true,
    scannedAt: new Date().toISOString(),
    installations,
    runningProcesses,
    categories,
    olderVersions,
    warnings,
  };
}

function processesForRules(processes: AdobeProcess[], ruleIds: string[]): AdobeProcess[] {
  const selected = new Set(ruleIds);
  return processes.filter((process) => process.involvedRuleIds.some((ruleId) => selected.has(ruleId)));
}

export async function closeAdobeProcesses(ruleIds: string[], force: boolean): Promise<ProcessCloseResult> {
  const before = processesForRules(await discoverAdobeProcesses(), ruleIds);
  const errors: string[] = [];
  for (const processInfo of before) {
    const args = force
      ? ["/F", "/PID", String(processInfo.pid), "/T"]
      : ["/PID", String(processInfo.pid), "/T"];
    try {
      await execFileAsync("taskkill.exe", args, { windowsHide: true, encoding: "utf8" });
    } catch (error) {
      errors.push(`${processInfo.displayName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, force ? 800 : 1800));
  const remaining = processesForRules(await discoverAdobeProcesses(), ruleIds);
  const remainingPids = new Set(remaining.map((processInfo) => processInfo.pid));
  return {
    requested: before,
    closed: before.filter((processInfo) => !remainingPids.has(processInfo.pid)),
    remaining,
    errors,
  };
}

function processesForProduct(processes: AdobeProcess[], productId: string): AdobeProcess[] {
  const product = PRODUCT_DEFINITIONS.find((item) => item.id === productId);
  if (!product) return [];
  const executableNames = new Set(product.processNames.map((name) => name.toLowerCase()));
  return processes.filter((processInfo) => executableNames.has(processInfo.executableName.toLowerCase()));
}

async function adobeSetupPath(): Promise<string | null> {
  const programFilesX86 = process.env["ProgramFiles(x86)"]?.trim() || "C:\\Program Files (x86)";
  if (!isAbsolute(programFilesX86)) return null;
  const adobeRoot = join(programFilesX86, "Common Files", "Adobe");
  const setup = join(adobeRoot, "Adobe Desktop Common", "HDBox", "Setup.exe");
  try {
    const [rootCanonical, setupCanonical, setupInfo] = await Promise.all([
      realpath(adobeRoot),
      realpath(setup),
      stat(setup),
    ]);
    if (!setupInfo.isFile() || basename(setupCanonical).toLowerCase() !== "setup.exe") return null;
    return isPathWithin(rootCanonical, setupCanonical) ? setupCanonical : null;
  } catch {
    return null;
  }
}

export async function uninstallOldAdobeVersion(candidateIdValue: string): Promise<UninstallOldVersionResult> {
  if (process.platform !== "win32" || typeof candidateIdValue !== "string" || candidateIdValue.length > 1024) {
    return { status: "failed", message: "Richiesta di disinstallazione non valida.", remainingProcesses: [] };
  }

  const scan = await scanCacheSweep();
  const candidate = scan.olderVersions.find((item) => item.candidateId === candidateIdValue);
  if (!candidate) {
    return { status: "failed", message: "La versione non risulta più una candidata sicura. Esegui una nuova analisi.", remainingProcesses: [] };
  }

  const before = processesForProduct(scan.runningProcesses, candidate.productId);
  for (const processInfo of before) {
    await execFileAsync("taskkill.exe", ["/PID", String(processInfo.pid), "/T"], {
      windowsHide: true,
      encoding: "utf8",
    }).catch(() => undefined);
  }
  if (before.length > 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1800));
  const remainingProcesses = processesForProduct(await discoverAdobeProcesses(), candidate.productId);
  if (remainingProcesses.length > 0) {
    return {
      status: "blocked",
      message: "L'applicazione Adobe è ancora aperta. Salva il lavoro, chiudila manualmente e riprova.",
      remainingProcesses,
    };
  }

  const setup = await adobeSetupPath();
  if (!setup) {
    return {
      status: "failed",
      message: "Il disinstallatore ufficiale Adobe HDBox non è disponibile. Usa Creative Cloud Desktop per rimuovere questa versione.",
      remainingProcesses: [],
    };
  }
  if (!/^[A-Z0-9]{3,8}$/.test(candidate.sapCode) || !/^\d+\.\d+(?:\.\d+)?$/.test(candidate.baseVersion)) {
    return { status: "failed", message: "Identificativo Adobe non valido; operazione annullata.", remainingProcesses: [] };
  }

  const powershellScript = [
    "$arguments = @('--uninstall=1', ('--sapCode=' + $env:FILEX_ADOBE_SAP), ('--baseVersion=' + $env:FILEX_ADOBE_BASE), '--platform=win64', '--deleteUserPreferences=false')",
    "$process = Start-Process -FilePath $env:FILEX_ADOBE_SETUP -ArgumentList $arguments -Verb RunAs -Wait -PassThru",
    "exit $process.ExitCode",
  ].join("; ");
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", powershellScript], {
      windowsHide: true,
      encoding: "utf8",
      timeout: 30 * 60 * 1000,
      env: {
        ...process.env,
        FILEX_ADOBE_SETUP: setup,
        FILEX_ADOBE_SAP: candidate.sapCode,
        FILEX_ADOBE_BASE: candidate.baseVersion,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cancelled = /cancel|annull|1223/i.test(message);
    return {
      status: cancelled ? "cancelled" : "failed",
      message: cancelled ? "Disinstallazione annullata dall'utente." : `Il disinstallatore Adobe non è terminato correttamente: ${message}`,
      remainingProcesses: [],
    };
  }

  const stillPresent = (await scanCacheSweep()).olderVersions.some((item) => item.candidateId === candidateIdValue);
  return stillPresent
    ? { status: "failed", message: "Il disinstallatore è terminato, ma Windows rileva ancora la vecchia versione. Riavvia Creative Cloud e analizza di nuovo.", remainingProcesses: [] }
    : { status: "completed", message: `${candidate.displayName} ${candidate.version} è stata rimossa mantenendo preferenze e plug-in condivisi.`, remainingProcesses: [] };
}

export async function cleanCacheTarget(
  target: CacheTargetSummary,
  allowedRoots: string[] = allowedCacheRoots(),
): Promise<DeleteStats> {
  const result: DeleteStats = { deletedFiles: 0, deletedBytes: 0, skippedItems: 0, errors: [] };
  if (!validateCacheTargetPath(target.path, allowedRoots) || !await pathExistsAsDirectory(target.path)) {
    result.errors.push(`Target non più valido: ${target.path}`);
    return result;
  }
  const canonicalRoot = await realpath(target.path).catch(() => null);
  if (!canonicalRoot) {
    result.errors.push(`Impossibile risolvere il target: ${target.path}`);
    return result;
  }

  const visit = async (directory: string, removeDirectory: boolean): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
      result.errors.push(`${directory}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    });
    for (const entry of entries) {
      const itemPath = join(directory, entry.name);
      try {
        const itemInfo = await lstat(itemPath);
        if (itemInfo.isSymbolicLink()) {
          result.skippedItems += 1;
          continue;
        }
        const canonicalItem = await realpath(itemPath);
        if (canonicalItem !== canonicalRoot && !isPathWithin(canonicalRoot, canonicalItem)) {
          result.skippedItems += 1;
          continue;
        }
        if (itemInfo.isDirectory()) {
          await visit(itemPath, true);
        } else if (itemInfo.isFile()) {
          await unlink(itemPath);
          result.deletedFiles += 1;
          result.deletedBytes += itemInfo.size;
        } else {
          result.skippedItems += 1;
        }
      } catch (error) {
        result.skippedItems += 1;
        result.errors.push(`${itemPath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (removeDirectory) {
      await rmdir(directory).catch((error: unknown) => {
        result.skippedItems += 1;
        result.errors.push(`${directory}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  };
  await visit(target.path, false);
  return result;
}

export async function executeCacheCleanup(ruleIds: string[]): Promise<CleanupResult> {
  const startedAt = new Date().toISOString();
  const selectedRuleIds = [...new Set(ruleIds.filter((ruleId) => defaultCacheRules().some((rule) => rule.ruleId === ruleId)))];
  const scan = await scanCacheSweep();
  const running = processesForRules(scan.runningProcesses, selectedRuleIds);
  const categories: CleanupCategoryResult[] = [];

  for (const category of scan.categories.filter((item) => selectedRuleIds.includes(item.ruleId))) {
    if (running.some((processInfo) => processInfo.involvedRuleIds.includes(category.ruleId))) {
      categories.push({
        ruleId: category.ruleId,
        title: category.title,
        deletedFiles: 0,
        deletedBytes: 0,
        skippedItems: category.fileCount,
        errors: ["Pulizia bloccata perché un processo Adobe coinvolto è ancora aperto."],
        status: "blocked",
      });
      continue;
    }
    const targetResults = await Promise.all(category.targets.map((target) => cleanCacheTarget(target)));
    const deletedFiles = targetResults.reduce((sum, item) => sum + item.deletedFiles, 0);
    const deletedBytes = targetResults.reduce((sum, item) => sum + item.deletedBytes, 0);
    const skippedItems = targetResults.reduce((sum, item) => sum + item.skippedItems, 0);
    const errors = targetResults.flatMap((item) => item.errors);
    categories.push({
      ruleId: category.ruleId,
      title: category.title,
      deletedFiles,
      deletedBytes,
      skippedItems,
      errors,
      status: category.targets.length === 0 ? "empty" : errors.length > 0 ? "partial" : "completed",
    });
  }

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    categories,
    deletedFiles: categories.reduce((sum, item) => sum + item.deletedFiles, 0),
    deletedBytes: categories.reduce((sum, item) => sum + item.deletedBytes, 0),
    skippedItems: categories.reduce((sum, item) => sum + item.skippedItems, 0),
    errors: categories.flatMap((item) => item.errors),
  };
}
