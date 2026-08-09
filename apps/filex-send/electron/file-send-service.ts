import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { access, mkdir, open, rename, rm } from "node:fs/promises";
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
  private session: InternalSession | null = null;
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
    this.session = null;
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    this.port = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  async setOutputRoot(outputRoot: string): Promise<FileSendSnapshot> {
    if (this.session) throw new Error("Termina il trasferimento prima di cambiare cartella.");
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
    this.session = {
      id,
      token,
      label: safeLabel.replaceAll("-", " "),
      uploadUrl: `http://${address}:${this.port}/s/${token}`,
      folderPath,
      createdAt,
      receivedBytes: 0,
      receivedFiles: [],
      activeUploads: 0,
      activeUploadBytes: 0,
      active: new Map(),
      clientCompleted: false,
    };
    this.emit(true);
    return this.snapshot();
  }

  closeSession(): FileSendSnapshot {
    this.session = null;
    this.emit(true);
    return this.snapshot();
  }

  snapshot(): FileSendSnapshot {
    const addresses = this.publicAddress ? [this.publicAddress] : listLanAddresses();
    return {
      mode: this.session ? "local" : null,
      remoteAvailable: false,
      remoteError: null,
      serverRunning: Boolean(this.server),
      port: this.port,
      networkAddresses: addresses,
      outputRoot: this.outputRoot,
      wifi: { ...this.wifi },
      wifiSource: this.wifiSource,
      wifiError: this.wifiError,
      session: this.session ? publicSession(this.session) : null,
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

    if (request.method === "GET" && url.pathname === "/health") {
      this.sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method === "GET" && pageMatch) {
      if (!this.isActiveToken(pageMatch[1])) return this.sendExpired(response);
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(mobilePage(this.session!.label, pageMatch[1]));
      return;
    }
    if (request.method === "PUT" && uploadMatch) {
      if (!this.isActiveToken(uploadMatch[1])) return this.sendExpired(response);
      await this.receiveFile(request, response);
      return;
    }
    if (request.method === "POST" && completeMatch) {
      if (!this.isActiveToken(completeMatch[1])) return this.sendExpired(response);
      this.session!.clientCompleted = true;
      this.emit(true);
      this.sendJson(response, 200, { ok: true });
      return;
    }
    this.sendJson(response, 404, { error: "Pagina non trovata." });
  }

  private isActiveToken(token: string): boolean {
    return Boolean(this.session && this.session.token === token);
  }

  private async receiveFile(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const session = this.session!;
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
  const { token: _token, active: _active, ...value } = session;
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
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#101b2d"><title>Invia a FileX Send</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:linear-gradient(155deg,#0b1423,#142a43);color:#f8fafc;font-family:system-ui,-apple-system,sans-serif;padding:24px 18px}main{max-width:560px;margin:0 auto}.brand{font-weight:850;letter-spacing:.08em;color:#63e6be;margin:10px 0 34px}.card{background:#fff;color:#122033;border-radius:28px;padding:30px 24px;box-shadow:0 24px 70px #0007}h1{font-size:30px;line-height:1.08;margin:0 0 10px}p{color:#637086;line-height:1.5}.shop{font-weight:750;color:#122033}.picker{display:block;text-align:center;background:#1167d8;color:#fff;font-weight:800;font-size:18px;padding:18px;border-radius:16px;margin:25px 0 14px}.picker input{display:none}.summary{min-height:28px;font-weight:700}.send{width:100%;border:0;border-radius:16px;background:#0db383;color:white;font-size:18px;font-weight:850;padding:17px}.send:disabled{opacity:.38}.progress{height:12px;background:#e7edf4;border-radius:99px;overflow:hidden;margin:22px 0 10px}.bar{height:100%;width:0;background:linear-gradient(90deg,#0db383,#55d9b2);transition:width .15s}.status{text-align:center;font-weight:750;color:#33445c}.done{text-align:center;padding:28px 0}.done .check{width:72px;height:72px;border-radius:50%;background:#0db383;color:#fff;font-size:42px;display:grid;place-items:center;margin:0 auto 18px}</style></head><body><main><div class="brand">FILEX SEND</div><section class="card" id="upload"><h1>Invia foto e video</h1><p>Consegna diretta a <span class="shop">${escapeHtml(label)}</span>. I file restano nella rete del negozio.</p><label class="picker">Scegli foto e video<input id="files" type="file" accept="image/*,video/*" multiple></label><div class="summary" id="summary">Nessun file selezionato</div><button class="send" id="send" disabled>Invia ora</button><div class="progress"><div class="bar" id="bar"></div></div><div class="status" id="status"></div></section><section class="card done" id="done" hidden><div class="check">✓</div><h1>Trasferimento completato</h1><p>Le foto sono arrivate. Puoi chiudere questa pagina.</p></section></main><script>
const token=${JSON.stringify(token)},input=document.querySelector('#files'),send=document.querySelector('#send'),summary=document.querySelector('#summary'),bar=document.querySelector('#bar'),status=document.querySelector('#status');let files=[];
const fmt=n=>n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':n<1073741824?(n/1048576).toFixed(1)+' MB':(n/1073741824).toFixed(1)+' GB';
input.onchange=()=>{files=[...input.files];const total=files.reduce((s,f)=>s+f.size,0);summary.textContent=files.length?files.length+' file · '+fmt(total):'Nessun file selezionato';send.disabled=!files.length};
function upload(file,onprogress){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('PUT','/api/session/'+token+'/files');xhr.setRequestHeader('X-File-Name',encodeURIComponent(file.name));xhr.upload.onprogress=e=>onprogress(e.loaded);xhr.onload=()=>xhr.status===201?resolve():reject(new Error('Invio non riuscito'));xhr.onerror=()=>reject(new Error('Connessione interrotta'));xhr.send(file)})}
send.onclick=async()=>{send.disabled=true;input.disabled=true;const total=files.reduce((s,f)=>s+f.size,0);let complete=0;try{for(let i=0;i<files.length;i++){const f=files[i];status.textContent='Invio '+(i+1)+' di '+files.length+' · '+f.name;await upload(f,n=>{bar.style.width=((complete+n)/total*100)+'%'});complete+=f.size}await fetch('/api/session/'+token+'/complete',{method:'POST'});document.querySelector('#upload').hidden=true;document.querySelector('#done').hidden=false}catch(e){status.textContent=e.message+' Tocca “Invia ora” per riprovare.';send.disabled=false;input.disabled=false}};
</script></body></html>`;
}

function expiredPage(): string {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sessione terminata</title><style>body{font-family:system-ui;background:#0f1b2d;color:white;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:30px}main{max-width:420px}h1{font-size:34px}p{color:#b9c7da;font-size:18px}</style></head><body><main><h1>Sessione terminata</h1><p>Chiedi al fotografo di creare un nuovo trasferimento e scansiona il nuovo QR code.</p></main></body></html>`;
}
