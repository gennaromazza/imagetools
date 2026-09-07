const { app, BrowserWindow } = require('electron');
const { createServer } = require('node:http');
const { readFile, writeFile } = require('node:fs/promises');
const { resolve, extname, sep } = require('node:path');
const assert = require('node:assert/strict');
app.setPath('userData', process.argv[2]);
const root = resolve(__dirname, '..');
const fixture = `
const trial = {schemaVersion:1,status:'active',enforcement:'enforce',canUseTools:true,trial:true,validUntil:Date.now()+30*86400000,offlineUntil:Date.now()+86400000,activation:{current:1,limit:1},message:'Prova gratuita attiva.'};
window.filexDesktop={getLicenseState:async()=>({status:'unlicensed',enforcement:'enforce',canUseTools:false,activation:{current:0,limit:2}}),getRuntimeInfo:async()=>({appVersion:'test',releaseChannel:'test'}),listAvailableTools:async()=>[],getSuiteUpdateState:async()=>({status:'idle'}),onSuiteUpdateState:()=>{},startTrial:async()=>{},finishTrial:async()=>trial,activateLicense:async()=>({...trial,trial:false,activation:{current:1,limit:2}}),openLicenseCheckout:async()=>{},deactivateLicense:async()=>({status:'unlicensed',activation:{current:0,limit:2}})};`;
const accountFixture = `
export const auth={};
export const observeAccount=callback=>callback({emailVerified:true,email:'trial@example.test'});
export const accountApi=async(path)=>path==='/trial/approve'?{validUntil:Date.now()+30*86400000}:{email:'trial@example.test',subscriptions:[]};
export const friendlyAuthError=error=>error.message;
export const loginAccount=async()=>{}; export const logoutAccount=async()=>{}; export const refreshAccount=async()=>({emailVerified:true}); export const registerAccount=async()=>{}; export const resendVerification=async()=>{}; export const resetAccountPassword=async()=>{};`;
app.whenReady().then(async () => {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/assets/firebase-account.js') { response.setHeader('Content-Type','text/javascript'); return response.end(accountFixture); }
      const suite = pathname.startsWith('/suite/');
      const base = resolve(root, suite ? 'apps/filex-desktop/suite-launcher-src' : 'website');
      const relative = suite ? pathname.slice('/suite/'.length) : pathname.slice(1);
      const path = resolve(base, relative.endsWith('/') || !relative ? relative + 'index.html' : relative);
      if (!path.startsWith(base + sep)) { response.statusCode=403; return response.end(); }
      let body = await readFile(path);
      if (suite && extname(path)==='.html') body = Buffer.from(body.toString().replace('<script type="module"', `<script>${fixture}</script><script type="module"`));
      response.setHeader('Content-Type', ({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp'})[extname(path)] || 'application/octet-stream');
      response.end(body);
    } catch { response.statusCode=404; response.end(); }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const window = new BrowserWindow({width:1280,height:960,show:false,webPreferences:{contextIsolation:true,sandbox:true}});
  const errors=[];
  window.webContents.on('console-message', details => { if (details.level==='error' && !details.message.includes('404')) errors.push(details.message); });
  const run = source => window.webContents.executeJavaScript(source);
  const settle = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await window.loadURL(origin+'/suite/'); await settle();
  assert.equal(await run("document.querySelector('#license-dialog').open"),true);
  assert.equal(await run("document.querySelector('#license-trial').disabled"),false);
  assert.equal(await run("getComputedStyle(document.querySelector('#trial-purchase')).display"),'none');
  await writeFile(resolve(process.argv[3],'trial-suite-start.png'),(await window.webContents.capturePage()).toPNG());
  await run("document.querySelector('#license-trial').click()");
  await new Promise(resolve=>setTimeout(resolve,5500));
  assert.equal(await run("document.querySelector('#license-active-view').hidden"),false);
  assert.match(await run("document.querySelector('#license-state-badge').textContent"),/30 GIORNI/);
  await run("document.querySelector('#trial-enter-key').click(); document.querySelector('#license-consent').click(); document.querySelector('#license-key').value='FILEX-TEST-PAID'; document.querySelector('#license-activate').click()");
  await settle();
  assert.equal(await run("document.querySelector('#trial-purchase').hidden"),true);
  assert.equal(await run("getComputedStyle(document.querySelector('#trial-purchase')).display"),'none');
  assert.equal(await run("document.querySelector('#license-devices').textContent"),'1 di 2');
  await window.loadURL(origin+'/account/#trial='+'a'.repeat(43)); await settle();
  assert.equal(await run("document.querySelector('#dashboard').hidden"),false);
  assert.equal(await run("document.querySelector('#approve-trial').disabled"),true);
  await run("document.querySelector('#trial-consent').click(); document.querySelector('#approve-trial').click()"); await settle();
  assert.match(await run("document.querySelector('#trial-message').textContent"),/Prova attivata/);
  assert.equal(await run("sessionStorage.getItem('filexTrialCode')"),null);
  await writeFile(resolve(process.argv[3],'trial-account.png'),(await window.webContents.capturePage()).toPNG());
  await window.loadURL(origin+'/prova/'); await settle();
  assert.match(await run('document.body.textContent'),/100 € all’anno/);
  await writeFile(resolve(process.argv[3],'trial-website.png'),(await window.webContents.capturePage()).toPNG());
  assert.deepEqual(errors,[]);
  window.destroy(); server.close();
  console.log('PASS: primo avvio, attivazione automatica prova, acquisto durante la prova, consenso account e pagina marketing (servizi simulati).');
  app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});
