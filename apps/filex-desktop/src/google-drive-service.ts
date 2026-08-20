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

const { app, safeStorage, shell } = electron;

// FileX deve poter creare e aggiornare soltanto i file che appartengono al suo
// workflow. drive.file è uno scope non sensibile e non concede accesso generale
// ai documenti presenti nel Drive personale dell'utente.
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_ROOT_FOLDER = "Image Select Pro";
const TOKEN_FILE_NAME = "google-drive-token.bin";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const PROJECT_ID_PROPERTY = "imageSelectProProjectId";
const LEGACY_DEFAULT_PROJECT_ID = "photo-selector-default";

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
  appProperties?: Record<string, string>;
}

interface DriveListResponse {
  files?: DriveFile[];
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
  throw new Error(`Google Drive error (${response.status})${message ? `: ${message.slice(0, 300)}` : ""}`);
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function listFiles(query: string): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    q: query,
    spaces: "drive",
    pageSize: "1000",
    fields: "files(id,name,createdTime,size,appProperties)",
    orderBy: "createdTime desc",
  });
  const response = await ensureResponse(await driveFetch(`/files?${params.toString()}`));
  const payload = await response.json() as DriveListResponse;
  return payload.files ?? [];
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
  manifest: DesktopCloudProjectManifest,
  rootId: string,
): Promise<DriveFile> {
  const projectName = manifest.projectName.trim() || "Senza nome";
  const projectId = manifest.projectId.trim();
  const folders = await listFiles(
    `'${escapeDriveQuery(rootId)}' in parents and trashed = false and mimeType = '${FOLDER_MIME}'`,
  );

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
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime,size",
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

export async function uploadStudioFlowRegistryToDrive(registry: unknown): Promise<{ fileId: string; fileName: string; createdAt: string }> {
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
  if (existing[0]) return { fileId:existing[0].id, fileName, createdAt:existing[0].createdTime ?? createdAt };
  const file = await uploadManifest(folder.id, fileName, registry);
  return { fileId: file.id, fileName, createdAt: file.createdTime ?? createdAt };
}

async function readDriveFile(fileId: string): Promise<DesktopCloudProjectManifest> {
  const response = await ensureResponse(await driveFetch(`/files/${encodeURIComponent(fileId)}?alt=media`));
  const manifest = await response.json() as DesktopCloudProjectManifest;
  if (manifest.schemaVersion !== 1 || manifest.app !== "image-select-pro") {
    throw new Error("Il progetto Google Drive non è compatibile con Image Select Pro.");
  }
  return manifest;
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

export async function exportPhotoSelectorProjectToDrive(
  manifest: DesktopCloudProjectManifest,
): Promise<DesktopCloudProjectVersion> {
  await writeDriveLog("Export started", `${manifest.projectName} (${manifest.assets.length} assets)`);
  const root = await ensureFolder(DRIVE_ROOT_FOLDER);
  const projectFolder = await ensureProjectFolder(manifest, root.id);
  const timestamp = manifest.exportedAt.replace(/[:.]/g, "-");
  const fileName = `${timestamp}__${manifest.projectName || "project"}.json`.replace(/[\\/:*?"<>|]+/g, "-");
  const file = await uploadManifest(projectFolder.id, fileName, manifest);
  await writeDriveLog("Export completed", file.id);
  return {
    id: file.id,
    name: file.name ?? fileName,
    createdAt: file.createdTime ?? manifest.exportedAt,
    size: Number(file.size ?? 0),
    projectName: manifest.projectName,
    sourceFolderName: manifest.sourceFolderName,
    totalAssets: manifest.assets.length,
    selectedAssets: manifest.assets.filter((asset) => asset.active === true).length,
  };
}

export async function listPhotoSelectorDriveVersions(
  projectName?: string,
): Promise<DesktopCloudProjectVersion[]> {
  const root = await ensureFolder(DRIVE_ROOT_FOLDER);
  const normalizedProjectName = projectName?.trim();
  const projectFolders = normalizedProjectName
    ? [await ensureFolder(normalizedProjectName, root.id)]
    : await listFiles(`'${escapeDriveQuery(root.id)}' in parents and trashed = false and mimeType = '${FOLDER_MIME}'`);

  const versions: DesktopCloudProjectVersion[] = [];
  for (const projectFolder of projectFolders) {
    const files = await listFiles(`'${escapeDriveQuery(projectFolder.id)}' in parents and trashed = false and mimeType = 'application/json'`);
    const described = await Promise.all(files.map(async (file): Promise<DesktopCloudProjectVersion> => {
      const baseVersion = {
        id: file.id,
        name: file.name ?? "Versione senza nome",
        createdAt: file.createdTime ?? new Date().toISOString(),
        size: Number(file.size ?? 0),
        projectName: projectFolder.name ?? normalizedProjectName,
      };
      try {
        const manifest = await readDriveFile(file.id);
        return {
          ...baseVersion,
          projectName: manifest.projectName,
          sourceFolderName: manifest.sourceFolderName,
          totalAssets: manifest.assets.length,
          selectedAssets: manifest.assets.filter((asset) => asset.active === true).length,
        };
      } catch {
        return baseVersion;
      }
    }));
    versions.push(...described);
  }

  return versions.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function downloadPhotoSelectorDriveVersion(
  versionId: string,
): Promise<DesktopCloudProjectManifest> {
  return readDriveFile(versionId);
}
