const api = window.filexDesktop;
const root = document.querySelector('#dock-tools');
const dockWindow = document.querySelector('.dock-window');
const controls = document.querySelector('#dock-controls');
const suiteToggle = document.querySelector('#suite-toggle');
const settingsButton = document.querySelector('#dock-settings');
const toolNames = {
  'photo-selector-app': 'Image Select Pro',
  'image-party-frame': 'Image Party Frame',
  'batch-print-layout': 'Batch Print Layout',
  'archivio-flow': 'Archivio Flow',
  'image-converter': 'Image Converter',
  'image-file-finder': 'Trova Foto da Lista',
  'cache-sweep': 'FileX Adobe Cleaner',
};

let states = [];
let dockState = {
  schemaVersion: 2,
  x: 0,
  y: 0,
  opacity: 0.94,
  collapsed: true,
  autoHide: true,
  toolOrder: [],
  visibleToolCount: 0,
  settingsOpen: false,
};
let autoCollapseTimer = null;
let refreshInFlight = false;
let renderKey = '';
let pointerX = null;
let magnificationFrame = null;
let dragState = null;
let suppressClickUntil = 0;

function installedStatesInOrder() {
  const installed = states.filter((state) => state.installed);
  const rank = new Map(dockState.toolOrder.map((toolId, index) => [toolId, index]));
  return installed.sort((left, right) => {
    const leftRank = rank.get(left.toolId) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = rank.get(right.toolId) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank;
  });
}

function render() {
  const ordered = installedStatesInOrder();
  const nextRenderKey = ordered.map((state) => state.toolId).join('|');
  if (nextRenderKey === renderKey) return;
  renderKey = nextRenderKey;
  root.innerHTML = ordered.map((state) => {
    const name = toolNames[state.toolId] || state.toolName;
    return `<button class="dock-item ready" data-id="${state.toolId}" title="${name}" aria-label="${name}"><img src="./icons/${state.toolId}.png" alt="" draggable="false" /><i></i></button>`;
  }).join('');
}

async function refresh() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    states = await api.listAvailableTools();
    const knownIds = states.map((state) => state.toolId);
    const nextOrder = [
      ...dockState.toolOrder.filter((toolId) => knownIds.includes(toolId)),
      ...knownIds.filter((toolId) => !dockState.toolOrder.includes(toolId)),
    ];
    const visibleToolCount = states.filter((state) => state.installed).length;
    if (nextOrder.join('|') !== dockState.toolOrder.join('|') || visibleToolCount !== dockState.visibleToolCount) {
      dockState = await api.saveSuiteDockState({ toolOrder: nextOrder, visibleToolCount });
    }
    render();
  } finally {
    refreshInFlight = false;
  }
}

function clearAutoCollapseTimer() {
  if (autoCollapseTimer) clearTimeout(autoCollapseTimer);
  autoCollapseTimer = null;
}

function scheduleAutoCollapse() {
  clearAutoCollapseTimer();
  if (!dockState.autoHide || dockState.collapsed || dockState.settingsOpen) return;
  autoCollapseTimer = setTimeout(() => { void setCollapsed(true); }, 4200);
}

function updateCollapsedUi() {
  document.body.classList.toggle('collapsed', dockState.collapsed);
  suiteToggle.title = dockState.collapsed ? 'Espandi FileX Dock' : 'Riduci FileX Dock';
  suiteToggle.setAttribute('aria-expanded', String(!dockState.collapsed));
}

async function setCollapsed(collapsed) {
  clearAutoCollapseTimer();
  if (collapsed) controls.hidden = true;
  dockState = await api.saveSuiteDockState({
    collapsed,
    settingsOpen: collapsed ? false : dockState.settingsOpen,
  });
  updateCollapsedUi();
  if (!collapsed) scheduleAutoCollapse();
}

async function setSettingsOpen(settingsOpen) {
  controls.hidden = !settingsOpen;
  dockState = await api.saveSuiteDockState({ settingsOpen });
  settingsButton.setAttribute('aria-expanded', String(settingsOpen));
  if (settingsOpen) clearAutoCollapseTimer();
  else scheduleAutoCollapse();
}

async function activate(id, button) {
  button.disabled = true;
  try {
    const state = states.find((item) => item.toolId === id);
    if (!state?.installed) return;
    const result = await api.openInstalledTool(id);
    if (!result.ok) throw new Error(result.message);
    if (dockState.autoHide) setTimeout(() => { void setCollapsed(true); }, 220);
  } catch (error) {
    alert(error.message || String(error));
  } finally {
    button.disabled = false;
  }
}

function resetMagnification() {
  pointerX = null;
  scheduleMagnification();
}

function scheduleMagnification() {
  if (magnificationFrame !== null) return;
  magnificationFrame = requestAnimationFrame(() => {
    magnificationFrame = null;
    const items = root.querySelectorAll('.dock-item');
    for (const item of items) {
      if (pointerX === null || dragState?.active) {
        item.style.transform = '';
        continue;
      }
      const rect = item.getBoundingClientRect();
      const distance = Math.abs(pointerX - (rect.left + rect.width / 2));
      const normalized = Math.min(1, distance / 145);
      const influence = (Math.cos(normalized * Math.PI) + 1) / 2;
      const scale = 1 + 0.28 * influence;
      const lift = -17 * influence;
      item.style.transform = `translate3d(0, ${lift}px, 0) scale(${scale})`;
    }
  });
}

function animateReorder(previousRects, draggedButton) {
  for (const item of root.querySelectorAll('.dock-item')) {
    if (item === draggedButton) continue;
    const previous = previousRects.get(item);
    if (!previous) continue;
    const current = item.getBoundingClientRect();
    const deltaX = previous.left - current.left;
    if (Math.abs(deltaX) < 1) continue;
    item.animate(
      [{ transform: `translate3d(${deltaX}px, 0, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
      { duration: 210, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
  }
}

function moveDraggedButton(clientX) {
  if (!dragState?.active) return;
  const button = dragState.button;
  const siblings = [...root.querySelectorAll('.dock-item')].filter((item) => item !== button);
  const reference = siblings.find((item) => {
    const rect = item.getBoundingClientRect();
    return clientX < rect.left + rect.width / 2;
  }) || null;
  if (reference === button.nextElementSibling || (!reference && !button.nextElementSibling)) return;
  const previousRects = new Map(siblings.map((item) => [item, item.getBoundingClientRect()]));
  root.insertBefore(button, reference);
  animateReorder(previousRects, button);
}

function finishDrag(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  const { button, active } = dragState;
  if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
  button.classList.remove('dragging');
  document.body.classList.remove('reordering');
  dragState = null;
  if (!active) return;
  suppressClickUntil = performance.now() + 350;
  const toolOrder = [...root.querySelectorAll('.dock-item')].map((item) => item.dataset.id);
  const remaining = dockState.toolOrder.filter((toolId) => !toolOrder.includes(toolId));
  dockState.toolOrder = [...toolOrder, ...remaining];
  renderKey = toolOrder.join('|');
  void api.saveSuiteDockState({ toolOrder: dockState.toolOrder }).then((saved) => { dockState = saved; });
  scheduleAutoCollapse();
}

root.addEventListener('click', (event) => {
  if (performance.now() < suppressClickUntil) return;
  const button = event.target.closest('[data-id]');
  if (button) void activate(button.dataset.id, button);
});

root.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  const button = event.target.closest('.dock-item');
  if (!button) return;
  clearAutoCollapseTimer();
  dragState = {
    pointerId: event.pointerId,
    button,
    startX: event.clientX,
    startY: event.clientY,
    active: false,
  };
  button.setPointerCapture(event.pointerId);
});

root.addEventListener('pointermove', (event) => {
  if (dragState && event.pointerId === dragState.pointerId) {
    const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);
    if (!dragState.active && distance > 6) {
      dragState.active = true;
      resetMagnification();
      dragState.button.classList.add('dragging');
      document.body.classList.add('reordering');
    }
    if (dragState.active) {
      event.preventDefault();
      moveDraggedButton(event.clientX);
      return;
    }
  }
  pointerX = event.clientX;
  scheduleMagnification();
});

root.addEventListener('pointerleave', () => {
  if (!dragState?.active) resetMagnification();
});
root.addEventListener('pointerup', finishDrag);
root.addEventListener('pointercancel', finishDrag);

suiteToggle.addEventListener('click', () => { void setCollapsed(!dockState.collapsed); });
settingsButton.addEventListener('click', () => { void setSettingsOpen(controls.hidden); });
document.querySelector('#dock-opacity').addEventListener('input', async (event) => {
  dockState = await api.saveSuiteDockState({ opacity: Number(event.target.value) / 100 });
});
document.querySelector('#dock-autohide').addEventListener('change', async (event) => {
  dockState = await api.saveSuiteDockState({ autoHide: event.target.checked });
  scheduleAutoCollapse();
});
document.querySelector('#dock-collapse').addEventListener('click', () => { void setCollapsed(true); });
document.querySelector('#dock-reset').addEventListener('click', async () => {
  dockState = await api.saveSuiteDockState({ x: 0, y: 0 });
  window.location.reload();
});
document.querySelector('#dock-close-settings').addEventListener('click', () => { void setSettingsOpen(false); });
window.addEventListener('mouseup', () => { void api.saveSuiteDockState({}); });
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!controls.hidden) void setSettingsOpen(false);
  else if (!dockState.collapsed) void setCollapsed(true);
});
dockWindow.addEventListener('mouseenter', clearAutoCollapseTimer);
dockWindow.addEventListener('mouseleave', scheduleAutoCollapse);

async function boot() {
  dockState = await api.getSuiteDockState();
  controls.hidden = true;
  dockState = await api.saveSuiteDockState({ settingsOpen: false });
  document.querySelector('#dock-opacity').value = String(Math.round(dockState.opacity * 100));
  document.querySelector('#dock-autohide').checked = dockState.autoHide;
  updateCollapsedUi();
  document.body.classList.remove('booting');
  await refresh();
  scheduleAutoCollapse();
}

setInterval(() => { void refresh(); }, 5000);
boot().catch((error) => {
  document.body.classList.remove('booting');
  root.innerHTML = `<span class="dock-error">${error.message || error}</span>`;
});
