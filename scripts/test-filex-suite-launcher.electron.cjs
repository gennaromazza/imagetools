const { app, BrowserWindow, ipcMain } = require('electron');
const { resolve } = require('node:path');
const assert = require('node:assert/strict');
app.setPath('userData', process.argv[2]);
app.whenReady().then(async () => {
  const window = new BrowserWindow({width:440,height:112,frame:false,show:false,webPreferences:{
    preload:resolve(__dirname,'test-filex-suite-launcher.preload.cjs'),contextIsolation:true,sandbox:false
  }});
  ipcMain.handle('test:resize-launcher', (_event, height, width) => {
    if (!window.isDestroyed()) window.setSize(width, Math.max(96, Math.min(620, height)));
  });
  await window.loadFile(resolve(__dirname,'../apps/filex-desktop/.output/suite-launcher/dock.html'));
  const run = code => window.webContents.executeJavaScript(code);
  const frame = () => run("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await frame();
  assert.equal(await run("document.querySelectorAll('.launch').length"),5);
  assert.ok(window.getSize()[1] <= 120, 'La dock chiusa deve essere una striscia orizzontale');
  assert.equal(await run("document.querySelector('#search-panel').hidden"),true);
  assert.equal(await run("document.querySelector('#controls').hidden"),true);
  assert.equal(await run("document.querySelector('#collapsed-notification-dot').hidden"),false);
  const compactWidth = window.getSize()[0];
  assert.equal(await run("[...document.querySelectorAll('.launch')].every(button => !button.textContent.trim())"),true);
  assert.equal(await run("new Set([...document.querySelectorAll('.launch')].map(button=>button.getBoundingClientRect().top)).size"),1);
  await run("document.querySelector('.launch').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}))");
  assert.equal(await run("document.querySelector('#tooltip').textContent"),'Image Party Frame');
  assert.equal(await run("document.querySelector('#tooltip').hidden"),false);
  if (process.env.FILEX_LAUNCHER_SCREENSHOT) {
    require('node:fs').writeFileSync(process.env.FILEX_LAUNCHER_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
  }
  await run("document.querySelector('#controls-toggle').click()");
  await frame();
  assert.equal(await run("document.querySelector('#controls').hidden"),false);
  assert.ok(window.getSize()[0] > compactWidth);
  await run("document.querySelector('#search-toggle').click(); document.querySelector('#search').value='converter'; document.querySelector('#search').dispatchEvent(new Event('input'))");
  assert.equal(await run("document.querySelectorAll('.launch').length"),1);
  await run("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");
  assert.equal(await run("document.querySelector('#search-panel').hidden"),true);
  assert.equal(await run("document.querySelectorAll('.launch').length"),5);
  await run("document.querySelector('#controls-toggle').click()");
  await frame();
  assert.equal(await run("document.querySelector('#controls').hidden"),true);
  assert.equal(window.getSize()[0], compactWidth);
  await run("document.querySelector('#controls-toggle').click()");
  await run("document.querySelectorAll('.launch')[2].dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))");
  assert.equal(await run("document.querySelector('.launch').dataset.id"),'id-photo');
  await run("document.querySelector('#settings-toggle').click(); document.querySelector('#theme').value='black'; document.querySelector('#theme').dispatchEvent(new Event('change'))");
  assert.equal(await run("getComputedStyle(document.documentElement).getPropertyValue('--bg')"),'#101010');
  await run("document.querySelector('#theme').value='custom'; document.querySelector('#theme').dispatchEvent(new Event('change')); document.querySelector('#custom-color').value='#ffffff'; document.querySelector('#custom-color').dispatchEvent(new Event('input'))");
  assert.equal(await run("getComputedStyle(document.documentElement).getPropertyValue('--fg')"),'#152018');
  await run("document.querySelector('#theme').value='system'; document.querySelector('#theme').dispatchEvent(new Event('change'))");
  assert.equal(await run("getComputedStyle(document.documentElement).getPropertyValue('--bg') === (matchMedia('(prefers-color-scheme: dark)').matches ? '#202020' : '#f1f1f1')"),true);
  await run("document.querySelector('#theme').value='black'; document.querySelector('#theme').dispatchEvent(new Event('change'))");
  await new Promise(resolve => { window.webContents.once('did-finish-load', resolve); window.reload(); });
  await frame();
  assert.equal(await run("document.querySelector('.launch').dataset.id"),'id-photo');
  assert.equal(await run("getComputedStyle(document.documentElement).getPropertyValue('--bg')"),'#101010');
  await run("document.querySelector('#controls-toggle').click(); document.querySelector('#notifications-toggle').click()");
  assert.match(await run("document.querySelector('#notifications-list').textContent"),/2 file ricevuti/);
  assert.equal(await run("document.querySelector('#notification-count').hidden"),true);
  await run("document.querySelector('#clear-notifications').click()");
  await new Promise(resolve => { window.webContents.once('did-finish-load', resolve); window.reload(); });
  await frame();
  await run("document.querySelector('#controls-toggle').click(); document.querySelector('#notifications-toggle').click()");
  assert.doesNotMatch(await run("document.querySelector('#notifications-list').textContent"),/2 file ricevuti/);
  await run("document.querySelector('.launch').click()");
  assert.match(await run("document.querySelector('#status').textContent"),/Licenza non attiva/);
  console.log('PASS: dock orizzontale, tooltip, ricerca espandibile, preferiti, tema persistente, notifiche Send e rimozione persistente, errori di avvio');
  app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});
