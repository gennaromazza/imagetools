const api = window.filexDesktop;
const root = document.querySelector('#dock-tools');
const toolNames = {
  'photo-selector-app':'Image Select Pro', 'auto-layout-app':'ImageAlbumMaker', 'image-party-frame':'Image Party Frame',
  'image-id-print':'Image ID Print', 'batch-print-layout':'Batch Print Layout', 'archivio-flow':'Archivio Flow',
  'image-converter':'Image Converter', 'image-file-finder':'Trova Foto da Lista', 'network-drive-doctor':'Ripara Disco Rete'
};
let states = [];
function render() {
  root.innerHTML = states.map(state => `<button class="dock-item ${state.installed?'ready':'missing'}" data-id="${state.toolId}" title="${toolNames[state.toolId] || state.toolName}"><img src="./icons/${state.toolId}.png" alt="${toolNames[state.toolId] || state.toolName}" /><i></i></button>`).join('');
}
async function refresh() { states = await api.listAvailableTools(); render(); }
async function activate(id, button) {
  button.disabled = true;
  try {
    const state = states.find(item => item.toolId === id);
    if (state?.installed) {
      const result = await api.openInstalledTool(id);
      if (!result.ok) throw new Error(result.message);
    } else {
      const job = await api.downloadToolUpdate(id);
      if (job.status !== 'ready-to-apply') throw new Error(job.error || 'Download non riuscito');
      const result = await api.applyToolUpdate(job.id);
      if (result.status !== 'completed') throw new Error(result.error || 'Installazione non riuscita');
      await refresh();
    }
  } catch (error) { alert(error.message || String(error)); }
  finally { button.disabled = false; }
}
root.addEventListener('click', event => { const button = event.target.closest('[data-id]'); if (button) void activate(button.dataset.id, button); });
refresh().catch(error => { root.innerHTML = `<span class="dock-error">${error.message || error}</span>`; });
