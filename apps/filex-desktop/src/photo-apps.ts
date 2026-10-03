import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface PhotoApp {
  id: "bridge";
  label: string;
  executable: string;
}

async function isFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

async function isDirectory(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}

/** Cartelle in cui Adobe installa i suoi programmi (a 64 e a 32 bit). */
export function defaultAdobeRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  return [env.ProgramFiles, env["ProgramFiles(x86)"]].filter((value): value is string => Boolean(value)).map((root) => join(root, "Adobe"));
}

/**
 * Programmi di foto installati in cui si puo' aprire una cartella dalla riga di comando.
 * Oggi solo Adobe Bridge (versione piu' recente). Lightroom Classic non accetta una cartella come argomento.
 */
export async function findPhotoApps(roots: readonly string[] = defaultAdobeRoots()): Promise<PhotoApp[]> {
  let best: { year: number; executable: string } | null = null;
  for (const root of roots) {
    let entries: string[] = [];
    try { entries = await readdir(root); } catch { continue; }
    for (const name of entries) {
      const match = /^Adobe Bridge(?: (\d{4}))?$/i.exec(name);
      if (!match) continue;
      const executable = join(root, name, "Adobe Bridge.exe");
      if (!(await isFile(executable))) continue;
      const year = match[1] ? Number(match[1]) : 0;
      if (!best || year > best.year) best = { year, executable };
    }
  }
  return best ? [{ id: "bridge", label: "Adobe Bridge", executable: best.executable }] : [];
}

type Launcher = (executable: string, args: string[]) => void;

const defaultLauncher: Launcher = (executable, args) => {
  const child = spawn(executable, args, { detached: true, stdio: "ignore" });
  child.on("error", () => undefined);
  child.unref();
};

/** Apre una cartella reale nel programma scelto. Non esegue mai altro che i programmi trovati da `findPhotoApps`. */
export async function openFolderInPhotoApp(
  appId: string,
  folderPath: string,
  options: { apps?: readonly PhotoApp[]; launch?: Launcher } = {},
): Promise<{ ok: boolean; message: string }> {
  const apps = options.apps ?? await findPhotoApps();
  const app = apps.find((item) => item.id === appId);
  if (!app) return { ok: false, message: "Programma non installato." };
  if (typeof folderPath !== "string" || !folderPath.trim() || folderPath.includes("\0") || !(await isDirectory(folderPath))) {
    return { ok: false, message: "La cartella non esiste più." };
  }
  try {
    (options.launch ?? defaultLauncher)(app.executable, [folderPath]);
    return { ok: true, message: `Apro la cartella in ${app.label}.` };
  } catch {
    return { ok: false, message: `Non sono riuscito ad aprire ${app.label}.` };
  }
}
