import { type Readable, type Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ZipFile } from "yazl";

export interface ArchiveSource {
  name: string;
  size: number;
  mtime?: Date;
  createReadStream(): Readable;
}

export function uniqueArchiveNames(fileNames: string[]): string[] {
  const reserved = new Set(fileNames);
  const used = new Set<string>();
  return fileNames.map((fileName) => {
    if (!used.has(fileName)) {
      used.add(fileName);
      return fileName;
    }
    const dot = fileName.lastIndexOf(".");
    const base = dot > 0 ? fileName.slice(0, dot) : fileName;
    const extension = dot > 0 ? fileName.slice(dot) : "";
    let occurrence = 1;
    let candidate = `${base} (${occurrence})${extension}`;
    while (used.has(candidate) || reserved.has(candidate)) {
      occurrence += 1;
      candidate = `${base} (${occurrence})${extension}`;
    }
    used.add(candidate);
    return candidate;
  });
}

export async function writeZipArchive(entries: ArchiveSource[], destination: Writable): Promise<void> {
  const zip = new ZipFile();
  const names = uniqueArchiveNames(entries.map((entry) => entry.name));
  let totalSize = 0;

  entries.forEach((entry, index) => {
    totalSize += entry.size;
    zip.addReadStreamLazy(names[index], {
      size: entry.size,
      mtime: entry.mtime ?? new Date(),
      compress: false,
      forceZip64Format: entry.size >= 0xffffffff,
    }, (callback) => callback(null, entry.createReadStream()));
  });

  const completed = pipeline(zip.outputStream, destination);
  zip.end({ forceZip64Format: totalSize >= 0xffffffff, comment: "" });
  await completed;
}
