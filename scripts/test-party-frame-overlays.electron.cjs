const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
app.setPath("userData", process.argv[2]);
app.disableHardwareAcceleration();
let window;
const evaluate = (fn, ...args) => window.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`);
async function waitFor(fn) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await evaluate(fn)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${fn}`);
}
async function setField(label, value) {
  await evaluate((label, value) => {
    const input = document.querySelector(`[aria-label="${label}"]`);
    if (!input) throw new Error(`Missing editor control: ${label}`);
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value").set.call(input, value);
    input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  }, label, value);
}
async function clickButton(label) {
  const point = await evaluate((label) => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === label);
    if (!button || button.disabled) throw new Error(`Save button unavailable: ${label}`);
    button.scrollIntoView({ block: 'center' });
    const box = button.getBoundingClientRect();
    const point = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    const hit = document.elementFromPoint(point.x, point.y);
    return { ...point, coveredBy: button.contains(hit) ? null : hit?.outerHTML.slice(0, 500) };
  }, label);
  assert.equal(point.coveredBy, null, `Save button covered: ${label}; ${point.coveredBy}`);
  window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
  window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
}
app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({ show: false, width: 1600, height: 1100, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    // Prove that the editor and its font files work without any external network.
    const externalRequests = [];
    window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      const allowed = details.url.startsWith(process.argv[3]) || details.url.startsWith(process.env.PARTY_OVERLAY_API_ORIGIN) || /^(data|blob|devtools):/.test(details.url);
      if (!allowed) externalRequests.push(details.url);
      callback({ cancel: !allowed });
    });
    await window.loadURL(`${process.argv[3]}/custom-template`);
    await waitFor(() => document.body.textContent.includes("Testo Overlay"));
    for (const thickness of [0, 24, 80, 0]) {
      await evaluate((value) => {
        for (const [suffix, next] of [['border-size', String(value)], ['border-color-text', '#d10000']]) {
          const input = document.querySelector(`#custom-template-vertical-${suffix}`);
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, next);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, thickness);
      await evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const border = await evaluate(() => {
        const area = document.querySelector('[data-testid="editor-photo-area"]');
        const placeholder = area.querySelector('[data-testid="photo-placeholder"]');
        return { color: getComputedStyle(area).backgroundColor, center: getComputedStyle(placeholder).backgroundColor, inset: parseFloat(placeholder.style.left) };
      });
      assert.equal(border.center, 'rgb(217, 217, 217)', 'Photo placeholder stays neutral regardless of border color');
      assert.equal(border.color, thickness === 0 ? 'rgba(0, 0, 0, 0)' : 'rgb(209, 0, 0)');
      assert.equal(border.inset > 0, thickness > 0, 'Thickness changes only the border around the placeholder');
    }
    console.log('PASS bordo editor: spessori 0, 24 e 80 px, colore rosso limitato al bordo e centro neutro');
    await evaluate(() => {
      const input = document.querySelector('#photo-radius');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '120');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await waitFor(() => parseFloat(document.querySelector('[data-testid="editor-photo-area"]').style.borderRadius) > 0);
    for (const command of ['Salva nella Libreria', 'Usa nel Progetto']) {
      await evaluate(() => { document.querySelector('aside').scrollTop = 1500; document.querySelector('#template-name').blur(); });
      await clickButton(command);
      await waitFor(() => document.activeElement?.id === 'template-name');
      await waitFor(() => document.body.textContent.includes('Inserisci il nome del template'));
      const feedback = await evaluate(() => {
        const input = document.querySelector('#template-name').getBoundingClientRect();
        return { visible: input.top >= 64 && input.bottom <= innerHeight, message: document.body.textContent.includes('Inserisci il nome del template') };
      });
      assert.equal(feedback.visible, true);
      assert.equal(feedback.message, true);
    }
    console.log('PASS salvataggio: il nome mancante viene segnalato e portato in vista per entrambi i comandi');
    await evaluate(() => {
      const section = [...document.querySelectorAll("div")].find((el) => el.textContent === "Testo Overlay").parentElement.parentElement;
      section.querySelector("button").click();
    });
    await waitFor(() => document.querySelector('[aria-label="Contenuto del testo"]'));
    await waitFor(() => document.activeElement?.getAttribute('aria-label') === 'Scrivi testo sul canvas');
    await window.webContents.insertText('Testo scritto sul canvas');
    await waitFor(() => document.querySelector('[aria-label="Contenuto del testo"]').value === 'Testo scritto sul canvas');
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await waitFor(() => !document.querySelector('[aria-label="Scrivi testo sul canvas"]'));
    await setField('Posizione X (px)', '0');
    await setField('Posizione Y (px)', '138');
    await setField('Larghezza (px)', '1181');
    await waitFor(() => document.querySelector('[data-testid="text-overlay"] img')?.naturalWidth > 0);
    const textHandle = await evaluate(() => {
      const box = document.querySelector('[aria-label="Sposta testo"]').getBoundingClientRect();
      return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    });
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...textHandle });
    window.webContents.sendInputEvent({ type: 'mouseMove', x: textHandle.x + 25, y: textHandle.y + 20 });
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: textHandle.x + 25, y: textHandle.y + 20 });
    await waitFor(() => Number(document.querySelector('[aria-label="Posizione X (px)"]').value) > 0);
    assert.ok(Number(await evaluate(() => document.querySelector('[aria-label="Posizione Y (px)"]').value)) > 138);
    await setField('Larghezza (px)', '590');
    const resizeTextHandle = await evaluate(() => {
      const box = document.querySelector('[aria-label="Ridimensiona testo"]').getBoundingClientRect();
      return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    });
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...resizeTextHandle });
    window.webContents.sendInputEvent({ type: 'mouseMove', x: resizeTextHandle.x + 30, y: resizeTextHandle.y + 10 });
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: resizeTextHandle.x + 30, y: resizeTextHandle.y + 10 });
    await waitFor(() => Number(document.querySelector('[aria-label="Dimensione testo (px)"]').value) > 48);
    await evaluate(() => document.querySelector('[data-testid="text-overlay"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    await waitFor(() => document.activeElement?.getAttribute('aria-label') === 'Scrivi testo sul canvas');
    await window.webContents.insertText('Riaperto con doppio clic');
    await waitFor(() => document.querySelector('[aria-label="Contenuto del testo"]').value === 'Riaperto con doppio clic');
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await waitFor(() => !document.querySelector('[aria-label="Scrivi testo sul canvas"]'));
    console.log('PASS testo: scrittura immediata sul canvas e trascinamento del riquadro a larghezza piena');
    await setField("Contenuto del testo", "Anna e Marco\n7 settembre 2026");
    await setField("Font", "playfair");
    await setField("Dimensione testo (px)", "72");
    await setField("Allineamento", "center");
    await setField("Opacità (%)", "50");
    const values = await evaluate(() => ["Contenuto del testo", "Font", "Dimensione testo (px)", "Allineamento", "Opacità (%)"].map((label) => document.querySelector(`[aria-label="${label}"]`).value));
    assert.deepEqual(values, ["Anna e Marco\n7 settembre 2026", "playfair", "72", "center", "50"]);
    console.log("PASS editor: contenuto, font, dimensioni, allineamento e opacità modificabili");
    await evaluate(async () => {
      const canvas = document.createElement("canvas"); canvas.width = 200; canvas.height = 100;
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "red"; ctx.fillRect(0, 0, 200, 100);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve));
      const transfer = new DataTransfer(); transfer.items.add(new File([blob], "logo.png", { type: "image/png" }));
      const input = document.querySelector('input[aria-label="Aggiungi logo"]'); input.files = transfer.files; input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitFor(() => document.querySelector('[aria-label="Altezza (px)"]'));
    await setField("Larghezza (px)", "200");
    await setField("Altezza (px)", "100");
    assert.deepEqual(await evaluate(() => [document.querySelector('[aria-label="Larghezza (px)"]').value, document.querySelector('[aria-label="Altezza (px)"]').value]), ["200", "100"]);
    console.log("PASS editor: caricamento logo e controllo dimensioni");
    const handle = await evaluate(() => {
      const element = document.querySelector('[aria-label="Ridimensiona logo"]');
      element.scrollIntoView({ block: 'center', inline: 'center' });
      const box = element.getBoundingClientRect();
      return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    });
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...handle });
    window.webContents.sendInputEvent({ type: 'mouseMove', x: handle.x + 30, y: handle.y + 15, movementX: 30, movementY: 15 });
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: handle.x + 30, y: handle.y + 15 });
    await waitFor(() => Number(document.querySelector('[aria-label="Larghezza (px)"]').value) > 200);
    console.log('PASS editor: la maniglia del logo risponde al trascinamento reale');
    const rendering = await evaluate(async () => {
      const { renderTextOverlayPng } = await import('/src/app/lib/textOverlay.ts');
      const { PHOTOBOOTH_FONTS, ensurePhotoboothFontsReady } = await import('/src/app/lib/photoboothFonts.ts');
      await ensurePhotoboothFontsReady();
      const text = { id: 'test', text: 'MMMM\nEvento', fontKey: 'montserrat', fontSizePx: 48, color: '#ffffff', bold: true, italic: true, align: 'center', x: 0, y: 0, width: 300, opacity: 50, shadow: true };
      const file = await renderTextOverlayPng(text);
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let alpha = 0; for (let index = 3; index < pixels.length; index += 4) alpha = Math.max(alpha, pixels[index]);
      const clipped = await createImageBitmap(await renderTextOverlayPng(text, 12));
      const result = { alpha, height: bitmap.height, clippedHeight: clipped.height, fonts: PHOTOBOOTH_FONTS.every((font) => document.fonts.check(`16px ${font.family}`)) };
      bitmap.close(); clipped.close(); return result;
    });
    assert.equal(rendering.alpha, 255, 'Text PNG must leave opacity to the compositor');
    assert.ok(rendering.height > 90, 'Multiline text retains both lines');
    assert.equal(rendering.clippedHeight, 12);
    assert.equal(rendering.fonts, true);
    assert.deepEqual(externalRequests.filter((url) => /fonts\.(googleapis|gstatic)/.test(url)), []);
    console.log('PASS rendering: font locali, testo multilinea e opacità applicata una sola volta');
    await evaluate(() => {
      const input = document.querySelector('#template-name');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Test logo e testo');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const border = document.querySelector('#custom-template-vertical-border-size');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(border, '24');
      border.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await evaluate(() => document.querySelector('[data-testid="text-overlay"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    await waitFor(() => document.activeElement?.getAttribute('aria-label') === 'Scrivi testo sul canvas');
    await clickButton('Salva nella Libreria');
    await waitFor(async () => {
      const { loadSavedTemplates } = await import('/src/app/lib/savedTemplates.ts');
      return loadSavedTemplates().length === 1;
    });
    const persisted = await evaluate(async () => {
      const library = await import('/src/app/lib/savedTemplates.ts');
      const project = await import('/src/app/contexts/ProjectContext.tsx');
      const record = library.loadSavedTemplates()[0];
      const template = await library.hydrateSavedTemplate(record);
      const restored = project.getCustomTemplateLogoFiles().vertical;
      const exported = await library.exportSavedTemplatesPackage();
      const prepared = library.prepareSavedTemplatesPackageImport(exported);
      await library.commitPreparedSavedTemplatesPackageImport(prepared);
      const reimported = await library.hydrateSavedTemplate(library.loadSavedTemplates()[0]);
      return {
        name: template.name, radius: template.variants.vertical.photoRadiusPx, text: template.variants.vertical.texts[0].text,
        logoName: [...restored.values()][0]?.name, logoCount: template.variants.vertical.logos.length,
        reimportedLogoCount: reimported.variants.vertical.logos.length,
        reimportedLogoBytes: [...project.getCustomTemplateLogoFiles().vertical.values()][0]?.size,
      };
    });
    assert.equal(persisted.name, 'Test logo e testo');
    assert.equal(persisted.radius, 120);
    assert.equal(persisted.text, 'Anna e Marco\n7 settembre 2026');
    assert.equal(persisted.logoName, 'logo.png');
    assert.equal(persisted.logoCount, 1);
    assert.equal(persisted.reimportedLogoCount, 1);
    assert.ok(persisted.reimportedLogoBytes > 0);
    const missingLogoError = await evaluate(async () => {
      const { loadSavedTemplates } = await import('/src/app/lib/savedTemplates.ts');
      const { clearCustomTemplateLogoFiles } = await import('/src/app/contexts/ProjectContext.tsx');
      const { prepareTemplateOverlays } = await import('/src/app/lib/textOverlay.ts');
      clearCustomTemplateLogoFiles();
      try { await prepareTemplateOverlays(loadSavedTemplates()[0].template); return ''; }
      catch (error) { return error.message; }
    });
    assert.match(missingLogoError, /File del logo non disponibile/);
    console.log('PASS libreria: salvataggio dall’editor, riapertura e pacchetto portabile preservano logo e testo');
    await evaluate(() => [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Variante Orizzontale').click());
    await waitFor(() => document.querySelectorAll('[data-testid="logo-overlay"]').length === 0);
    assert.equal(await evaluate(() => document.querySelector('#photo-radius').value), '0', 'Horizontal radius stays independent');
    assert.equal(await evaluate(() => document.querySelectorAll('[data-testid="text-overlay"]').length), 0);
    await evaluate(() => [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Variante Verticale').click());
    await waitFor(() => document.querySelectorAll('[data-testid="logo-overlay"]').length === 1);
    assert.equal(await evaluate(() => document.querySelectorAll('[data-testid="text-overlay"]').length), 1);
    await waitFor(() => document.querySelector('[data-testid="text-overlay"] img')?.naturalWidth > 0);
    const preview = await evaluate(() => {
      const image = document.querySelector('[data-testid="text-overlay"] img');
      const box = document.querySelector('[data-testid="template-canvas"]');
      return { width: image.getBoundingClientRect().width, naturalWidth: image.naturalWidth, canvasWidth: box.clientWidth };
    });
    assert.ok(Math.abs(preview.width / preview.canvasWidth - preview.naturalWidth / 1181) < 0.01, 'Text preview scales with the template');
    const layout = await evaluate(() => {
      const canvas = document.querySelector('[data-testid="template-canvas"]').getBoundingClientRect();
      const sidebar = document.querySelector('aside').getBoundingClientRect();
      return { canvasLeft: canvas.left, canvasTop: canvas.top, canvasBottom: canvas.bottom, sidebarRight: sidebar.right, height: innerHeight };
    });
    assert.ok(layout.canvasLeft >= layout.sidebarRight, 'Canvas stays next to the controls');
    assert.ok(layout.canvasTop >= 0 && layout.canvasBottom <= layout.height + 1, 'Full canvas fits the window');
    if (process.env.PARTY_OVERLAY_SCREENSHOT) {
      await evaluate(() => { document.querySelector('[data-testid="template-canvas"]').scrollIntoView({ block: 'center' }); });
      await evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      require('node:fs').writeFileSync(process.env.PARTY_OVERLAY_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    }
    console.log('PASS editor: varianti indipendenti e testo proporzionato al canvas');
    await evaluate(() => document.querySelector('[data-testid="text-overlay"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    await waitFor(() => document.activeElement?.getAttribute('aria-label') === 'Scrivi testo sul canvas');
    await clickButton('Usa nel Progetto');
    await waitFor(() => location.pathname === '/new-project');
    console.log('PASS salvataggio: entrambi i pulsanti funzionano con scrittura sul canvas ancora attiva');
    await waitFor(() => document.querySelector('#project-name') && document.querySelector('input[webkitdirectory]'));
    await evaluate(async () => {
      const name = document.querySelector('#project-name');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(name, 'Progetto con overlay');
      name.dispatchEvent(new Event('input', { bubbles: true }));
      const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 450;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#2876ad'; ctx.fillRect(0, 0, 300, 450);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve));
      const file = new File([blob], 'foto.png', { type: 'image/png' });
      Object.defineProperty(file, 'webkitRelativePath', { value: 'Evento/foto.png' });
      const transfer = new DataTransfer(); transfer.items.add(file);
      const input = document.querySelector('input[webkitdirectory]'); input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Continua alla Validazione' && !button.disabled));
    await waitFor(() => !document.querySelector('[data-sonner-toast]'));
    await clickButton('Continua alla Validazione');
    await waitFor(() => location.pathname === '/template-validation');
    await waitFor(() => document.querySelectorAll('[data-testid="photo-placeholder"]').length === 2);
    assert.equal(await evaluate(() => [...document.querySelectorAll('[data-testid="photo-placeholder"]')].every((element) => getComputedStyle(element).backgroundColor === 'rgb(217, 217, 217)')), true, 'Validation also keeps photo placeholders neutral');
    await waitFor(() => [...document.querySelectorAll('[data-orientation="vertical"] [data-testid="project-logo"] img, [data-orientation="vertical"] [data-testid="project-text"] img')].filter((image) => image.naturalWidth > 0).length === 2);
    assert.equal(await evaluate(() => document.querySelectorAll('[data-orientation="horizontal"] [data-testid="project-logo"], [data-orientation="horizontal"] [data-testid="project-text"]').length), 0);
    const actionsLayout = await evaluate(() => {
      const actions = document.querySelector('[data-testid="validation-actions"]');
      const previews = actions.previousElementSibling.getBoundingClientRect();
      const box = actions.getBoundingClientRect();
      const info = [...document.querySelectorAll('h2')].find((heading) => heading.textContent === 'Informazioni Modello').getBoundingClientRect();
      return { gap: box.top - previews.bottom, bottom: box.bottom, infoTop: info.top,
        editTarget: actions.querySelector('a').getAttribute('href') };
    });
    assert.ok(actionsLayout.gap >= 0 && actionsLayout.gap <= 20, 'Actions sit immediately below the previews');
    assert.ok(actionsLayout.bottom <= actionsLayout.infoTop, 'Actions precede model details');
    assert.equal(actionsLayout.editTarget, '/custom-template');
    console.log('PASS validazione: comandi subito sotto le anteprime e prima delle informazioni');
    await clickButton("Vai all'Area di Lavoro");
    await waitFor(() => location.pathname === '/workspace');
    await waitFor(() => document.querySelector('img[alt="foto.png"]')?.naturalWidth > 0);
    await waitFor(() => [...document.querySelectorAll('[data-testid="project-template-overlays"] img')].filter((image) => image.naturalWidth > 0).length === 2);
    const composition = await evaluate(() => {
      const layer = document.querySelector('[data-testid="project-template-overlays"]');
      const text = layer.querySelector('[data-testid="project-text"]');
      return { orientation: layer.dataset.orientation, pointerEvents: getComputedStyle(layer).pointerEvents, opacity: getComputedStyle(text).opacity, text: text.querySelector('img').alt, width: layer.getBoundingClientRect().width };
    });
    assert.equal(composition.orientation, 'vertical');
    assert.equal(composition.pointerEvents, 'none');
    assert.equal(composition.opacity, '0.5');
    assert.equal(composition.text, 'Anna e Marco\n7 settembre 2026');
    assert.ok(composition.width > 100);
    console.log('PASS progetto: foto reale caricata, logo e testo visibili in validazione e nell’area di lavoro, opacità e variante preservate');
    await clickButton('Elabora e approva');
    await waitFor(() => document.querySelector('img[alt="Anteprima elaborata di foto.png"]')?.naturalWidth > 0);
    const borderRendering = await evaluate(async () => {
      const image = document.querySelector('img[alt="Anteprima elaborata di foto.png"]');
      const bitmap = await createImageBitmap(await (await fetch(image.src)).blob());
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let photoPixels = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (Math.abs(pixels[i] - 40) < 15 && Math.abs(pixels[i + 1] - 118) < 15 && Math.abs(pixels[i + 2] - 173) < 15) photoPixels++;
      }
      return { photoRatio: photoPixels / (canvas.width * canvas.height), extraBorder: !!document.querySelector('[data-testid="live-photo-border"]') };
    });
    assert.ok(borderRendering.photoRatio > 0.3, 'Processed image retains the photograph inside its border');
    assert.equal(borderRendering.extraBorder, false, 'Live border must not cover the already processed photograph');
    console.log('PASS spessore: foto elaborata visibile senza il riquadro del bordo sovrapposto');
    await window.loadURL(process.argv[3]);
    await waitFor(() => document.querySelector('[aria-label="Modifica template Test logo e testo"]'));
    const originalId = await evaluate(async () => (await import('/src/app/lib/savedTemplates.ts')).loadSavedTemplates()[0].id);
    await clickButton('Modifica');
    await waitFor(() => document.querySelector('#photo-radius')?.value === '120');
    await waitFor(() => document.querySelector('[data-testid="text-overlay"] img')?.naturalWidth > 0);
    await waitFor(async () => {
      const logo = document.querySelector('[data-testid="logo-overlay"]');
      const url = logo?.style.backgroundImage.match(/url\("?([^"\)]+)"?\)/)?.[1];
      if (!url) return false;
      const image = new Image(); image.src = url;
      await image.decode(); return image.naturalWidth > 0;
    });
    await evaluate(() => document.querySelector('[data-testid="text-overlay"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    await waitFor(() => document.activeElement?.getAttribute('aria-label') === 'Scrivi testo sul canvas');
    await window.webContents.insertText('Testo aggiornato dalla libreria');
    await clickButton('Salva nella Libreria');
    await waitFor(async () => (await import('/src/app/lib/savedTemplates.ts')).loadSavedTemplates()[0].template.variants.vertical.texts[0].text === 'Testo aggiornato dalla libreria');
    const updated = await evaluate(async () => {
      const library = await import('/src/app/lib/savedTemplates.ts');
      const records = library.loadSavedTemplates();
      const template = await library.hydrateSavedTemplate(records[0]);
      return { count: records.length, id: records[0].id, logoCount: template.variants.vertical.logos.length, text: template.variants.vertical.texts[0].text };
    });
    assert.equal(updated.count, 1, 'Editing must update the existing template without creating duplicates');
    assert.equal(updated.id, originalId);
    assert.equal(updated.logoCount, 1);
    assert.equal(updated.text, 'Testo aggiornato dalla libreria');
    console.log('PASS modifica libreria: riapertura dall’Home, aggiornamento dello stesso template e conservazione del logo');
  } catch (error) { console.error(error); app.exitCode = 1; }
  finally { window?.destroy(); app.exit(app.exitCode || 0); }
});
