import { createServer, type Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as electron from "electron";
import type {
  DesktopCloudProjectManifest,
  DesktopCloudProjectVersion,
  DesktopGoogleDriveStatus,
} from "@photo-tools/desktop-contracts";
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
} from "./google-drive-config.generated.js";
import { googleDriveApiDisabledMessage, googleDriveFileUrl } from "./google-drive-link.js";

const { app, safeStorage, shell } = electron;

// FileX deve poter creare e aggiornare soltanto i file che appartengono al suo
// workflow. drive.file è uno scope non sensibile e non concede accesso generale
// ai documenti presenti nel Drive personale dell'utente.
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_ROOT_FOLDER = "Image Select Pro";
const FREE_SELECTIONS_FOLDER = "Selezioni libere";
const TOKEN_FILE_NAME = "google-drive-token.bin";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const PROJECT_ID_PROPERTY = "imageSelectProProjectId";
const WORKSPACE_ID_PROPERTY = "imageSelectProWorkspaceId";
const WORKSPACE_MODE_PROPERTY = "imageSelectProWorkspaceMode";
const FOLDER_ROLE_PROPERTY = "imageSelectProFolderRole";
const FREE_SELECTIONS_ROOT_ROLE = "free-selections-root";
const LEGACY_DEFAULT_PROJECT_ID = "photo-selector-default";
const DRIVE_MANIFEST_READ_CONCURRENCY = 4;

type CloudWorkspaceMode = "project" | "free";

type CompatibleCloudProjectManifest = DesktopCloudProjectManifest & {
  kind?: CloudWorkspaceMode;
  workspaceMode?: CloudWorkspaceMode;
  selectionId?: string;
  workspaceId?: string;
  displayName?: string;
};

type CompatibleCloudProjectVersion = DesktopCloudProjectVersion & {
  kind?: CloudWorkspaceMode;
  workspaceMode?: CloudWorkspaceMode;
  selectionId?: string;
  workspaceId?: string;
  displayName?: string;
  webViewLink?: string;
  driveUrl?: string;
};

interface StoredToken {
  refreshToken: string;
  accessToken?: string;
  expiresAt?: number;
  accountEmail?: string;
  scope?: string;
}

interface DriveFile {
  id: string;
  name?: string;
  createdTime?: string;
  size?: string;
  webViewLink?: string;
  appProperties?: Record<string, string>;
}

interface DriveListResponse {
  files?: DriveFile[];
  nextPageToken?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => run()),
  );
  return results;
}

function optionalNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readWorkspaceMode(value: unknown, fieldName: string): CloudWorkspaceMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "project" || value === "free") {
    return value;
  }
  throw new Error(`Manifest Google Drive non valido: ${fieldName} non riconosciuto.`);
}

function getWorkspaceMode(manifest: Record<string, unknown>): CloudWorkspaceMode {
  const kind = readWorkspaceMode(manifest.kind, "kind");
  const workspaceMode = readWorkspaceMode(manifest.workspaceMode, "workspaceMode");
  if (kind && workspaceMode && kind !== workspaceMode) {
    throw new Error("Manifest Google Drive non valido: modalità di lavoro in conflitto.");
  }
  return kind ?? workspaceMode ?? "project";
}

function getFreeWorkspaceId(manifest: Record<string, unknown>): string {
  const selectionId = optionalNonEmptyString(manifest.selectionId);
  const workspaceId = optionalNonEmptyString(manifest.workspaceId);
  if (selectionId && workspaceId && selectionId !== workspaceId) {
    throw new Error("Manifest Google Drive non valido: identità della selezione in conflitto.");
  }
  const id = selectionId ?? workspaceId;
  if (!id) {
    throw new Error("La selezione libera non ha un'identità valida per il backup Google Drive.");
  }
  return id;
}

function getFreeWorkspaceDisplayName(manifest: Record<string, unknown>): string {
  return optionalNonEmptyString(manifest.displayName)
    ?? optionalNonEmptyString(manifest.projectName)
    ?? optionalNonEmptyString(manifest.sourceFolderName)
    ?? "Selezione libera";
}

function isUnsafeCloudRelativePath(value: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  return /^[a-z]:\//i.test(normalized)
    || normalized.startsWith("/")
    || normalized.split("/").includes("..");
}

function isUnsafeCloudSourceFileKey(value: string): boolean {
  // Le chiavi libere hanno forma sourceId::percorso-relativo::size::mtime.
  // Controlliamo ogni segmento: validare solo il primo nasconderebbe un
  // percorso assoluto nel segmento che identifica davvero la foto.
  return value.split("::").some((segment) => isUnsafeCloudRelativePath(segment));
}

function validateCloudPhotoState(value: unknown, index: number): void {
  if (!isRecord(value)) {
    throw new Error(`Manifest Google Drive non valido: foto ${index + 1} non valida.`);
  }
  if (typeof value.relativePath !== "string" || typeof value.fileName !== "string") {
    throw new Error(`Manifest Google Drive non valido: percorso foto ${index + 1} mancante.`);
  }
  if (typeof value.rating !== "number" || !Number.isFinite(value.rating)) {
    throw new Error(`Manifest Google Drive non valido: valutazione foto ${index + 1} non valida.`);
  }
  if (!(["picked", "rejected", "unmarked"] as unknown[]).includes(value.pickStatus)) {
    throw new Error(`Manifest Google Drive non valido: stato foto ${index + 1} non valido.`);
  }
  if (
    value.colorLabel !== null
    && value.colorLabel !== undefined
    && !(["red", "yellow", "green", "blue", "purple"] as unknown[]).includes(value.colorLabel)
  ) {
    throw new Error(`Manifest Google Drive non valido: etichetta colore foto ${index + 1} non valida.`);
  }
  if (value.customLabels !== undefined && (
    !Array.isArray(value.customLabels)
    || value.customLabels.some((label) => typeof label !== "string")
  )) {
    throw new Error(`Manifest Google Drive non valido: etichette foto ${index + 1} non valide.`);
  }
  if (value.size !== undefined && (typeof value.size !== "number" || !Number.isFinite(value.size) || value.size < 0)) {
    throw new Error(`Manifest Google Drive non valido: dimensione foto ${index + 1} non valida.`);
  }
  if (value.sourceFileKey !== undefined && typeof value.sourceFileKey !== "string") {
    throw new Error(`Manifest Google Drive non valido: chiave sorgente foto ${index + 1} non valida.`);
  }
  if (value.active !== undefined && typeof value.active !== "boolean") {
    throw new Error(`Manifest Google Drive non valido: selezione foto ${index + 1} non valida.`);
  }
}

function validateCloudManifest(value: unknown): CompatibleCloudProjectManifest {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.app !== "image-select-pro") {
    throw new Error("Il progetto Google Drive non è compatibile con Image Select Pro.");
  }

  const workspaceMode = getWorkspaceMode(value);
  if (workspaceMode === "free") {
    getFreeWorkspaceId(value);
  } else if (!optionalNonEmptyString(value.projectId)) {
    throw new Error("Manifest Google Drive non valido: identità progetto mancante.");
  }

  if (
    typeof value.projectName !== "string"
    || typeof value.sourceFolderName !== "string"
    || typeof value.exportedAt !== "string"
    || !Array.isArray(value.assets)
  ) {
    throw new Error("Manifest Google Drive non valido: dati principali mancanti.");
  }
  if (value.exportedFrom !== undefined && typeof value.exportedFrom !== "string") {
    throw new Error("Manifest Google Drive non valido: versione sorgente non valida.");
  }
  if (value.activeRelativePaths !== undefined && (
    !Array.isArray(value.activeRelativePaths)
    || value.activeRelativePaths.some((relativePath) => typeof relativePath !== "string")
  )) {
    throw new Error("Manifest Google Drive non valido: elenco selezioni non valido.");
  }
  value.assets.forEach(validateCloudPhotoState);
  if (workspaceMode === "free") {
    const unsafePath = isUnsafeCloudRelativePath(value.sourceFolderName)
      || value.assets.some((asset) => {
        const record = asset as Record<string, unknown>;
        return isUnsafeCloudRelativePath(String(record.relativePath))
          || isUnsafeCloudRelativePath(String(record.fileName))
          || (typeof record.sourceFileKey === "string" && isUnsafeCloudSourceFileKey(record.sourceFileKey));
      }) || (Array.isArray(value.activeRelativePaths)
        && value.activeRelativePaths.some((relativePath) => isUnsafeCloudRelativePath(String(relativePath))));
    if (unsafePath) {
      throw new Error("Manifest Google Drive non valido: una selezione libera contiene un percorso assoluto o non sicuro.");
    }
  }

  const normalizedManifest: DesktopCloudProjectManifest = {
    schemaVersion: 1,
    app: "image-select-pro",
    projectId: optionalNonEmptyString(value.projectId)
      ?? (workspaceMode === "free" ? getFreeWorkspaceId(value) : ""),
    projectName: value.projectName,
    sourceFolderName: value.sourceFolderName,
    exportedAt: value.exportedAt,
    ...(typeof value.exportedFrom === "string" ? { exportedFrom: value.exportedFrom } : {}),
    activeRelativePaths: Array.isArray(value.activeRelativePaths) ? value.activeRelativePaths : [],
    assets: value.assets.map((asset) => {
      const record = asset as Record<string, unknown>;
      return {
        relativePath: String(record.relativePath),
        fileName: String(record.fileName),
        ...(typeof record.size === "number" ? { size: record.size } : {}),
        ...(typeof record.sourceFileKey === "string" ? { sourceFileKey: record.sourceFileKey } : {}),
        rating: Number(record.rating),
        pickStatus: record.pickStatus as DesktopCloudProjectManifest["assets"][number]["pickStatus"],
        colorLabel: (record.colorLabel ?? null) as DesktopCloudProjectManifest["assets"][number]["colorLabel"],
        customLabels: Array.isArray(record.customLabels) ? record.customLabels as string[] : [],
        ...(typeof record.active === "boolean" ? { active: record.active } : {}),
      };
    }),
  } as DesktopCloudProjectManifest;

  if (workspaceMode !== "free") {
    return {
      ...normalizedManifest,
      ...(value.kind === "project" ? { kind: "project" as const } : {}),
      ...(value.workspaceMode === "project" ? { workspaceMode: "project" as const } : {}),
      ...(optionalNonEmptyString(value.selectionId) ? { selectionId: optionalNonEmptyString(value.selectionId) } : {}),
      ...(optionalNonEmptyString(value.workspaceId) ? { workspaceId: optionalNonEmptyString(value.workspaceId) } : {}),
      ...(optionalNonEmptyString(value.displayName) ? { displayName: optionalNonEmptyString(value.displayName) } : {}),
    };
  }
  const workspaceId = getFreeWorkspaceId(value);
  return {
    ...normalizedManifest,
    kind: "free",
    workspaceMode: "free",
    selectionId: workspaceId,
    workspaceId,
    displayName: getFreeWorkspaceDisplayName(value),
  };
}

function sharedGoogleDriveDataDir(): string {
  return join(app.getPath("appData"), "FileX", "shared");
}

function tokenPath(): string {
  return join(sharedGoogleDriveDataDir(), TOKEN_FILE_NAME);
}

async function writeDriveLog(message: string, details?: string): Promise<void> {
  try {
    await appendFile(
      join(app.getPath("userData"), "google-drive.log"),
      `${new Date().toISOString()} ${message}${details ? ` :: ${details.slice(0, 1000)}` : ""}\n`,
      "utf8",
    );
  } catch {
    // Diagnostics must never interfere with the Drive operation.
  }
}

async function loadToken(): Promise<StoredToken | null> {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      void writeDriveLog("Secure token storage unavailable");
      return null;
    }
    const encoded = await readFile(tokenPath(), "utf8");
    const raw = safeStorage.decryptString(Buffer.from(encoded, "base64"));
    const parsed = JSON.parse(raw) as StoredToken;
    if (parsed.scope !== DRIVE_SCOPE) {
      await unlink(tokenPath()).catch(() => undefined);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function saveToken(token: StoredToken): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Archiviazione sicura non disponibile: il collegamento Google Drive non può essere salvato.");
  }
  const raw = JSON.stringify(token);
  const encoded = safeStorage.encryptString(raw).toString("base64");
  await mkdir(sharedGoogleDriveDataDir(), { recursive: true });
  await writeFile(tokenPath(), encoded, "utf8");
}

async function clearToken(): Promise<void> {
  try {
    await unlink(tokenPath());
  } catch {
    // The token may already be absent.
  }
}

function jsonHeaders(): HeadersInit {
  return { "Content-Type": "application/json" };
}

async function exchangeRefreshToken(token: StoredToken): Promise<string> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error("Google Drive OAuth non è configurato completamente in questa build.");
  }

  if (token.accessToken && token.expiresAt && token.expiresAt > Date.now() + 60_000) {
    return token.accessToken;
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      ...(GOOGLE_CLIENT_SECRET ? { client_secret: GOOGLE_CLIENT_SECRET } : {}),
      refresh_token: token.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    const authenticationExpired = response.status === 400 || response.status === 401;
    if (authenticationExpired) {
      await clearToken();
      throw new Error("Sessione Google Drive scaduta. Riconnetti Google Drive.");
    }
    throw new Error(`Aggiornamento della sessione Google Drive non riuscito (${response.status}).`);
  }

  const payload = await response.json() as { access_token?: string; expires_in?: number };
  if (!payload.access_token) {
    throw new Error("Google non ha restituito un access token valido.");
  }

  token.accessToken = payload.access_token;
  token.expiresAt = Date.now() + (payload.expires_in ?? 3600) * 1000;
  await saveToken(token);
  return token.accessToken;
}

async function driveFetch(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<Response> {
  const token = await loadToken();
  if (!token) {
    throw new Error("Google Drive non è collegato.");
  }

  const accessToken = await exchangeRefreshToken(token);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(`https://www.googleapis.com/drive/v3${path}`, { ...init, headers });
  void writeDriveLog("Drive API response", `${init.method ?? "GET"} ${path} -> ${response.status}`);

  if (response.status === 401 && retry) {
    token.accessToken = undefined;
    token.expiresAt = undefined;
    await saveToken(token);
    return driveFetch(path, init, false);
  }

  return response;
}

async function ensureResponse(response: Response): Promise<Response> {
  if (response.ok) {
    return response;
  }

  const message = await response.text().catch(() => "");
  if (
    response.status === 403
    && /insufficient\s+(authentication\s+)?scopes|insufficientpermissions/i.test(message)
  ) {
    await clearToken();
    throw new Error(
      "I permessi Google Drive del collegamento sono insufficienti. Premi nuovamente «Collega Drive» per autorizzare l'accesso ai progetti.",
    );
  }
  const apiDisabledMessage = googleDriveApiDisabledMessage(message);
  if (response.status === 403 && apiDisabledMessage) {
    throw new Error(apiDisabledMessage);
  }
  throw new Error(`Google Drive error (${response.status})${message ? `: ${message.slice(0, 300)}` : ""}`);
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function listFiles(query: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  const seenPageTokens = new Set<string>();

  do {
    const params = new URLSearchParams({
      q: query,
      spaces: "drive",
      pageSize: "1000",
      fields: "nextPageToken,files(id,name,createdTime,size,webViewLink,appProperties)",
      orderBy: "createdTime desc",
    });
    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const response = await ensureResponse(await driveFetch(`/files?${params.toString()}`));
    const payload = await response.json() as DriveListResponse;
    files.push(...(payload.files ?? []));

    const nextPageToken = optionalNonEmptyString(payload.nextPageToken);
    if (nextPageToken && seenPageTokens.has(nextPageToken)) {
      throw new Error("Google Drive ha restituito una paginazione non valida.");
    }
    if (nextPageToken) {
      seenPageTokens.add(nextPageToken);
    }
    pageToken = nextPageToken;
  } while (pageToken);

  return files;
}

async function createFolder(
  name: string,
  parentId?: string,
  appProperties?: Record<string, string>,
): Promise<DriveFile> {
  const metadata = {
    name,
    mimeType: FOLDER_MIME,
    ...(parentId ? { parents: [parentId] } : {}),
    ...(appProperties ? { appProperties } : {}),
  };
  const response = await ensureResponse(await driveFetch("/files?fields=id,name,createdTime,size,appProperties", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(metadata),
  }));
  return await response.json() as DriveFile;
}

async function ensureFolder(name: string, parentId?: string): Promise<DriveFile> {
  const parentQuery = parentId ? ` and '${escapeDriveQuery(parentId)}' in parents` : "";
  const files = await listFiles(
    `name = '${escapeDriveQuery(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false${parentQuery}`,
  );
  return files[0] ?? createFolder(name, parentId);
}

function isFreeSelectionsRoot(folder: DriveFile): boolean {
  return folder.appProperties?.[FOLDER_ROLE_PROPERTY] === FREE_SELECTIONS_ROOT_ROLE;
}

async function updateFolderMetadata(
  folder: DriveFile,
  name: string,
  appProperties: Record<string, string>,
): Promise<DriveFile> {
  const propertiesMatch = Object.entries(appProperties).every(
    ([key, value]) => folder.appProperties?.[key] === value,
  );
  if (folder.name === name && propertiesMatch) {
    return folder;
  }
  const response = await ensureResponse(await driveFetch(
    `/files/${encodeURIComponent(folder.id)}?fields=id,name,createdTime,size,appProperties`,
    {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({
        name,
        appProperties: {
          ...folder.appProperties,
          ...appProperties,
        },
      }),
    },
  ));
  return await response.json() as DriveFile;
}

async function ensureFreeSelectionsRoot(rootId: string): Promise<DriveFile> {
  const folders = await listFiles(
    `'${escapeDriveQuery(rootId)}' in parents and trashed = false and mimeType = '${FOLDER_MIME}'`,
  );
  const taggedRoot = folders.find(isFreeSelectionsRoot);
  if (taggedRoot) {
    return updateFolderMetadata(taggedRoot, FREE_SELECTIONS_FOLDER, {
      [FOLDER_ROLE_PROPERTY]: FREE_SELECTIONS_ROOT_ROLE,
    });
  }
  return createFolder(FREE_SELECTIONS_FOLDER, rootId, {
    [FOLDER_ROLE_PROPERTY]: FREE_SELECTIONS_ROOT_ROLE,
  });
}

async function ensureFreeSelectionFolder(
  manifest: CompatibleCloudProjectManifest,
  rootId: string,
): Promise<DriveFile> {
  const manifestRecord = manifest as unknown as Record<string, unknown>;
  const workspaceId = getFreeWorkspaceId(manifestRecord);
  const displayName = getFreeWorkspaceDisplayName(manifestRecord);
  const freeRoot = await ensureFreeSelectionsRoot(rootId);
  const folders = await listFiles(
    `'${escapeDriveQuery(freeRoot.id)}' in parents and trashed = false and mimeType = '${FOLDER_MIME}'`,
  );
  const taggedFolder = folders.find((folder) => (
    folder.appProperties?.[WORKSPACE_MODE_PROPERTY] === "free"
    && folder.appProperties?.[WORKSPACE_ID_PROPERTY] === workspaceId
  ));
  const identity = {
    [WORKSPACE_MODE_PROPERTY]: "free",
    [WORKSPACE_ID_PROPERTY]: workspaceId,
  };
  if (taggedFolder) {
    return updateFolderMetadata(taggedFolder, displayName, identity);
  }

  // Free selections intentionally never fall back to a same-name folder: SD
  // labels and camera folder names are commonly repeated across different jobs.
  return createFolder(displayName, freeRoot.id, identity);
}

async function updateProjectFolderIdentity(
  folder: DriveFile,
  projectName: string,
  projectId: string,
): Promise<DriveFile> {
  if (
    folder.name === projectName
    && folder.appProperties?.[PROJECT_ID_PROPERTY] === projectId
  ) {
    return folder;
  }
  const response = await ensureResponse(await driveFetch(
    `/files/${encodeURIComponent(folder.id)}?fields=id,name,createdTime,size,appProperties`,
    {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({
        name: projectName,
        appProperties: {
          ...folder.appProperties,
          [PROJECT_ID_PROPERTY]: projectId,
        },
      }),
    },
  ));
  return await response.json() as DriveFile;
}

async function folderContainsProjectId(folderId: string, projectId: string): Promise<boolean> {
  if (!projectId || projectId === LEGACY_DEFAULT_PROJECT_ID) {
    return false;
  }
  const files = await listFiles(
    `'${escapeDriveQuery(folderId)}' in parents and trashed = false and mimeType = 'application/json'`,
  );
  for (const file of files) {
    try {
      const manifest = await readDriveFile(file.id);
      if (manifest.projectId === projectId) {
        return true;
      }
    } catch {
      // Ignore unrelated or damaged JSON files in the project folder.
    }
  }
  return false;
}

async function ensureProjectFolder(
  manifest: CompatibleCloudProjectManifest,
  rootId: string,
): Promise<DriveFile> {
  const projectName = optionalNonEmptyString(manifest.projectName) ?? "Senza nome";
  const projectId = optionalNonEmptyString(manifest.projectId) ?? "";
  const folders = (await listFiles(
    `'${escapeDriveQuery(rootId)}' in parents and trashed = false and mimeType = '${FOLDER_MIME}'`,
  )).filter((folder) => !isFreeSelectionsRoot(folder));

  const taggedFolder = folders.find(
    (folder) => folder.appProperties?.[PROJECT_ID_PROPERTY] === projectId,
  );
  if (taggedFolder) {
    return updateProjectFolderIdentity(taggedFolder, projectName, projectId);
  }

  const sameNameFolder = folders.find((folder) => folder.name === projectName);
  if (sameNameFolder) {
    return updateProjectFolderIdentity(sameNameFolder, projectName, projectId);
  }

  for (const folder of folders) {
    if (
      !folder.appProperties?.[PROJECT_ID_PROPERTY]
      && await folderContainsProjectId(folder.id, projectId)
    ) {
      return updateProjectFolderIdentity(folder, projectName, projectId);
    }
  }

  return createFolder(projectName, rootId, { [PROJECT_ID_PROPERTY]: projectId });
}

async function uploadManifest(
  parentId: string,
  fileName: string,
  manifest: unknown,
): Promise<DriveFile> {
  const boundary = `filex-${randomBytes(12).toString("hex")}`;
  const metadata = JSON.stringify({
    name: fileName,
    mimeType: "application/json",
    parents: [parentId],
  });
  const content = JSON.stringify(manifest, null, 2);
  const body = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n`,
    `--${boundary}--\r\n`,
  ].join("");
  const response = await ensureResponse(await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime,size,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await exchangeRefreshToken((await loadToken()) as StoredToken)}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  ));
  void writeDriveLog("Drive upload response", `${fileName} -> ${response.status}`);
  return await response.json() as DriveFile;
}

export async function uploadStudioFlowRegistryToDrive(registry: unknown): Promise<{ fileId: string; fileName: string; createdAt: string; driveUrl: string }> {
  const status = await getGoogleDriveStatus();
  if (!status.connected) throw new Error("Google Drive non è collegato.");
  const folder = await ensureFolder("FileX StudioFlow Registry");
  const createdAt = new Date().toISOString();
  const checksumSource = registry && typeof registry === "object"
    ? Object.fromEntries(Object.entries(registry as Record<string, unknown>).filter(([key]) => key !== "generatedAt"))
    : registry;
  const checksum = createHash("sha256").update(JSON.stringify(checksumSource)).digest("hex").slice(0, 24);
  const fileName = `studioflow-registry-${checksum}.json`;
  const existing = await listFiles(`name = '${escapeDriveQuery(fileName)}' and '${escapeDriveQuery(folder.id)}' in parents and trashed = false`);
  if (existing[0]) return {
    fileId: existing[0].id,
    fileName,
    createdAt: existing[0].createdTime ?? createdAt,
    driveUrl: googleDriveFileUrl(existing[0].id, existing[0].webViewLink),
  };
  const file = await uploadManifest(folder.id, fileName, registry);
  return {
    fileId: file.id,
    fileName,
    createdAt: file.createdTime ?? createdAt,
    driveUrl: googleDriveFileUrl(file.id, file.webViewLink),
  };
}

async function readDriveFile(fileId: string): Promise<CompatibleCloudProjectManifest> {
  const response = await ensureResponse(await driveFetch(`/files/${encodeURIComponent(fileId)}?alt=media`));
  return validateCloudManifest(await response.json() as unknown);
}

async function getAccountEmail(token: StoredToken): Promise<string | null> {
  const accessToken = await exchangeRefreshToken(token);
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    return null;
  }
  const payload = await response.json() as { email?: string };
  return payload.email ?? null;
}

function statusFor(token: StoredToken | null, requiresReconnect = false): DesktopGoogleDriveStatus {
  return {
    configured: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
    connected: Boolean(token),
    accountEmail: token?.accountEmail ?? null,
    requiresReconnect,
  };
}

export async function getGoogleDriveStatus(): Promise<DesktopGoogleDriveStatus> {
  const token = await loadToken();
  if (!token) {
    void writeDriveLog("Status requested", "disconnected");
    return statusFor(null);
  }

  try {
    await exchangeRefreshToken(token);
    void writeDriveLog("Status requested", "connected");
    return statusFor(token);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Sessione Google Drive scaduta")) {
      void writeDriveLog("Status requested", "reconnect-required");
      return statusFor(null, true);
    }
    void writeDriveLog("Status requested", "connected-unverified");
    return statusFor(token);
  }
}

export async function connectGoogleDrive(): Promise<DesktopGoogleDriveStatus> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error("Google Drive OAuth non è configurato completamente in questa build.");
  }

  const existing = await loadToken();
  if (existing) {
    try {
      await exchangeRefreshToken(existing);
      existing.accountEmail = existing.accountEmail ?? (await getAccountEmail(existing)) ?? undefined;
      await saveToken(existing);
      return statusFor(existing);
    } catch (error) {
      // A rejected refresh token is removed by exchangeRefreshToken. In that
      // case continue directly with OAuth so "Riconnetti" remains one click.
      if (await loadToken()) {
        throw error;
      }
    }
  }

  const state = randomBytes(24).toString("hex");
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  let callbackServer: Server | null = null;
  let resolveCallback: ((value: URL) => void) | null = null;
  let rejectCallback: ((reason?: unknown) => void) | null = null;
  const callback = new Promise<URL>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  callbackServer = createServer((request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/") {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<h2>Autorizzazione Google ricevuta. Puoi tornare a FileX.</h2>");
      if (url.searchParams.get("state") !== state) {
        rejectCallback?.(new Error("Risposta OAuth non valida."));
        return;
      }
      if (url.searchParams.get("error")) {
        rejectCallback?.(new Error(`Autorizzazione Google annullata: ${url.searchParams.get("error")}`));
        return;
      }
      resolveCallback?.(url);
    } catch (error) {
      rejectCallback?.(error);
    }
  });

  await new Promise<void>((resolve, reject) => {
    callbackServer?.once("error", reject);
    callbackServer?.listen(0, "127.0.0.1", () => resolve());
  });

  const address = callbackServer.address();
  if (!address || typeof address === "string") {
    callbackServer.close();
    throw new Error("Non è stato possibile avviare il callback OAuth locale.");
  }
  // I client OAuth di tipo Desktop accettano il loopback con una porta
  // dinamica. Google documenta il redirect senza un percorso aggiuntivo.
  const redirectUri = `http://127.0.0.1:${address.port}`;
  const authParams = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: `openid email ${DRIVE_SCOPE}`,
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  try {
    await shell.openExternal(`https://accounts.google.com/o/oauth2/v2/auth?${authParams.toString()}`);
    const callbackUrl = await Promise.race([
      callback,
      new Promise<URL>((_, reject) => setTimeout(() => reject(new Error("Login Google scaduto.")), 180_000)),
    ]);
    const code = callbackUrl.searchParams.get("code");
    if (!code) {
      throw new Error("Google non ha restituito il codice di autorizzazione.");
    }

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        ...(GOOGLE_CLIENT_SECRET ? { client_secret: GOOGLE_CLIENT_SECRET } : {}),
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenResponse.ok) {
      const details = await tokenResponse.text().catch(() => "");
      throw new Error(
        `Autorizzazione Google fallita (${tokenResponse.status})${details ? `: ${details.slice(0, 500)}` : "."}`,
      );
    }
    const payload = await tokenResponse.json() as { refresh_token?: string; access_token?: string; expires_in?: number };
    if (!payload.refresh_token) {
      throw new Error("Google non ha restituito un refresh token.");
    }
    const token: StoredToken = {
      refreshToken: payload.refresh_token,
      accessToken: payload.access_token,
      expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
      scope: DRIVE_SCOPE,
    };
    token.accountEmail = (await getAccountEmail(token)) ?? undefined;
    await saveToken(token);
    return statusFor(token);
  } finally {
    callbackServer.close();
  }
}

export async function disconnectGoogleDrive(): Promise<DesktopGoogleDriveStatus> {
  const token = await loadToken();
  if (token?.refreshToken) {
    try {
      const response = await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: token.refreshToken }),
      });
      void writeDriveLog("Drive token revoke", String(response.status));
    } catch (error) {
      void writeDriveLog("Drive token revoke failed", error instanceof Error ? error.message : String(error));
    }
  }
  await clearToken();
  return statusFor(null);
}

function manifestVersionCompatibility(
  manifest: CompatibleCloudProjectManifest,
): Partial<CompatibleCloudProjectVersion> {
  const manifestRecord = manifest as unknown as Record<string, unknown>;
  const workspaceMode = getWorkspaceMode(manifestRecord);
  if (workspaceMode === "free") {
    const workspaceId = getFreeWorkspaceId(manifestRecord);
    return {
      kind: "free",
      workspaceMode: "free",
      selectionId: workspaceId,
      workspaceId,
      displayName: getFreeWorkspaceDisplayName(manifestRecord),
    };
  }

  return {
    kind: "project" as const,
    workspaceMode: "project" as const,
    workspaceId: manifest.projectId,
    ...(optionalNonEmptyString(manifest.selectionId) ? { selectionId: manifest.selectionId!.trim() } : {}),
    ...(optionalNonEmptyString(manifest.displayName) ? { displayName: manifest.displayName!.trim() } : {}),
  };
}

function driveVersionLinkFields(file: DriveFile): Pick<CompatibleCloudProjectVersion, "webViewLink" | "driveUrl"> {
  return {
    webViewLink: file.webViewLink,
    driveUrl: googleDriveFileUrl(file.id, file.webViewLink),
  };
}

async function ensureProjectFolderByNameForListing(projectName: string, rootId: string): Promise<DriveFile> {
  const folders = await listFiles(
    `name = '${escapeDriveQuery(projectName)}' and '${escapeDriveQuery(rootId)}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
  );
  return folders.find((folder) => !isFreeSelectionsRoot(folder))
    ?? createFolder(projectName, rootId);
}

async function listVersionsInFolder(
  folder: DriveFile,
  defaults: Partial<CompatibleCloudProjectVersion> = {},
): Promise<CompatibleCloudProjectVersion[]> {
  const files = await listFiles(
    `'${escapeDriveQuery(folder.id)}' in parents and trashed = false and mimeType = 'application/json'`,
  );
  const versions = await mapWithConcurrency(
    files,
    DRIVE_MANIFEST_READ_CONCURRENCY,
    async (file): Promise<CompatibleCloudProjectVersion | null> => {
    const baseVersion: CompatibleCloudProjectVersion = {
      id: file.id,
      name: file.name ?? "Versione senza nome",
      createdAt: file.createdTime ?? new Date().toISOString(),
      size: Number(file.size ?? 0),
      projectName: folder.name,
      ...defaults,
      ...driveVersionLinkFields(file),
    };
    try {
      const manifest = await readDriveFile(file.id);
      return {
        ...baseVersion,
        projectName: manifest.projectName,
        sourceFolderName: manifest.sourceFolderName,
        totalAssets: manifest.assets.length,
        selectedAssets: manifest.assets.filter((asset) => asset.active === true).length,
        ...manifestVersionCompatibility(manifest),
      };
    } catch (error) {
      void writeDriveLog(
        "Drive manifest skipped",
        `${file.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
    },
  );
  return versions.filter((version): version is CompatibleCloudProjectVersion => version !== null);
}

export async function exportPhotoSelectorProjectToDrive(
  manifest: DesktopCloudProjectManifest,
): Promise<DesktopCloudProjectVersion> {
  const validatedManifest = validateCloudManifest(manifest);
  const manifestRecord = validatedManifest as unknown as Record<string, unknown>;
  const workspaceMode = getWorkspaceMode(manifestRecord);
  const displayName = workspaceMode === "free"
    ? getFreeWorkspaceDisplayName(manifestRecord)
    : validatedManifest.projectName;
  await writeDriveLog("Export started", `${displayName} (${validatedManifest.assets.length} assets)`);
  const root = await ensureFolder(DRIVE_ROOT_FOLDER);
  const targetFolder = workspaceMode === "free"
    ? await ensureFreeSelectionFolder(validatedManifest, root.id)
    : await ensureProjectFolder(validatedManifest, root.id);
  const timestamp = validatedManifest.exportedAt.replace(/[:.]/g, "-");
  const fileName = `${timestamp}__${displayName || "project"}.json`.replace(/[\\/:*?"<>|]+/g, "-");
  const file = await uploadManifest(targetFolder.id, fileName, validatedManifest);
  await writeDriveLog("Export completed", file.id);
  const version: CompatibleCloudProjectVersion = {
    id: file.id,
    name: file.name ?? fileName,
    createdAt: file.createdTime ?? validatedManifest.exportedAt,
    size: Number(file.size ?? 0),
    projectName: validatedManifest.projectName,
    sourceFolderName: validatedManifest.sourceFolderName,
    totalAssets: validatedManifest.assets.length,
    selectedAssets: validatedManifest.assets.filter((asset) => asset.active === true).length,
    ...manifestVersionCompatibility(validatedManifest),
    ...driveVersionLinkFields(file),
  };
  return version;
}

export async function listPhotoSelectorDriveVersions(
  projectName?: string,
): Promise<DesktopCloudProjectVersion[]> {
  const root = await ensureFolder(DRIVE_ROOT_FOLDER);
  const normalizedProjectName = projectName?.trim();
  if (normalizedProjectName) {
    const projectFolder = await ensureProjectFolderByNameForListing(normalizedProjectName, root.id);
    return (await listVersionsInFolder(projectFolder))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  const rootFolders = await listFiles(
    `'${escapeDriveQuery(root.id)}' in parents and trashed = false and mimeType = '${FOLDER_MIME}'`,
  );
  const projectFolders = rootFolders.filter((folder) => !isFreeSelectionsRoot(folder));
  const freeSelectionRoots = rootFolders.filter(isFreeSelectionsRoot);
  const versions: CompatibleCloudProjectVersion[] = [];
  for (const projectFolder of projectFolders) {
    versions.push(...await listVersionsInFolder(projectFolder));
  }
  for (const freeRoot of freeSelectionRoots) {
    const freeFolders = await listFiles(
      `'${escapeDriveQuery(freeRoot.id)}' in parents and trashed = false and mimeType = '${FOLDER_MIME}'`,
    );
    for (const freeFolder of freeFolders) {
      const workspaceId = optionalNonEmptyString(freeFolder.appProperties?.[WORKSPACE_ID_PROPERTY]);
      if (freeFolder.appProperties?.[WORKSPACE_MODE_PROPERTY] !== "free" || !workspaceId) {
        continue;
      }
      versions.push(...await listVersionsInFolder(freeFolder, {
        kind: "free",
        workspaceMode: "free",
        selectionId: workspaceId,
        workspaceId,
        displayName: freeFolder.name ?? "Selezione libera",
      }));
    }
  }

  return versions.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function downloadPhotoSelectorDriveVersion(
  versionId: string,
): Promise<DesktopCloudProjectManifest> {
  return readDriveFile(versionId);
}
