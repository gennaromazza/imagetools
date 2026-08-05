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
const metadata = {
  'photo-selector-app': { icon:'select', category:'Selezione', description:'Gestisce la selezione completa di servizi fotografici anche molto grandi. Permette di sfogliare rapidamente JPEG e RAW, confrontare gli scatti, assegnare valutazioni, preferenze ed etichette colore, sincronizzare i dati XMP e salvare o trasferire il progetto tramite Google Drive.', color:'#36a97b' },
  'image-party-frame': { icon:'frame', category:'Creatività', description:'Crea progetti fotografici con cornici e composizioni grafiche usando template predefiniti o personalizzati. Consente di regolare ritaglio e zoom per ogni immagine, confrontare prima e dopo, validare il risultato ed esportare interi gruppi di fotografie pronti per eventi e consegne.', color:'#d9695f' },
  'batch-print-layout': { icon:'print', category:'Stampa', description:'Impagina automaticamente molte fotografie su fogli pronti per la stampa. Organizza il lavoro in batch, distribuisce le immagini nei layout disponibili e riduce le operazioni manuali e lo spreco di carta durante la preparazione delle stampe.', color:'#8c71c8' },
  'archivio-flow': { icon:'archive', category:'Archivio', description:'Accompagna l\'importazione delle fotografie dalla scheda alla creazione del lavoro in archivio. Rileva i file, applica una struttura di cartelle e nomi coerenti, prepara copie operative e leggere e mantiene i servizi consultabili e riapribili nel tempo.', color:'#6d9460' },
  'image-converter': { icon:'convert', category:'Utility', description:'Converte intere cartelle di immagini in JPG o WebP usando preset per web, social, revisione e stampa, con controllo di dimensioni, qualità e peso. Gestisce inoltre i negativi RAW trasformandoli in DNG compresso, conservando gli originali e i relativi file XMP.', color:'#df8647' },
  'image-file-finder': { icon:'find', category:'Utility', description:'Cerca automaticamente fotografie dentro cartelle e sottocartelle partendo da una lista di nomi o codici file. Raccoglie in una destinazione unica le immagini trovate e produce un riepilogo chiaro di corrispondenze, duplicati ed elementi mancanti.', color:'#4c9caf' },
};
const categories = ['Tutti','Preferiti','Recenti','Selezione','Creatività','Stampa','Archivio','Utility'];
let states = [];
let activeCategory = 'Tutti';
let favorites = new Set(JSON.parse(localStorage.getItem('filex-favorites') || '[]'));
let recent = JSON.parse(localStorage.getItem('filex-recent') || '[]');
let suiteUpdateDeferred = false;
let suiteInstallTimer = null;
let suiteInstallSeconds = 0;

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
  nav.innerHTML = categories.map(category => `<button class="nav-item ${category===activeCategory?'active':''}" data-category="${category}">${category==='Preferiti'?icon('star'):''}<span>${category}</span></button>`).join('');
}
function filteredTools() {
  const query = search.value.trim().toLowerCase();
  let list = [...states];
  if (activeCategory === 'Preferiti') list = list.filter(x => favorites.has(x.toolId));
  else if (activeCategory === 'Recenti') list = recent.map(id => list.find(x => x.toolId===id)).filter(Boolean);
  else if (activeCategory !== 'Tutti') list = list.filter(x => metadata[x.toolId]?.category===activeCategory);
  if (query) list = list.filter(x => `${x.toolName} ${metadata[x.toolId]?.description||''}`.toLowerCase().includes(query));
  return list;
}
function renderTools() {
  const list = filteredTools();
  toolsGrid.innerHTML = list.length ? list.map(state => {
    const meta = metadata[state.toolId] || {icon:'suite',category:'Tool',description:'Strumento FileX',color:'#36a97b'};
    const installed = Boolean(state.installed);
    const update = state.status === 'update-available';
    const releaseHighlights = Array.isArray(state.releaseHighlights) ? state.releaseHighlights : [];
    const updateDetails = update ? `<aside class="tool-update-notes" aria-label="Novità versione ${escapeHtml(state.latestVersion)}">
      <strong>Novità della versione ${escapeHtml(state.latestVersion)}</strong>
      <ul>${releaseHighlights.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </aside>` : '';
    return `<article class="tool-card" style="--tool-color:${meta.color}">
      <button class="favorite ${favorites.has(state.toolId)?'selected':''}" data-action="favorite" data-id="${state.toolId}" title="Preferito">${icon('star')}</button>
      <div class="tool-icon"><img src="./icons/${state.toolId}.png" alt="" /></div><span class="category">${meta.category}</span><h3>${escapeHtml(state.toolName)}</h3><p class="tool-description">${meta.description}</p>
      ${updateDetails}
      <div class="card-foot"><span class="status ${update?'warn':installed?'ok':'off'}">${update?'Aggiornamento':installed?'Pronto':'Da installare'}</span>
      <div class="card-actions">${update?`<button class="update-mini" data-action="install" data-id="${state.toolId}">Aggiorna</button>`:''}<button class="launch" data-action="${installed?'open':'install'}" data-id="${state.toolId}">${installed?'Apri':'Installa'} <span>→</span></button></div></div>
    </article>`;
  }).join('') : '<div class="empty">Nessuno strumento in questa sezione.</div>';
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
toolsGrid.addEventListener('click', async e => { const b=e.target.closest('[data-action]'); if(!b)return; const {action,id}=b.dataset; if(action==='favorite'){ favorites.has(id)?favorites.delete(id):favorites.add(id); localStorage.setItem('filex-favorites',JSON.stringify([...favorites])); renderTools(); return; } try { if(action==='open'){ b.disabled=true; const result=await api.openInstalledTool(id); if(!result.ok) throw new Error(result.message); recent=[id,...recent.filter(x=>x!==id)].slice(0,6); localStorage.setItem('filex-recent',JSON.stringify(recent)); b.disabled=false; } else await install(id,b); } catch(error){ b.disabled=false; alert(error.message||String(error)); } });
document.querySelector('#refresh-btn').addEventListener('click', () => {
  suiteUpdateDeferred = false;
  void Promise.all([refresh(), api.checkSuiteUpdate()]);
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
renderNav(); refresh().catch(error => { document.querySelector('#runtime-info').textContent=`Errore: ${error.message||error}`; });
