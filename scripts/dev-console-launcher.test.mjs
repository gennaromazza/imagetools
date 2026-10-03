import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CONSOLE_PORT, isDevConsoleCommand, planLaunch, prepareDevConsole } from "./dev-console-launcher.mjs";

const OURS = 'C:\\Program Files\\nodejs\\node.exe --require D:\\IMAGETOOL_REMOTE\\node_modules\\tsx\\dist\\preflight.cjs --import file:///D:/IMAGETOOL_REMOTE/node_modules/tsx/dist/loader.mjs D:\\IMAGETOOL_REMOTE\\apps\\filex-dev-console\\server\\index.ts';
const ARCHIVIO = '"C:\\Program Files\\nodejs\\node.exe" --require D:\\IMAGETOOL_REMOTE\\node_modules\\tsx\\dist\\preflight.cjs --import file:///D:/IMAGETOOL_REMOTE/node_modules/tsx/dist/loader.mjs server/index.ts';
const OURS_RELATIVE = '"C:\Program Files\nodejs\node.exe" --require D:\IMAGETOOL_REMOTE\node_modules\tsx\dist\preflight.cjs --import file:///D:/IMAGETOOL_REMOTE/node_modules/tsx/dist/loader.mjs server/index.ts';
const ADOBE = '"C:\\Program Files\\Adobe\\Adobe Creative Cloud Experience\\libs\\node.exe" "C:\\Program Files\\Adobe\\Adobe Creative Cloud Experience\\js\\main.js"';

test("riconosce solo la nostra console: né il server di Archivio Flow né altri node", () => {
  assert.equal(isDevConsoleCommand(OURS), true);
  assert.equal(isDevConsoleCommand(OURS.toLowerCase().replaceAll("\\", "/")), true, "anche con barre e maiuscole diverse");
  assert.equal(isDevConsoleCommand(ARCHIVIO), false, "il server di Archivio Flow (3003) non si tocca");
  assert.equal(isDevConsoleCommand(ADOBE), false);
  assert.equal(isDevConsoleCommand(""), false);
  assert.equal(isDevConsoleCommand(undefined), false);
  assert.equal(isDevConsoleCommand("node D:\\x\\filex-dev-console\\README.md"), false);
});

test("piano d'avvio: porta libera, nostra console o altro programma", () => {
  assert.deepEqual(planLaunch(null, false), { action: "start" });
  assert.deepEqual(planLaunch({ pid: 10, name: "node.exe", commandLine: OURS }, true), { action: "replace", pid: 10 });
  const refuse = planLaunch({ pid: 11, name: "node.exe", commandLine: ADOBE }, false);
  assert.equal(refuse.action, "refuse");
  assert.match(refuse.reason, /non lo chiudo/);
  assert.match(refuse.reason, /processo 11/);
});

function fakes(overrides = {}) {
  const calls = { posts: [], kills: [], logs: [] };
  let listener = overrides.listener ?? null;
  const deps = {
    getListener: async () => listener,
    isOurConsole: async (candidate) => candidate.commandLine === OURS || candidate.commandLine === OURS_RELATIVE,
    post: async (url) => { calls.posts.push(url); if (overrides.postFails) throw new Error("irraggiungibile"); if (overrides.onPost) overrides.onPost(url, (value) => { listener = value; }); return true; },
    kill: async (pid) => { calls.kills.push(pid); if (overrides.killFrees) listener = null; },
    waitPortFree: async () => listener === null,
    log: (message) => calls.logs.push(message),
  };
  return { deps, calls, setListener: (value) => { listener = value; } };
}

test("avvio: anche una console avviata con il percorso relativo (npm run start) viene riconosciuta dalla verifica, non dal solo testo", async () => {
  const { deps, calls } = fakes({
    listener: { pid: 10, name: "node.exe", commandLine: OURS_RELATIVE },
    onPost: (url, setListener) => { if (url.endsWith("/api/dev/shutdown")) setListener(null); },
  });
  assert.equal(isDevConsoleCommand(OURS_RELATIVE), false, "da sola la riga di comando non basta");
  assert.deepEqual(await prepareDevConsole(deps), { ok: true, action: "replace", forced: false });
  assert.equal(calls.posts.length, 2);
});

test("avvio: porta libera, si parte senza chiudere nulla", async () => {
  const { deps, calls } = fakes();
  assert.deepEqual(await prepareDevConsole(deps), { ok: true, action: "start" });
  assert.deepEqual([calls.posts, calls.kills], [[], []]);
});

test("avvio: console precedente che risponde, prima si fermano i tool e poi la console, senza forzare", async () => {
  const { deps, calls } = fakes({
    listener: { pid: 10, name: "node.exe", commandLine: OURS },
    onPost: (url, setListener) => { if (url.endsWith("/api/dev/shutdown")) setListener(null); },
  });
  const result = await prepareDevConsole(deps);
  assert.deepEqual(result, { ok: true, action: "replace", forced: false });
  assert.deepEqual(calls.posts, [`http://127.0.0.1:${CONSOLE_PORT}/api/tools/stop-all`, `http://127.0.0.1:${CONSOLE_PORT}/api/dev/shutdown`], "tool prima, console dopo");
  assert.deepEqual(calls.kills, []);
});

test("avvio: console bloccata, si ferma a forza solo il suo processo", async () => {
  const { deps, calls } = fakes({ listener: { pid: 10, name: "node.exe", commandLine: OURS }, postFails: true, killFrees: true });
  const result = await prepareDevConsole(deps);
  assert.deepEqual(result, { ok: true, action: "replace", forced: true });
  assert.deepEqual(calls.kills, [10]);
  assert.ok(calls.logs.some((line) => /non ha risposto/.test(line)), "lo dice");
});

test("avvio: se la porta passa a un altro programma durante l'attesa, non lo si uccide", async () => {
  const { deps, calls, setListener } = fakes({ listener: { pid: 10, name: "node.exe", commandLine: OURS }, postFails: true });
  deps.waitPortFree = async () => { setListener({ pid: 77, name: "node.exe", commandLine: ADOBE }); return false; };
  const result = await prepareDevConsole(deps);
  assert.equal(result.ok, false);
  assert.equal(result.action, "refuse");
  assert.deepEqual(calls.kills, [], "nessuna uccisione di un processo che non e' la console");
});

test("avvio: la porta e' di un altro programma, si rifiuta senza fare nulla", async () => {
  const { deps, calls } = fakes({ listener: { pid: 55, name: "node.exe", commandLine: ADOBE } });
  const result = await prepareDevConsole(deps);
  assert.equal(result.ok, false);
  assert.equal(result.action, "refuse");
  assert.deepEqual([calls.posts, calls.kills], [[], []]);
  assert.ok(calls.logs.some((line) => /processo 55/.test(line)));
});

test("avvio: se la porta resta occupata anche dopo la chiusura forzata, lo dice e fallisce", async () => {
  const { deps, calls } = fakes({ listener: { pid: 10, name: "node.exe", commandLine: OURS }, postFails: true });
  const result = await prepareDevConsole(deps);
  assert.deepEqual([result.ok, result.action], [false, "stuck"]);
  assert.deepEqual(calls.kills, [10]);
});

test("avvia-progetto.bat: usa il lanciatore, si ferma se fallisce e non uccide mai processi in massa", () => {
  const bat = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "avvia-progetto.bat"), "utf8");
  assert.match(bat, /dev-console-launcher\.mjs"?\s+prepare/);
  assert.match(bat, /errorlevel/i, "se la preparazione fallisce non si avvia nulla");
  assert.match(bat, /dev-console-launcher\.mjs"?\s+open/, "il browser si apre quando la console risponde");
  assert.match(bat, /npm run console/);
  assert.ok(bat.indexOf("prepare") < bat.indexOf("npm run console"), "prima si prepara, poi si avvia");
  assert.doesNotMatch(bat, /taskkill\s+\/f\s+\/im|taskkill\s+\/im|Stop-Process\s+-Name|killall|wmic\s+process/i, "nessuna chiusura per nome");
  assert.doesNotMatch(bat, /start\s+""\s+http:\/\/127\.0\.0\.1:4390/, "non si apre piu' il browser prima che il server sia pronto");
});
