const credential = decodeURIComponent(location.pathname.replace(/^\/r\//, "").split("/")[0] || "");
const loading = document.querySelector("#loading");
const upload = document.querySelector("#upload");
const done = document.querySelector("#done");
const errorCard = document.querySelector("#error");
const errorText = document.querySelector("#errorText");
const input = document.querySelector("#files");
const send = document.querySelector("#send");
const summary = document.querySelector("#summary");
const status = document.querySelector("#status");
const bar = document.querySelector("#bar");
const again = document.querySelector("#again");
let files = [];

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
    document.querySelector("#label").textContent = session.label;
    document.querySelector("#expiry").textContent = `Link valido fino al ${new Date(session.expiresAt).toLocaleString("it-IT")}`;
    loading.hidden = true;
    upload.hidden = false;
  } catch (cause) { showError(cause.message); }
}

input.addEventListener("change", () => {
  files = [...input.files];
  const total = files.reduce((sum, file) => sum + file.size, 0);
  summary.textContent = files.length ? `${files.length} file · ${formatBytes(total)}` : "Nessun file selezionato";
  send.disabled = files.length === 0;
});

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
  input.disabled = true;
  const total = files.reduce((sum, file) => sum + file.size, 0);
  let completed = 0;
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      status.textContent = `Invio ${index + 1} di ${files.length} · ${file.name}`;
      const pending = await api(`/public/${encodeURIComponent(credential)}/uploads`, { method: "POST", body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }) });
      await uploadFile(pending.uploadUrl, file, (loaded) => { bar.style.width = `${((completed + loaded) / total) * 100}%`; });
      await api(`/public/${encodeURIComponent(credential)}/uploads/${pending.fileId}/complete`, { method: "POST", body: "{}" });
      completed += file.size;
    }
    await api(`/public/${encodeURIComponent(credential)}/complete`, { method: "POST", body: "{}" });
    upload.hidden = true;
    done.hidden = false;
  } catch (cause) {
    status.textContent = cause.message;
    send.disabled = false;
    input.disabled = false;
  }
});

again.addEventListener("click", () => location.reload());

void initialize();
