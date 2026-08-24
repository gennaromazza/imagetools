import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { access, mkdir, open, rename, rm, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { networkInterfaces } from "node:os";
import { basename, extname, join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import type { FileSendReceivedFile, FileSendSession, FileSendSnapshot, FileSendWifiConfig, FileSendWifiSource } from "../src/contracts.js";

const MAX_FILE_BYTES = 25 * 1024 * 1024 * 1024;
const MAX_FILE_NAME_LENGTH = 180;

interface ActiveUpload {
  bytes: number;
}

interface InternalSession extends FileSendSession {
  token: string;
  active: Map<string, ActiveUpload>;
  sharedPaths: Map<string, string>;
}

export interface FileSendServiceOptions {
  outputRoot: string;
  host?: string;
  port?: number;
  publicAddress?: string;
  onChange?: (snapshot: FileSendSnapshot) => void;
  wifi?: FileSendWifiConfig;
  wifiSource?: FileSendWifiSource;
  wifiError?: string | null;
}

export class FileSendService {
  private outputRoot: string;
  private readonly host: string;
  private readonly requestedPort: number;
  private readonly publicAddress?: string;
  private readonly onChange?: (snapshot: FileSendSnapshot) => void;
  private server: Server | null = null;
  private port: number | null = null;
  private readonly sessions = new Map<string, InternalSession>();
  private selectedSessionId: string | null = null;
  private lastEmitAt = 0;
  private wifi: FileSendWifiConfig;
  private wifiSource: FileSendWifiSource;
  private wifiError: string | null;

  constructor(options: FileSendServiceOptions) {
    this.outputRoot = options.outputRoot;
    this.host = options.host ?? "0.0.0.0";
    this.requestedPort = options.port ?? 0;
    this.publicAddress = options.publicAddress;
    this.onChange = options.onChange;
    this.wifi = options.wifi ?? { ssid: "FileX Send", password: "", security: "WPA" };
    this.wifiSource = options.wifiSource ?? "missing";
    this.wifiError = options.wifiError ?? null;
  }

  async start(): Promise<FileSendSnapshot> {
    if (this.server) return this.snapshot();
    await mkdir(this.outputRoot, { recursive: true });
    this.server = createServer((request, response) => {
      void this.route(request, response).catch((error: unknown) => {
        if (!response.headersSent) this.sendJson(response, 500, { error: "Errore durante la ricezione." });
        else response.destroy(error instanceof Error ? error : undefined);
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.requestedPort, this.host, () => resolve());
    });
    const address = this.server.address();
    this.port = typeof address === "object" && address ? address.port : this.requestedPort;
    this.emit(true);
    return this.snapshot();
  }

  async stop(): Promise<void> {
    this.sessions.clear();
    this.selectedSessionId = null;
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    this.port = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  async setOutputRoot(outputRoot: string): Promise<FileSendSnapshot> {
    if (this.sessions.size > 0) throw new Error("Termina i trasferimenti locali prima di cambiare cartella.");
    await mkdir(outputRoot, { recursive: true });
    this.outputRoot = outputRoot;
    this.emit(true);
    return this.snapshot();
  }

  setWifi(wifi: FileSendWifiConfig, source: FileSendWifiSource = "manual", error: string | null = null): FileSendSnapshot {
    this.wifi = normalizeWifi(wifi);
    this.wifiSource = source;
    this.wifiError = error;
    this.emit(true);
    return this.snapshot();
  }

  async startSession(label?: string): Promise<FileSendSnapshot> {
    if (!this.server || !this.port) await this.start();
    const createdAt = Date.now();
    const safeLabel = sanitizeLabel(label) || `Cliente-${String(new Date(createdAt).getHours()).padStart(2, "0")}${String(new Date(createdAt).getMinutes()).padStart(2, "0")}`;
    const folderName = `${formatDate(createdAt)}_${safeLabel}`;
    const folderPath = await createUniqueDirectory(this.outputRoot, folderName);
    const token = randomBytes(18).toString("base64url");
    const id = randomUUID();
    const address = this.publicAddress ?? listLanAddresses()[0] ?? "127.0.0.1";
    const session: InternalSession = {
      id,
      token,
      label: safeLabel.replaceAll("-", " "),
      direction: "receive",
      uploadUrl: `http://${address}:${this.port}/s/${token}`,
      folderPath,
      createdAt,
      receivedBytes: 0,
      receivedFiles: [],
      activeUploads: 0,
      activeUploadBytes: 0,
      active: new Map(),
      sharedPaths: new Map(),
      clientCompleted: false,
    };
    this.sessions.set(id, session);
    this.selectedSessionId = id;
    this.emit(true);
    return this.snapshot();
  }

  async startSendSession(filePaths: string[], label?: string): Promise<FileSendSnapshot> {
    if (!this.server || !this.port) await this.start();
    const createdAt = Date.now();
    const safeLabel = sanitizeLabel(label) || `Consegna-${String(new Date(createdAt).getHours()).padStart(2, "0")}${String(new Date(createdAt).getMinutes()).padStart(2, "0")}`;
    const token = randomBytes(18).toString("base64url");
    const id = randomUUID();
    const address = this.publicAddress ?? listLanAddresses()[0] ?? "127.0.0.1";
    const session: InternalSession = {
      id, token, direction: "send", label: safeLabel.replaceAll("-", " "),
      uploadUrl: `http://${address}:${this.port}/s/${token}`,
      folderPath: this.outputRoot, createdAt,
      receivedBytes: 0, receivedFiles: [],
      activeUploads: 0, activeUploadBytes: 0, active: new Map(), sharedPaths: new Map(), clientCompleted: false,
    };
    this.sessions.set(id, session);
    await this.addSendFiles(id, filePaths, false);
    this.selectedSessionId = id;
    this.emit(true);
    return this.snapshot();
  }

  selectSession(sessionId: string): FileSendSnapshot {
    if (!this.sessions.has(sessionId)) throw new Error("Sessione locale non trovata.");
    this.selectedSessionId = sessionId;
    return this.snapshot();
  }

  async addSendFiles(sessionId: string, filePaths: string[], emit = true): Promise<FileSendSnapshot> {
    const session = this.sessions.get(sessionId);
    if (!session || session.direction !== "send") throw new Error("Condivisione locale non trovata.");
    const existing = new Set(session.sharedPaths.values());
    const additions: Array<{ path: string; file: FileSendReceivedFile }> = [];
    for (const path of filePaths) {
      if (existing.has(path)) continue;
      const info = await stat(path);
      if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error(`File non valido o troppo grande: ${basename(path)}`);
      additions.push({ path, file: { id: randomUUID(), name: sanitizeFileName(basename(path)), size: info.size, receivedAt: Date.now() } });
    }
    for (const { path, file } of additions) { session.sharedPaths.set(file.id, path); session.receivedFiles.push(file); session.receivedBytes += file.size; }
    if (emit && additions.length) this.emit(true);
    return this.snapshot();
  }

  closeSession(sessionId: string): FileSendSnapshot {
    this.sessions.delete(sessionId);
    if (this.selectedSessionId === sessionId) this.selectedSessionId = this.sessions.keys().next().value ?? null;
    this.emit(true);
    return this.snapshot();
  }

  getSessions(): FileSendSession[] {
    return [...this.sessions.values()].map(publicSession);
  }

  getSession(sessionId?: string | null): FileSendSession | null {
    const session = this.sessions.get(sessionId ?? this.selectedSessionId ?? "");
    return session ? publicSession(session) : null;
  }

  snapshot(): FileSendSnapshot {
    const addresses = this.publicAddress ? [this.publicAddress] : listLanAddresses();
    return {
      mode: this.selectedSessionId ? "local" : null,
      remoteAvailable: false,
      remoteError: null,
      serverRunning: Boolean(this.server),
      port: this.port,
      networkAddresses: addresses,
      outputRoot: this.outputRoot,
      wifi: { ...this.wifi },
      wifiSource: this.wifiSource,
      wifiError: this.wifiError,
      session: this.getSession(),
      sessions: this.getSessions().map((session) => ({ mode: "local" as const, session })),
      history: [],
      warning: addresses.length === 0
        ? "Nessuna rete locale rilevata. Collega il PC alla rete FileX Send."
        : null,
    };
  }

  private emit(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastEmitAt < 200) return;
    this.lastEmitAt = now;
    this.onChange?.(this.snapshot());
  }

  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const pageMatch = url.pathname.match(/^\/s\/([A-Za-z0-9_-]+)$/);
    const uploadMatch = url.pathname.match(/^\/api\/session\/([A-Za-z0-9_-]+)\/files$/);
    const completeMatch = url.pathname.match(/^\/api\/session\/([A-Za-z0-9_-]+)\/complete$/);
    const downloadMatch = url.pathname.match(/^\/api\/session\/([A-Za-z0-9_-]+)\/downloads\/([0-9a-f-]{36})$/i);

    if (request.method === "GET" && url.pathname === "/health") {
      this.sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method === "GET" && pageMatch) {
      const session = this.sessionForToken(pageMatch[1]);
      if (!session) return this.sendExpired(response);
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(session.direction === "send" ? downloadPage(session, pageMatch[1]) : mobilePage(session.label, pageMatch[1]));
      return;
    }
    if (request.method === "GET" && downloadMatch) {
      const session = this.sessionForToken(downloadMatch[1]);
      if (!session) return this.sendExpired(response);
      const path = session.sharedPaths.get(downloadMatch[2]);
      const file = session.receivedFiles.find((candidate) => candidate.id === downloadMatch[2]);
      if (!path || !file || session.direction !== "send") return this.sendJson(response, 404, { error: "File non trovato." });
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(file.size),
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "cache-control": "no-store",
      });
      createReadStream(path).pipe(response);
      return;
    }
    if (request.method === "PUT" && uploadMatch) {
      const session = this.sessionForToken(uploadMatch[1]);
      if (!session) return this.sendExpired(response);
      await this.receiveFile(request, response, session);
      return;
    }
    if (request.method === "POST" && completeMatch) {
      const session = this.sessionForToken(completeMatch[1]);
      if (!session) return this.sendExpired(response);
      session.clientCompleted = true;
      this.emit(true);
      this.sendJson(response, 200, { ok: true });
      return;
    }
    this.sendJson(response, 404, { error: "Pagina non trovata." });
  }

  private sessionForToken(token: string): InternalSession | null {
    return [...this.sessions.values()].find((session) => session.token === token) ?? null;
  }

  private async receiveFile(request: IncomingMessage, response: ServerResponse, session: InternalSession): Promise<void> {
    const encodedName = headerValue(request.headers["x-file-name"]);
    const originalName = decodeHeader(encodedName);
    const contentLength = Number(headerValue(request.headers["content-length"]));
    if (!originalName) return this.sendJson(response, 400, { error: "Nome file mancante." });
    if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_FILE_BYTES) {
      return this.sendJson(response, 413, { error: "Dimensione file non valida o superiore a 25 GB." });
    }

    const uploadId = randomUUID();
    const { finalPath, partPath, fileName, handle } = await reserveDestination(session.folderPath, originalName);
    const active: ActiveUpload = { bytes: 0 };
    session.active.set(uploadId, active);
    this.syncActiveTotals(session);
    this.emit(true);

    try {
      await new Promise<void>((resolve, reject) => {
        const stream = handle.createWriteStream();
        request.on("data", (chunk: Buffer) => {
          active.bytes += chunk.length;
          if (active.bytes > MAX_FILE_BYTES) request.destroy(new Error("File troppo grande"));
          this.syncActiveTotals(session);
          this.emit();
        });
        request.once("aborted", () => reject(new Error("Upload interrotto")));
        request.once("error", reject);
        stream.once("error", reject);
        stream.once("finish", resolve);
        request.pipe(stream);
      });
      if (active.bytes !== contentLength) throw new Error("Dimensione ricevuta non corrispondente");
      await rename(partPath, finalPath);
      const receivedFile: FileSendReceivedFile = { id: uploadId, name: fileName, size: active.bytes, receivedAt: Date.now() };
      session.receivedFiles = [...session.receivedFiles, receivedFile];
      session.receivedBytes += active.bytes;
      session.active.delete(uploadId);
      this.syncActiveTotals(session);
      this.emit(true);
      this.sendJson(response, 201, { ok: true, file: receivedFile });
    } catch {
      session.active.delete(uploadId);
      this.syncActiveTotals(session);
      await rm(partPath, { force: true }).catch(() => undefined);
      this.emit(true);
      if (!response.headersSent) this.sendJson(response, 400, { error: "Trasferimento interrotto. Riprova il file." });
    }
  }

  private syncActiveTotals(session: InternalSession): void {
    session.activeUploads = session.active.size;
    session.activeUploadBytes = [...session.active.values()].reduce((sum, upload) => sum + upload.bytes, 0);
  }

  private sendExpired(response: ServerResponse): void {
    response.writeHead(410, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(expiredPage());
  }

  private sendJson(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify(body));
  }
}

function normalizeWifi(wifi: FileSendWifiConfig): FileSendWifiConfig {
  const ssid = wifi.ssid.trim().slice(0, 64);
  const security = wifi.security === "nopass" ? "nopass" : "WPA";
  return { ssid, security, password: security === "nopass" ? "" : wifi.password.slice(0, 63) };
}

function publicSession(session: InternalSession): FileSendSession {
  const { token: _token, active: _active, sharedPaths: _sharedPaths, ...value } = session;
  return { ...value, receivedFiles: [...value.receivedFiles] };
}

export function listLanAddresses(): string[] {
  const addresses = new Set<string>();
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal && isPrivateIpv4(entry.address)) addresses.add(entry.address);
    }
  }
  return [...addresses].sort((left, right) => scoreAddress(right) - scoreAddress(left));
}

function isPrivateIpv4(address: string): boolean {
  const [a, b] = address.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function scoreAddress(address: string): number {
  if (address.startsWith("192.168.")) return 3;
  if (address.startsWith("10.")) return 2;
  return 1;
}

function sanitizeLabel(value?: string): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

function sanitizeFileName(value: string): string {
  const extension = extname(basename(value)).slice(0, 16);
  const stem = basename(value, extname(basename(value)))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, MAX_FILE_NAME_LENGTH - extension.length);
  return `${stem || "foto"}${extension}`;
}

async function createUniqueDirectory(root: string, preferredName: string): Promise<string> {
  for (let index = 1; index <= 999; index += 1) {
    const candidate = join(root, index === 1 ? preferredName : `${preferredName}-${index}`);
    try {
      await mkdir(candidate);
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("Impossibile creare una nuova cartella di ricezione.");
}

async function reserveDestination(folderPath: string, originalName: string) {
  const safeName = sanitizeFileName(originalName);
  const extension = extname(safeName);
  const stem = basename(safeName, extension);
  for (let index = 1; index <= 9999; index += 1) {
    const fileName = index === 1 ? safeName : `${stem} (${index})${extension}`;
    const finalPath = join(folderPath, fileName);
    const partPath = `${finalPath}.filex-part`;
    try {
      await access(finalPath);
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      const handle = await open(partPath, "wx");
      return { finalPath, partPath, fileName, handle };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("Troppi file con lo stesso nome.");
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}_${String(date.getHours()).padStart(2, "0")}-${String(date.getMinutes()).padStart(2, "0")}`;
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function decodeHeader(value: string): string {
  try { return decodeURIComponent(value); } catch { return ""; }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]!);
}

function mobilePage(label: string, token: string): string {
  const page = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#101b2d"><title>Invia a FileX Send</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:linear-gradient(155deg,#0b1423,#142a43);color:#f8fafc;font-family:system-ui,-apple-system,sans-serif;padding:24px 18px}main{max-width:560px;margin:0 auto}.brand{font-weight:850;letter-spacing:.08em;color:#63e6be;margin:10px 0 34px}.card{background:#fff;color:#122033;border-radius:28px;padding:30px 24px;box-shadow:0 24px 70px #0007}h1{font-size:30px;line-height:1.08;margin:0 0 10px}p{color:#637086;line-height:1.5}.shop{font-weight:750;color:#122033}.pickers{display:grid;gap:10px;margin:25px 0 9px}.picker{display:flex;align-items:center;justify-content:center;gap:10px;text-align:left;background:#1167d8;color:#fff;font-weight:800;font-size:18px;padding:16px;border-radius:16px}.picker.secondary{background:#e7edf4;color:#213d5b}.picker small{display:block;font-size:12px;opacity:.75;margin-top:3px}.picker input{position:absolute;width:1px;height:1px;opacity:0}.help{font-size:13px;margin:0 2px 14px}.summary{min-height:28px;font-weight:700}.previews{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin:5px 0 12px}.preview{aspect-ratio:1;border-radius:10px;overflow:hidden;background:#e7edf4;display:grid;place-items:center;font-size:10px;text-align:center;word-break:break-word}.preview img,.preview video{width:100%;height:100%;object-fit:cover}.send{width:100%;border:0;border-radius:16px;background:#0db383;color:white;font-size:18px;font-weight:850;padding:17px}.send:disabled{opacity:.38}.progress{height:12px;background:#e7edf4;border-radius:99px;overflow:hidden;margin:22px 0 10px}.bar{height:100%;width:0;background:linear-gradient(90deg,#0db383,#55d9b2);transition:width .15s}.status{text-align:center;font-weight:750;color:#33445c}.done{text-align:center;padding:28px 0}.done .check{width:72px;height:72px;border-radius:50%;background:#0db383;color:#fff;font-size:42px;display:grid;place-items:center;margin:0 auto 18px}</style></head><body><main><div class="brand">FILEX SEND</div><section class="card" id="upload"><h1>Invia foto e video</h1><p>Consegna diretta a <span class="shop">${escapeHtml(label)}</span>. I file restano nella rete del negozio.</p><div class="pickers"><label class="picker"><span>▦</span><span>Scegli dalla galleria<small>Foto e video del telefono</small></span><input id="mediaFiles" type="file" accept="image/*,video/*" multiple></label><label class="picker secondary"><span>⌕</span><span>Sfoglia altri file<small>Download, cartelle e documenti</small></span><input id="otherFiles" type="file" multiple></label></div><p class="help">Puoi selezionare più elementi insieme. Su alcuni telefoni devi tenere premuta la prima foto.</p><div class="summary" id="summary">Nessun file selezionato</div><div class="previews" id="previews"></div><button class="send" id="send" disabled>Invia ora</button><div class="progress"><div class="bar" id="bar"></div></div><div class="status" id="status"></div></section><section class="card done" id="done" hidden><div class="check">✓</div><h1>Trasferimento completato</h1><p>Le foto sono arrivate. Puoi chiudere questa pagina.</p></section></main><script>
const token=${JSON.stringify(token)},inputs=[...document.querySelectorAll('#mediaFiles,#otherFiles')],send=document.querySelector('#send'),summary=document.querySelector('#summary'),previews=document.querySelector('#previews'),bar=document.querySelector('#bar'),status=document.querySelector('#status');let files=[];
const fmt=n=>n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':n<1073741824?(n/1048576).toFixed(1)+' MB':(n/1073741824).toFixed(1)+' GB';
inputs.forEach(input=>input.onchange=()=>{files=[...input.files];const total=files.reduce((s,f)=>s+f.size,0);summary.textContent=files.length?files.length+' file · '+fmt(total):'Nessun file selezionato';send.disabled=!files.length;previews.replaceChildren(...files.slice(0,8).map(file=>{const item=document.createElement('div');item.className='preview';if(file.type.startsWith('image/')||file.type.startsWith('video/')){const media=document.createElement(file.type.startsWith('video/')?'video':'img'),url=URL.createObjectURL(file);media.src=url;media.alt=file.name;media.onload=media.onloadeddata=()=>URL.revokeObjectURL(url);item.append(media)}else item.textContent=file.name;return item}));inputs.forEach(other=>{if(other!==input)other.value=''})});
function upload(file,onprogress){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('PUT','/api/session/'+token+'/files');xhr.setRequestHeader('X-File-Name',encodeURIComponent(file.name));xhr.upload.onprogress=e=>onprogress(e.loaded);xhr.onload=()=>xhr.status===201?resolve():reject(new Error('Invio non riuscito'));xhr.onerror=()=>reject(new Error('Connessione interrotta'));xhr.send(file)})}
send.onclick=async()=>{send.disabled=true;inputs.forEach(input=>input.disabled=true);const total=files.reduce((s,f)=>s+f.size,0);let complete=0;try{for(let i=0;i<files.length;i++){const f=files[i];status.textContent='Invio '+(i+1)+' di '+files.length+' · '+f.name;await upload(f,n=>{bar.style.width=((complete+n)/total*100)+'%'});complete+=f.size}await fetch('/api/session/'+token+'/complete',{method:'POST'});document.querySelector('#upload').hidden=true;document.querySelector('#done').hidden=false}catch(e){status.textContent=e.message+' Tocca “Invia ora” per riprovare.';send.disabled=false;inputs.forEach(input=>input.disabled=false)}};
</script></body></html>`;
  return page
    .replace('Invia foto e video', 'Invia file')
    .replace('Foto e video del telefono', 'Foto, video, documenti e qualsiasi altro file')
    .replace('accept="image/*,video/*"', 'accept="*/*"')
    .replace('Le foto sono arrivate.', 'I file sono arrivati.');
}

function expiredPage(): string {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sessione terminata</title><style>body{font-family:system-ui;background:#0f1b2d;color:white;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:30px}main{max-width:420px}h1{font-size:34px}p{color:#b9c7da;font-size:18px}</style></head><body><main><h1>Sessione terminata</h1><p>Chiedi al fotografo di creare un nuovo trasferimento e scansiona il nuovo QR code.</p></main></body></html>`;
}

function downloadPage(session: InternalSession, token: string): string {
  const files = session.receivedFiles.map((file) => `<li><div><strong>${escapeHtml(file.name)}</strong><small>${formatFileSize(file.size)}</small></div><a href="/api/session/${token}/downloads/${file.id}" download>Scarica</a></li>`).join("");
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#101b2d"><title>File da FileX Send</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;background:linear-gradient(155deg,#0b1423,#142a43);font-family:system-ui,-apple-system,sans-serif;color:#fff;padding:24px 18px}main{max-width:560px;margin:auto}.brand{font-weight:900;letter-spacing:.08em;color:#63e6be;margin:10px 0 30px}.card{background:#fff;color:#122033;border-radius:28px;padding:28px 23px;box-shadow:0 24px 70px #0007}h1{font-size:30px;line-height:1.08;margin:0 0 10px}p{color:#637086;line-height:1.5}ul{list-style:none;padding:0;margin:24px 0 0}li{display:flex;align-items:center;gap:12px;padding:15px 0;border-top:1px solid #e2e9ef}li div{min-width:0;flex:1}strong,small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}small{color:#75869a;margin-top:4px}a{background:#1167d8;color:#fff;text-decoration:none;font-weight:850;padding:11px 14px;border-radius:12px}</style></head><body><main><div class="brand">FILEX SEND</div><section class="card"><h1>File pronti per te</h1><p><strong>${escapeHtml(session.label)}</strong> ha condiviso ${session.receivedFiles.length} ${session.receivedFiles.length === 1 ? "file" : "file"}. Tocca Scarica accanto a ogni elemento.</p><ul>${files}</ul></section></main></body></html>`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
