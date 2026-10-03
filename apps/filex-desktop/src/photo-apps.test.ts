import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { defaultAdobeRoots, findPhotoApps, openFolderInPhotoApp, type PhotoApp } from "./photo-apps.js";

function adobeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "filex-adobe-"));
  return join(root, "Adobe");
}

function install(root: string, folder: string, withExecutable = true): string {
  const directory = join(root, folder);
  mkdirSync(directory, { recursive: true });
  const executable = join(directory, "Adobe Bridge.exe");
  if (withExecutable) writeFileSync(executable, "MZ");
  return executable;
}

test("programmi foto: sceglie la versione di Bridge più recente tra più cartelle di installazione", async () => {
  const root = adobeRoot();
  install(root, "Adobe Bridge 2024");
  const newest = install(root, "Adobe Bridge 2025");
  mkdirSync(join(root, "Adobe Photoshop 2025"), { recursive: true });
  const apps = await findPhotoApps([root]);
  assert.equal(apps.length, 1);
  assert.deepEqual([apps[0]!.id, apps[0]!.label, apps[0]!.executable], ["bridge", "Adobe Bridge", newest]);
});

test("programmi foto: cartella senza eseguibile, radice mancante o altri programmi Adobe non contano", async () => {
  const empty = adobeRoot();
  install(empty, "Adobe Bridge 2025", false);
  assert.deepEqual(await findPhotoApps([empty]), []);
  assert.deepEqual(await findPhotoApps([join(empty, "non-esiste")]), []);
  assert.deepEqual(await findPhotoApps([]), []);
  const other = adobeRoot();
  mkdirSync(join(other, "Adobe Lightroom Classic"), { recursive: true });
  assert.deepEqual(await findPhotoApps([other]), [], "Lightroom non accetta una cartella dalla riga di comando");
});

test("programmi foto: cerca sia a 64 sia a 32 bit e un Bridge senza anno è la versione più vecchia", async () => {
  const x64 = adobeRoot();
  const x86 = adobeRoot();
  install(x64, "Adobe Bridge");
  const modern = install(x86, "Adobe Bridge 2023");
  assert.equal((await findPhotoApps([x64, x86]))[0]!.executable, modern);
  assert.deepEqual(defaultAdobeRoots({ ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)" }), [join("C:\\Program Files", "Adobe"), join("C:\\Program Files (x86)", "Adobe")]);
  assert.deepEqual(defaultAdobeRoots({}), []);
});

test("apertura cartella: solo programmi trovati e cartelle reali, nessun comando arbitrario", async () => {
  const folder = mkdtempSync(join(tmpdir(), "filex-photos-"));
  const file = join(folder, "x.jpg");
  writeFileSync(file, "x");
  const apps: PhotoApp[] = [{ id: "bridge", label: "Adobe Bridge", executable: "C:\\Adobe\\Adobe Bridge.exe" }];
  const calls: Array<[string, string[]]> = [];
  const launch = (executable: string, args: string[]) => { calls.push([executable, args]); };

  assert.deepEqual(await openFolderInPhotoApp("bridge", folder, { apps, launch }), { ok: true, message: "Apro la cartella in Adobe Bridge." });
  assert.deepEqual(calls, [["C:\\Adobe\\Adobe Bridge.exe", [folder]]]);

  assert.equal((await openFolderInPhotoApp("cmd.exe", folder, { apps, launch })).ok, false, "id sconosciuto");
  assert.equal((await openFolderInPhotoApp("bridge", file, { apps, launch })).ok, false, "un file non è una cartella");
  assert.equal((await openFolderInPhotoApp("bridge", join(folder, "manca"), { apps, launch })).ok, false);
  assert.equal((await openFolderInPhotoApp("bridge", "", { apps, launch })).ok, false);
  assert.equal((await openFolderInPhotoApp("bridge", `${folder}\0`, { apps, launch })).ok, false);
  assert.equal((await openFolderInPhotoApp("bridge", folder, { apps: [], launch })).message, "Programma non installato.");
  const failing = await openFolderInPhotoApp("bridge", folder, { apps, launch: () => { throw new Error("blocco"); } });
  assert.deepEqual(failing, { ok: false, message: "Non sono riuscito ad aprire Adobe Bridge." });
  assert.equal(calls.length, 1, "nessuna chiamata per i casi rifiutati");
});
