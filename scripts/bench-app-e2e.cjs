// Benchmark end-to-end di Image Select Pro (Electron in sviluppo, pilotato via CDP).
//   node scripts/bench-app-e2e.cjs <cartella> [--keys]
// ATTENZIONE: con --keys il test assegna rating e quindi SCRIVE sidecar XMP nella cartella: usare una copia.
const { spawn } = require("node:child_process");
const path = require("node:path");
const folder = process.argv[2]; const doKeys = process.argv.includes("--keys");
const desktop = path.join(__dirname, "..", "apps", "filex-desktop");
const exe = path.join(desktop, "node_modules", "electron", "dist", "electron.exe");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9333;
(async () => {
  const t0 = Date.now();
  const child = spawn(exe, [".", `--remote-debugging-port=${port}`, `--open-folder=${folder}`], { cwd: desktop, env: { ...process.env, FILEX_TOOL: "photo-selector-app" }, stdio: ["ignore", require("node:fs").openSync(process.env.BENCH_MAIN_LOG || "bench-main.log", "w"), require("node:fs").openSync(process.env.BENCH_MAIN_LOG || "bench-main.log", "a")] });
  let target;
  for (let i = 0; i < 200 && !target; i++) { await sleep(300); try { const l = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); target = l.find((t) => t.type === "page" && !t.url.startsWith("devtools")); } catch {} }
  if (!target) { console.log("pagina non trovata"); child.kill(); process.exit(1); }
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => { const r = await Promise.race([sleep(8000).then(() => null), send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })]); return r === null ? "TIMEOUT" : r.result?.result?.value; };
  console.log(`processo avviato, pagina raggiungibile dopo ${Date.now() - t0} ms`);
  const cards = () => ev(`document.querySelectorAll('.photo-card img[src]').length`);
  let firstCard = null, snap = null;
  for (let i = 0; i < 1500 && Date.now() - t0 < 900000; i++) {
    const n = await cards();
    if (n > 0 && firstCard === null) { firstCard = Date.now() - t0; console.log(`prima miniatura visibile: ${firstCard} ms dall'avvio`); }
    snap = await ev(`window.filexDesktop && window.filexDesktop.getDesktopPerformanceSnapshot ? window.filexDesktop.getDesktopPerformanceSnapshot() : null`);
    if (snap && snap.folderOpenToGridCompleteMs && snap.lastUpdatedAt && snap.lastUpdatedAt > t0) break;
    if (i % 12 === 0) console.log(`  t=${((Date.now() - t0) / 1000).toFixed(0)}s miniature nel DOM: ${n}, snapshot: ${snap ? snap.folderOpenToGridCompleteMs : 'assente'}, richieste miniature (log): ${(() => { try { const txt = require('node:fs').readFileSync(process.env.BENCH_MAIN_LOG || 'bench-main.log', 'utf8'); const m = txt.match(/req (\d+)/g); return (m ? m[m.length - 1] : 'req 0') + ', foto elaborate: ' + (txt.match(/avg bytes-read/g) || []).length; } catch { return '?'; } })()}`);
    await sleep(400);
  }
  console.log("snapshot app:", JSON.stringify(snap));
  if (doKeys) {
    await ev(`(() => { window.__lat = []; window.__long = []; window.addEventListener('keydown', (e) => { const t = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => window.__lat.push([e.key, performance.now() - t]))); }, true);
      try { new PerformanceObserver((l) => l.getEntries().forEach((x) => window.__long.push(x.duration))).observe({ entryTypes: ['longtask'] }); } catch {} })()`);
    await ev(`document.querySelector('.photo-card')?.click(); document.querySelector('.photo-card')?.focus(); 1`);
    await sleep(500);
    const key = async (k, code, vk) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, text: k.length === 1 ? k : undefined }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk }); };
    for (let i = 0; i < 40; i++) { await key(String((i % 5) + 1), `Digit${(i % 5) + 1}`, 49 + (i % 5)); await sleep(180); await key("ArrowRight", "ArrowRight", 39); await sleep(180); }
    const lat = await ev(`JSON.stringify(window.__lat)`); const lg = await ev(`JSON.stringify(window.__long)`);
    const rate = JSON.parse(lat).filter((x) => /^[1-5]$/.test(x[0])).map((x) => x[1]).sort((a, b) => a - b);
    const nav = JSON.parse(lat).filter((x) => x[0] === "ArrowRight").map((x) => x[1]).sort((a, b) => a - b);
    const pct = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(0) : "n/d";
    console.log(`rating (tasto->paint) n=${rate.length}: mediana ${pct(rate, .5)} ms, p90 ${pct(rate, .9)} ms, max ${pct(rate, 1)} ms`);
    console.log(`frecce (tasto->paint) n=${nav.length}: mediana ${pct(nav, .5)} ms, p90 ${pct(nav, .9)} ms, max ${pct(nav, 1)} ms`);
    const L = JSON.parse(lg); console.log(`long task (>50ms) durante i tasti: ${L.length}, max ${L.length ? Math.max(...L).toFixed(0) : 0} ms`);
  }
  ws.close(); child.kill(); await sleep(500); process.exit(0);
})();
