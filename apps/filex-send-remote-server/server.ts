import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

const MAX_FILE_BYTES = 25 * 1024 * 1024 * 1024;

interface RemoteFile {
  id: string;
  name: string;
  size: number;
  receivedAt: number;
  path: string;
  contentType: string;
}

interface RemoteSession {
  id: string;
  publicToken: string;
  desktopToken: string;
  label: string;
  createdAt: number;
  expiresAt: number;
  clientCompleted: boolean;
  files: RemoteFile[];
  activeUploads: number;
  folderPath: string;
}

export interface RemoteServerOptions {
  dataDir: string;
  host?: string;
  port?: number;
  publicBaseUrl?: string;
  createToken?: string;
  ttlMs?: number;
}

export class FileXSendRemoteServer {
  private readonly options: Required<RemoteServerOptions>;
  private readonly sessions = new Map<string, RemoteSession>();
  private server: Server | null = null;
  private actualPort = 0;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(options: RemoteServerOptions) {
    this.options = {
      dataDir: options.dataDir,
      host: options.host ?? "127.0.0.1",
      port: options.port ?? 4355,
      publicBaseUrl: options.publicBaseUrl ?? "",
      createToken: options.createToken ?? "filex-send-development",
      ttlMs: options.ttlMs ?? 24 * 60 * 60 * 1000,
    };
  }

  async start(): Promise<string> {
    await mkdir(this.options.dataDir, { recursive: true });
    this.server = createServer((request, response) => void this.route(request, response).catch(() => this.json(response, 500, { error: "Errore del servizio." })));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.options.port, this.options.host, () => resolve());
    });
    const address = this.server.address();
    this.actualPort = typeof address === "object" && address ? address.port : this.options.port;
    this.sweepTimer = setInterval(() => void this.sweepExpired(), 60_000);
    return this.baseUrl();
  }

  async stop(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private baseUrl(): string {
    return this.options.publicBaseUrl.replace(/\/+$/, "") || `http://127.0.0.1:${this.actualPort}`;
  }

  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const page = url.pathname.match(/^\/r\/([A-Za-z0-9_-]+)$/);
    const upload = url.pathname.match(/^\/api\/public\/([A-Za-z0-9_-]+)\/files$/);
    const complete = url.pathname.match(/^\/api\/public\/([A-Za-z0-9_-]+)\/complete$/);
    const status = url.pathname.match(/^\/api\/desktop\/([A-Za-z0-9_-]+)$/);
    const download = url.pathname.match(/^\/api\/desktop\/([A-Za-z0-9_-]+)\/files\/([A-Za-z0-9_-]+)$/);

    if (request.method === "GET" && url.pathname === "/health") return this.json(response, 200, { ok: true });
    if (request.method === "POST" && url.pathname === "/api/sessions") return this.createSession(request, response);
    if (request.method === "GET" && page) {
      const session = this.byPublicToken(page[1]);
      if (!session) return this.expired(response);
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(remotePage(session.label, session.publicToken));
      return;
    }
    if (request.method === "PUT" && upload) {
      const session = this.byPublicToken(upload[1]);
      if (!session) return this.json(response, 410, { error: "Sessione scaduta." });
      return this.receiveFile(session, request, response);
    }
    if (request.method === "POST" && complete) {
      const session = this.byPublicToken(complete[1]);
      if (!session) return this.json(response, 410, { error: "Sessione scaduta." });
      session.clientCompleted = true;
      return this.json(response, 200, { ok: true });
    }
    if (status) {
      const session = this.authorizedSession(status[1], request);
      if (!session) return this.json(response, 401, { error: "Non autorizzato." });
      if (request.method === "GET") return this.json(response, 200, publicStatus(session));
      if (request.method === "DELETE") {
        await this.deleteSession(session);
        return this.json(response, 200, { ok: true });
      }
    }
    if (download) {
      const session = this.authorizedSession(download[1], request);
      const file = session?.files.find((item) => item.id === download[2]);
      if (!session || !file) return this.json(response, 404, { error: "File non trovato." });
      if (request.method === "GET") {
        response.writeHead(200, {
          "content-type": file.contentType || inferContentType(file.name),
          "content-length": file.size,
          "content-disposition": `attachment; filename="${sanitizeDownloadFileName(file.name)}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        });
        createReadStream(file.path).pipe(response);
        return;
      }
      if (request.method === "DELETE") {
        await rm(file.path, { force: true });
        session.files = session.files.filter((item) => item.id !== file.id);
        return this.json(response, 200, { ok: true });
      }
    }
    this.json(response, 404, { error: "Pagina non trovata." });
  }

  private async createSession(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (bearer(request) !== this.options.createToken) return this.json(response, 401, { error: "Non autorizzato." });
    const body = await readJson(request);
    const id = randomUUID();
    const publicToken = token();
    const desktopToken = token();
    const folderPath = join(this.options.dataDir, id);
    await mkdir(folderPath, { recursive: true });
    const session: RemoteSession = {
      id, publicToken, desktopToken, folderPath,
      label: typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 80) : "FileX Send",
      createdAt: Date.now(), expiresAt: Date.now() + this.options.ttlMs,
      clientCompleted: false, files: [], activeUploads: 0,
    };
    this.sessions.set(id, session);
    this.json(response, 201, { sessionId: id, desktopToken, uploadUrl: `${this.baseUrl()}/r/${publicToken}`, expiresAt: session.expiresAt });
  }

  private async receiveFile(session: RemoteSession, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const rawName = decodeHeader(single(request.headers["x-file-name"]));
    const expectedSize = Number(single(request.headers["content-length"]));
    if (!rawName || !Number.isFinite(expectedSize) || expectedSize < 0 || expectedSize > MAX_FILE_BYTES) return this.json(response, 413, { error: "File non valido." });
    const fileName = sanitizeName(rawName);
    const contentType = contentTypeFromHeader(single(request.headers["content-type"]), fileName);
    const id = randomUUID();
    const partPath = join(session.folderPath, `${id}.part`);
    const finalPath = join(session.folderPath, id);
    const handle = await open(partPath, "wx");
    let received = 0;
    session.activeUploads += 1;
    try {
      await new Promise<void>((resolve, reject) => {
        const stream = handle.createWriteStream();
        request.on("data", (chunk: Buffer) => { received += chunk.length; if (received > MAX_FILE_BYTES) request.destroy(); });
        request.once("aborted", () => reject(new Error("Interrotto")));
        request.once("error", reject);
        stream.once("error", reject);
        stream.once("finish", resolve);
        request.pipe(stream);
      });
      if (received !== expectedSize) throw new Error("Dimensione incompleta");
      await rename(partPath, finalPath);
      session.files.push({ id, name: fileName, size: received, receivedAt: Date.now(), path: finalPath, contentType });
      this.json(response, 201, { ok: true, id });
    } catch {
      await rm(partPath, { force: true });
      this.json(response, 400, { error: "Invio interrotto." });
    } finally {
      session.activeUploads -= 1;
    }
  }

  private byPublicToken(value: string): RemoteSession | null {
    return [...this.sessions.values()].find((session) => session.publicToken === value && session.expiresAt > Date.now()) ?? null;
  }

  private authorizedSession(id: string, request: IncomingMessage): RemoteSession | null {
    const session = this.sessions.get(id);
    return session && session.desktopToken === bearer(request) && session.expiresAt > Date.now() ? session : null;
  }

  private async sweepExpired(): Promise<void> {
    for (const session of this.sessions.values()) if (session.expiresAt <= Date.now()) await this.deleteSession(session);
  }

  private async deleteSession(session: RemoteSession): Promise<void> {
    this.sessions.delete(session.id);
    await rm(session.folderPath, { recursive: true, force: true });
  }

  private json(response: ServerResponse, status: number, value: unknown): void {
    if (response.headersSent) return;
    response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify(value));
  }

  private expired(response: ServerResponse): void {
    response.writeHead(410, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><title>Sessione terminata</title><body style='font-family:system-ui;background:#0b1827;color:white;text-align:center;padding:15vh 20px'><h1>Sessione terminata</h1><p>Chiedi al fotografo un nuovo link FileX Send.</p></body>");
  }
}

function publicStatus(session: RemoteSession) {
  return { sessionId: session.id, label: session.label, expiresAt: session.expiresAt, clientCompleted: session.clientCompleted, activeUploads: session.activeUploads, files: session.files.map(({ path: _path, ...file }) => file) };
}

function bearer(request: IncomingMessage): string {
  return (request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
}

function token(): string { return randomBytes(24).toString("base64url"); }
function single(value: string | string[] | undefined): string { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
function decodeHeader(value: string): string { try { return decodeURIComponent(value); } catch { return ""; } }
function sanitizeName(value: string): string {
  const extension = extname(basename(value)).slice(0, 16);
  const stem = basename(value, extname(basename(value))).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").trim().slice(0, 160);
  return `${stem || "foto"}${extension}`;
}
function contentTypeFromHeader(value: string, fileName: string): string {
  const normalized = value.split(";")[0].trim();
  return normalized || inferContentType(fileName);
}
function inferContentType(fileName: string): string {
  const extension = extname(fileName).toLowerCase();
  return MIME_TYPES[extension] ?? "application/octet-stream";
}
function sanitizeDownloadFileName(value: string): string {
  return value.replace(/[\\/"*:<>?|]/g, "_").replace(/[\x00-\x1F\x7F]/g, "_").trim().slice(0, 180) || "file";
}
async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) { const buffer = Buffer.from(chunk); size += buffer.length; if (size > 64 * 1024) throw new Error("Payload troppo grande"); chunks.push(buffer); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>; } catch { return {}; }
}
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]!); }

function remotePage(label: string, publicToken: string): string {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#103d32"><title>FileX Send</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;background:linear-gradient(155deg,#0b251f,#123e34);color:#f8fafc;font-family:system-ui,-apple-system,sans-serif;padding:24px 18px}main{max-width:560px;margin:auto}.brand{font-weight:900;letter-spacing:.08em;color:#68e1bf;margin:10px 0 32px}.card{background:#fff;color:#122033;border-radius:28px;padding:30px 24px;box-shadow:0 24px 70px #0007}h1{font-size:30px;line-height:1.08;margin:0 0 10px}p{color:#637086;line-height:1.5}.picker{display:block;text-align:center;background:#14a982;color:#fff;font-weight:850;font-size:18px;padding:18px;border-radius:16px;margin:25px 0 14px}.picker input{display:none}.summary{min-height:28px;font-weight:700}.send{width:100%;border:0;border-radius:16px;background:#e5b34f;color:#182214;font-size:18px;font-weight:900;padding:17px}.send:disabled{opacity:.38}.progress{height:12px;background:#e7edf4;border-radius:99px;overflow:hidden;margin:22px 0 10px}.bar{height:100%;width:0;background:#14a982}.status{text-align:center;font-weight:750;color:#33445c}.done{text-align:center;padding:28px 0}.check{width:72px;height:72px;border-radius:50%;background:#14a982;color:#fff;font-size:42px;display:grid;place-items:center;margin:0 auto 18px}</style></head><body><main><div class="brand">FILEX SEND · A DISTANZA</div><section class="card" id="upload"><h1>Invia foto e video</h1><p>Consegna privata a <strong>${escapeHtml(label)}</strong>. Il link è temporaneo.</p><label class="picker">Scegli foto e video<input id="files" type="file" accept="*/*" multiple></label><div class="summary" id="summary">Nessun file selezionato</div><button class="send" id="send" disabled>Invia ora</button><div class="progress"><div class="bar" id="bar"></div></div><div class="status" id="status"></div></section><section class="card done" id="done" hidden><div class="check">✓</div><h1>Trasferimento completato</h1><p>Le foto sono state consegnate. Puoi chiudere questa pagina.</p></section></main><script>const token=${JSON.stringify(publicToken)},input=document.querySelector('#files'),send=document.querySelector('#send'),summary=document.querySelector('#summary'),bar=document.querySelector('#bar'),status=document.querySelector('#status');let files=[];const mimeMap={\".3gp\":\"video/3gpp\",\".avi\":\"video/x-msvideo\",\".bmp\":\"image/bmp\",\".gif\":\"image/gif\",\".heic\":\"image/heic\",\".jpg\":\"image/jpeg\",\".jpeg\":\"image/jpeg\",\".m4v\":\"video/x-m4v\",\".mkv\":\"video/x-matroska\",\".mov\":\"video/quicktime\",\".mp4\":\"video/mp4\",\".mp3\":\"audio/mpeg\",\".mpeg\":\"video/mpeg\",\".mpg\":\"video/mpeg\",\".pdf\":\"application/pdf\",\".png\":\"image/png\",\".txt\":\"text/plain; charset=utf-8\",\".webp\":\"image/webp\",\".wav\":\"audio/wav\",\".webm\":\"video/webm\",\".wma\":\"audio/x-ms-wma\",\".wmv\":\"video/x-ms-wmv\",\".zip\":\"application/zip\"};function mime(file){const extension=file.name.toLowerCase().slice(file.name.lastIndexOf('.'));return file.type&&file.type.trim()||mimeMap[extension]||'application/octet-stream';}const fmt=n=>n<1048576?(n/1024).toFixed(1)+' KB':n<1073741824?(n/1048576).toFixed(1)+' MB':(n/1073741824).toFixed(1)+' GB';input.onchange=()=>{files=[...input.files];summary.textContent=files.length?files.length+' file · '+fmt(files.reduce((s,f)=>s+f.size,0)):'Nessun file selezionato';send.disabled=!files.length};function upload(file,onprogress){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('PUT','/api/public/'+token+'/files');xhr.setRequestHeader('X-File-Name',encodeURIComponent(file.name));xhr.setRequestHeader('Content-Type',mime(file));xhr.upload.onprogress=e=>onprogress(e.loaded);xhr.onload=()=>xhr.status===201?resolve():reject(new Error('Invio non riuscito'));xhr.onerror=()=>reject(new Error('Connessione interrotta'));xhr.send(file)})}send.onclick=async()=>{send.disabled=true;input.disabled=true;const total=files.reduce((s,f)=>s+f.size,0);let complete=0;try{for(let i=0;i<files.length;i++){const f=files[i];status.textContent='Invio '+(i+1)+' di '+files.length+' · '+f.name;await upload(f,n=>bar.style.width=((complete+n)/total*100)+'%');complete+=f.size}await fetch('/api/public/'+token+'/complete',{method:'POST'});document.querySelector('#upload').hidden=true;document.querySelector('#done').hidden=false}catch(e){status.textContent=e.message;send.disabled=false;input.disabled=false}};</script></body></html>`;
}
const MIME_TYPES: Record<string, string> = {
  ".3gp": "video/3gpp",
  ".avi": "video/x-msvideo",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".m4v": "video/x-m4v",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".wma": "audio/x-ms-wma",
  ".wmv": "video/x-ms-wmv",
  ".zip": "application/zip",
};

if (process.argv[1] && new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1)).replaceAll("/", "\\").toLowerCase() === process.argv[1].toLowerCase()) {
  const server = new FileXSendRemoteServer({
    dataDir: process.env.FILEX_SEND_DATA_DIR ?? join(process.cwd(), ".data"),
    host: process.env.FILEX_SEND_HOST ?? "0.0.0.0",
    port: Number(process.env.FILEX_SEND_PORT ?? 4355),
    publicBaseUrl: process.env.FILEX_SEND_PUBLIC_URL,
    createToken: process.env.FILEX_SEND_CREATE_TOKEN,
  });
  server.start().then((url) => console.log(`FileX Send Remote in ascolto su ${url}`));
}
