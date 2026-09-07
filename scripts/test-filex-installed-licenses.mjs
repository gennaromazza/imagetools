import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { extractFile, listPackage } from "@electron/asar";

// Inspector redirects only appData/userData and observes lifecycle events.
// The installed production license code, signatures and enforcement are unchanged.
const components = {
  suite: "FileX-Suite", "photo-selector-app": "Image-Select-Pro", "image-party-frame": "Image-Party-Frame",
  "batch-print-layout": "Batch-Print-Layout", "id-photo": "FileX-ID-Photo", "archivio-flow": "Archivio-Flow",
  "image-converter": "Image-Converter", "image-file-finder": "Trova-Foto-da-Lista", "cache-sweep": "FileX-Adobe-Cleaner",
  "filex-send": "FileX-Send", "backup-guard": "FileX-Backup-Guard",
};
const selected = process.env.FILEX_TEST_COMPONENT ? [process.env.FILEX_TEST_COMPONENT] : Object.keys(components);
for (const id of selected) assert.ok(components[id], `Componente non riconosciuto: ${id}`);
const temporaryBase = resolve(".codex-remote-attachments/installed-license-tests"); await mkdir(temporaryBase, { recursive: true });
const realLicense = await readFile(join(process.env.APPDATA, "FileX/filex-license.json"), "utf8");
const original = JSON.parse(realLicense); assert.ok(original.attestation, "Occorre una licenza reale firmata per il collaudo installato.");
for (const id of selected) {
  const name = components[id]; const install = join(process.env.LOCALAPPDATA, "Programs", name);
  const archive = join(install, "resources/app.asar");
  const metadata = JSON.parse(extractFile(archive, "package.json").toString());
  const expected = JSON.parse(await readFile(`apps/${id === "suite" ? "filex-desktop" : id}/package.json`, "utf8"));
  assert.equal(metadata.version, expected.version, `${id}: installer non aggiornato`);
  const entries = new Set(listPackage(archive).map(path => path.replaceAll("\\", "/").replace(/^\//, "")));
  const queue = [metadata.main]; const seen = new Set();
  while (queue.length) {
    const path = queue.pop(); if (seen.has(path)) continue; seen.add(path); assert.ok(entries.has(path), `Import mancante: ${path}`);
    const source = extractFile(archive, path.replaceAll("/", "\\")).toString();
    const { posix } = await import("node:path");
    for (const match of source.matchAll(/(?:from\s*|import\s*\(\s*)["'](\.{1,2}\/[^"']+\.js)["']/g)) queue.push(posix.normalize(posix.join(posix.dirname(path), match[1])));
  }
  for (const mode of ["absent", "active", "tampered"]) {
    const temporary = await mkdtemp(join(temporaryBase, `${id}-${mode}-`));
    try {
      await mkdir(join(temporary, "FileX"));
      if (mode !== "absent") await writeFile(join(temporary, "FileX/filex-license.json"), mode === "active" ? realLicense : JSON.stringify({ ...original, activationTokenEncrypted: undefined, attestation: "tampered", state: { status: "active", enforcement: "observe", canUseTools: true } }));
      const report = await run(join(install, `${name}.exe`), temporary, id === "suite" || mode === "active");
      assert.equal(report.packaged, true); assert.equal(report.appData, temporary);
      assert.equal(report.ready, true, `${id}/${mode}: main process non pronto`);
      assert.equal(report.loaded, id === "suite" || mode === "active", `${id}/${mode}: policy licenza errata (${JSON.stringify(report)})`);
      assert.deepEqual(report.errors, [], `${id}/${mode}: errore main/renderer`);
      console.log(`PASS installato ${id} ${metadata.version}: ${mode}, import ${seen.size}`);
    } finally {
      assert.ok(resolve(temporary).startsWith(temporaryBase + "\\"));
      await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    }
  }
}

async function run(executable, directory, shouldLoad) {
  const reportPath = join(directory, "smoke.json");
  const child = spawn(executable, ["--inspect-brk=127.0.0.1:0", `--user-data-dir=${join(directory, "profile")}`], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  let ws; let output = ""; let configured = false; let failure;
  child.on("error", error => { failure = error; });
  const exited = new Promise(resolveExit => child.once("exit", code => resolveExit(code)));
  child.stderr.on("data", chunk => {
    output += chunk; const match = output.match(/ws:\/\/127\.0\.0\.1:\d+\/[\w-]+/); if (!match || ws) return;
    ws = new WebSocket(match[0]);
    const send = (id, method, params) => ws.send(JSON.stringify({ id, method, params }));
    ws.onopen = () => { send(1, "Debugger.enable"); send(2, "Runtime.runIfWaitingForDebugger"); };
    ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.method === "Debugger.paused" && !configured) {
        configured = true;
        send(3, "Runtime.evaluate", { expression: `(()=>{
          const req=process.getBuiltinModule('module').createRequire(process.execPath), e=req('electron'), fs=req('node:fs');
          e.app.setPath('appData',${JSON.stringify(directory)});
          const state={packaged:e.app.isPackaged,appData:e.app.getPath('appData'),ready:false,loaded:false,errors:[],dialogs:[]};
          const save=()=>fs.writeFileSync(${JSON.stringify(reportPath)},JSON.stringify(state)); save();
          e.dialog.showErrorBox=(title,content)=>{state.dialogs.push({title,content});save();};
          process.on('uncaughtExceptionMonitor',error=>{state.errors.push(String(error));save();});
          e.app.on('ready',()=>{state.ready=true;save();});
          e.app.on('before-quit',()=>{state.quitting=true;save();});
          e.app.on('browser-window-created',(_,window)=>{
            window.webContents.on('did-finish-load',()=>{state.loaded=true;save();});
            window.webContents.on('render-process-gone',(_,details)=>{state.errors.push(details.reason);save();});
          });
          return true;
        })()`, returnByValue: true });
      }
      if (message.id === 3) {
        if (message.result?.exceptionDetails || message.error) { failure = new Error(JSON.stringify(message)); child.kill(); }
        else send(4, "Debugger.resume");
      }
    };
    ws.onerror = () => { failure = new Error("Connessione inspector fallita"); };
  });
  try {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      const report = await readFile(reportPath, "utf8").then(JSON.parse, () => null);
      if (report?.loaded || report?.errors?.length || report?.quitting || (child.exitCode !== null && report)) {
        if (report.loaded) await new Promise(resolveWait => setTimeout(resolveWait, 2000));
        return await readFile(reportPath, "utf8").then(JSON.parse);
      }
      if (child.exitCode !== null && !report) throw new Error(`Uscita anticipata ${child.exitCode}`);
      await new Promise(resolveWait => setTimeout(resolveWait, 250));
    }
    throw new Error(`Timeout main process, caricamento atteso: ${shouldLoad}`);
  } finally {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ id: 99, method: "Runtime.evaluate", params: { expression: "process.getBuiltinModule('module').createRequire(process.execPath)('electron').app.quit()" } }));
      ws.close();
    }
    if (child.exitCode === null) {
      const ended = await Promise.race([exited.then(() => true), new Promise(resolveWait => setTimeout(() => resolveWait(false), 5000))]);
      if (!ended) { child.kill(); await exited; }
    }
  }
}
