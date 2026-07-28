import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, "..");
const sourceDir = join(desktopRoot, "suite-launcher-src");
const outputDir = join(desktopRoot, ".output", "suite-launcher");
const brandingDir = join(desktopRoot, ".output", "branding");
const iconsDir = join(outputDir, "icons");

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await cp(sourceDir, outputDir, { recursive: true });
await mkdir(iconsDir, { recursive: true });
for (const toolId of [
  "suite-launcher",
  "photo-selector-app", "auto-layout-app", "image-party-frame", "image-id-print",
  "batch-print-layout", "archivio-flow", "image-converter", "image-file-finder", "network-drive-doctor",
]) {
  await cp(join(brandingDir, `${toolId}.png`), join(iconsDir, `${toolId}.png`));
}

console.log(`Suite launcher built at ${outputDir}`);
