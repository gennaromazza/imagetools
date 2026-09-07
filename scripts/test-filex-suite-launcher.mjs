import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const require = createRequire(new URL("../apps/filex-desktop/package.json", import.meta.url));
const profile = await mkdtemp(join(tmpdir(), "filex-launcher-test-"));
try {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  for (const entry of ["./test-filex-suite-launcher.electron.cjs", "./test-filex-suite-inbox.electron.cjs"]) {
  const child = spawn(require("electron"), [
    fileURLToPath(new URL(entry, import.meta.url)), profile,
  ], { stdio: "inherit", windowsHide: true, env });
  const timeout = setTimeout(() => child.kill(), 30000);
  try {
    await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code) => code === 0 ? resolve() : reject(new Error("Launcher test exit: " + code)));
    });
  } finally { clearTimeout(timeout); }
  }
} finally {
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
