import { app, BrowserWindow, dialog, ipcMain, Notification, safeStorage, shell } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FileSendService } from "./file-send-service.js";
import type { FileSendWifiConfig } from "../src/contracts.js";
import { detectCurrentWifi } from "./wifi-detection.js";
import { FIREBASE_API_KEY } from "./firebase-config.generated.js";
import { FileSendRemoteClient, type PersistedRemoteSession } from "./remote-client-service.js";
import type { FirebaseAnonymousAuthState } from "./firebase-anonymous-auth.js";
import type { FileSendSession, FileSendSessionHistoryEntry, FileSendSnapshot } from "../src/contracts.js";
import { directToolLicenseAllowed } from "./license-gate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let service: FileSendService;
let settings: FileSendSettings;
let remoteClient: FileSendRemoteClient;
let currentMode: "local" | "remote" | null = null;
let currentSessionId: string | null = null;
let settingsSaveQueue = Promise.resolve();
let settingsSaveTimer: NodeJS.Timeout | null = null;

interface FileSendSettings {
  outputRoot: string;
  wifi: FileSendWifiConfig;
  remoteSessions: PersistedRemoteSession[];
  activeLocalSessions: FileSendSession[];
  history: FileSendSessionHistoryEntry[];
  cloudAuth: FirebaseAnonymousAuthState | null;
}

interface PersistedFileSendSettings {
  outputRoot?: string;
  wifi?: {
    ssid?: string;
    security?: "WPA" | "nopass";
    passwordEncrypted?: string;
    password?: string;
  };
  remoteSession?: Omit<PersistedRemoteSession, "desktopToken"> & { desktopTokenEncrypted?: string };
  remoteSessions?: Array<Omit<PersistedRemoteSession, "desktopToken"> & { desktopTokenEncrypted?: string }>;
  activeLocalSessions?: FileSendSession[];
  history?: FileSendSessionHistoryEntry[];
  cloudAuth?: { localId?: string; refreshTokenEncrypted?: string };
}

const isDevRenderer = process.env.FILEX_RENDERER_MODE === "dev";
app.setName(isDevRenderer ? "FileX Send Dev" : "FileX Send");
if (process.platform === "win32") app.setAppUserModelId(isDevRenderer ? "studio.filex.filex-send.dev" : "studio.filex.filex-send");

function rendererEntry(): string {
  if (app.isPackaged) return join(process.resourcesPath, "apps", "filex-send", "web", "index.html");
  return resolve(app.getAppPath(), ".output", "web", "index.html");
}

function iconPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, "branding", "filex-send.ico");
  return resolve(app.getAppPath(), "..", "filex-desktop", ".output", "branding", "filex-send.ico");
}

function settingsPath(): string {
  return join(app.getPath("userData"), "filex-send-settings.json");
}

async function readSettings(): Promise<FileSendSettings> {
  const defaults: FileSendSettings = {
    outputRoot: join(app.getPath("pictures"), "FileX Send"),
    wifi: { ssid: "", password: "", security: "WPA" },
    remoteSessions: [],
    activeLocalSessions: [],
    history: [],
    cloudAuth: null,
  };
  try {
    const parsed = JSON.parse(await readFile(settingsPath(), "utf8")) as PersistedFileSendSettings;
    let password = "";
    if (typeof parsed.wifi?.passwordEncrypted === "string" && parsed.wifi.passwordEncrypted) {
      try { password = safeStorage.decryptString(Buffer.from(parsed.wifi.passwordEncrypted, "base64")); } catch { password = ""; }
    } else if (typeof parsed.wifi?.password === "string") {
      password = parsed.wifi.password;
    }
    const persistedRemoteSessions = parsed.remoteSessions ?? (parsed.remoteSession ? [parsed.remoteSession] : []);
    const remoteSessions: PersistedRemoteSession[] = [];
    if (safeStorage.isEncryptionAvailable()) for (const persisted of persistedRemoteSessions) {
      if (!persisted.desktopTokenEncrypted) continue;
      try {
        const desktopToken = safeStorage.decryptString(Buffer.from(persisted.desktopTokenEncrypted, "base64"));
        remoteSessions.push({ ...persisted, desktopToken });
      } catch { /* sessione non recuperabile */ }
    }
    let cloudAuth: FirebaseAnonymousAuthState | null = null;
    if (parsed.cloudAuth?.localId && parsed.cloudAuth.refreshTokenEncrypted && safeStorage.isEncryptionAvailable()) {
      try {
        cloudAuth = {
          localId: parsed.cloudAuth.localId,
          refreshToken: safeStorage.decryptString(Buffer.from(parsed.cloudAuth.refreshTokenEncrypted, "base64")),
        };
      } catch { cloudAuth = null; }
    }
    const storedHistory = Array.isArray(parsed.history)
      ? parsed.history.filter((entry) => entry && typeof entry.closedAt === "number" && typeof entry.session?.id === "string").slice(0, 500)
      : [];
    const interruptedLocal = Array.isArray(parsed.activeLocalSessions)
      ? parsed.activeLocalSessions.filter((session) => session && typeof session.id === "string").map((session) => ({ mode: "local" as const, session, closedAt: Date.now() }))
      : [];
    const history = [...interruptedLocal, ...storedHistory].filter((entry, index, entries) => entries.findIndex((candidate) => candidate.session.id === entry.session.id) === index).slice(0, 500);
    return {
      outputRoot: typeof parsed.outputRoot === "string" && parsed.outputRoot.trim() ? parsed.outputRoot : defaults.outputRoot,
      wifi: {
        ssid: typeof parsed.wifi?.ssid === "string" ? parsed.wifi.ssid : defaults.wifi.ssid,
        password,
        security: parsed.wifi?.security === "nopass" ? "nopass" : "WPA",
      },
      remoteSessions,
      activeLocalSessions: [],
      history,
      cloudAuth,
    };
  } catch { /* prima apertura */ }
  return defaults;
}

async function saveSettings(): Promise<void> {
  if (settings.wifi.security === "WPA" && settings.wifi.password && !safeStorage.isEncryptionAvailable()) {
    throw new Error("La protezione credenziali di Windows non è disponibile.");
  }
  const persisted: PersistedFileSendSettings = {
    outputRoot: settings.outputRoot,
    wifi: {
      ssid: settings.wifi.ssid,
      security: settings.wifi.security,
      passwordEncrypted: settings.wifi.password
        ? safeStorage.encryptString(settings.wifi.password).toString("base64")
        : "",
    },
    remoteSessions: settings.remoteSessions.map((session) => ({
      ...session,
      desktopToken: undefined,
      desktopTokenEncrypted: safeStorage.encryptString(session.desktopToken).toString("base64"),
    })) as PersistedFileSendSettings["remoteSessions"],
    activeLocalSessions: settings.activeLocalSessions,
    history: settings.history,
    cloudAuth: settings.cloudAuth ? {
      localId: settings.cloudAuth.localId,
      refreshTokenEncrypted: safeStorage.encryptString(settings.cloudAuth.refreshToken).toString("base64"),
    } : undefined,
  };
  await writeFile(settingsPath(), JSON.stringify(persisted, null, 2), "utf8");
}

function queueSettingsSave(): Promise<void> {
  const pending = settingsSaveQueue.then(() => saveSettings());
  settingsSaveQueue = pending.catch(() => undefined);
  return pending;
}

function scheduleSettingsSave(): void {
  if (settingsSaveTimer) return;
  settingsSaveTimer = setTimeout(() => {
    settingsSaveTimer = null;
    void queueSettingsSave();
  }, 400);
}

function registerIpc(): void {
  ipcMain.handle("filex-send:get-snapshot", () => composeSnapshot());
  ipcMain.handle("filex-send:start-session", async (_event, label: unknown) => {
    const started = await service.startSession(typeof label === "string" ? label : undefined);
    currentMode = "local";
    currentSessionId = started.session!.id;
    return composeSnapshot();
  });
  ipcMain.handle("filex-send:start-remote-session", async (_event, label: unknown, expiresAt: unknown) => {
    const session = await remoteClient.startSession(typeof label === "string" ? label : undefined, typeof expiresAt === "number" ? expiresAt : undefined);
    currentMode = "remote";
    currentSessionId = session.id;
    return composeSnapshot();
  });
  ipcMain.handle("filex-send:start-send-session", async (_event, mode: unknown, label: unknown, expiresAt: unknown) => {
    if (mode !== "local" && mode !== "remote") throw new Error("Modalità di invio non valida.");
    const selected = await dialog.showOpenDialog(mainWindow!, {
      title: "Scegli i file da inviare",
      properties: ["openFile", "multiSelections"],
    });
    if (selected.canceled || selected.filePaths.length === 0) return composeSnapshot();
    const started = mode === "local"
      ? (await service.startSendSession(selected.filePaths, typeof label === "string" ? label : undefined)).session!
      : await remoteClient.startSendSession(selected.filePaths, typeof label === "string" ? label : undefined, typeof expiresAt === "number" ? expiresAt : undefined);
    currentMode = mode;
    currentSessionId = started.id;
    return composeSnapshot();
  });
  ipcMain.handle("filex-send:select-session", (_event, mode: unknown, sessionId: unknown) => {
    if ((mode !== "local" && mode !== "remote") || typeof sessionId !== "string") throw new Error("Sessione non valida.");
    const session = mode === "local" ? service.getSession(sessionId) : remoteClient.getSession(sessionId);
    if (!session) throw new Error("Sessione non trovata.");
    if (mode === "local") service.selectSession(sessionId);
    currentMode = mode;
    currentSessionId = sessionId;
    return composeSnapshot();
  });
  ipcMain.handle("filex-send:close-session", async (_event, mode: unknown, sessionId: unknown) => {
    if ((mode !== "local" && mode !== "remote") || typeof sessionId !== "string") throw new Error("Sessione non valida.");
    const session = mode === "remote" ? remoteClient.getSession(sessionId) : service.getSession(sessionId);
    if (!session) throw new Error("Sessione non trovata.");
    const historyEntry: FileSendSessionHistoryEntry = { mode, session, closedAt: Date.now() };
    settings.history = [historyEntry, ...settings.history.filter((entry) => entry.session.id !== sessionId)].slice(0, 500);
    if (mode === "remote") await remoteClient.closeSession(sessionId);
    else service.closeSession(sessionId);
    selectFallbackSession();
    await queueSettingsSave();
    return composeSnapshot();
  });
  ipcMain.handle("filex-send:choose-output-root", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { title: "Scegli dove ricevere foto e video", properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return composeSnapshot();
    await service.setOutputRoot(result.filePaths[0]);
    remoteClient.setOutputRoot(result.filePaths[0]);
    settings.outputRoot = result.filePaths[0];
    await queueSettingsSave();
    return composeSnapshot();
  });
  ipcMain.handle("filex-send:save-wifi", async (_event, wifi: unknown) => {
    if (!wifi || typeof wifi !== "object") throw new Error("Configurazione Wi-Fi non valida.");
    const candidate = wifi as Partial<FileSendWifiConfig>;
    const normalized: FileSendWifiConfig = {
      ssid: typeof candidate.ssid === "string" ? candidate.ssid.trim() : "",
      password: typeof candidate.password === "string" ? candidate.password : "",
      security: candidate.security === "nopass" ? "nopass" : "WPA",
    };
    if (!normalized.ssid) throw new Error("Inserisci il nome della rete Wi-Fi.");
    if (normalized.security === "WPA" && normalized.password.length < 8) throw new Error("La password Wi-Fi deve contenere almeno 8 caratteri.");
    settings.wifi = normalized;
    await queueSettingsSave();
    service.setWifi(normalized, "manual");
    return composeSnapshot();
  });
  ipcMain.handle("filex-send:detect-wifi", () => refreshDetectedWifi());
  ipcMain.handle("filex-send:open-session-folder", async (_event, mode: unknown, sessionId: unknown) => {
    const session = mode === "local" && typeof sessionId === "string"
      ? service.getSession(sessionId)
      : mode === "remote" && typeof sessionId === "string" ? remoteClient.getSession(sessionId) : null;
    const folderPath = session?.folderPath ?? settings.outputRoot;
    const message = await shell.openPath(folderPath);
    return message ? { ok: false, message } : { ok: true };
  });
  ipcMain.handle("filex-send:open-history-folder", async (_event, sessionId: unknown) => {
    const session = typeof sessionId === "string" ? settings.history.find((entry) => entry.session.id === sessionId)?.session : null;
    if (!session) return { ok: false, message: "Sessione non trovata nello storico." };
    const message = await shell.openPath(session.folderPath);
    return message ? { ok: false, message } : { ok: true };
  });
}

function composeSnapshot(): FileSendSnapshot {
  const local = service.snapshot();
  const sessions = [
    ...service.getSessions().map((session) => ({ mode: "local" as const, session })),
    ...remoteClient.getSessions().map((session) => ({ mode: "remote" as const, session })),
  ].sort((left, right) => right.session.createdAt - left.session.createdAt);
  const selected = currentMode === "remote" && currentSessionId
    ? remoteClient.getSession(currentSessionId)
    : currentMode === "local" && currentSessionId ? service.getSession(currentSessionId) : null;
  return {
    ...local,
    mode: currentMode,
    remoteAvailable: remoteClient?.isAvailable() ?? false,
    remoteError: remoteClient?.getError() ?? null,
    session: selected,
    sessions,
    history: settings.history,
  };
}

function selectFallbackSession(): void {
  const remote = remoteClient.getSessions()[0];
  const local = service.getSessions()[0];
  const fallback = remote ? { mode: "remote" as const, session: remote } : local ? { mode: "local" as const, session: local } : null;
  currentMode = fallback?.mode ?? null;
  currentSessionId = fallback?.session.id ?? null;
  if (fallback?.mode === "local") service.selectSession(fallback.session.id);
}

function emitSnapshot(): void {
  if (mainWindow && service && remoteClient) mainWindow.webContents.send("filex-send:snapshot", composeSnapshot());
}

async function refreshDetectedWifi() {
  const detected = await detectCurrentWifi();
  if (detected.wifi) {
    settings.wifi = detected.wifi;
    await queueSettingsSave();
    service.setWifi(detected.wifi, "detected");
    return composeSnapshot();
  }
  const remembered = Boolean(settings.wifi.ssid) && (settings.wifi.security === "nopass" || settings.wifi.password.length >= 8);
  service.setWifi(settings.wifi, remembered ? "remembered" : "missing", detected.error);
  return composeSnapshot();
}

async function createWindow(): Promise<void> {
  const windowTitle = `FileX Send — Versione ${app.getVersion()}`;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    title: windowTitle,
    icon: iconPath(),
    backgroundColor: "#091321",
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    mainWindow?.setTitle(windowTitle);
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = null; });
  if (process.env.FILEX_RENDERER_MODE === "dev" && process.env.FILEX_RENDERER_URL) await mainWindow.loadURL(process.env.FILEX_RENDERER_URL);
  else await mainWindow.loadFile(rendererEntry());
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.whenReady().then(async () => {
    if (!(await directToolLicenseAllowed())) { app.quit(); return; }
    settings = await readSettings();
    const detected = await detectCurrentWifi();
    if (detected.wifi) {
      settings.wifi = detected.wifi;
      await queueSettingsSave();
    }
    const hasRememberedWifi = Boolean(settings.wifi.ssid) && (settings.wifi.security === "nopass" || settings.wifi.password.length >= 8);
    service = new FileSendService({
      outputRoot: settings.outputRoot,
      wifi: settings.wifi,
      wifiSource: detected.wifi ? "detected" : hasRememberedWifi ? "remembered" : "missing",
      wifiError: detected.wifi ? null : detected.error,
      onChange: () => {
        settings.activeLocalSessions = service.getSessions();
        scheduleSettingsSave();
        emitSnapshot();
      },
    });
    await service.start();
    remoteClient = new FileSendRemoteClient({
      baseUrl: process.env.FILEX_SEND_REMOTE_URL ?? "https://gen-lang-client-0321087169.web.app",
      firebaseApiKey: FIREBASE_API_KEY,
      authState: settings.cloudAuth,
      outputRoot: settings.outputRoot,
      restoredSessions: settings.remoteSessions,
      onChange: () => {
        settings.remoteSessions = remoteClient.exportSessions();
        settings.cloudAuth = remoteClient.exportAuthState();
        scheduleSettingsSave();
        emitSnapshot();
      },
      onFilesReceived: (count, label) => {
        if (Notification.isSupported()) new Notification({ title: "FileX Send", body: `${count} ${count === 1 ? "file ricevuto" : "file ricevuti"} da ${label}.` }).show();
      },
    });
    if (settings.remoteSessions[0]) {
      currentMode = "remote";
      currentSessionId = settings.remoteSessions[0].id;
    }
    remoteClient.resume();
    void remoteClient.checkAvailability();
    registerIpc();
    await createWindow();
  });
}

app.on("activate", () => { if (!mainWindow) void createWindow(); });
app.on("before-quit", () => { void service?.stop(); void remoteClient?.stop(); });
app.on("window-all-closed", () => app.quit());
