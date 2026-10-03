#!/usr/bin/env node
// Avvio pulito della FileX Dev Console (usato da avvia-progetto.bat).
//
//   prepare  chiude la console precedente e i tool avviati da essa, poi esce con 0 se si puo' partire
//   status   dice chi occupa la porta, senza fermare nulla
//   open     aspetta che la console risponda e apre il browser
//
// Regola di sicurezza: non si uccide MAI un processo per nome o in massa. Si ferma soltanto chi ascolta sulla porta
// della console E ha nella riga di comando il percorso della nostra console; qualunque altro programma sulla
// stessa porta fa fermare l'avvio con un messaggio.

import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const CONSOLE_PORT = 4390;
export const CONSOLE_URL = `http://127.0.0.1:${CONSOLE_PORT}`;

const execFileP = promisify(execFile);

/** Riga di comando del processo node della nostra console (non di altri programmi Node, es. Adobe). */
export function isDevConsoleCommand(commandLine) {
  return typeof commandLine === "string" && /filex-dev-console[\\/]server[\\/]index\.ts/i.test(commandLine);
}

/** Cosa fare in base a chi occupa la porta della console e a se' e' davvero la nostra (verificato a parte). */
export function planLaunch(listener, ours) {
  if (!listener) return { action: "start" };
  if (ours) return { action: "replace", pid: listener.pid };
  return {
    action: "refuse",
    reason: `La porta ${CONSOLE_PORT} e' occupata da un altro programma (${listener.name ?? "sconosciuto"}, processo ${listener.pid}): non lo chiudo. Liberala a mano o cambia porta.`,
  };
}

/**
 * Prepara l'avvio. Le dipendenze sono iniettate per poter provare ogni caso senza toccare processi veri.
 * deps: { getListener(port), isOurConsole(listener), post(url), kill(pid), waitPortFree(port, ms), log(message) }
 */
export async function prepareDevConsole(deps) {
  const { getListener, isOurConsole, post, kill, waitPortFree, log } = deps;
  const listener = await getListener(CONSOLE_PORT);
  const plan = planLaunch(listener, listener ? await isOurConsole(listener) : false);
  if (plan.action === "refuse") { log(plan.reason); return { ok: false, action: "refuse", reason: plan.reason }; }
  if (plan.action === "start") { log("Nessuna console precedente: parto subito."); return { ok: true, action: "start" }; }

  log(`Trovata una console precedente (processo ${plan.pid}).`);
  // 1) Fermo i tool avviati dalla console: lo fa lei stessa, e tocca solo cio' che ha registrato
  //    e i server Vite FileX riconosciuti. Se non risponde si prosegue: la chiudo comunque.
  const stopped = await post(`${CONSOLE_URL}/api/tools/stop-all`).catch(() => false);
  log(stopped ? "Tool avviati dalla console: fermati." : "La console non ha risposto sullo stop dei tool: proseguo.");
  // 2) Chiusura ordinata della console.
  await post(`${CONSOLE_URL}/api/dev/shutdown`).catch(() => false);
  if (await waitPortFree(CONSOLE_PORT, 8_000)) { log("Console precedente chiusa."); return { ok: true, action: "replace", forced: false }; }

  // 3) Non si e' chiusa: solo ora la fermo con la forza, dopo aver riverificato che sia ancora la nostra.
  const again = await getListener(CONSOLE_PORT);
  if (again && !(await isOurConsole(again))) {
    const reason = `La porta ${CONSOLE_PORT} e' ora occupata da un altro programma (${again.name ?? "sconosciuto"}): non lo chiudo.`;
    log(reason);
    return { ok: false, action: "refuse", reason };
  }
  if (again) await kill(again.pid);
  if (await waitPortFree(CONSOLE_PORT, 5_000)) { log("Console precedente chiusa a forza."); return { ok: true, action: "replace", forced: true }; }
  const reason = `Non sono riuscito a liberare la porta ${CONSOLE_PORT}.`;
  log(reason);
  return { ok: false, action: "stuck", reason };
}

// ── Implementazioni reali (solo Windows) ─────────────────────────────────────

async function powershell(script) {
  const { stdout } = await execFileP("powershell", ["-NoProfile", "-Command", script], { timeout: 10_000, windowsHide: true, encoding: "utf8" });
  return stdout.trim();
}

async function realGetListener(port) {
  const script = [
    `$c = Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1`,
    "if ($null -eq $c) { exit 0 }",
    "$p = Get-CimInstance Win32_Process -Filter \"ProcessId=$($c.OwningProcess)\" -ErrorAction SilentlyContinue",
    "if ($null -eq $p) { exit 0 }",
    "[pscustomobject]@{ pid = [int]$p.ProcessId; name = [string]$p.Name; commandLine = [string]$p.CommandLine } | ConvertTo-Json -Compress",
  ].join("; ");
  try {
    const out = await powershell(script);
    return out ? JSON.parse(out) : null;
  } catch {
    return null;
  }
}

/**
 * La porta e' della nostra console? Tre prove, dalla piu' sicura: la console stessa dichiara il suo processo;
 * il percorso completo nella riga di comando; per le console avviate prima che esistesse la dichiarazione,
 * un node con `server/index.ts` che risponde con l'elenco dei tool FileX.
 */
async function realIsOurConsole(listener) {
  if (isDevConsoleCommand(listener.commandLine)) return true;
  try {
    const response = await fetch(`${CONSOLE_URL}/api/dev/identity`, { signal: AbortSignal.timeout(2_500) });
    if (response.ok) {
      const body = await response.json();
      if (body?.app === "filex-dev-console" && body.pid === listener.pid) return true;
    }
  } catch { /* console vecchia o non raggiungibile */ }
  if (String(listener.name).toLowerCase() === "node.exe" && /server[\/]index\.ts/i.test(listener.commandLine ?? "")) {
    try {
      const response = await fetch(`${CONSOLE_URL}/api/tools`, { signal: AbortSignal.timeout(2_500) });
      const body = await response.json();
      const ids = (Array.isArray(body) ? body : body?.tools ?? []).map((tool) => tool?.id);
      return ids.includes("suite-launcher") && ids.includes("archivio-flow");
    } catch { return false; }
  }
  return false;
}

async function realPost(url) {
  const response = await fetch(url, { method: "POST", signal: AbortSignal.timeout(20_000) });
  return response.ok;
}

async function realKill(pid) {
  await execFileP("taskkill", ["/pid", String(Number(pid)), "/t", "/f"], { timeout: 15_000, windowsHide: true });
}

async function realWaitPortFree(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await realGetListener(port))) return true;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return !(await realGetListener(port));
}

async function openWhenReady(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${CONSOLE_URL}/api/tools`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        await execFileP("cmd", ["/c", "start", "", CONSOLE_URL], { windowsHide: true });
        return true;
      }
    } catch { /* il server non e' ancora pronto */ }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return false;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mode = process.argv[2];
  if (mode === "prepare") {
    const result = await prepareDevConsole({
      getListener: realGetListener, isOurConsole: realIsOurConsole, post: realPost, kill: realKill, waitPortFree: realWaitPortFree,
      log: (message) => console.log(`  ${message}`),
    });
    process.exit(result.ok ? 0 : 1);
  } else if (mode === "status") {
    const listener = await realGetListener(CONSOLE_PORT);
    const plan = planLaunch(listener, listener ? await realIsOurConsole(listener) : false);
    console.log(plan.action === "start" ? "  Porta libera: nessuna console in esecuzione." : plan.action === "replace" ? `  Console in esecuzione (processo ${plan.pid}).` : `  ${plan.reason}`);
    process.exit(0);
  } else if (mode === "open") {
    const opened = await openWhenReady();
    if (!opened) console.log("  La console non ha risposto in tempo: apri a mano " + CONSOLE_URL);
    process.exit(0);
  } else {
    console.log("Uso: node scripts/dev-console-launcher.mjs prepare|open|status");
    process.exit(2);
  }
}
