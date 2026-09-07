import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { desktopToolManifest } from "../apps/filex-desktop/.output/electron/tool-manifest.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const shellRoot = resolve(root, "apps/filex-desktop");
const sharp = createRequire(new URL("../apps/filex-desktop/package.json", import.meta.url))("sharp");
const builder = await readFile(resolve(shellRoot, "electron-builder.config.mjs"), "utf8");
assert.match(builder, /signAndEditExecutable:\s*true/, "Windows must embed the product icon in the EXE");
assert.ok(builder.includes('appId: `studio.filex.${requestedTool.id}`'), "Installer identity must follow the manifest");
assert.ok(builder.includes('WinShell::SetLnkAUMI'), "Installer shortcuts must retain their Windows identity");
assert.ok(builder.includes('resources\\\\branding'), "Installer shortcuts must use the packaged branding");

for (const tool of Object.values(desktopToolManifest)) {
  const prefix = tool.id + ": ";
  const ico = await readFile(resolve(shellRoot, ".output/branding", tool.id + ".ico"));
  assert.equal(ico.readUInt16LE(0), 0, prefix + "invalid ICO header");
  assert.equal(ico.readUInt16LE(2), 1, prefix + "not an ICO");
  const count = ico.readUInt16LE(4);
  assert.ok(count > 0 && ico.length >= 6 + count * 16, prefix + "missing icon directory");
  const sizes = new Set();
  for (let index = 0; index < count; index++) {
    const entry = 6 + index * 16;
    const size = ico[entry] || 256;
    assert.equal(ico[entry + 1] || 256, size, prefix + "icon must be square");
    const bytes = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    assert.ok(bytes > 0 && offset >= 6 + count * 16 && offset + bytes <= ico.length, prefix + "truncated frame");
    const frame = sharp(ico.subarray(offset, offset + bytes));
    const metadata = await frame.metadata();
    assert.equal(metadata.width, size, prefix + "decoded width mismatch");
    assert.equal(metadata.height, size, prefix + "decoded height mismatch");
    const stats = await frame.stats();
    assert.ok(stats.channels.slice(0, 3).some(channel => channel.stdev > 0), prefix + "blank icon frame");
    if (metadata.hasAlpha) assert.ok(stats.channels[3].max > 0, prefix + "fully transparent icon");
    sizes.add(size);
  }
  for (const size of [16, 24, 32, 48, 64, 128, 256]) assert.ok(sizes.has(size), prefix + "missing DPI size " + size);
  const source = tool.electronMainOutputFile === "main.js" || tool.electronMainOutputFile === "suite-main.js"
    ? resolve(shellRoot, "src", tool.electronMainOutputFile.replace(/\.js$/, ".ts"))
    : resolve(shellRoot, tool.versionPackageRelativeToShell, "electron/main.ts");
  const main = await readFile(source, "utf8");
  assert.match(main, /browser-window-created/, prefix + "all windows need the taskbar policy");
  assert.match(main, /setAppDetails\(/, prefix + "missing taskbar details");
  for (const field of ["appId:", "appIconPath:", "relaunchCommand:", "relaunchDisplayName:"]) {
    assert.ok(main.includes(field), prefix + "missing " + field);
  }
  assert.match(main, /app\.isPackaged\s*\?\s*""\s*:\s*"\.dev"/, prefix + "Dev identity must differ from installed identity");
  console.log("OK Windows branding: " + tool.id);
}
