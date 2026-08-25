import { readFile, writeFile } from "node:fs/promises";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  throw new Error("Uso: node scripts/update-website-suite-download.mjs <version>");
}

const path = "website/index.html";
let html = await readFile(path, "utf8");
const stableUrl = "https://github.com/gennaromazza/imagetools/releases/download/suite-channel-stable/FileX-Suite-stable-x64-setup.exe";
const linkPattern = /(id="download-link"\s+href=")[^"]+("[^>]*>)/;
if (!linkPattern.test(html)) throw new Error("Link download Suite non trovato nel sito.");
html = html.replace(linkPattern, `$1${stableUrl}$2`);
const labelPattern = /(<span id="version-label">FileX Suite )[^<]+(<\/span>)/;
if (!labelPattern.test(html)) throw new Error("Etichetta versione Suite non trovata nel sito.");
html = html.replace(labelPattern, `$1${version}$2`);
await writeFile(path, html, "utf8");
console.log(`Link Suite aggiornato per ${version}: ${stableUrl}`);
