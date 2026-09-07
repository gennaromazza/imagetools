import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { spawn } from "node:child_process";
const require = createRequire(new URL("../apps/filex-desktop/package.json", import.meta.url));
const root = resolve(import.meta.dirname, "../.codex-remote-attachments");
await mkdir(root, { recursive: true });
const profile = await mkdtemp(join(root, "trial-ui-profile-"));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
try {
  const child = spawn(require("electron"), [resolve(import.meta.dirname, "test-filex-trial-ui.electron.cjs"), profile, root], { windowsHide: true, stdio: "inherit", env });
  const timeout = setTimeout(() => child.kill(), 45000);
  try {
    await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error(`Trial UI: exit ${code}`))); });
  } finally { clearTimeout(timeout); }
} finally {
  if (!resolve(profile).startsWith(root + sep) || !profile.startsWith(join(root, "trial-ui-profile-"))) throw new Error("Unsafe test cleanup path");
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
