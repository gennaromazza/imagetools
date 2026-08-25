import { extractFile, listPackage } from "@electron/asar";
import { dirname, posix, resolve } from "node:path";

const asarPath = resolve("apps/filex-desktop/.output/releases/win-unpacked/resources/app.asar");
const entries = new Set((await listPackage(asarPath)).map((entry) => entry.replace(/^\\/, "").replaceAll("\\", "/")));
const queue = [".output/electron/suite-main.js"];
const visited = new Set();

while (queue.length) {
  const current = queue.shift();
  if (visited.has(current)) continue;
  visited.add(current);
  if (!entries.has(current)) throw new Error(`Modulo runtime mancante nell'ASAR: ${current}`);

  const source = extractFile(asarPath, current.replaceAll("/", "\\")).toString("utf8");
  const imports = source.matchAll(/(?:from\s+|import\s*\()?["'](\.\.?\/[^"']+\.js)["']/g);
  for (const match of imports) {
    const target = posix.normalize(posix.join(dirname(current).replaceAll("\\", "/"), match[1]));
    if (!entries.has(target)) throw new Error(`Import runtime mancante: ${current} -> ${target}`);
    queue.push(target);
  }
}

console.log(`FileX Suite packaged runtime imports: PASS (${visited.size} moduli)`);
