import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { desktopToolManifest } from "../apps/filex-desktop/src/tool-manifest.js";

const root = resolve(import.meta.dirname, "..");
const sharedMain = await readFile(resolve(root, "apps/filex-desktop/src/main.ts"), "utf8");
const sharedLicenseService = await readFile(resolve(root, "apps/filex-desktop/src/license-service.ts"), "utf8");
assert.match(sharedMain, /requestedTool\.id !== "suite-launcher"[\s\S]*getLicenseState\(\)[\s\S]*!license\.canUseTools/);
assert.match(sharedLicenseService, /if \(app\.isPackaged\) return "enforce";/);
assert.match(sharedLicenseService, /function resolveEnforcement[\s\S]*if \(app\.isPackaged\) return "enforce";/);
assert.match(sharedLicenseService, /function applyCurrentEnforcement[\s\S]*status === "active" \|\| state\.status === "grace"/);
// Cached active flags are untrusted: offline use must pass the signed proof.
assert.doesNotMatch(sharedLicenseService, /return applyCurrentEnforcement\(store\.state\);/);
assert.match(sharedLicenseService, /const offline = await usableOffline\(store\);/);

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
  assert.match(source, /import \{ directToolLicenseAllowed, startLicenseExpiryWatchdog \} from "\.\/license-gate\.js"/);
  assert.match(source, /await directToolLicenseAllowed\(\)/);
  assert.match(source, /startLicenseExpiryWatchdog\(\)/);
}

// Album Flow: stessa copertura licenza dei tool condivisi, più il cablaggio di pacchetto e rilascio.
assert.equal(desktopToolManifest["album-flow"].licenseRuntime, "shared-runtime");
const desktopScripts = JSON.parse(await readFile(resolve(root, "apps/filex-desktop/package.json"), "utf8")).scripts as Record<string, string>;
for (const name of ["dist:album-flow:win", "dist:album-flow:win64", "dist:album-flow:win32", "dist:album-flow:mac"]) {
  assert.match(desktopScripts[name] ?? "", /FILEX_TOOL=album-flow electron-builder/, `${name} mancante o non punta ad Album Flow`);
}
const manifestScript = await readFile(resolve(root, "apps/filex-desktop/scripts/generate-release-manifest.mjs"), "utf8");
assert.match(manifestScript, /toolId: "album-flow", executableName: "FileX-Album-Flow"/);
const launcherScript = await readFile(resolve(root, "apps/filex-desktop/scripts/build-suite-launcher.mjs"), "utf8");
assert.match(launcherScript, /"album-flow"/);
const albumApp = await readFile(resolve(root, "apps/album-flow/src/App.tsx"), "utf8");
assert.match(albumApp, /useLicenseNotice\(\)/, "Album Flow deve mostrare gli avvisi di licenza");

for (const toolId of Object.keys(standaloneEntries)) {
  assert.equal(desktopToolManifest[toolId as keyof typeof desktopToolManifest].licenseRuntime, "standalone");
}

console.log(`FileX license coverage passed for ${Object.keys(desktopToolManifest).length - 1} current tools and future manifest entries.`);
