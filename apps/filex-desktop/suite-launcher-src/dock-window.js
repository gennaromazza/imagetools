const api = window.filexDesktop;
const root = document.querySelector('#dock-tools');
const toolNames = {
  'photo-selector-app':'Image Select Pro', 'auto-layout-app':'ImageAlbumMaker', 'image-party-frame':'Image Party Frame',
  'image-id-print':'Image ID Print', 'batch-print-layout':'Batch Print Layout', 'archivio-flow':'Archivio Flow',
  'image-converter':'Image Converter', 'image-file-finder':'Trova Foto da Lista', 'network-drive-doctor':'Ripara Disco Rete'
};
let states = [];
let dockState = { x: 0, y: 0, opacity: 0.94, collapsed: false, autoHide: false };
let autoHideTimer = null;
function render() {
  root.innerHTML = states.filter(state => state.installed).map(state => `<button class="dock-item ready" data-id="${state.toolId}" title="${toolNames[state.toolId] || state.toolName}"><img src="./icons/${state.toolId}.png" alt="${toolNames[state.toolId] || state.toolName}" /><i></i></button>`).join('');
}
async function refresh() { states = await api.listAvailableTools(); render(); }
async function activate(id, button) {
  button.disabled = true;
  try {
    const state = states.find(item => item.toolId === id);
    if (!state?.installed) return;
    const result = await api.openInstalledTool(id);
    if (!result.ok) throw new Error(result.message);
  } catch (error) { alert(error.message || String(error)); }
  finally { button.disabled = false; }
}
root.addEventListener('click', event => { const button = event.target.closest('[data-id]'); if (button) void activate(button.dataset.id, button); });
document.querySelector('#suite-toggle').addEventListener('click', async () => {
  dockState = await api.saveSuiteDockState({ collapsed: !dockState.collapsed });
  document.body.classList.toggle('collapsed', dockState.collapsed);
});
document.querySelector('#dock-settings').addEventListener('click', () => {
  document.querySelector('#dock-controls').hidden = !document.querySelector('#dock-controls').hidden;
});
document.querySelector('#dock-opacity').addEventListener('input', async event => {
  dockState = await api.saveSuiteDockState({ opacity: Number(event.target.value) / 100 });
});
document.querySelector('#dock-autohide').addEventListener('change', async event => {
  dockState = await api.saveSuiteDockState({ autoHide: event.target.checked });
  document.body.classList.toggle('autohide-enabled', dockState.autoHide);
});
document.querySelector('#dock-collapse').addEventListener('click', async () => {
  dockState = await api.saveSuiteDockState({ collapsed: true });
  document.body.classList.add('collapsed');
});
document.querySelector('#dock-reset').addEventListener('click', async () => {
  dockState = await api.saveSuiteDockState({ x: 0, y: 0 });
  window.location.reload();
});
document.querySelector('#dock-close-settings').addEventListener('click', () => {
  document.querySelector('#dock-controls').hidden = true;
});
window.addEventListener('mouseup', () => { void api.saveSuiteDockState({}); });
root.addEventListener('pointermove', event => {
  const rect = root.getBoundingClientRect();
  for (const item of root.querySelectorAll('.dock-item')) {
    const itemRect = item.getBoundingClientRect();
    const center = itemRect.left + itemRect.width / 2;
    const distance = Math.abs(event.clientX - center);
    const influence = Math.max(0, 1 - distance / 125);
    item.style.transform = `translateY(${-10 * influence}px) scale(${1 + 0.16 * influence})`;
  }
});
root.addEventListener('pointerleave', () => {
  for (const item of root.querySelectorAll('.dock-item')) item.style.transform = '';
});
function resetAutoHideTimer() {
  if (autoHideTimer) clearTimeout(autoHideTimer);
  document.body.classList.remove('is-hidden');
  if (dockState.autoHide && !dockState.collapsed) {
    autoHideTimer = setTimeout(() => document.body.classList.add('is-hidden'), 1800);
  }
}
document.querySelector('.dock-window').addEventListener('mouseenter', resetAutoHideTimer);
document.querySelector('.dock-window').addEventListener('mouseleave', resetAutoHideTimer);
async function boot() {
  dockState = await api.getSuiteDockState();
  document.querySelector('#dock-opacity').value = String(Math.round(dockState.opacity * 100));
  document.querySelector('#dock-autohide').checked = dockState.autoHide;
  document.body.classList.toggle('collapsed', dockState.collapsed);
  await refresh();
  resetAutoHideTimer();
}
setInterval(() => { void refresh(); }, 5000);
boot().catch(error => { root.innerHTML = `<span class="dock-error">${error.message || error}</span>`; });
