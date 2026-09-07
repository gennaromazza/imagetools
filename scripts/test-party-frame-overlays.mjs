import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { tsImport } from "tsx/esm/api";
const requireDesktop = createRequire(new URL("../apps/filex-desktop/package.json", import.meta.url));
const requireParty = createRequire(new URL("../apps/image-party-frame/package.json", import.meta.url));
const { createServer } = await import(pathToFileURL(requireParty.resolve("vite")).href);
const root = fileURLToPath(new URL("../apps/image-party-frame/", import.meta.url));
for (const font of ['anton', 'bebas-neue', 'montserrat', 'playfair-display', 'cinzel', 'great-vibes', 'dancing-script', 'pacifico']) {
  const source = fileURLToPath(new URL(`../node_modules/@fontsource/${font}/LICENSE`, import.meta.url));
  assert.equal(await readFile(join(root, 'public/font-licenses', `${font}.txt`), 'utf8'), await readFile(source, 'utf8'), `Missing font license: ${font}`);
}
const profile = await mkdtemp(join(tmpdir(), "party-overlay-test-"));
let server;
let api;
let apiListener;
try {
  const { createPartyFrameApp } = await tsImport('../apps/image-party-frame/server/app.ts', import.meta.url);
  api = await createPartyFrameApp({ dataDir: join(profile, 'api-data'), sessionToken: null });
  apiListener = api.app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { apiListener.once('listening', resolve); apiListener.once('error', reject); });
  const apiOrigin = `http://127.0.0.1:${apiListener.address().port}`;
  server = await createServer({ root, configFile: join(root, "vite.config.ts"), define: { 'import.meta.env.VITE_IMAGE_PARTY_FRAME_API_BASE_URL': JSON.stringify(apiOrigin) }, server: { port: 0, strictPort: false, host: "127.0.0.1" } });
  await server.listen();
  const port = server.httpServer.address().port;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.PARTY_OVERLAY_API_ORIGIN = apiOrigin;
  const child = spawn(requireDesktop("electron"), [fileURLToPath(new URL("./test-party-frame-overlays.electron.cjs", import.meta.url)), profile, `http://127.0.0.1:${port}`], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  const timer = setTimeout(() => child.kill(), 90000);
  try {
    await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Overlay editor test exited ${code}`)));
    });
  } finally { clearTimeout(timer); }
} finally {
  await server?.close();
  if (apiListener) await new Promise((resolve) => apiListener.close(resolve));
  await api?.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
