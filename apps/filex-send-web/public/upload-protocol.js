export const UPLOAD_CHUNK_SIZE = 16 * 1024 * 1024;
export const UPLOAD_MAX_RETRIES = 5;
export const UPLOAD_REQUEST_TIMEOUT_MS = 120_000;

export function totalBytes(files) {
  return files.reduce((total, file) => total + Number(file.size || 0), 0);
}

export function chunkCount(total, chunkSize = UPLOAD_CHUNK_SIZE) {
  return Math.ceil(total / chunkSize);
}

export function chunkEnd(offset, total, chunkSize = UPLOAD_CHUNK_SIZE) {
  return Math.min(total - 1, offset + chunkSize - 1);
}

export function offsetFromRange(range) {
  const match = /^bytes=0-(\d+)$/i.exec(String(range || "").trim());
  return match ? Number(match[1]) + 1 : null;
}

export function nextOffset(status, range, fallback) {
  if (status === 200 || status === 201) return fallback;
  if (status === 308) return offsetFromRange(range) ?? fallback;
  return null;
}

export function isRetryableStatus(status) {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

export function retryDelay(attempt) {
  return Math.min(8000, 500 * 2 ** attempt);
}
