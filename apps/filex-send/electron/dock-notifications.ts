import { mkdir, writeFile, rename, readdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

export async function publishReceivedFiles(directory: string, count: number, label: string): Promise<void> {
  if (!Number.isInteger(count) || count <= 0) return;
  await mkdir(directory, { recursive: true });
  const createdAt = Date.now();
  const id = randomUUID();
  const file = join(directory, `${createdAt}-${id}.json`);
  const temporary = file + ".tmp";
  try {
    await writeFile(temporary, JSON.stringify({
      id, toolId: "filex-send", title: "FileX Send",
      message: `${count} ${count === 1 ? "file ricevuto" : "file ricevuti"} · ${label.slice(0, 160)}`,
      createdAt,
    }), { encoding: "utf8", flag: "wx" });
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
  const files = (await readdir(directory)).filter(name => /^\d+-[a-f0-9-]+\.json$/.test(name)).sort();
  await Promise.all(files.slice(0, Math.max(0, files.length - 100)).map(name => rm(join(directory, name), { force: true })));
}
