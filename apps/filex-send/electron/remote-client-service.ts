import { access, mkdir, open, rename, rm, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
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

interface RemoteOwnedSession {
  sessionId: string;
  direction: "receive" | "send";
  label: string;
  createdAt: number;
  expiresAt: number;
  retentionExpiresAt: number;
  clientCompleted: boolean;
  activeUploads: number;
  receivedBytes: number;
  receivedFiles: number;
}

interface RestoredRemoteSession extends RemoteOwnedSession {
  desktopToken: string;
}

export interface PersistedRemoteSession extends FileSendSession {
  desktopToken: string;
}

export interface RemoteClientOptions {
  baseUrl: string;
  firebaseApiKey: string;
  authState?: FirebaseAnonymousAuthState | null;
  outputRoot: string;
  restoredSessions?: PersistedRemoteSession[];
  onChange?: () => void;
  onFilesReceived?: (count: number, label: string) => void;
}

export class FileSendRemoteClient {
  private outputRoot: string;
  private readonly baseUrl: string;
  private readonly auth: FirebaseAnonymousAuth;
  private readonly onChange?: () => void;
  private readonly onFilesReceived?: (count: number, label: string) => void;
  private readonly sessions = new Map<string, FileSendSession & { desktopToken: string }>();
  private timer: NodeJS.Timeout | null = null;
  private readonly polling = new Set<string>();
  private error: string | null = null;
  private available = false;
  private downloading = new Set<string>();

  constructor(options: RemoteClientOptions) {
    this.outputRoot = options.outputRoot;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.onChange = options.onChange;
    this.onFilesReceived = options.onFilesReceived;
    this.auth = new FirebaseAnonymousAuth(options.firebaseApiKey, options.authState, this.onChange);
    for (const restored of options.restoredSessions ?? []) {
      this.sessions.set(restored.id, { ...restored, direction: restored.direction ?? "receive", receivedFiles: [...restored.receivedFiles] });
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
  exportSessions(): PersistedRemoteSession[] {
    return [...this.sessions.values()].map((session) => ({ ...session, receivedFiles: [...session.receivedFiles] }));
  }
  exportAuthState(): FirebaseAnonymousAuthState | null { return this.auth.exportState(); }
  resume(): void {
    this.ensureTimer();
    void this.restoreAndPoll();
  }
  getSession(sessionId: string): FileSendSession | null {
    const stored = this.sessions.get(sessionId);
    if (!stored) return null;
    const { desktopToken: _desktopToken, ...session } = stored;
    return { ...session, receivedFiles: [...session.receivedFiles] };
  }
  getSessions(): FileSendSession[] { return [...this.sessions.keys()].map((id) => this.getSession(id)!); }

  private async restoreAndPoll(): Promise<void> {
    await this.restoreSessions();
    await this.pollAll();
  }

  private async restoreSessions(): Promise<void> {
    try {
      const idToken = await this.auth.getIdToken();
      const listed = await fetch(`${this.baseUrl}/api/sessions`, { headers: auth(idToken), signal: AbortSignal.timeout(10_000) });
      if (!listed.ok) throw new Error(`Recupero sessioni non riuscito (${listed.status}).`);
      const payload = await listed.json() as { sessions?: RemoteOwnedSession[] };
      for (const remote of payload.sessions ?? []) {
        if (this.sessions.has(remote.sessionId)) continue;
        const restoredResponse = await fetch(`${this.baseUrl}/api/sessions/${remote.sessionId}/restore`, { method: "POST", headers: auth(idToken), signal: AbortSignal.timeout(10_000) });
        if (!restoredResponse.ok) continue;
        const restored = await restoredResponse.json() as RestoredRemoteSession;
        const createdAt = restored.createdAt || Date.now();
        const safeLabel = sanitizeLabel(restored.label) || `Cliente-${new Date(createdAt).toTimeString().slice(0, 5).replace(":", "")}`;
        const folderPath = restored.direction === "receive"
          ? await createUniqueDirectory(this.outputRoot, `${formatDate(createdAt)}_${safeLabel}`)
          : this.outputRoot;
        this.sessions.set(restored.sessionId, {
          id: restored.sessionId,
          direction: restored.direction,
          desktopToken: restored.desktopToken,
          label: safeLabel.replaceAll("-", " "),
          uploadUrl: "",
          folderPath,
          createdAt,
          expiresAt: restored.expiresAt,
          retentionExpiresAt: restored.retentionExpiresAt,
          receivedBytes: restored.receivedBytes ?? 0,
          receivedFiles: [],
          activeUploads: restored.activeUploads ?? 0,
          activeUploadBytes: 0,
          clientCompleted: restored.clientCompleted,
        });
      }
      this.error = null;
      this.onChange?.();
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : String(cause);
      this.onChange?.();
    }
  }

  async startSession(label?: string, expiresAt?: number): Promise<FileSendSession> {
    if (!this.available && !await this.checkAvailability()) throw new Error(this.error ?? "Servizio remoto non disponibile.");
    const idToken = await this.auth.getIdToken();
    const response = await fetch(`${this.baseUrl}/api/sessions`, {
      method: "POST",
      headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
      body: JSON.stringify({ label, expiresAt, direction: "receive" }),
    });
    if (!response.ok) throw new Error(`Creazione sessione remota non riuscita (${response.status}).`);
    const created = await response.json() as CreatedRemoteSession;
    const createdAt = Date.now();
    const safeLabel = sanitizeLabel(label) || `Cliente-${new Date(createdAt).toTimeString().slice(0, 5).replace(":", "")}`;
    const folderPath = await createUniqueDirectory(this.outputRoot, `${formatDate(createdAt)}_${safeLabel}`);
    const session: FileSendSession & { desktopToken: string } = {
      id: created.sessionId,
      direction: "receive",
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
    this.sessions.set(session.id, session);
    this.error = null;
    this.ensureTimer();
    await this.poll(session);
    return this.getSession(session.id)!;
  }

  async startSendSession(filePaths: string[], label?: string, expiresAt?: number): Promise<FileSendSession> {
    if (!this.available && !await this.checkAvailability()) throw new Error(this.error ?? "Servizio remoto non disponibile.");
    const idToken = await this.auth.getIdToken();
    const response = await fetch(`${this.baseUrl}/api/sessions`, {
      method: "POST",
      headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
      body: JSON.stringify({ label, expiresAt, direction: "send" }),
    });
    if (!response.ok) throw new Error(`Creazione condivisione remota non riuscita (${response.status}).`);
    const created = await response.json() as CreatedRemoteSession;
    const createdAt = Date.now();
    const safeLabel = sanitizeLabel(label) || `Consegna-${new Date(createdAt).toTimeString().slice(0, 5).replace(":", "")}`;
    const session: FileSendSession & { desktopToken: string } = {
      id: created.sessionId, desktopToken: created.desktopToken, direction: "send",
      label: safeLabel.replaceAll("-", " "), uploadUrl: created.uploadUrl, folderPath: this.outputRoot,
      createdAt, expiresAt: created.expiresAt, retentionExpiresAt: created.retentionExpiresAt,
      receivedBytes: 0, receivedFiles: [], activeUploads: 0, activeUploadBytes: 0, clientCompleted: false,
    };
    this.sessions.set(session.id, session);
    await this.addSendFiles(session.id, filePaths, false);
    this.ensureTimer();
    this.onChange?.();
    return this.getSession(session.id)!;
  }

  async addSendFiles(sessionId: string, filePaths: string[], notify = true): Promise<FileSendSession> {
    const session = this.sessions.get(sessionId);
    if (!session || session.direction !== "send") throw new Error("Condivisione Internet non trovata.");
    const credential = session.uploadUrl.split("/r/").pop()!;
    for (const path of filePaths) {
      const info = await stat(path);
      const name = sanitizeFileName(basename(path));
      if (!info.isFile() || info.size > 25 * 1024 * 1024 * 1024) throw new Error(`File non valido o troppo grande: ${name}`);
      const pendingResponse = await fetch(`${this.baseUrl}/api/public/${encodeURIComponent(credential)}/uploads`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, size: info.size, contentType: "application/octet-stream" }),
      });
      if (!pendingResponse.ok) throw new Error(`Preparazione di ${name} non riuscita.`);
      const pending = await pendingResponse.json() as { fileId: string; uploadUrl: string };
      const body = Readable.toWeb(createReadStream(path)) as BodyInit;
      const uploaded = await fetch(pending.uploadUrl, { method: "PUT", headers: { "content-type": "application/octet-stream", "content-range": `bytes 0-${info.size - 1}/${info.size}` }, body, duplex: "half" } as RequestInit & { duplex: "half" });
      if (!uploaded.ok) throw new Error(`Caricamento di ${name} non riuscito.`);
      const completed = await fetch(`${this.baseUrl}/api/public/${encodeURIComponent(credential)}/uploads/${pending.fileId}/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!completed.ok) throw new Error(`Conferma di ${name} non riuscita.`);
      session.receivedFiles.push({ id: pending.fileId, name, size: info.size, receivedAt: Date.now() });
      session.receivedBytes += info.size;
      if (notify) this.onChange?.();
    }
    return this.getSession(session.id)!;
  }

  async updateExpiry(sessionId: string, expiresAt: number): Promise<FileSendSession> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Sessione Internet non trovata.");
    const response = await fetch(`${this.baseUrl}/api/desktop/${session.id}`, { method: "PATCH", headers: { ...auth(session.desktopToken), "content-type": "application/json" }, body: JSON.stringify({ expiresAt }) });
    if (!response.ok) throw new Error("Aggiornamento della scadenza non riuscito.");
    const updated = await response.json() as { expiresAt: number; retentionExpiresAt: number };
    session.expiresAt = updated.expiresAt;
    session.retentionExpiresAt = updated.retentionExpiresAt;
    session.clientCompleted = false;
    this.onChange?.();
    return this.getSession(session.id)!;
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId) ?? null;
    this.sessions.delete(sessionId);
    if (this.sessions.size === 0 && this.timer) clearInterval(this.timer);
    if (this.sessions.size === 0) this.timer = null;
    this.onChange?.();
    if (!session) return;
    await fetch(`${this.baseUrl}/api/desktop/${session.id}`, { method: "DELETE", headers: auth(session.desktopToken) }).catch(() => undefined);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private ensureTimer(): void {
    if (!this.timer) this.timer = setInterval(() => void this.pollAll(), 5_000);
  }

  private async pollAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => this.poll(session)));
  }

  private async poll(session: FileSendSession & { desktopToken: string }): Promise<void> {
    if (!this.sessions.has(session.id) || this.polling.has(session.id)) return;
    this.polling.add(session.id);
    try {
      const response = await fetch(`${this.baseUrl}/api/desktop/${session.id}`, { headers: auth(session.desktopToken), signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`Sessione remota non raggiungibile (${response.status}).`);
      const status = await response.json() as RemoteStatus;
      session.clientCompleted = status.clientCompleted;
      session.activeUploads = status.activeUploads;
      session.expiresAt = status.expiresAt;
      session.retentionExpiresAt = status.retentionExpiresAt;
      if (session.direction === "send") {
        session.receivedFiles = status.files.map(({ id, name, size, receivedAt }) => ({ id, name, size, receivedAt }));
        session.receivedBytes = session.receivedFiles.reduce((total, file) => total + file.size, 0);
        this.error = null;
        return;
      }
      let downloaded = 0;
      for (const file of status.files) {
        if (this.downloading.has(`${session.id}:${file.id}`)) continue;
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
      this.polling.delete(session.id);
      this.onChange?.();
    }
  }

  private async downloadFile(session: FileSendSession & { desktopToken: string }, file: FileSendReceivedFile & { downloadUrl?: string }): Promise<void> {
    const downloadKey = `${session.id}:${file.id}`;
    this.downloading.add(downloadKey);
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
      this.downloading.delete(downloadKey);
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
