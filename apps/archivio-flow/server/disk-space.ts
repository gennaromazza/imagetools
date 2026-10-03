import fs from "fs";
import path from "path";

/**
 * Spazio libero sul disco che ospitera' la destinazione. La cartella puo' non esistere ancora
 * (verra' creata dall'importazione): si risale fino alla prima che esiste.
 */
export async function freeSpaceFor(targetPath: string): Promise<{ freeBytes: number; totalBytes: number } | null> {
  if (typeof targetPath !== "string" || !targetPath.trim() || targetPath.includes("\0")) return null;
  let current = path.resolve(targetPath);
  for (let depth = 0; depth < 64; depth++) {
    try {
      const stats = await fs.promises.statfs(current);
      return { freeBytes: Number(stats.bavail) * Number(stats.bsize), totalBytes: Number(stats.blocks) * Number(stats.bsize) };
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
  return null;
}
