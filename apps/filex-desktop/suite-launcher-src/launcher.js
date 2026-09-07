const api = window.filexDesktop;
const root = document.querySelector('#tools');
const search = document.querySelector('#search');
const status = document.querySelector('#status');
const tooltip = document.querySelector('#tooltip');
const surface = document.querySelector('#surface');
function saved(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function persist(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { message('Impossibile salvare le preferenze.'); } }
const asIds = value => new Set(Array.isArray(value) ? value.filter(id => typeof id === 'string').slice(-500) : []);
let favorites = asIds(saved('filex-launcher-favorites', []));
let dismissed = asIds(saved('filex-dock-dismissed', []));
let seen = asIds(saved('filex-dock-seen', []));
let tools = [], notifications = [], busy = false, refreshBusy = false, noticeBusy = false;
let renderKey = '', naturalWidth = 440, lastSize = '';
let controlsExpanded = false;
let theme = saved('filex-dock-theme', 'filex');
let color = saved('filex-dock-color', '#243447');
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
function message(text = '') { status.textContent = text; status.hidden = !text; }
function resize() {
  const height = Math.ceil(surface.getBoundingClientRect().height + 42);
  const size = height + ':' + naturalWidth;
  if (size === lastSize) return;
  lastSize = size;
  void api.resizeSuiteLauncher?.(height, naturalWidth).catch(() => { lastSize = ''; });
}
new ResizeObserver(resize).observe(surface);
function applyTheme() {
  if (!['filex', 'black', 'system', 'custom'].includes(theme)) theme = 'filex';
  if (!/^#[0-9a-f]{6}$/i.test(color)) color = '#243447';
  const background = theme === 'black' ? '#101010' : theme === 'system' ? systemTheme.matches ? '#202020' : '#f1f1f1' : theme === 'custom' ? color : '#18291f';
  const channels = background.slice(1).match(/../g).map(x => parseInt(x, 16));
  const light = channels[0] * .299 + channels[1] * .587 + channels[2] * .114 > 155;
  const variables = {bg:background, fg:light?'#152018':'#f1f6f2', muted:light?'#435249':'#bdc9c1',
    border:light?'#00000028':'#ffffff28', hover:light?'#00000010':'#ffffff19', accent:light?'#256840':'#a5e8be'};
  for (const [name, value] of Object.entries(variables)) document.documentElement.style.setProperty('--' + name, value);
  document.documentElement.style.colorScheme = light ? 'light' : 'dark';
  document.querySelector('#theme').value = theme;
  document.querySelector('#custom-color').value = color;
  document.querySelector('#custom-color').hidden = theme !== 'custom';
  document.querySelector('#color-label').hidden = theme !== 'custom';
}
systemTheme.addEventListener('change', applyTheme);
document.querySelector('#theme').addEventListener('change', event => { theme=event.target.value; persist('filex-dock-theme',theme); applyTheme(); });
document.querySelector('#custom-color').addEventListener('input', event => {
  const valid = /^#[0-9a-f]{6}$/i.test(event.target.value);
  event.target.setAttribute('aria-invalid', String(!valid));
  if (valid) { color=event.target.value; persist('filex-dock-color',color); applyTheme(); }
});
function tip(button) {
  tooltip.textContent = button.dataset.tip || button.getAttribute('aria-label');
  tooltip.hidden = false;
  const rect = button.getBoundingClientRect();
  const width = tooltip.getBoundingClientRect().width;
  tooltip.style.left = Math.max(6, Math.min(innerWidth-width-6, rect.left+rect.width/2-width/2)) + 'px';
  tooltip.style.top = Math.max(2,rect.top-32) + 'px';
}
document.addEventListener('pointerover', event => { const button=event.target.closest('[data-tip]'); if (button) tip(button); });
document.addEventListener('focusin', event => { const button=event.target.closest('[data-tip]'); if (button) tip(button); });
document.addEventListener('pointerout', event => { if (event.target.closest('[data-tip]')) tooltip.hidden=true; });
document.addEventListener('focusout', () => { tooltip.hidden=true; });
function panel(name, open) {
  tooltip.hidden=true;
  for (const id of ['search','settings','notifications']) {
    const active = id===name && open;
    document.querySelector('#'+id+'-panel').hidden=!active;
    document.querySelector('#'+id+'-toggle').setAttribute('aria-expanded',String(active));
  }
  if (name==='search' && open) search.focus();
  else if (search.value) { search.value=''; render(); }
  if (name==='notifications' && open) {
    notifications.forEach(item=>seen.add(item.id)); persist('filex-dock-seen',[...seen].slice(-500)); renderNotifications();
  }
  resize();
}
for (const id of ['search','settings','notifications']) {
  document.querySelector('#'+id+'-toggle').addEventListener('click',()=>panel(id,document.querySelector('#'+id+'-panel').hidden));
}
document.querySelector('#controls-toggle').addEventListener('click', () => {
  controlsExpanded = !controlsExpanded;
  document.querySelector('#controls').hidden = !controlsExpanded;
  const toggle = document.querySelector('#controls-toggle');
  toggle.setAttribute('aria-expanded', String(controlsExpanded));
  toggle.setAttribute('aria-label', controlsExpanded ? 'Riduci comandi' : 'Espandi comandi');
  toggle.dataset.tip = controlsExpanded ? 'Riduci comandi' : 'Espandi comandi';
  document.querySelector('#controls-chevron').textContent = controlsExpanded ? '›' : '‹';
  tooltip.hidden = true;
  if (!controlsExpanded) panel('', false);
  render(); renderNotifications();
});
async function launch(id) {
  if (busy) return;
  busy=true;
  root.querySelectorAll('button').forEach(button=>{button.disabled=true;});
  try {
    const result=await api.openInstalledTool(id);
    if(result.ok) { message(); window.close(); }
    else message(result.message || 'Impossibile avviare il programma.');
  } catch(error) { message('Avvio non riuscito: '+(error.message||error)); }
  finally { busy=false; root.querySelectorAll('button').forEach(button=>{button.disabled=false;}); }
}
function render() {
  const visible=tools.filter(tool=>tool.installed && tool.toolName.toLocaleLowerCase('it').includes(search.value.trim().toLocaleLowerCase('it')))
    .sort((a,b)=>Number(favorites.has(b.toolId))-Number(favorites.has(a.toolId)));
  const key=JSON.stringify(visible)+JSON.stringify([...favorites]);
  naturalWidth=Math.max(240,Math.min(880, visible.length*48+(controlsExpanded?228:76)));
  if (key===renderKey) { resize(); return; }
  renderKey=key; root.replaceChildren(); tooltip.hidden=true;
  message(visible.length ? '' : tools.some(tool=>tool.installed) ? 'Nessun programma corrispondente.' : 'Nessun programma installato. Apri Gestisci FileX Suite.');
  for(const tool of visible) {
    const button=document.createElement('button');
    button.className='launch'+(favorites.has(tool.toolId)?' favorite':'');
    button.dataset.id=tool.toolId;
    button.dataset.tip=tool.toolName+(tool.status==='update-available'?' · Aggiornamento disponibile':'');
    button.setAttribute('aria-label',tool.toolName);
    button.setAttribute('aria-describedby','tooltip');
    button.disabled=busy;
    const icon=document.createElement('img'); icon.src='./icons/'+tool.toolId+'.png'; icon.alt='';
    button.append(icon);
    if(tool.status==='update-available') {
      const dot=document.createElement('span'); dot.className='update-dot'; dot.setAttribute('aria-label','Aggiornamento disponibile'); button.append(dot);
    }
    button.addEventListener('click',()=>void launch(tool.toolId));
    const favorite=event=>{
      event.preventDefault();
      if(favorites.has(tool.toolId)) favorites.delete(tool.toolId); else favorites.add(tool.toolId);
      persist('filex-launcher-favorites',[...favorites]); render();
      [...root.children].find(item=>item.dataset.id===tool.toolId)?.focus();
    };
    button.addEventListener('contextmenu',favorite);
    button.addEventListener('keydown',event=>{if(event.shiftKey&&event.key.toLowerCase()==='f')favorite(event);});
    root.append(button);
  }
  resize();
}
async function refresh() {
  if(refreshBusy||busy)return;
  refreshBusy=true;
  try { tools=await api.listAvailableTools(); render(); }
  catch(error){message('Impossibile caricare i programmi: '+(error.message||error));}
  finally{refreshBusy=false;}
}
function renderNotifications() {
  const list=document.querySelector('#notifications-list');
  list.replaceChildren();
  const unread=notifications.filter(item=>!seen.has(item.id)).length;
  document.querySelector('#collapsed-notification-dot').hidden=controlsExpanded || !unread;
  const badge=document.querySelector('#notification-count');
  badge.hidden=!unread; badge.textContent=unread>99?'99+':String(unread);
  document.querySelector('#notifications-toggle').setAttribute('aria-label','Notifiche, '+unread+' non lette');
  if(!notifications.length){const p=document.createElement('p');p.textContent='Nessuna notifica.';list.append(p);}
  for(const item of notifications) {
    const article=document.createElement('article'); article.className='notification';
    const title=document.createElement('strong'); title.textContent=item.title;
    const text=document.createElement('p'); text.textContent=item.message;
    const actions=document.createElement('div');actions.className='actions';
    const open=document.createElement('button');open.textContent=item.toolId==='filex-send'?'Apri FileX Send':'Gestisci Suite';
    open.addEventListener('click',()=>{if(item.toolId==='filex-send')void launch('filex-send');else void manage();});
    const dismiss=document.createElement('button');dismiss.textContent='Rimuovi';
    dismiss.addEventListener('click',()=>{
      dismissed.add(item.id);persist('filex-dock-dismissed',[...dismissed].slice(-500));
      notifications=notifications.filter(other=>other.id!==item.id);renderNotifications();
    });
    actions.append(open,dismiss);article.append(title,text,actions);list.append(article);
  }
}
async function refreshNotifications() {
  if(noticeBusy)return;noticeBusy=true;
  try {
    const [events,suite,license]=await Promise.all([
      api.getSuiteNotifications?.().catch(()=>[])||[],
      api.getSuiteUpdateState?.().catch(()=>null)||null,
      api.getLicenseState?.().catch(()=>null)||null,
    ]);
    const next=[...events];
    if(suite && ['available','downloading','ready','installing','error'].includes(suite.status)){
      const labels={available:'Aggiornamento Suite disponibile',downloading:'Download Suite in corso',ready:'Suite pronta da installare',installing:'Installazione Suite in corso',error:'Errore aggiornamento Suite'};
      next.push({id:'suite:'+suite.status+':'+(suite.availableVersion||''),title:labels[suite.status],message:suite.error||suite.message|| (suite.status==='downloading'&&typeof suite.percent==='number'?Math.round(suite.percent)+'%':suite.availableVersion||'Apri la Suite per i dettagli.')});
    }
    if(license&&!license.canUseTools)next.push({id:'license:'+license.status,title:'Licenza FileX',message:license.message||'Apri la Suite per gestire la licenza.'});
    tools.filter(tool=>tool.installed&&tool.status==='update-available').forEach(tool=>next.push({
      id:'update:'+tool.toolId+':'+tool.latestVersion,title:'Aggiornamento: '+tool.toolName,message:'Una nuova versione è disponibile nella Suite.',
    }));
    notifications=[...new Map(next.filter(item=>!dismissed.has(item.id)).map(item=>[item.id,item])).values()].slice(0,100);
    if(!document.querySelector('#notifications-panel').hidden){notifications.forEach(item=>seen.add(item.id));persist('filex-dock-seen',[...seen].slice(-500));}
    renderNotifications();
  } finally{noticeBusy=false;}
}
document.querySelector('#clear-notifications').addEventListener('click',()=>{
  notifications.forEach(item=>dismissed.add(item.id));persist('filex-dock-dismissed',[...dismissed].slice(-500));notifications=[];renderNotifications();
});
async function manage(){try{await api.openSuiteWindow();}catch(error){message('Impossibile aprire la Suite: '+(error.message||error));}}
document.querySelector('#manage').addEventListener('click',()=>void manage());
search.addEventListener('input',render);
window.addEventListener('keydown',event=>{
  if(event.key==='Escape'){
    event.preventDefault();
    if(['search','settings','notifications'].some(id=>!document.querySelector('#'+id+'-panel').hidden)){panel('',false);document.querySelector('#search-toggle').focus();}
    else window.close();
  }
});
window.addEventListener('blur',()=>{tooltip.hidden=true;panel('',false);message();});
window.addEventListener('focus',()=>{void refresh().then(refreshNotifications);});
api.onSuiteUpdateState?.(()=>{void refreshNotifications();});
applyTheme();
void refresh().then(refreshNotifications);
setInterval(()=>{void refreshNotifications();},5000);
setInterval(()=>{void refresh();},60000);
