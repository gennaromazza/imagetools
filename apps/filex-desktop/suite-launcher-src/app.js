const api = window.filexDesktop;
const toolsGrid = document.querySelector('#tools-grid');
const nav = document.querySelector('#category-nav');
const search = document.querySelector('#search-input');
const title = document.querySelector('#view-title');
const gridTitle = document.querySelector('#grid-title');
const gridSubtitle = document.querySelector('#grid-subtitle');
const suiteUpdatePanel = document.querySelector('#suite-update-panel');
const suiteUpdateTitle = document.querySelector('#suite-update-title');
const suiteUpdateMessage = document.querySelector('#suite-update-message');
const suiteUpdateProgress = document.querySelector('.suite-update-progress');
const suiteUpdateProgressBar = document.querySelector('#suite-update-progress-bar');
const suiteUpdateRetry = document.querySelector('#suite-update-retry');
const suiteUpdateLater = document.querySelector('#suite-update-later');
const suiteUpdateInstall = document.querySelector('#suite-update-install');
const suiteUpdateDismiss = document.querySelector('#suite-update-dismiss');
const sectionsDialog = document.querySelector('#sections-dialog');
const sectionsDialogTitle = document.querySelector('#sections-dialog-title');
const sectionsDialogContent = document.querySelector('#sections-dialog-content');
const suiteToast = document.querySelector('#suite-toast');
const licenseDialog = document.querySelector('#license-dialog');
const licenseActiveView = document.querySelector('#license-active-view');
const licenseActivationView = document.querySelector('#license-activation-view');
const licenseError = document.querySelector('#license-error');
let licenseState = null;
const metadata = {
  'photo-selector-app': { icon:'select', category:'Selezione', description:'Gestisce la selezione completa di servizi fotografici anche molto grandi. Permette di sfogliare rapidamente JPEG e RAW, confrontare gli scatti, assegnare valutazioni, preferenze ed etichette colore, sincronizzare i dati XMP e salvare o trasferire il progetto tramite Google Drive.', color:'#36a97b' },
  'image-party-frame': { icon:'frame', category:'Creatività', description:'Crea progetti fotografici con cornici e composizioni grafiche usando template predefiniti o personalizzati. Consente di regolare ritaglio e zoom per ogni immagine, confrontare prima e dopo, validare il risultato ed esportare interi gruppi di fotografie pronti per eventi e consegne.', color:'#d9695f' },
  'batch-print-layout': { icon:'print', category:'Stampa', description:'Impagina automaticamente molte fotografie su fogli pronti per la stampa. Organizza il lavoro in batch, distribuisce le immagini nei layout disponibili e riduce le operazioni manuali e lo spreco di carta durante la preparazione delle stampe.', color:'#8c71c8' },
  'archivio-flow': { icon:'archive', category:'Archivio', description:'Accompagna l\'importazione delle fotografie dalla scheda alla creazione del lavoro in archivio. Rileva i file, applica una struttura di cartelle e nomi coerenti, prepara copie operative e leggere e mantiene i servizi consultabili e riapribili nel tempo.', color:'#6d9460' },
  'image-converter': { icon:'convert', category:'Utility', description:'Converte intere cartelle di immagini in JPG o WebP usando preset per web, social, revisione e stampa, con controllo di dimensioni, qualità e peso. Gestisce inoltre i negativi RAW trasformandoli in DNG compresso, conservando gli originali e i relativi file XMP.', color:'#df8647' },
  'image-file-finder': { icon:'find', category:'Utility', description:'Cerca automaticamente fotografie dentro cartelle e sottocartelle partendo da una lista di nomi o codici file. Raccoglie in una destinazione unica le immagini trovate e produce un riepilogo chiaro di corrispondenze, duplicati ed elementi mancanti.', color:'#4c9caf' },
  'cache-sweep': { icon:'suite', category:'Utility', description:'FileX Adobe Cleaner lavora esclusivamente sui programmi Adobe: libera le cache supportate e individua vecchie versioni installate accanto a quella corrente. Ogni rimozione è spiegata e confermata; cataloghi, progetti, preset, preferenze, licenze e dati di recupero restano protetti.', color:'#e5b34f' },
  'filex-send': { icon:'suite', category:'Consegna', description:'Riceve foto e video dal cliente tramite QR sulla rete locale oppure con un link remoto temporaneo. Gli invii restano disponibili anche a PC spento e vengono scaricati automaticamente alla riapertura.', color:'#39c9a5' },
  'backup-guard': { icon:'suite', category:'Utility', description:'Controlla che fotografie, cataloghi e progetti importanti dispongano davvero di copie di sicurezza utilizzabili. Rileva dischi e destinazioni disponibili, segnala lavori non protetti e guida verifiche e backup senza cancellare o modificare i file originali.', color:'#62b985' },
};
const systemCategories = ['Tutti', 'Preferiti', 'Recenti'];
const defaultCategories = ['Selezione', 'Creatività', 'Stampa', 'Archivio', 'Consegna', 'Utility'];
const organizationStorageKey = 'filex-organization-v1';
const storedOrganization = readStoredOrganization();
let customCategories = storedOrganization.customCategories;
let toolCategoryOverrides = storedOrganization.toolCategories;
let states = [];
let activeCategory = 'Tutti';
let favorites = new Set(JSON.parse(localStorage.getItem('filex-favorites') || '[]'));
let recent = JSON.parse(localStorage.getItem('filex-recent') || '[]');
let suiteUpdateDeferred = false;
let suiteInstallTimer = null;
let suiteInstallSeconds = 0;
let toastTimer = null;
let renamingCategoryIndex = null;

function readStoredOrganization() {
  try {
    const value = JSON.parse(localStorage.getItem(organizationStorageKey) || '{}');
    return {
      customCategories: Array.isArray(value.customCategories) ? [...new Set(value.customCategories.filter(name => typeof name === 'string' && name.trim()))] : [],
      toolCategories: value.toolCategories && typeof value.toolCategories === 'object'
        ? Object.fromEntries(Object.entries(value.toolCategories).filter(([, names]) => Array.isArray(names)))
        : {},
    };
  } catch {
    return { customCategories: [], toolCategories: {} };
  }
}

function allCategories() {
  return [...systemCategories, ...defaultCategories, ...customCategories];
}

function editableCategories() {
  return [...defaultCategories, ...customCategories];
}

function categoriesForTool(toolId) {
  const saved = toolCategoryOverrides[toolId];
  if (Array.isArray(saved)) {
    const valid = saved.filter(name => editableCategories().includes(name));
    if (valid.length) return valid;
  }
  return [metadata[toolId]?.category || 'Utility'];
}

function saveOrganization() {
  localStorage.setItem(organizationStorageKey, JSON.stringify({ customCategories, toolCategories: toolCategoryOverrides }));
}

function setToolCategories(toolId, categoryNames) {
  const valid = [...new Set(categoryNames.filter(name => editableCategories().includes(name)))];
  toolCategoryOverrides[toolId] = valid.length ? valid : [metadata[toolId]?.category || 'Utility'];
  saveOrganization();
}

function showToast(message) {
  clearTimeout(toastTimer);
  suiteToast.textContent = message;
  suiteToast.hidden = false;
  toastTimer = setTimeout(() => { suiteToast.hidden = true; }, 2600);
}

function formatLicenseDate(value) {
  return typeof value === 'number' ? new Date(value).toLocaleDateString('it-IT', { day:'2-digit', month:'short', year:'numeric' }) : '-';
}

function renderLicense(state) {
  licenseState = state;
  const permitted = state?.canUseTools === true && (state?.status === 'active' || state?.status === 'grace');
  const statusLabel = permitted
    ? (state.status === 'grace' ? 'Da aggiornare' : 'Attiva')
    : (state?.status === 'unavailable' ? 'Verifica richiesta' : 'Non attiva');
  document.querySelector('#license-sidebar-status').textContent = statusLabel;
  document.querySelector('#license-dot').classList.toggle('active', permitted);
  document.querySelector('#license-summary-title').textContent = permitted ? 'FileX All Access' : 'Licenza FileX';
  document.querySelector('#license-summary-copy').textContent = state?.message || 'Verifica non disponibile.';
  document.querySelector('#license-mode').textContent = `Modalita licenze: ${state?.enforcement || 'observe'}`;
  licenseActiveView.hidden = !permitted;
  licenseActivationView.hidden = permitted;
  if (permitted) {
    document.querySelector('#license-state-badge').textContent = state.status === 'grace' ? 'PERIODO DI CORTESIA' : 'ATTIVA';
    document.querySelector('#license-state-message').textContent = state.message;
    document.querySelector('#license-devices').textContent = `${state.activation.current} di ${state.activation.limit}`;
    document.querySelector('#license-valid-until').textContent = formatLicenseDate(state.validUntil);
    document.querySelector('#license-offline-until').textContent = formatLicenseDate(state.offlineUntil);
  } else if (state?.message) {
    licenseError.textContent = state.message;
    licenseError.hidden = state.status === 'unlicensed';
  }
}

async function refreshLicense(force = false) {
  const state = await api.getLicenseState(force);
  renderLicense(state);
  return state;
}

function openLicenseDialog() {
  licenseError.hidden = true;
  if (licenseState) renderLicense(licenseState);
  licenseDialog.showModal();
}

function stopSuiteInstallCountdown() {
  if (suiteInstallTimer) clearInterval(suiteInstallTimer);
  suiteInstallTimer = null;
}

function formatDownloadSpeed(bytesPerSecond) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '';
  const megabytes = bytesPerSecond / (1024 * 1024);
  return `${megabytes.toFixed(megabytes >= 10 ? 0 : 1)} MB/s`;
}

function startSuiteInstallCountdown(version) {
  if (suiteInstallTimer || suiteUpdateDeferred) return;
  suiteInstallSeconds = 10;
  suiteUpdateInstall.textContent = `Installa ora (${suiteInstallSeconds})`;
  suiteInstallTimer = setInterval(() => {
    suiteInstallSeconds -= 1;
    suiteUpdateInstall.textContent = `Installa ora (${Math.max(0, suiteInstallSeconds)})`;
    if (suiteInstallSeconds > 0) return;
    stopSuiteInstallCountdown();
    suiteUpdateTitle.textContent = `Installazione FileX ${version}`;
    suiteUpdateMessage.textContent = 'FileX e tutti i tool aperti verranno chiusi e riavviati automaticamente.';
    void api.installSuiteUpdate();
  }, 1000);
}

function renderSuiteUpdate(state) {
  const status = state?.status || 'idle';
  const version = state?.availableVersion || '';
  const shouldHide = ['idle', 'disabled', 'up-to-date'].includes(status) || (suiteUpdateDeferred && status !== 'installing');
  suiteUpdatePanel.hidden = shouldHide;
  suiteUpdateRetry.hidden = true;
  suiteUpdateLater.hidden = true;
  suiteUpdateInstall.hidden = true;
  suiteUpdateDismiss.hidden = true;
  suiteUpdateProgress.classList.remove('indeterminate');
  suiteUpdateProgressBar.style.width = `${Math.min(100, Math.max(0, state?.percent || 0))}%`;
  if (shouldHide) {
    stopSuiteInstallCountdown();
    return;
  }

  if (status === 'checking') {
    suiteUpdateTitle.textContent = 'Controllo aggiornamenti...';
    suiteUpdateMessage.textContent = 'Verifico la versione più recente di FileX Suite.';
    suiteUpdateProgress.classList.add('indeterminate');
    return;
  }
  if (status === 'available' || status === 'downloading') {
    const percent = Math.round(state.percent || 0);
    const speed = formatDownloadSpeed(state.bytesPerSecond);
    suiteUpdateTitle.textContent = `FileX ${version} è disponibile`;
    suiteUpdateMessage.textContent = status === 'available'
      ? 'Preparazione del download automatico...'
      : `Download ${percent}%${speed ? ` · ${speed}` : ''}. Puoi continuare a lavorare.`;
    suiteUpdateLater.hidden = false;
    return;
  }
  if (status === 'ready') {
    suiteUpdateTitle.textContent = `FileX ${version} è pronto`;
    suiteUpdateMessage.textContent = 'L’installazione partirà automaticamente. Windows potrebbe chiedere conferma.';
    suiteUpdateProgressBar.style.width = '100%';
    suiteUpdateLater.hidden = false;
    suiteUpdateInstall.hidden = false;
    startSuiteInstallCountdown(version);
    return;
  }
  if (status === 'installing') {
    stopSuiteInstallCountdown();
    suiteUpdateTitle.textContent = `Installazione FileX ${version}`;
    suiteUpdateMessage.textContent = 'Chiusura di FileX e di tutti i tool, applicazione dell’aggiornamento e riavvio...';
    suiteUpdateProgressBar.style.width = '100%';
    return;
  }
  if (status === 'error') {
    stopSuiteInstallCountdown();
    suiteUpdateTitle.textContent = 'Aggiornamento non completato';
    suiteUpdateMessage.textContent = 'La connessione non è disponibile o è instabile. FileX continuerà a funzionare normalmente.';
    suiteUpdateRetry.hidden = false;
    suiteUpdateDismiss.hidden = false;
  }
}

function icon(name) { return `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`; }
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[character]);
}
function renderNav() {
  nav.innerHTML = allCategories().map(category => `<button class="nav-item ${category===activeCategory?'active':''}" data-category="${escapeHtml(category)}">${category==='Preferiti'?icon('star'):''}<span>${escapeHtml(category)}</span></button>`).join('');
}
function filteredTools() {
  const query = search.value.trim().toLowerCase();
  let list = [...states];
  if (activeCategory === 'Preferiti') list = list.filter(x => favorites.has(x.toolId));
  else if (activeCategory === 'Recenti') list = recent.map(id => list.find(x => x.toolId===id)).filter(Boolean);
  else if (activeCategory !== 'Tutti') list = list.filter(x => categoriesForTool(x.toolId).includes(activeCategory));
  if (query) list = list.filter(x => `${x.toolName} ${metadata[x.toolId]?.description||''}`.toLowerCase().includes(query));
  return list;
}
function renderTools() {
  const list = filteredTools();
  toolsGrid.innerHTML = list.length ? list.map(state => {
    const meta = metadata[state.toolId] || {icon:'suite',category:'Tool',description:'Strumento FileX',color:'#36a97b'};
    const installed = Boolean(state.installed);
    const update = state.status === 'update-available';
    const suiteUpdateRequired = state.status === 'suite-update-required';
    const releaseHighlights = Array.isArray(state.releaseHighlights) ? state.releaseHighlights : [];
    const updateDetails = update ? `<aside class="tool-update-notes" aria-label="Novità versione ${escapeHtml(state.latestVersion)}">
      <strong>Novità della versione ${escapeHtml(state.latestVersion)}</strong>
      <ul>${releaseHighlights.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </aside>` : '';
    const memberships = categoriesForTool(state.toolId);
    return `<article class="tool-card" draggable="true" data-tool-id="${state.toolId}" style="--tool-color:${meta.color}">
      <button class="favorite ${favorites.has(state.toolId)?'selected':''}" data-action="favorite" data-id="${state.toolId}" title="Preferito">${icon('star')}</button>
      <div class="tool-icon"><img src="./icons/${state.toolId}.png" alt="" /></div><span class="category">${escapeHtml(memberships.join(' · '))}</span><h3>${escapeHtml(state.toolName)}</h3><p class="tool-description">${meta.description}</p>
      ${updateDetails}
      <div class="card-foot"><span class="status ${update||suiteUpdateRequired?'warn':installed?'ok':'off'}">${suiteUpdateRequired?'Aggiorna prima la Suite':update?'Aggiornamento':installed?'Pronto':'Da installare'}</span>
      <div class="card-actions"><button class="sections-button" data-action="sections" data-id="${state.toolId}">Sezioni</button>${update?`<button class="update-mini" data-action="install" data-id="${state.toolId}">Aggiorna</button>`:''}<button class="launch" data-action="${installed?'open':'install'}" data-id="${state.toolId}" ${suiteUpdateRequired&&!installed?'disabled':''}>${installed?'Apri':'Installa'} <span>→</span></button></div></div>
    </article>`;
  }).join('') : '<div class="empty">Nessuno strumento in questa sezione.</div>';
}

function normalizeCategoryName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 32);
}

function categoryNameExists(name, ignoredIndex = -1) {
  const normalized = name.toLocaleLowerCase('it');
  return [...systemCategories, ...defaultCategories, ...customCategories.filter((_, index) => index !== ignoredIndex)]
    .some(item => item.toLocaleLowerCase('it') === normalized);
}

function renderManageSectionsDialog() {
  sectionsDialogTitle.textContent = 'Le tue sezioni';
  const rows = customCategories.length
    ? customCategories.map((category, index) => {
      const count = states.filter(state => categoriesForTool(state.toolId).includes(category)).length;
      const nameEditor = renamingCategoryIndex === index
        ? `<input class="section-rename-input" data-rename-input="${index}" maxlength="32" value="${escapeHtml(category)}" aria-label="Nuovo nome della sezione ${escapeHtml(category)}">`
        : `<strong>${escapeHtml(category)}</strong><small>${count} tool</small>`;
      const actions = renamingCategoryIndex === index
        ? `<button type="button" data-section-action="save-rename" data-index="${index}" title="Salva nome">✓</button><button type="button" data-section-action="cancel-rename" data-index="${index}" title="Annulla">×</button>`
        : `<button type="button" data-section-action="up" data-index="${index}" title="Sposta su" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" data-section-action="down" data-index="${index}" title="Sposta giù" ${index === customCategories.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" data-section-action="rename" data-index="${index}" title="Rinomina">✎</button>
        <button type="button" data-section-action="delete" data-index="${index}" title="Elimina">×</button>`;
      return `<div class="section-row"><div>${nameEditor}</div><div class="section-row-actions">
        ${actions}
      </div></div>`;
    }).join('')
    : '<div class="empty">Non hai ancora creato sezioni personali.</div>';
  sectionsDialogContent.innerHTML = `<div class="section-create"><input id="new-section-name" maxlength="32" placeholder="Nome nuova sezione" aria-label="Nome nuova sezione"><button id="create-section-btn" class="secondary-action" type="button">Crea</button></div><div class="section-list">${rows}</div><p class="dialog-help">Trascina un tool su una sezione per aggiungerlo. Lo stesso tool può comparire in tutte le sezioni che desideri.</p><button id="reset-sections-btn" class="reset-sections" type="button">Ripristina organizzazione predefinita</button>`;
}

function openManageSectionsDialog() {
  renamingCategoryIndex = null;
  renderManageSectionsDialog();
  sectionsDialog.showModal();
}

function openToolSectionsDialog(toolId) {
  const state = states.find(item => item.toolId === toolId);
  if (!state) return;
  sectionsDialogTitle.textContent = `Sezioni di ${state.toolName}`;
  const selected = categoriesForTool(toolId);
  sectionsDialogContent.innerHTML = `<div class="section-checks">${editableCategories().map(category => `<label class="section-check"><input type="checkbox" data-tool-section="${escapeHtml(category)}" data-tool-id="${toolId}" ${selected.includes(category) ? 'checked' : ''}><span>${escapeHtml(category)}</span></label>`).join('')}</div><p class="dialog-help">Seleziona una o più sezioni. Togliere una spunta rimuove soltanto il collegamento: il tool non viene disinstallato.</p>`;
  sectionsDialog.showModal();
}

function refreshOrganizationViews() {
  if (!allCategories().includes(activeCategory)) activeCategory = 'Tutti';
  renderNav();
  renderTools();
}
async function refresh() {
  const [runtime, tools] = await Promise.all([api.getRuntimeInfo(), api.listAvailableTools()]);
  states = tools;
  document.querySelector('#suite-version').textContent = `FileX ${runtime.appVersion}`;
  document.querySelector('#runtime-info').textContent = `${tools.filter(x=>x.installed).length}/${tools.length} tool installati · canale ${runtime.releaseChannel}`;
  renderTools();
}
async function install(id, button = null) {
  const originalLabel = button?.textContent;
  if (button) { button.disabled = true; button.textContent = 'Scarico...'; }
  let job = await api.downloadToolUpdate(id);
  while (job && !['ready-to-apply', 'failed'].includes(job.status)) {
    if (button) {
      const percent = job.totalBytes ? Math.floor((job.downloadedBytes / job.totalBytes) * 100) : null;
      button.textContent = job.status === 'verifying' ? 'Verifica...' : percent !== null ? `Scarico ${percent}%` : 'Scarico...';
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    job = await api.getToolUpdateJob(job.id);
  }
  if (!job || job.status !== 'ready-to-apply') throw new Error(job?.error || 'Download non riuscito');
  if (button) button.textContent = 'Riavvio...';
  const result = await api.applyToolUpdate(job.id);
  if (result.status !== 'completed') throw new Error(result.error || 'Installazione non riuscita');
  await new Promise(resolve => setTimeout(resolve, 1200));
  await refresh();
  if (button) { button.disabled = false; button.textContent = originalLabel || 'Aggiorna'; }
}
nav.addEventListener('click', e => { const b=e.target.closest('[data-category]'); if(!b)return; activeCategory=b.dataset.category; title.textContent=activeCategory==='Tutti'?'Tutti gli strumenti':activeCategory; gridTitle.textContent=activeCategory; gridSubtitle.textContent=activeCategory==='Preferiti'?'I tool che usi di più.':activeCategory==='Recenti'?'Gli ultimi workflow aperti.':'Accesso rapido ai tuoi workflow fotografici.'; renderNav(); renderTools(); });
search.addEventListener('input', renderTools);
toolsGrid.addEventListener('click', async e => { const b=e.target.closest('[data-action]'); if(!b)return; const {action,id}=b.dataset; if(action==='favorite'){ favorites.has(id)?favorites.delete(id):favorites.add(id); localStorage.setItem('filex-favorites',JSON.stringify([...favorites])); renderTools(); return; } if(action==='sections'){ openToolSectionsDialog(id); return; } try { if(action==='open'){ b.disabled=true; const result=await api.openInstalledTool(id); if(!result.ok) throw new Error(result.message); recent=[id,...recent.filter(x=>x!==id)].slice(0,6); localStorage.setItem('filex-recent',JSON.stringify(recent)); b.disabled=false; } else await install(id,b); } catch(error){ b.disabled=false; alert(error.message||String(error)); } });
document.querySelector('#manage-sections-btn').addEventListener('click', openManageSectionsDialog);
document.querySelector('#license-btn').addEventListener('click', openLicenseDialog);
document.querySelector('#license-summary-button').addEventListener('click', openLicenseDialog);
document.querySelector('#license-refresh').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Verifica...';
  try {
    const state = await refreshLicense(true);
    const checkedAt = new Date(state.lastCheckedAt || Date.now()).toLocaleTimeString('it-IT', { hour:'2-digit', minute:'2-digit' });
    showToast(`Licenza verificata alle ${checkedAt}.`);
  } catch (error) {
    alert(error.message || String(error));
  } finally {
    button.disabled = false;
    button.textContent = 'Verifica ora';
  }
});
const licenseConsent = document.querySelector('#license-consent');
const licenseActivateButton = document.querySelector('#license-activate');
licenseConsent.addEventListener('change', () => { licenseActivateButton.disabled = !licenseConsent.checked; });
document.querySelector('#license-activate').addEventListener('click', async event => {
  const button = event.currentTarget;
  if (!licenseConsent.checked) return;
  const key = document.querySelector('#license-key').value;
  const label = document.querySelector('#license-device-label').value;
  licenseError.hidden = true;
  button.disabled = true;
  button.textContent = 'Attivazione...';
  try {
    const state = await api.activateLicense(key, label);
    renderLicense(state);
    document.querySelector('#license-key').value = '';
    licenseConsent.checked = false;
    licenseActivateButton.disabled = true;
    showToast('FileX All Access attivato.');
  } catch (error) {
    licenseError.textContent = error.message || String(error);
    licenseError.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = 'Attiva FileX';
  }
});
document.querySelector('#license-deactivate').addEventListener('click', async event => {
  const button = event.currentTarget;
  if (!confirm('Disattivare FileX su questo PC? I tuoi file e progetti non verranno eliminati.')) return;
  button.disabled = true;
  try { renderLicense(await api.deactivateLicense()); showToast('PC disattivato.'); }
  catch (error) { alert(error.message || String(error)); }
  finally { button.disabled = false; }
});
document.querySelector('#buy-annual').addEventListener('click', () => api.openLicenseCheckout('annual'));
document.querySelector('#buy-monthly').addEventListener('click', () => api.openLicenseCheckout('monthly'));
sectionsDialogContent.addEventListener('click', event => {
  if (event.target.id === 'reset-sections-btn') {
    if (!confirm('Ripristinare le sezioni predefinite? Le sezioni personali verranno eliminate, ma nessun tool sarà disinstallato.')) return;
    customCategories = [];
    toolCategoryOverrides = {};
    activeCategory = 'Tutti';
    saveOrganization();
    refreshOrganizationViews();
    renderManageSectionsDialog();
    showToast('Organizzazione predefinita ripristinata.');
    return;
  }
  if (event.target.id === 'create-section-btn') {
    const input = sectionsDialogContent.querySelector('#new-section-name');
    const name = normalizeCategoryName(input.value);
    if (!name) { input.focus(); return; }
    if (categoryNameExists(name)) { alert('Esiste già una sezione con questo nome.'); return; }
    customCategories.push(name);
    saveOrganization();
    refreshOrganizationViews();
    renderManageSectionsDialog();
    return;
  }
  const button = event.target.closest('[data-section-action]');
  if (!button) return;
  const index = Number(button.dataset.index);
  const action = button.dataset.sectionAction;
  if (!Number.isInteger(index) || !customCategories[index]) return;
  if (action === 'up' || action === 'down') {
    const destination = index + (action === 'up' ? -1 : 1);
    if (destination < 0 || destination >= customCategories.length) return;
    [customCategories[index], customCategories[destination]] = [customCategories[destination], customCategories[index]];
  } else if (action === 'rename') {
    renamingCategoryIndex = index;
    renderManageSectionsDialog();
    const input = sectionsDialogContent.querySelector(`[data-rename-input="${index}"]`);
    input?.focus();
    input?.select();
    return;
  } else if (action === 'cancel-rename') {
    renamingCategoryIndex = null;
    renderManageSectionsDialog();
    return;
  } else if (action === 'save-rename') {
    const oldName = customCategories[index];
    const input = sectionsDialogContent.querySelector(`[data-rename-input="${index}"]`);
    const newName = normalizeCategoryName(input?.value);
    if (!newName) { input?.focus(); return; }
    if (newName === oldName) { renamingCategoryIndex = null; renderManageSectionsDialog(); return; }
    if (categoryNameExists(newName, index)) { alert('Esiste già una sezione con questo nome.'); return; }
    customCategories[index] = newName;
    Object.keys(toolCategoryOverrides).forEach(toolId => {
      toolCategoryOverrides[toolId] = (Array.isArray(toolCategoryOverrides[toolId]) ? toolCategoryOverrides[toolId] : []).map(name => name === oldName ? newName : name);
    });
    if (activeCategory === oldName) activeCategory = newName;
    renamingCategoryIndex = null;
  } else if (action === 'delete') {
    const removed = customCategories[index];
    if (!confirm(`Eliminare la sezione “${removed}”? I tool non verranno disinstallati.`)) return;
    customCategories.splice(index, 1);
    Object.keys(toolCategoryOverrides).forEach(toolId => {
      const remaining = (Array.isArray(toolCategoryOverrides[toolId]) ? toolCategoryOverrides[toolId] : []).filter(name => name !== removed);
      toolCategoryOverrides[toolId] = remaining.length ? remaining : [metadata[toolId]?.category || 'Utility'];
    });
  }
  saveOrganization();
  refreshOrganizationViews();
  renderManageSectionsDialog();
});
sectionsDialogContent.addEventListener('keydown', event => {
  const renameInput = event.target.closest('[data-rename-input]');
  if (renameInput && event.key === 'Enter') {
    event.preventDefault();
    sectionsDialogContent.querySelector(`[data-section-action="save-rename"][data-index="${renameInput.dataset.renameInput}"]`)?.click();
    return;
  }
  if (renameInput && event.key === 'Escape') {
    event.preventDefault();
    renamingCategoryIndex = null;
    renderManageSectionsDialog();
    return;
  }
  if (event.key === 'Enter' && event.target.id === 'new-section-name') {
    event.preventDefault();
    sectionsDialogContent.querySelector('#create-section-btn')?.click();
  }
});
sectionsDialogContent.addEventListener('change', event => {
  const checkbox = event.target.closest('[data-tool-section]');
  if (!checkbox) return;
  const checked = [...sectionsDialogContent.querySelectorAll('[data-tool-section]:checked')].map(item => item.dataset.toolSection);
  if (!checked.length) {
    checkbox.checked = true;
    showToast('Ogni tool deve restare in almeno una sezione.');
    return;
  }
  setToolCategories(checkbox.dataset.toolId, checked);
  refreshOrganizationViews();
});
toolsGrid.addEventListener('dragstart', event => {
  const card = event.target.closest('[data-tool-id]');
  if (!card) return;
  event.dataTransfer.setData('text/filex-tool-id', card.dataset.toolId);
  event.dataTransfer.effectAllowed = 'copy';
  card.classList.add('dragging');
});
toolsGrid.addEventListener('dragend', event => {
  event.target.closest('[data-tool-id]')?.classList.remove('dragging');
  nav.querySelectorAll('.drag-target').forEach(item => item.classList.remove('drag-target'));
});
nav.addEventListener('dragover', event => {
  const target = event.target.closest('[data-category]');
  if (!target || !editableCategories().includes(target.dataset.category)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  nav.querySelectorAll('.drag-target').forEach(item => item.classList.toggle('drag-target', item === target));
});
nav.addEventListener('dragleave', event => {
  if (!nav.contains(event.relatedTarget)) nav.querySelectorAll('.drag-target').forEach(item => item.classList.remove('drag-target'));
});
nav.addEventListener('drop', event => {
  const target = event.target.closest('[data-category]');
  const category = target?.dataset.category;
  const toolId = event.dataTransfer.getData('text/filex-tool-id');
  nav.querySelectorAll('.drag-target').forEach(item => item.classList.remove('drag-target'));
  if (!toolId || !editableCategories().includes(category)) return;
  event.preventDefault();
  const memberships = categoriesForTool(toolId);
  if (!memberships.includes(category)) setToolCategories(toolId, [...memberships, category]);
  refreshOrganizationViews();
  const toolName = states.find(item => item.toolId === toolId)?.toolName || 'Tool';
  showToast(`${toolName} aggiunto a “${category}”.`);
});
document.querySelector('#refresh-btn').addEventListener('click', () => {
  void refresh();
});
document.querySelector('#check-suite-update-btn').addEventListener('click', () => {
  suiteUpdateDeferred = false;
  void api.checkSuiteUpdate();
});
document.querySelector('#install-missing-btn').addEventListener('click', async e => { e.currentTarget.disabled=true; try { for(const item of states.filter(x=>!x.installed)) await install(item.toolId); } catch(error){ alert(error.message||String(error)); } finally { e.currentTarget.disabled=false; } });
suiteUpdateRetry.addEventListener('click', () => {
  suiteUpdateDeferred = false;
  void api.checkSuiteUpdate();
});
suiteUpdateLater.addEventListener('click', () => {
  suiteUpdateDeferred = true;
  stopSuiteInstallCountdown();
  suiteUpdatePanel.hidden = true;
});
suiteUpdateInstall.addEventListener('click', () => {
  stopSuiteInstallCountdown();
  void api.installSuiteUpdate();
});
suiteUpdateDismiss.addEventListener('click', () => {
  suiteUpdateDeferred = true;
  suiteUpdatePanel.hidden = true;
});
api.onSuiteUpdateState(renderSuiteUpdate);
void api.getSuiteUpdateState().then(renderSuiteUpdate);
renderNav();
void refreshLicense().catch(error => renderLicense({ status:'unavailable', enforcement:'observe', activation:{current:0,limit:2}, message:error.message||String(error) }));
refresh().catch(error => { document.querySelector('#runtime-info').textContent=`Errore: ${error.message||error}`; });
