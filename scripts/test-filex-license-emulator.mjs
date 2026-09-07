import { createRequire } from "node:module";
import { mkdir, writeFile, access } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");
const directory = join(root, ".codex-remote-attachments/license-audit-runtime");
await mkdir(directory, { recursive: true });
async function port() {
  const server = createServer(); await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value;
}
const config = join(directory, "firebase-audit.json");
await writeFile(config, JSON.stringify({
  firestore: { rules: join(root,"firestore.rules"), indexes: join(root,"firestore.indexes.json") },
  emulators: { firestore: {host:"127.0.0.1",port:await port()}, auth: {host:"127.0.0.1",port:await port()}, hub: {host:"127.0.0.1",port:await port()}, logging: {host:"127.0.0.1",port:await port()}, ui:{enabled:false}, singleProjectMode:true },
}));
const env = { ...process.env };
const portableJava = join(directory,"jdk-21.0.12.1+1-jre");
if (!env.JAVA_HOME && await access(join(portableJava,"bin/java.exe")).then(()=>true,()=>false)) env.JAVA_HOME = portableJava;
const pathVariable = Object.keys(env).find(key => key.toLowerCase() === "path") ?? "PATH";
env[pathVariable] = [dirname(process.execPath), ...(env.JAVA_HOME ? [join(env.JAVA_HOME,"bin")] : []), env[pathVariable]].join(process.platform === "win32" ? ";" : ":");
const firebaseBin = join(dirname(require.resolve("firebase-tools/package.json")), "lib/bin/firebase.js");
const child = spawn(process.execPath,[firebaseBin,"emulators:exec","--project","demo-filex-license-audit","--config",config,"--only","firestore,auth",`"${process.execPath}" --import tsx scripts/test-filex-license-emulator.ts`],{cwd:root,env,stdio:"inherit",windowsHide:true});
await new Promise((resolve,reject)=>{child.on("error",reject);child.on("exit",code=>code===0?resolve():reject(new Error(`Emulator audit failed: ${code}`)));});
