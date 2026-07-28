const api = window.filexDesktop;
const toolsGrid = document.querySelector('#tools-grid');
const nav = document.querySelector('#category-nav');
const search = document.querySelector('#search-input');
const title = document.querySelector('#view-title');
const gridTitle = document.querySelector('#grid-title');
const gridSubtitle = document.querySelector('#grid-subtitle');
const metadata = {
  'photo-selector-app': { icon:'select', category:'Selezione', description:'Seleziona, classifica e confronta grandi servizi fotografici.', color:'#36a97b' },
  'image-party-frame': { icon:'frame', category:'Creatività', description:'Applica cornici e composizioni per eventi e consegne.', color:'#d9695f' },
  'batch-print-layout': { icon:'print', category:'Stampa', description:'Organizza molte immagini su fogli pronti per la stampa.', color:'#8c71c8' },
  'archivio-flow': { icon:'archive', category:'Archivio', description:'Acquisisci, organizza e proteggi il tuo archivio fotografico.', color:'#6d9460' },
  'image-converter': { icon:'convert', category:'Utility', description:'Converti e comprimi immagini e negativi RAW.', color:'#df8647' },
  'image-file-finder': { icon:'find', category:'Utility', description:'Trova e raccogli fotografie partendo da una lista.', color:'#4c9caf' },
};
const categories = ['Tutti','Preferiti','Recenti','Selezione','Album','Creatività','Stampa','Archivio','Utility'];
let states = [];
let activeCategory = 'Tutti';
let favorites = new Set(JSON.parse(localStorage.getItem('filex-favorites') || '[]'));
let recent = JSON.parse(localStorage.getItem('filex-recent') || '[]');

function icon(name) { return `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`; }
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
    return `<article class="tool-card" style="--tool-color:${meta.color}">
      <button class="favorite ${favorites.has(state.toolId)?'selected':''}" data-action="favorite" data-id="${state.toolId}" title="Preferito">${icon('star')}</button>
      <div class="tool-icon"><img src="./icons/${state.toolId}.png" alt="" /></div><span class="category">${meta.category}</span><h3>${state.toolName}</h3><p>${meta.description}</p>
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
  const job = await api.downloadToolUpdate(id);
  if (job.status !== 'ready-to-apply') throw new Error(job.error || 'Download non riuscito');
  if (button) button.textContent = 'Avvio...';
  const result = await api.applyToolUpdate(job.id);
  if (result.status !== 'completed') throw new Error(result.error || 'Installazione non riuscita');
  await new Promise(resolve => setTimeout(resolve, 1200));
  await refresh();
  if (button) { button.disabled = false; button.textContent = originalLabel || 'Aggiorna'; }
}
nav.addEventListener('click', e => { const b=e.target.closest('[data-category]'); if(!b)return; activeCategory=b.dataset.category; title.textContent=activeCategory==='Tutti'?'Tutti gli strumenti':activeCategory; gridTitle.textContent=activeCategory; gridSubtitle.textContent=activeCategory==='Preferiti'?'I tool che usi di più.':activeCategory==='Recenti'?'Gli ultimi workflow aperti.':'Accesso rapido ai tuoi workflow fotografici.'; renderNav(); renderTools(); });
search.addEventListener('input', renderTools);
toolsGrid.addEventListener('click', async e => { const b=e.target.closest('[data-action]'); if(!b)return; const {action,id}=b.dataset; if(action==='favorite'){ favorites.has(id)?favorites.delete(id):favorites.add(id); localStorage.setItem('filex-favorites',JSON.stringify([...favorites])); renderTools(); return; } try { if(action==='open'){ b.disabled=true; const result=await api.openInstalledTool(id); if(!result.ok) throw new Error(result.message); recent=[id,...recent.filter(x=>x!==id)].slice(0,6); localStorage.setItem('filex-recent',JSON.stringify(recent)); b.disabled=false; } else await install(id,b); } catch(error){ b.disabled=false; alert(error.message||String(error)); } });
document.querySelector('#refresh-btn').addEventListener('click', refresh);
document.querySelector('#install-missing-btn').addEventListener('click', async e => { e.currentTarget.disabled=true; try { for(const item of states.filter(x=>!x.installed)) await install(item.toolId); } catch(error){ alert(error.message||String(error)); } finally { e.currentTarget.disabled=false; } });
renderNav(); refresh().catch(error => { document.querySelector('#runtime-info').textContent=`Errore: ${error.message||error}`; });
