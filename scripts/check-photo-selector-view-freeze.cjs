// Verifica manuale end-to-end (richiede il build di Image Select Pro): durante la classificazione
// la vista non si riordina e le foto valutate non spariscono dal filtro attivo.
//   node scripts/check-photo-selector-view-freeze.cjs
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const folder = path.join(require("node:os").tmpdir(), "imagetool-freeze-synth").split(path.sep).join("/");
const desktop = path.join(__dirname, "..", "apps", "filex-desktop");
const exe = path.join(desktop, "node_modules", "electron", "dist", "electron.exe");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9444;

(async () => {
  fs.mkdirSync(folder, { recursive: true });
  for (let i = 1; i <= 40; i++) {
    const f = `${folder}/IMG_${String(i).padStart(3, "0")}.jpg`;
    if (!fs.existsSync(f)) {
      fs.writeFileSync(f, await sharp({ create: { width: 800, height: 533, channels: 3, background: `rgb(${i * 6},${i * 3},${255 - i * 5})` } }).jpeg().toBuffer());
    }
  }
  for (const f of fs.readdirSync(folder)) if (/\.xmp$/i.test(f)) fs.unlinkSync(`${folder}/${f}`);

  const child = spawn(exe, [".", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", `--remote-debugging-port=${port}`, `--open-folder=${folder}`], { cwd: desktop, env: { ...process.env, FILEX_TOOL: "photo-selector-app" }, stdio: "ignore" });
  let target;
  for (let i = 0; i < 100 && !target; i++) { await sleep(300); try { const l = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); target = l.find((t) => t.type === "page" && !t.url.startsWith("devtools")); } catch {} }
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const ids = async () => JSON.parse(await ev(`JSON.stringify(Array.from(document.querySelectorAll('[data-preview-asset-id]')).map((e) => e.dataset.previewAssetId))`));
  const setSelect = (finder, value) => ev(`(() => { const s = ${finder}; if (!s) return 'select non trovata'; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, ${JSON.stringify(value)}); s.dispatchEvent(new Event('change', { bubbles: true })); return 'ok'; })()`);
  const key = async (k, code, vk) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, text: k.length === 1 ? k : undefined }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk }); };
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  for (let i = 0; i < 100; i++) { const n = (await ids()).length; if (n >= 10) break; await sleep(300); }
  await sleep(2500);
  const results = [];
  const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? " - " + detail : ""}`); };

  console.log("autoAdvanceOnAction nelle preferenze:", await ev(`window.filexDesktop.getDesktopPreferences().then((p) => String(p && p.autoAdvanceOnAction))`));
  // Test 1: filtro "Senza stelle"
  console.log("filtro:", await setSelect(`Array.from(document.querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => o.value === '0' && /Senza stelle/.test(o.text)))`, "0"));
  await sleep(600);
  const before = await ids();
  console.log("foto visibili con filtro 'Senza stelle':", before.length);
  await ev(`(document.querySelector('.photo-card')||{}).click?.(); (document.querySelector('.photo-card')||{}).focus?.(); 1`);
  await sleep(300);
  for (let i = 0; i < 4; i++) { const fb = await ev(`document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.previewAssetId : 'nessun focus su card'`); await key(String(i + 2), `Digit${i + 2}`, 50 + i); await sleep(350); await key('ArrowRight', 'ArrowRight', 39); await sleep(300); }
  const afterFilter = await ids();
  check("le foto valutate restano visibili nel filtro 'Senza stelle'", afterFilter.length === before.length, `prima ${before.length}, dopo ${afterFilter.length}`);
  const hasBtn = await ev(`Array.from(document.querySelectorAll('button')).some((b) => /Aggiorna vista/.test(b.textContent))`);
  check("compare il pulsante 'Aggiorna vista'", hasBtn === true);
  await ev(`Array.from(document.querySelectorAll('button')).find((b) => /Aggiorna vista/.test(b.textContent))?.click(); 1`);
  await sleep(600);
  const refreshed = await ids();
  check("dopo 'Aggiorna vista' il filtro viene riapplicato", refreshed.length === before.length - 4, `visibili ${refreshed.length} (attese ${before.length - 4})`);

  // Test 2: ordinamento per valutazione
  await setSelect(`Array.from(document.querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => o.value === '0' && /Senza stelle/.test(o.text)))`, "any");
  await sleep(500);
  console.log("ordinamento:", await setSelect(`document.querySelector('select.photo-selector__sort')`, "rating"));
  await sleep(800);
  const order0 = await ids();
  await ev(`(document.querySelectorAll('.photo-card')[8]||{}).click?.(); (document.querySelectorAll('.photo-card')[8]||{}).focus?.(); 1`);
  await sleep(300);
  for (let i = 0; i < 3; i++) { await key("5", "Digit5", 53); await sleep(350); await key("ArrowRight", "ArrowRight", 39); await sleep(300); }
  const order1 = await ids();
  check("l'ordine per valutazione non cambia mentre si classifica", same(order0, order1));
  await ev(`Array.from(document.querySelectorAll('button')).find((b) => /Aggiorna vista/.test(b.textContent))?.click(); 1`);
  await sleep(700);
  const order2 = await ids();
  check("dopo 'Aggiorna vista' l'ordine viene riordinato per valutazione", !same(order0, order2));

  ws.close(); child.kill();
  await sleep(500);
  fs.rmSync(folder, { recursive: true, force: true });
  console.log(results.every(Boolean) ? "TUTTO OK" : "CI SONO FALLIMENTI");
  process.exit(results.every(Boolean) ? 0 : 1);
})();
