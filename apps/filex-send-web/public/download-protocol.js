export const DOWNLOAD_START_DELAY_MS = 420;
export const DOWNLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
export const DOWNLOAD_MAX_RETRIES = 3;
const DOWNLOAD_TIMEOUT_MS = 45_000;
const waitForRetry = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function uniqueDownloadName(name, usedNames) {
  const original = String(name || "file");
  if (!usedNames.has(original)) {
    usedNames.add(original);
    return original;
  }
  const extensionIndex = original.lastIndexOf(".");
  const stem = extensionIndex > 0 ? original.slice(0, extensionIndex) : original;
  const extension = extensionIndex > 0 ? original.slice(extensionIndex) : "";
  let suffix = 2;
  let candidate = stem + " (" + suffix + ")" + extension;
  while (usedNames.has(candidate)) {
    suffix += 1;
    candidate = stem + " (" + suffix + ")" + extension;
  }
  usedNames.add(candidate);
  return candidate;
}

async function fetchDownloadChunk(file, start, end, fetchFile) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const downloadUrl = `${file.downloadProxyUrl}${file.downloadProxyUrl.includes("?") ? "&" : "?"}start=${start}&end=${end}`;
      const response = await fetchFile(downloadUrl, {
        headers: { Range: `bytes=${start}-${end}` },
        cache: "no-store",
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      const expectedRange = `bytes ${start}-${end}/${file.size}`;
      if (response.status !== 206 || response.headers.get("content-range") !== expectedRange) {
        await response.body?.cancel();
        const error = new Error(`Download di ${file.name} non riuscito (HTTP ${response.status}). Ricarica la pagina e riprova.`);
        error.retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
        throw error;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== end - start + 1) throw new Error("Blocco incompleto.");
      return bytes;
    } catch (cause) {
      if (cause.retryable === false || attempt >= DOWNLOAD_MAX_RETRIES) {
        throw new Error(`Download di ${file.name} interrotto. ${cause.retryable === false ? cause.message : "Connessione interrotta o blocco incompleto: riprova."}`);
      }
      await waitForRetry(500 * 2 ** attempt);
    }
  }
}

/**
 * One folder permission; bounded, validated chunks avoid cloud response limits.
 * Commit each file only after every byte is received. Retry only the failed chunk.
 */
export async function saveFilesToDirectory(files, directory, fetchFile, onProgress, onFileProgress) {
  const usedNames = new Set();
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file.downloadProxyUrl || !Number.isSafeInteger(file.size) || file.size <= 0) {
      throw new Error("Dati download non aggiornati. Ricarica la pagina e riprova.");
    }
    const targetName = uniqueDownloadName(file.name, usedNames);
    const handle = await directory.getFileHandle(targetName, { create: true });
    const writable = await handle.createWritable();
    try {
      onFileProgress?.(index + 1, files.length, targetName, 0, file.size);
      for (let offset = 0; offset < file.size;) {
        const end = Math.min(offset + DOWNLOAD_CHUNK_BYTES, file.size) - 1;
        const bytes = await fetchDownloadChunk(file, offset, end, fetchFile);
        await writable.write(bytes);
        offset += bytes.byteLength;
        onFileProgress?.(index + 1, files.length, targetName, offset, file.size);
      }
      await writable.close();
    } catch (cause) {
      try { await writable.abort(); } catch { /* Preserve the original error. */ }
      throw cause;
    }
    onProgress?.(index + 1, files.length, targetName);
  }
}

/**
 * Starts separate browser downloads one at a time for browsers without the
 * File System Access API. Browsers may allow only the first download when
 * several anchor clicks happen in the same task.
 */
export async function downloadFilesSequentially(files, triggerDownload, wait) {
  for (let index = 0; index < files.length; index += 1) {
    triggerDownload(files[index], index, files.length);
    if (index + 1 < files.length) await wait(DOWNLOAD_START_DELAY_MS);
  }
}

