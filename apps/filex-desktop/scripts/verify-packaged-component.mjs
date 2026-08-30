import { extractFile, listPackage } from "@electron/asar";
import { existsSync } from "node:fs";
import { posix, resolve } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, ...valueParts] = argument.replace(/^--/, "").split("=");
    return [key, valueParts.join("=")];
  }),
);

const expectedPackages = {
  suite: { name: "FileX-Suite", main: ".output/electron/suite-main.js" },
  "photo-selector-app": { name: "Image-Select-Pro", main: ".output/electron/main.js" },
  "image-party-frame": { name: "Image-Party-Frame", main: ".output/electron/main.js" },
  "batch-print-layout": { name: "Batch-Print-Layout", main: ".output/electron/main.js" },
  "archivio-flow": { name: "Archivio-Flow", main: ".output/electron/main.js" },
  "image-converter": { name: "Image-Converter", main: ".output/electron/main.js" },
  "image-file-finder": { name: "Trova-Foto-da-Lista", main: ".output/electron/main.js" },
  "cache-sweep": { name: "FileX-Adobe-Cleaner", main: ".output/electron/cache-sweep/electron/main.js" },
  "filex-send": { name: "FileX-Send", main: ".output/electron/filex-send/electron/main.js" },
  "backup-guard": { name: "FileX-Backup-Guard", main: ".output/electron/backup-guard/electron/main.js" },
};

const expected = expectedPackages[args.component];
if (!args.component || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(args.version ?? "")) {
  throw new Error("Uso: verify-packaged-component.mjs --component=<id> --version=<semver> [--archive=<app.asar>]");
}
if (!expected) {
  throw new Error(`Componente non supportato dal verificatore: ${args.component}`);
}

const archivePath = resolve(
  args.archive ?? "apps/filex-desktop/.output/releases/win-unpacked/resources/app.asar",
);
if (!existsSync(archivePath)) throw new Error(`ASAR non trovato: ${archivePath}`);

const packageJson = JSON.parse(extractFile(archivePath, "package.json").toString("utf8"));
if (packageJson.name !== expected.name) {
  throw new Error(`Nome package inatteso: ${packageJson.name}; atteso ${expected.name}`);
}
if (packageJson.version !== args.version) {
  throw new Error(`Versione package inattesa: ${packageJson.version}; attesa ${args.version}`);
}
if (packageJson.main !== expected.main) {
  throw new Error(`Entrypoint inattesa: ${packageJson.main}; attesa ${expected.main}`);
}

function verifyRelativeImportClosure(archivePath, entries, entryPath) {
  const pendingEntries = [entryPath];
  const visitedEntries = new Set();
  const relativeImportPattern = /(?:from\s*|import\s*(?:\(\s*)?)["'](\.{1,2}\/[^"']+)["']/g;

  while (pendingEntries.length > 0) {
    const currentEntry = pendingEntries.pop();
    if (!currentEntry || visitedEntries.has(currentEntry)) continue;
    visitedEntries.add(currentEntry);

    const source = extractFile(
      archivePath,
      currentEntry.slice(1).replaceAll("/", "\\"),
    ).toString("utf8");
    for (const match of source.matchAll(relativeImportPattern)) {
      const importedEntry = posix.normalize(posix.join(posix.dirname(currentEntry), match[1]));
      if (!entries.has(importedEntry)) {
        throw new Error(`${currentEntry} importa ${importedEntry}, assente dall'ASAR.`);
      }
      pendingEntries.push(importedEntry);
    }
  }
}

if (args.component === "archivio-flow") {
  const entries = new Set(listPackage(archivePath).map((entry) => entry.replaceAll("\\", "/")));
  const serverEntry = "/.output/electron/archivio-flow-server/server/index.js";
  if (!entries.has(serverEntry)) {
    throw new Error(`Archivio Flow non contiene ${serverEntry}`);
  }
  verifyRelativeImportClosure(archivePath, entries, serverEntry);
  verifyRelativeImportClosure(archivePath, entries, "/.output/electron/main.js");
}

if (args.component === "image-party-frame") {
  const entries = new Set(listPackage(archivePath).map((entry) => entry.replaceAll("\\", "/")));
  const serverEntry = "/.output/electron/image-party-frame-server/server/index.js";
  if (!entries.has(serverEntry)) {
    throw new Error(`Image Party Frame non contiene ${serverEntry}`);
  }
  verifyRelativeImportClosure(archivePath, entries, serverEntry);
  verifyRelativeImportClosure(archivePath, entries, "/.output/electron/main.js");
}

if (args.component === "photo-selector-app") {
  const entries = new Set(listPackage(archivePath).map((entry) => entry.replaceAll("\\", "/")));
  verifyRelativeImportClosure(archivePath, entries, "/.output/electron/main.js");
}

if (args.component === "suite") {
  const entries = listPackage(archivePath).map((entry) => entry.replaceAll("\\", "/"));
  for (const requiredEntry of [
    "/.output/electron/license-service.js",
    "/.output/electron/license-attestation.js",
    "/.output/electron/license-public-key.js",
  ]) {
    if (!entries.includes(requiredEntry)) throw new Error(`La Suite non contiene ${requiredEntry}`);
  }
  const forbiddenEntries = [
    "/.output/electron/main.js",
    "/.output/electron/desktop-store.js",
    "/.output/electron/google-drive-service.js",
    "/.output/electron/native-folder-service.js",
    "/.output/electron/native-image-service.js",
    "/.output/electron/raw-jpeg-extractor.js",
    "/.output/electron/thumbnail-disk-cache.js",
    "/.output/electron/xmp-compatibility.js",
    "/node_modules/@img",
    "/node_modules/exiftool-vendored",
    "/node_modules/exiftool-vendored.exe",
    "/node_modules/sharp",
  ];
  const bundledForbiddenEntries = entries.filter((entry) =>
    forbiddenEntries.some((forbidden) => entry === forbidden || entry.startsWith(`${forbidden}/`)));
  if (bundledForbiddenEntries.length > 0) {
    throw new Error(`La Suite contiene moduli tool-specifici:\n${bundledForbiddenEntries.slice(0, 20).join("\n")}`);
  }
}

if (args.component === "cache-sweep") {
  const entries = listPackage(archivePath).map((entry) => entry.replaceAll("\\", "/"));
  const requiredEntries = [
    "/.output/electron/cache-sweep/electron/main.js",
    "/.output/electron/cache-sweep/electron/preload.cjs",
    "/.output/electron/cache-sweep/electron/cache-sweep-service.js",
    "/.output/electron/cache-sweep/electron/license-gate.js",
  ];
  for (const requiredEntry of requiredEntries) {
    if (!entries.includes(requiredEntry)) {
      throw new Error(`Cache Sweep non contiene ${requiredEntry}`);
    }
  }
  const forbiddenEntries = entries.filter((entry) =>
    entry.startsWith("/node_modules/")
    || entry === "/.output/electron/main.js"
    || entry === "/.output/electron/native-image-service.js"
    || entry === "/.output/electron/thumbnail-disk-cache.js");
  if (forbiddenEntries.length > 0) {
    throw new Error(`Cache Sweep contiene dipendenze o runtime estranei:\n${forbiddenEntries.slice(0, 20).join("\n")}`);
  }
}

if (args.component === "filex-send") {
  const entries = listPackage(archivePath).map((entry) => entry.replaceAll("\\", "/"));
  for (const requiredEntry of [
    "/.output/electron/filex-send/electron/main.js",
    "/.output/electron/filex-send/electron/preload.cjs",
    "/.output/electron/filex-send/electron/file-send-service.js",
    "/.output/electron/filex-send/electron/firebase-anonymous-auth.js",
    "/.output/electron/filex-send/electron/remote-client-service.js",
    "/.output/electron/filex-send/electron/license-gate.js",
  ]) {
    if (!entries.includes(requiredEntry)) throw new Error(`FileX Send non contiene ${requiredEntry}`);
  }
  const forbiddenEntries = entries.filter((entry) => entry.startsWith("/node_modules/") || entry === "/.output/electron/main.js");
  if (forbiddenEntries.length > 0) throw new Error(`FileX Send contiene runtime estranei:\n${forbiddenEntries.slice(0, 20).join("\n")}`);
}

if (args.component === "backup-guard") {
  const entries = listPackage(archivePath).map((entry) => entry.replaceAll("\\", "/"));
  for (const requiredEntry of [
    "/.output/electron/backup-guard/electron/main.js",
    "/.output/electron/backup-guard/electron/preload.cjs",
    "/.output/electron/backup-guard/electron/backup-guard-service.js",
    "/.output/electron/backup-guard/electron/license-gate.js",
  ]) {
    if (!entries.includes(requiredEntry)) throw new Error(`Backup Guard non contiene ${requiredEntry}`);
  }
}

console.log(`${args.component} ${args.version}: ASAR verificato (${packageJson.main}).`);
