import { access, mkdir, open, rename, rm, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FileSendReceivedFile, FileSendSession } from "../src/contracts.js";
import { FirebaseAnonymousAuth, type FirebaseAnonymousAuthState } from "./firebase-anonymous-auth.js";

interface CreatedRemoteSession {
  sessionId: string;
  desktopToken: string;
  uploadUrl: string;
  expiresAt: number;
  retentionExpiresAt: number;
}

interface RemoteStatus {
  sessionId: string;
  label: string;
  expiresAt: number;
  retentionExpiresAt: number;
  clientCompleted: boolean;
  activeUploads: number;
  files: Array<FileSendReceivedFile & { downloadUrl?: string }>;
}

export interface PersistedRemoteSession extends FileSendSession {
  desktopToken: string;
}

export interface RemoteClientOptions {
  baseUrl: string;
  firebaseApiKey: string;
  authState?: FirebaseAnonymousAuthState | null;
  outputRoot: string;
  restoredSession?: PersistedRemoteSession | null;
  onChange?: () => void;
  onFilesReceived?: (count: number, label: string) => void;
}

export class FileSendRemoteClient {
  private outputRoot: string;
  private readonly baseUrl: string;
  private readonly auth: FirebaseAnonymousAuth;
  private readonly onChange?: () => void;
  private readonly onFilesReceived?: (count: number, label: string) => void;
  private session: (FileSendSession & { desktopToken: string }) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private error: string | null = null;
  private available = false;
  private downloading = new Set<string>();

  constructor(options: RemoteClientOptions) {
    this.outputRoot = options.outputRoot;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.onChange = options.onChange;
    this.onFilesReceived = options.onFilesReceived;
    this.auth = new FirebaseAnonymousAuth(options.firebaseApiKey, options.authState, this.onChange);
    if (options.restoredSession) {
      this.session = { ...options.restoredSession, receivedFiles: [...options.restoredSession.receivedFiles] };
    }
  }

  async checkAvailability(): Promise<boolean> {
    try {
      let response = await fetch(`${this.baseUrl}/api/health`, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok && this.baseUrl.startsWith("http://127.0.0.1")) response = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(5_000) });
      this.available = response.ok;
      this.error = response.ok ? null : "Servizio remoto non disponibile.";
    } catch {
      this.available = false;
      this.error = "FileX Send Remote non è ancora collegato a un server pubblico.";
    }
    this.onChange?.();
    return this.available;
  }

  setOutputRoot(outputRoot: string): void { this.outputRoot = outputRoot; }
  isAvailable(): boolean { return this.available; }
  getError(): string | null { return this.error; }
  exportSession(): PersistedRemoteSession | null {
    return this.session ? { ...this.session, receivedFiles: [...this.session.receivedFiles] } : null;
  }
  exportAuthState(): FirebaseAnonymousAuthState | null { return this.auth.exportState(); }
  resume(): void {
    if (!this.session || this.timer) return;
    this.timer = setInterval(() => void this.poll(), 5_000);
    void this.poll();
  }
  getSession(): FileSendSession | null {
    if (!this.session) return null;
    const { desktopToken: _desktopToken, ...session } = this.session;
    return { ...session, receivedFiles: [...session.receivedFiles] };
  }

  async startSession(label?: string, expiresAt?: number): Promise<FileSendSession> {
    if (!this.available && !await this.checkAvailability()) throw new Error(this.error ?? "Servizio remoto non disponibile.");
    const idToken = await this.auth.getIdToken();
    const response = await fetch(`${this.baseUrl}/api/sessions`, {
      method: "POST",
      headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
      body: JSON.stringify({ label, expiresAt }),
    });
    if (!response.ok) throw new Error(`Creazione sessione remota non riuscita (${response.status}).`);
    const created = await response.json() as CreatedRemoteSession;
    const createdAt = Date.now();
    const safeLabel = sanitizeLabel(label) || `Cliente-${new Date(createdAt).toTimeString().slice(0, 5).replace(":", "")}`;
    const folderPath = await createUniqueDirectory(this.outputRoot, `${formatDate(createdAt)}_${safeLabel}`);
    this.session = {
      id: created.sessionId,
      desktopToken: created.desktopToken,
      label: safeLabel.replaceAll("-", " "),
      uploadUrl: created.uploadUrl,
      folderPath,
      createdAt,
      expiresAt: created.expiresAt,
      retentionExpiresAt: created.retentionExpiresAt,
      receivedBytes: 0,
      receivedFiles: [],
      activeUploads: 0,
      activeUploadBytes: 0,
      clientCompleted: false,
    };
    this.error = null;
    this.timer = setInterval(() => void this.poll(), 5_000);
    await this.poll();
    return this.getSession()!;
  }

  async closeSession(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const session = this.session;
    this.session = null;
    this.onChange?.();
    if (!session) return;
    await fetch(`${this.baseUrl}/api/desktop/${session.id}`, { method: "DELETE", headers: auth(session.desktopToken) }).catch(() => undefined);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async poll(): Promise<void> {
    if (!this.session || this.polling) return;
    this.polling = true;
    const session = this.session;
    try {
      const response = await fetch(`${this.baseUrl}/api/desktop/${session.id}`, { headers: auth(session.desktopToken), signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`Sessione remota non raggiungibile (${response.status}).`);
      const status = await response.json() as RemoteStatus;
      session.clientCompleted = status.clientCompleted;
      session.activeUploads = status.activeUploads;
      session.expiresAt = status.expiresAt;
      session.retentionExpiresAt = status.retentionExpiresAt;
      let downloaded = 0;
      for (const file of status.files) {
        if (this.downloading.has(file.id)) continue;
        if (session.receivedFiles.some((item) => item.id === file.id)) {
          await this.acknowledgeFile(session, file.id);
          continue;
        }
        await this.downloadFile(session, file);
        downloaded += 1;
      }
      if (downloaded > 0) this.onFilesReceived?.(downloaded, session.label);
      this.error = null;
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      this.polling = false;
      this.onChange?.();
    }
  }

  private async downloadFile(session: FileSendSession & { desktopToken: string }, file: FileSendReceivedFile & { downloadUrl?: string }): Promise<void> {
    this.downloading.add(file.id);
    const { finalPath, partPath, fileName, handle } = await reserveDestination(session.folderPath, file.name);
    try {
      const response = await fetch(file.downloadUrl ?? `${this.baseUrl}/api/desktop/${session.id}/files/${file.id}`, { headers: file.downloadUrl ? undefined : auth(session.desktopToken) });
      if (!response.ok || !response.body) throw new Error(`Download di ${file.name} non riuscito.`);
      await pipeline(Readable.fromWeb(response.body as never), handle.createWriteStream());
      const receivedSize = (await stat(partPath)).size;
      if (receivedSize !== file.size) throw new Error(`Dimensione non valida per ${file.name}.`);
      await rename(partPath, finalPath);
      session.receivedFiles.push({ id: file.id, name: fileName, size: file.size, receivedAt: file.receivedAt });
      session.receivedBytes += file.size;
      await this.acknowledgeFile(session, file.id);
    } catch (cause) {
      await rm(partPath, { force: true });
      throw cause;
    } finally {
      this.downloading.delete(file.id);
    }
  }

  private async acknowledgeFile(session: FileSendSession & { desktopToken: string }, fileId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/desktop/${session.id}/files/${fileId}`, { method: "DELETE", headers: auth(session.desktopToken) });
    if (!response.ok) throw new Error("Conferma della consegna cloud non riuscita.");
  }
}

function auth(token: string): Record<string, string> { return { authorization: `Bearer ${token}` }; }
function sanitizeLabel(value?: string): string { return (value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9 _-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60); }
function sanitizeFileName(value: string): string { const extension = extname(basename(value)).slice(0, 16); const stem = basename(value, extname(basename(value))).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").trim().slice(0, 160); return `${stem || "foto"}${extension}`; }
function formatDate(timestamp: number): string { const date = new Date(timestamp); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}_${String(date.getHours()).padStart(2, "0")}-${String(date.getMinutes()).padStart(2, "0")}`; }
async function createUniqueDirectory(root: string, name: string): Promise<string> { await mkdir(root, { recursive: true }); for (let index = 1; index <= 999; index += 1) { const candidate = join(root, index === 1 ? name : `${name}-${index}`); try { await mkdir(candidate); return candidate; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; } } throw new Error("Impossibile creare la cartella."); }
async function reserveDestination(folderPath: string, originalName: string) { const safeName = sanitizeFileName(originalName); const extension = extname(safeName); const stem = basename(safeName, extension); for (let index = 1; index <= 9999; index += 1) { const fileName = index === 1 ? safeName : `${stem} (${index})${extension}`; const finalPath = join(folderPath, fileName); const partPath = `${finalPath}.filex-remote-part`; try { await access(finalPath); continue; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } try { const handle = await open(partPath, "wx"); return { finalPath, partPath, fileName, handle }; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; } } throw new Error("Troppi file duplicati."); }
