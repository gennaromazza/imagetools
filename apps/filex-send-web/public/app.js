const credential = decodeURIComponent(location.pathname.replace(/^\/r\//, "").split("/")[0] || "");
const loading = document.querySelector("#loading");
const upload = document.querySelector("#upload");
const download = document.querySelector("#download");
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
const relativePaths = new WeakMap();

const formatBytes = (bytes) => bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : bytes < 1073741824 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1073741824).toFixed(1)} GB`;
const api = async (path, init) => {
  const response = await fetch(`/api${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Servizio non disponibile.");
  return body;
};
const showError = (message) => { loading.hidden = true; upload.hidden = true; errorText.textContent = message; errorCard.hidden = false; };

async function initialize() {
  if (!credential) return showError("Il collegamento non è valido.");
  try {
    const session = await api(`/public/${encodeURIComponent(credential)}`);
    if (session.direction === "send") {
      document.querySelector("#downloadLabel").textContent = session.label;
      document.querySelector("#downloadExpiry").textContent = `Link valido fino al ${new Date(session.expiresAt).toLocaleString("it-IT")}`;
      const list = document.querySelector("#downloadList");
      session.files.forEach((file) => {
        const row = document.createElement("div"); row.className = "download-row";
        const info = document.createElement("div");
        const name = document.createElement("strong"); name.textContent = file.name;
        const size = document.createElement("small"); size.textContent = formatBytes(file.size);
        const link = document.createElement("a"); link.href = file.downloadUrl; link.textContent = "Scarica"; link.setAttribute("download", file.name);
        info.append(name, size); row.append(info, link); list.append(row);
      });
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

function setFiles(selected) {
  const known = new Set();
  files = selected.filter((file) => {
    const key = `${relativeName(file)}:${file.size}:${file.lastModified}`;
    if (known.has(key)) return false;
    known.add(key);
    return true;
  });
  const total = files.reduce((sum, file) => sum + file.size, 0);
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

function uploadFile(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("Content-Range", `bytes 0-${file.size - 1}/${file.size}`);
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("Caricamento non riuscito."));
    xhr.onerror = () => reject(new Error("Connessione interrotta."));
    xhr.send(file);
  });
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
      await uploadFile(pending.uploadUrl, file, (loaded) => { bar.style.width = `${((completed + loaded) / total) * 100}%`; updateFileProgress(index, loaded, file.size); });
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
