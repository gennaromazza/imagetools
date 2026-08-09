import { app, BrowserWindow, dialog, ipcMain, Notification, safeStorage, shell } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FileSendService } from "./file-send-service.js";
import type { FileSendWifiConfig } from "../src/contracts.js";
import { detectCurrentWifi } from "./wifi-detection.js";
import { FileSendRemoteClient, type PersistedRemoteSession } from "./remote-client-service.js";
import type { FirebaseAnonymousAuthState } from "./firebase-anonymous-auth.js";
import type { FileSendSnapshot } from "../src/contracts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let service: FileSendService;
let settings: FileSendSettings;
let remoteClient: FileSendRemoteClient;
let currentMode: "local" | "remote" | null = null;

interface FileSendSettings {
  outputRoot: string;
  wifi: FileSendWifiConfig;
  remoteSession: PersistedRemoteSession | null;
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
  cloudAuth?: { localId?: string; refreshTokenEncrypted?: string };
}

app.setName("FileX Send");
if (process.platform === "win32") app.setAppUserModelId("studio.filex.filex-send");

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
    remoteSession: null,
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
    let remoteSession: PersistedRemoteSession | null = null;
    if (parsed.remoteSession?.desktopTokenEncrypted && safeStorage.isEncryptionAvailable()) {
      try {
        const desktopToken = safeStorage.decryptString(Buffer.from(parsed.remoteSession.desktopTokenEncrypted, "base64"));
        remoteSession = { ...parsed.remoteSession, desktopToken };
      } catch { remoteSession = null; }
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
    return {
      outputRoot: typeof parsed.outputRoot === "string" && parsed.outputRoot.trim() ? parsed.outputRoot : defaults.outputRoot,
      wifi: {
        ssid: typeof parsed.wifi?.ssid === "string" ? parsed.wifi.ssid : defaults.wifi.ssid,
        password,
        security: parsed.wifi?.security === "nopass" ? "nopass" : "WPA",
      },
      remoteSession,
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
    remoteSession: settings.remoteSession ? {
      ...settings.remoteSession,
      desktopToken: undefined,
      desktopTokenEncrypted: safeStorage.encryptString(settings.remoteSession.desktopToken).toString("base64"),
    } as PersistedFileSendSettings["remoteSession"] : undefined,
    cloudAuth: settings.cloudAuth ? {
      localId: settings.cloudAuth.localId,
      refreshTokenEncrypted: safeStorage.encryptString(settings.cloudAuth.refreshToken).toString("base64"),
    } : undefined,
  };
  await writeFile(settingsPath(), JSON.stringify(persisted, null, 2), "utf8");
}

function registerIpc(): void {
  ipcMain.handle("filex-send:get-snapshot", () => composeSnapshot());
  ipcMain.handle("filex-send:start-session", async (_event, label: unknown) => {
    currentMode = "local";
    await service.startSession(typeof label === "string" ? label : undefined);
    return composeSnapshot();
  });
  ipcMain.handle("filex-send:start-remote-session", async (_event, label: unknown, expiresAt: unknown) => {
    currentMode = "remote";
    await remoteClient.startSession(typeof label === "string" ? label : undefined, typeof expiresAt === "number" ? expiresAt : undefined);
    return composeSnapshot();
  });
  ipcMain.handle("filex-send:close-session", async () => {
    if (currentMode === "remote") await remoteClient.closeSession();
    else service.closeSession();
    currentMode = null;
    return composeSnapshot();
  });
  ipcMain.handle("filex-send:choose-output-root", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { title: "Scegli dove ricevere foto e video", properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return composeSnapshot();
    await service.setOutputRoot(result.filePaths[0]);
    remoteClient.setOutputRoot(result.filePaths[0]);
    settings.outputRoot = result.filePaths[0];
    await saveSettings();
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
    await saveSettings();
    service.setWifi(normalized, "manual");
    return composeSnapshot();
  });
  ipcMain.handle("filex-send:detect-wifi", () => refreshDetectedWifi());
  ipcMain.handle("filex-send:open-session-folder", async () => {
    const snapshot = composeSnapshot();
    const folderPath = snapshot.session?.folderPath ?? snapshot.outputRoot;
    const message = await shell.openPath(folderPath);
    return message ? { ok: false, message } : { ok: true };
  });
}

function composeSnapshot(): FileSendSnapshot {
  const local = service.snapshot();
  return {
    ...local,
    mode: currentMode,
    remoteAvailable: remoteClient?.isAvailable() ?? false,
    remoteError: remoteClient?.getError() ?? null,
    session: currentMode === "remote" ? remoteClient.getSession() : currentMode === "local" ? local.session : null,
  };
}

function emitSnapshot(): void {
  if (mainWindow && service && remoteClient) mainWindow.webContents.send("filex-send:snapshot", composeSnapshot());
}

async function refreshDetectedWifi() {
  const detected = await detectCurrentWifi();
  if (detected.wifi) {
    settings.wifi = detected.wifi;
    await saveSettings();
    service.setWifi(detected.wifi, "detected");
    return composeSnapshot();
  }
  const remembered = Boolean(settings.wifi.ssid) && (settings.wifi.security === "nopass" || settings.wifi.password.length >= 8);
  service.setWifi(settings.wifi, remembered ? "remembered" : "missing", detected.error);
  return composeSnapshot();
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    title: "FileX Send",
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
    settings = await readSettings();
    const detected = await detectCurrentWifi();
    if (detected.wifi) {
      settings.wifi = detected.wifi;
      await saveSettings();
    }
    const hasRememberedWifi = Boolean(settings.wifi.ssid) && (settings.wifi.security === "nopass" || settings.wifi.password.length >= 8);
    service = new FileSendService({
      outputRoot: settings.outputRoot,
      wifi: settings.wifi,
      wifiSource: detected.wifi ? "detected" : hasRememberedWifi ? "remembered" : "missing",
      wifiError: detected.wifi ? null : detected.error,
      onChange: () => emitSnapshot(),
    });
    await service.start();
    remoteClient = new FileSendRemoteClient({
      baseUrl: process.env.FILEX_SEND_REMOTE_URL ?? "https://gen-lang-client-0321087169.web.app",
      firebaseApiKey: "AIzaSyAilpdQ7nneAsZ8eKvOMPrEb7wS1axNUkQ",
      authState: settings.cloudAuth,
      outputRoot: settings.outputRoot,
      restoredSession: settings.remoteSession,
      onChange: () => {
        settings.remoteSession = remoteClient.exportSession();
        settings.cloudAuth = remoteClient.exportAuthState();
        void saveSettings();
        emitSnapshot();
      },
      onFilesReceived: (count, label) => {
        if (Notification.isSupported()) new Notification({ title: "FileX Send", body: `${count} ${count === 1 ? "file ricevuto" : "file ricevuti"} da ${label}.` }).show();
      },
    });
    if (settings.remoteSession) currentMode = "remote";
    remoteClient.resume();
    void remoteClient.checkAvailability();
    registerIpc();
    await createWindow();
  });
}

app.on("activate", () => { if (!mainWindow) void createWindow(); });
app.on("before-quit", () => { void service?.stop(); void remoteClient?.stop(); });
app.on("window-all-closed", () => app.quit());
