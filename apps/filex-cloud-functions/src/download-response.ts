import type { ServerResponse } from "node:http";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { downloadContentDisposition, publicDownloadRange } from "./core.js";

/** Stream only a bounded byte range; never proxy an entire large object. */
export async function sendDownloadRange(
  file: { name: string; size: number; contentType?: string },
  rangeHeader: string | undefined,
  response: ServerResponse,
  openStream: (range: { start: number; end: number }) => Readable,
): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Accept-Ranges", "bytes");
  const range = publicDownloadRange(file.size, rangeHeader);
  if (!range) {
    response.statusCode = 416;
    response.setHeader("Content-Range", `bytes */${file.size}`);
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error: "Richiesto un download a blocchi. Ricarica la pagina e riprova." }));
    return;
  }
  response.statusCode = rangeHeader ? 206 : 200;
  response.setHeader("Content-Type", file.contentType ?? "application/octet-stream");
  response.setHeader("Content-Length", String(range.end - range.start + 1));
  response.setHeader("Content-Disposition", downloadContentDisposition(file.name));
  if (rangeHeader) response.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${file.size}`);
  // pipeline waits for completion and destroys the storage stream on disconnect.
  await pipeline(openStream(range), response);
}

