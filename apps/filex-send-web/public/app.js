import { UPLOAD_MAX_RETRIES, UPLOAD_REQUEST_TIMEOUT_MS, chunkEnd, isRetryableStatus, nextOffset, retryDelay, totalBytes } from "./upload-protocol.js";

const credential = decodeURIComponent(location.pathname.replace(/^\/r\//, "").split("/")[0] || "");
const loading = document.querySelector("#loading");
const upload = document.querySelector("#upload");
const download = document.querySelector("#download");
const downloadAll = document.querySelector("#downloadAll");
const downloadAllStatus = document.querySelector("#downloadAllStatus");
const done = document.querySelector("#done");
const errorCard = document.querySelector("#error");
const errorText = document.querySelector("#errorText");
const inputs = [...document.querySelectorAll("#mediaFiles, #otherFiles, #folderFiles")];
const send = document.querySelector("#send");
const summary = document.querySelector("#summary");
const status = document.querySelector("#status");
const bar = document.querySelector("#bar");
const previews = document.querySelector("#previews");
const fileList = document.querySelector("#fileList");
const dropZone = document.querySelector("#dropZone");
const again = document.querySelector("#again");
let files = [];
let sharedFiles = [];
const relativePaths = new WeakMap();
const MAX_BROWSER_ZIP_BYTES = 128 * 1024 * 1024;
const ARCHIVE_API_BASE_URL = "https://europe-west1-gen-lang-client-0321087169.cloudfunctions.net/api";

const formatBytes = (bytes) => bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : bytes < 1073741824 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1073741824).toFixed(1)} GB`;
const api = async (path, init) => {
  const response = await fetch(`/api${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Servizio non disponibile.");
  return body;
};
const showError = (message) => { loading.hidden = true; upload.hidden = true; errorText.textContent = message; errorCard.hidden = false; };

function triggerDownload(file) {
  const link = document.createElement("a");
  link.href = file.downloadUrl;
  link.download = file.name;
  link.rel = "noreferrer";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
}

async function requestDownloadArchive() {
  const response = await fetch(`${ARCHIVE_API_BASE_URL}/public/${encodeURIComponent(credential)}/archive`, { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 202) throw new Error(body.error || "Non riesco a preparare lo ZIP.");
  return body;
}

async function downloadAllFiles() {
  if (!sharedFiles.length || !downloadAll) return;
  downloadAll.disabled = true;
  downloadAll.textContent = `Preparo lo ZIP · ${sharedFiles.length} file`;
  const startedAt = Date.now();
  const timer = window.setInterval(() => {
    const elapsed = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
    downloadAllStatus.textContent = `Creazione dello ZIP sul server in corso · ${elapsed}s. Non chiudere questa pagina.`;
  }, 1000);

  try {
    let archive;
    do {
      archive = await requestDownloadArchive();
      if (archive.status === "building") await new Promise((resolve) => setTimeout(resolve, 3000));
    } while (archive.status === "building");
    triggerDownload({ downloadUrl: archive.downloadUrl, name: archive.name });
    downloadAll.textContent = `Download ZIP avviato · ${sharedFiles.length} file`;
    downloadAllStatus.textContent = "Un unico archivio ZIP e pronto nel pannello Download del browser.";
  } catch (cause) {
    downloadAll.disabled = false;
    downloadAll.textContent = `Scarica tutti · ${sharedFiles.length}`;
    downloadAllStatus.textContent = cause.message || "Non riesco a preparare lo ZIP. Riprova tra poco.";
  } finally {
    window.clearInterval(timer);
  }
}

async function downloadAllAsZip() {
  downloadAll.textContent = "Creazione archivio…";
  downloadAllStatus.textContent = "Preparazione del file ZIP in corso…";

  const zip = new JSZip();
  const reservedNames = new Set(sharedFiles.map((file) => file.name));
  const usedNames = new Set();

  for (const file of sharedFiles) {
    const response = await fetch(file.downloadUrl);
    if (!response.ok) throw new Error(`Download fallito per ${file.name}`);
    const blob = await response.blob();

    zip.file(uniqueDownloadName(file.name, usedNames, reservedNames), blob);
  }

  downloadAllStatus.textContent = "Compressione in corso…";
  const content = await zip.generateAsync({ type: "blob" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(content);
  link.download = `filex-send-${Date.now()}.zip`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 60_000);

  downloadAll.textContent = `ZIP scaricato · ${sharedFiles.length} file`;
  downloadAllStatus.textContent = "Archivio scaricato con successo.";
}

function uniqueDownloadName(fileName, usedNames, reservedNames) {
  if (!usedNames.has(fileName)) {
    usedNames.add(fileName);
    return fileName;
  }
  const dot = fileName.lastIndexOf(".");
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot) : "";
  let occurrence = 1;
  let candidate = `${base} (${occurrence})${extension}`;
  while (usedNames.has(candidate) || reservedNames.has(candidate)) {
    occurrence += 1;
    candidate = `${base} (${occurrence})${extension}`;
  }
  usedNames.add(candidate);
  return candidate;
}

async function downloadAllSequential() {
  downloadAll.textContent = "Avvio download…";
  downloadAllStatus.textContent = "Download uno alla volta in corso…";

  for (let i = 0; i < sharedFiles.length; i++) {
    const file = sharedFiles[i];
    downloadAll.textContent = `Scaricando ${i + 1} di ${sharedFiles.length}…`;
    triggerDownload(file);
    // Wait between downloads to avoid browser blocking
    if (i < sharedFiles.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  downloadAll.textContent = `Download avviati · ${sharedFiles.length}`;
  downloadAllStatus.textContent = "I file vengono scaricati separatamente. Se il browser blocca qualche download, riprova con il pulsante.";
}

async function initialize() {
  if (!credential) return showError("Il collegamento non è valido.");
  try {
    const session = await api(`/public/${encodeURIComponent(credential)}`);
    if (session.direction === "send") {
      sharedFiles = session.files || [];
      document.querySelector("#downloadLabel").textContent = session.label;
      document.querySelector("#downloadExpiry").textContent = `Link valido fino al ${new Date(session.expiresAt).toLocaleString("it-IT")}`;
      const list = document.querySelector("#downloadList");
      session.files.forEach((file) => {
        const row = document.createElement("div"); row.className = "download-row";
        const info = document.createElement("div");
        const name = document.createElement("strong"); name.textContent = file.name;
        const size = document.createElement("small"); size.textContent = formatBytes(file.size);
        const link = document.createElement("a"); link.href = file.downloadUrl; link.textContent = "Scarica"; link.setAttribute("download", file.name); link.rel = "noreferrer";
        info.append(name, size); row.append(info, link); list.append(row);
      });
      if (downloadAll) {
        downloadAll.disabled = sharedFiles.length === 0;
        downloadAll.textContent = sharedFiles.length ? `Scarica tutti · ${sharedFiles.length}` : "Nessun file disponibile";
      }
      loading.hidden = true; download.hidden = false; return;
    }
    document.querySelector("#label").textContent = session.label;
    document.querySelector("#expiry").textContent = `Link valido fino al ${new Date(session.expiresAt).toLocaleString("it-IT")}`;
    loading.hidden = true;
    upload.hidden = false;
  } catch (cause) { showError(cause.message); }
}

function relativeName(file) {
  return relativePaths.get(file) || file.webkitRelativePath || file.name;
}

downloadAll?.addEventListener("click", () => { void downloadAllFiles(); });

function setFiles(selected) {
  const known = new Set();
  files = selected.filter((file) => {
    const key = `${relativeName(file)}:${file.size}:${file.lastModified}`;
    if (known.has(key)) return false;
    known.add(key);
    return true;
  });
  const total = totalBytes(files);
  summary.textContent = files.length ? `${files.length} file · ${formatBytes(total)}` : "Nessun file selezionato";
  send.disabled = files.length === 0;
  previews.replaceChildren(...files.slice(0, 7).map((file) => {
    const item = document.createElement("div");
    item.className = "preview";
    if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
      const media = document.createElement(file.type.startsWith("video/") ? "video" : "img");
      const objectUrl = URL.createObjectURL(file);
      media.src = objectUrl;
      media.alt = file.name;
      const release = () => URL.revokeObjectURL(objectUrl);
      media.addEventListener("load", release, { once: true });
      media.addEventListener("loadeddata", release, { once: true });
      item.append(media);
    } else {
      item.classList.add("preview--file");
      item.textContent = file.name;
    }
    return item;
  }));
  if (files.length > 7) {
    const more = document.createElement("div");
    more.className = "preview-more";
    more.textContent = `+${files.length - 7}`;
    previews.append(more);
  }
  renderFileList();
}

function renderFileList() {
  fileList.replaceChildren(...files.map((file, index) => {
    const row = document.createElement("div"); row.className = "file-row"; row.dataset.index = String(index);
    const details = document.createElement("div");
    const name = document.createElement("strong"); name.className = "file-row__name"; name.textContent = file.name;
    const path = document.createElement("small"); path.className = "file-row__path"; path.textContent = relativeName(file) === file.name ? formatBytes(file.size) : `${relativeName(file)} · ${formatBytes(file.size)}`;
    const state = document.createElement("span"); state.className = "file-row__status"; state.textContent = "In attesa";
    const progress = document.createElement("div"); progress.className = "file-row__progress"; progress.append(document.createElement("div"));
    details.append(name, path); row.append(details, state, progress);
    return row;
  }));
}

function updateFileProgress(index, loaded, total) {
  const row = fileList.querySelector(`[data-index="${index}"]`);
  if (!row) return;
  row.classList.add("is-uploading");
  row.querySelector(".file-row__status").textContent = `${Math.round((loaded / total) * 100)}%`;
  row.querySelector(".file-row__progress div").style.width = `${(loaded / total) * 100}%`;
}

function markFileComplete(index) {
  const row = fileList.querySelector(`[data-index="${index}"]`);
  if (!row) return;
  row.classList.remove("is-uploading"); row.classList.add("is-complete");
  row.querySelector(".file-row__status").textContent = "Caricato ✓";
  row.querySelector(".file-row__progress div").style.width = "100%";
}

async function readEntry(entry, prefix = "") {
  if (entry.isFile) return new Promise((resolve, reject) => entry.file((file) => {
    relativePaths.set(file, `${prefix}${file.name}`);
    resolve([file]);
  }, reject));
  const reader = entry.createReader(); const children = [];
  while (true) { const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject)); if (!batch.length) break; children.push(...batch); }
  return (await Promise.all(children.map((child) => readEntry(child, `${prefix}${entry.name}/`)))).flat();
}

async function filesFromDrop(dataTransfer) {
  const entries = [...dataTransfer.items].map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  if (entries.length) return (await Promise.all(entries.map((entry) => readEntry(entry)))).flat();
  return [...dataTransfer.files];
}

inputs.forEach((input) => input.addEventListener("change", () => setFiles([...input.files])));
dropZone.addEventListener("click", () => document.querySelector("#otherFiles").click());
dropZone.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); document.querySelector("#otherFiles").click(); } });
["dragenter", "dragover"].forEach((type) => dropZone.addEventListener(type, (event) => { event.preventDefault(); dropZone.classList.add("dragging"); }));
["dragleave", "drop"].forEach((type) => dropZone.addEventListener(type, (event) => { event.preventDefault(); dropZone.classList.remove("dragging"); }));
dropZone.addEventListener("drop", async (event) => { try { setFiles(await filesFromDrop(event.dataTransfer)); } catch { status.textContent = "Non riesco a leggere uno degli elementi trascinati."; } });

function requestUploadChunk(url, chunk, start, end, total, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.timeout = UPLOAD_REQUEST_TIMEOUT_MS;
    xhr.setRequestHeader("Content-Type", chunk.type || "application/octet-stream");
    xhr.setRequestHeader("Content-Range", `bytes ${start}-${end}/${total}`);
    xhr.upload.onprogress = (event) => onProgress(start + event.loaded);
    xhr.onload = () => {
      const offset = nextOffset(xhr.status, xhr.getResponseHeader("Range"), end + 1);
      if (offset !== null) resolve(offset);
      else { const error = new Error(xhr.status >= 500 ? "Server temporaneamente non disponibile." : "Caricamento non riuscito."); error.status = xhr.status; reject(error); }
    };
    xhr.onerror = () => { const error = new Error("Connessione interrotta."); error.status = 0; reject(error); };
    xhr.ontimeout = () => { const error = new Error("La richiesta è scaduta."); error.status = 408; reject(error); };
    xhr.send(chunk);
  });
}

function queryUploadOffset(url, total) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.timeout = UPLOAD_REQUEST_TIMEOUT_MS;
    xhr.setRequestHeader("Content-Range", `bytes */${total}`);
    xhr.onload = () => {
      const offset = offsetFromResponse(xhr);
      if (offset !== null) resolve(offset);
      else reject(Object.assign(new Error("Impossibile riprendere il caricamento."), { status: xhr.status }));
    };
    xhr.onerror = () => reject(Object.assign(new Error("Connessione interrotta."), { status: 0 }));
    xhr.ontimeout = () => reject(Object.assign(new Error("La richiesta è scaduta."), { status: 408 }));
    xhr.send();
  });
}

function offsetFromResponse(xhr) {
  if (xhr.status === 200 || xhr.status === 201) return Number(xhr.getResponseHeader("Content-Length") || 0) || null;
  return xhr.status === 308 ? (Number((/^bytes=0-(\d+)$/i.exec(xhr.getResponseHeader("Range") || "") || [])[1]) + 1 || 0) : null;
}

const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

async function uploadFile(url, file, onProgress, onRetry) {
  let offset = 0;
  while (offset < file.size) {
    const end = chunkEnd(offset, file.size);
    let attempt = 0;
    while (true) {
      try {
        offset = await requestUploadChunk(url, file.slice(offset, end + 1), offset, end, file.size, onProgress);
        break;
      } catch (cause) {
        if (attempt >= UPLOAD_MAX_RETRIES || !isRetryableStatus(cause.status ?? 0)) throw cause;
        attempt += 1;
        onRetry?.(attempt, UPLOAD_MAX_RETRIES);
        await wait(retryDelay(attempt - 1));
        try { offset = await queryUploadOffset(url, file.size); } catch { /* il retry successivo riprova anche il recupero offset */ }
      }
    }
  }
}

send.addEventListener("click", async () => {
  send.disabled = true;
  inputs.forEach((input) => { input.disabled = true; });
  const total = files.reduce((sum, file) => sum + file.size, 0);
  let completed = 0;
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      status.textContent = `Invio ${index + 1} di ${files.length} · ${file.name}`;
      const pending = await api(`/public/${encodeURIComponent(credential)}/uploads`, { method: "POST", body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }) });
      await uploadFile(pending.uploadUrl, file, (loaded) => { bar.style.width = `${((completed + loaded) / total) * 100}%`; updateFileProgress(index, loaded, file.size); status.textContent = `Invio ${index + 1} di ${files.length} · ${file.name} · ${Math.round((loaded / file.size) * 100)}%`; }, (attempt, max) => { status.textContent = `Rete instabile: riprovo ${file.name} (${attempt}/${max})…`; });
      await api(`/public/${encodeURIComponent(credential)}/uploads/${pending.fileId}/complete`, { method: "POST", body: "{}" });
      completed += file.size;
      markFileComplete(index);
    }
    await api(`/public/${encodeURIComponent(credential)}/complete`, { method: "POST", body: "{}" });
    upload.hidden = true;
    done.hidden = false;
  } catch (cause) {
    status.textContent = cause.message;
    const row = fileList.querySelector(".is-uploading");
    if (row) { row.classList.remove("is-uploading"); row.classList.add("is-error"); row.querySelector(".file-row__status").textContent = "Da riprovare"; }
    send.disabled = false;
    inputs.forEach((input) => { input.disabled = false; });
  }
});

again.addEventListener("click", () => location.reload());

void initialize();
