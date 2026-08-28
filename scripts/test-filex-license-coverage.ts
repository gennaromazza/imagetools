import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { desktopToolManifest } from "../apps/filex-desktop/src/tool-manifest.js";

const root = resolve(import.meta.dirname, "..");
const sharedMain = await readFile(resolve(root, "apps/filex-desktop/src/main.ts"), "utf8");
const sharedLicenseService = await readFile(resolve(root, "apps/filex-desktop/src/license-service.ts"), "utf8");
assert.match(sharedMain, /requestedTool\.id !== "suite-launcher"[\s\S]*getLicenseState\(\)[\s\S]*!license\.canUseTools/);
assert.match(sharedMain, /--filex-packaged-smoke-test/);
assert.match(sharedMain, /--filex-license-smoke-test/);
assert.match(sharedLicenseService, /if \(app\.isPackaged\) return "enforce"/);
assert.match(sharedLicenseService, /--filex-license-smoke-test=unlicensed/);

const standaloneEntries: Record<string, string> = {
  "cache-sweep": "apps/cache-sweep/electron/main.ts",
  "filex-send": "apps/filex-send/electron/main.ts",
  "backup-guard": "apps/backup-guard/electron/main.ts",
};

for (const tool of Object.values(desktopToolManifest)) {
  if (tool.id === "suite-launcher") {
    assert.equal(tool.licenseRuntime, "management");
    continue;
  }
  if (tool.licenseRuntime === "shared-runtime") continue;
  assert.equal(tool.licenseRuntime, "standalone", `${tool.id}: percorso licenza sconosciuto`);
  const entry = standaloneEntries[tool.id];
  assert.ok(entry, `${tool.id}: entry point standalone non registrato nel test licenze`);
  const source = await readFile(resolve(root, entry), "utf8");
  assert.match(source, /import \{ directToolLicenseAllowed \} from "\.\/license-gate\.js"/);
  assert.match(source, /await directToolLicenseAllowed\(/);
}

for (const toolId of Object.keys(standaloneEntries)) {
  assert.equal(desktopToolManifest[toolId as keyof typeof desktopToolManifest].licenseRuntime, "standalone");
}

console.log(`FileX license coverage passed for ${Object.keys(desktopToolManifest).length - 1} current tools and future manifest entries.`);
