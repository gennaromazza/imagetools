import { extractFile, listPackage } from "@electron/asar";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

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
  "archivio-flow": { name: "Archivio-Flow", main: ".output/electron/main.js" },
};

const expected = expectedPackages[args.component];
if (!expected || !/^\d+\.\d+\.\d+$/.test(args.version ?? "")) {
  throw new Error("Uso: verify-packaged-component.mjs --component=<id> --version=<semver> [--archive=<app.asar>]");
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

if (args.component === "suite") {
  const entries = listPackage(archivePath).map((entry) => entry.replaceAll("\\", "/"));
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

console.log(`${args.component} ${args.version}: ASAR verificato (${packageJson.main}).`);
