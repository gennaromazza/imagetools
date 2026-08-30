const api = window.filexDesktop;
const root = document.querySelector('#dock-tools');
const dockWindow = document.querySelector('.dock-window');
const controls = document.querySelector('#dock-controls');
const suiteToggle = document.querySelector('#suite-toggle');
const settingsButton = document.querySelector('#dock-settings');
const notificationsButton = document.querySelector('#dock-notifications');
const notificationCount = document.querySelector('#dock-notification-count');
const dockEdgeAnchor = document.querySelector('#dock-edge-anchor');
const notificationCenter = document.querySelector('#dock-notification-center');
const notificationList = document.querySelector('#dock-notification-list');
const notificationClose = document.querySelector('#dock-notification-close');
const notificationClearAll = document.querySelector('#dock-notifications-clear');

const toolNames = {
  'photo-selector-app': 'Image Select Pro',
  'image-party-frame': 'Image Party Frame',
  'batch-print-layout': 'Batch Print Layout',
  'archivio-flow': 'Archivio Flow',
  'image-converter': 'Image Converter',
  'image-file-finder': 'Trova Foto da Lista',
  'cache-sweep': 'FileX Adobe Cleaner',
  'filex-send': 'FileX Send',
};

const NOTIFICATION_LIMIT = 20;

let states = [];
let dockState = {
  schemaVersion: 2,
  enabled: true,
  x: 0,
  y: 0,
  opacity: 0.94,
  collapsed: true,
  autoHide: true,
  toolOrder: [],
  visibleToolCount: 0,
  settingsOpen: false,
  notificationCenterOpen: false,
  edgeAnchor: "bottom",
};
let autoCollapseTimer = null;
let refreshInFlight = false;
let notificationsInFlight = false;
let renderKey = '';
let pointerPosition = null;
let magnificationFrame = null;
let dragState = null;
let suppressClickUntil = 0;
let suiteUpdateState = null;
let licenseState = null;
let notifications = [];
let notificationSeed = 0;
let isHoverReveal = false;

function isSideDock() {
  return dockState.edgeAnchor === 'left' || dockState.edgeAnchor === 'right';
}

function applyEdgeAnchorUi() {
  document.body.classList.toggle('dock--edge-left', dockState.edgeAnchor === 'left');
  document.body.classList.toggle('dock--edge-right', dockState.edgeAnchor === 'right');
  document.body.classList.toggle('dock--edge-bottom', dockState.edgeAnchor === 'bottom');
  if (dockEdgeAnchor) dockEdgeAnchor.value = dockState.edgeAnchor;
}

function installedStatesInOrder() {
  const installed = states.filter((state) => state.installed);
  const rank = new Map(dockState.toolOrder.map((toolId, index) => [toolId, index]));
  return installed.sort((left, right) => {
    const leftRank = rank.get(left.toolId) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = rank.get(right.toolId) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank;
  });
}

function sanitizeText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 180);
}

function notificationSeverityFromSuiteStatus(status) {
  if (status === 'error' || status === 'installing') return 'error';
  if (status === 'downloading' || status === 'checking' || status === 'ready' || status === 'available') return 'warning';
  return 'info';
}

function notificationSeverityFromLicenseStatus(status) {
  if (status === 'expired' || status === 'revoked' || status === 'unavailable') return 'error';
  if (status === 'grace') return 'warning';
  return 'info';
}

function formatBytes(bytes) {
  if (!bytes || bytes < 1024) return `${bytes ?? 0} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  for (const unit of units) {
    if (value < 1024) return `${value.toFixed(1)} ${unit}`;
    value /= 1024;
  }
  return `${value.toFixed(1)} PB`;
}

async function setNotificationCenterOpen(open) {
  if (!notificationCenter || !notificationsButton) return;
  if (open && dockState.collapsed) await setCollapsed(false);
  controls.hidden = true;
  notificationCenter.hidden = !open;
  notificationsButton.setAttribute('aria-expanded', String(open));
  settingsButton.setAttribute('aria-expanded', 'false');
  dockState = await api.saveSuiteDockState({ notificationCenterOpen: open, settingsOpen: false });
  if (open) {
    clearAutoCollapseTimer();
  } else {
    notificationsButton.blur();
    scheduleAutoCollapse();
  }
}

function buildNotificationActionMarkup(action, notificationId) {
  const toolId = action.toolId ? ` data-tool-id="${sanitizeText(action.toolId)}"` : '';
  const billing = action.billing ? ` data-billing="${sanitizeText(action.billing)}"` : '';
  return `<button type="button" data-action="${sanitizeText(action.action)}" data-notification-id="${notificationId}"${toolId}${billing}>${sanitizeText(action.actionLabel)}</button>`;
}

function renderNotifications() {
  if (notificationCount) {
    notificationCount.textContent = String(notifications.length);
    notificationsButton?.setAttribute('title', notifications.length ? `Notifiche (${notifications.length})` : 'Notifiche FileX');
  }

  if (!notificationList) return;
  if (!notifications.length) {
    notificationList.innerHTML = '<p class="dock-notification-empty">Nessuna notifica.</p>';
    return;
  }

  notificationList.innerHTML = notifications
    .map(
      (notification) => `<article class="dock-notification-item dock-notification-item--${notification.level}" data-notification-id="${notification.id}">
      <div class="dock-notification-title">
        <strong>${sanitizeText(notification.title)}</strong>
        <button type="button" data-action="dismiss" data-notification-id="${notification.id}" aria-label="Chiudi notifica">×</button>
      </div>
      <div class="dock-notification-subtitle">${sanitizeText(notification.subtitle)}</div>
      ${notification.actions?.length
        ? `<div>${notification.actions.map((action) => buildNotificationActionMarkup(action, notification.id)).join('')}</div>`
        : ''}
    </article>`,
    )
    .join('');
}

function addOrUpdateNotifications(nextNotifications) {
  const wanted = new Map(nextNotifications.map((notification) => [notification.key, notification]));
  const merged = [];
  const now = Date.now();

  for (const existing of notifications) {
    const next = wanted.get(existing.key);
    if (!next) continue;
    merged.push({
      ...existing,
      ...next,
      timestamp: now,
    });
    wanted.delete(existing.key);
  }

  for (const [key, next] of wanted.entries()) {
    merged.push({
      ...next,
      id: `notification-${++notificationSeed}`,
      key,
      timestamp: now,
    });
  }

  notifications = merged
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, NOTIFICATION_LIMIT);
  renderNotifications();
}

function clearNotifications() {
  notifications = [];
  renderNotifications();
}

function buildSuiteNotifications() {
  if (!suiteUpdateState || suiteUpdateState.status === 'disabled') return [];

  if (suiteUpdateState.status === 'up-to-date' || suiteUpdateState.status === 'idle') {
    return [];
  }

  if (suiteUpdateState.status === 'available') {
    return [{
      key: `suite-update-available:${sanitizeText(suiteUpdateState.availableVersion)}`,
      level: notificationSeverityFromSuiteStatus('available'),
      title: `Aggiornamento suite disponibile`,
      subtitle: `Versione ${sanitizeText(suiteUpdateState.currentVersion)} -> ${sanitizeText(suiteUpdateState.availableVersion)}`,
      actions: [
        { action: 'check-suite-update', actionLabel: 'Controlla stato' },
      ],
    }];
  }

  if (suiteUpdateState.status === 'downloading') {
    const percent = typeof suiteUpdateState.percent === 'number'
      ? `${suiteUpdateState.percent.toFixed(1)}%`
      : 'in corso';
    const size = suiteUpdateState.totalBytes
      ? `${formatBytes(suiteUpdateState.transferredBytes)} / ${formatBytes(suiteUpdateState.totalBytes)}`
      : `${formatBytes(suiteUpdateState.transferredBytes)} / ?`;
    return [{
      key: `suite-update-downloading:${suiteUpdateState.currentVersion}:${suiteUpdateState.availableVersion ?? 'n/a'}`,
      level: notificationSeverityFromSuiteStatus('downloading'),
      title: 'Aggiornamento suite in download',
      subtitle: `${percent} (${size})`,
      actions: [{ action: 'dismiss', actionLabel: 'Nascondi' }],
    }];
  }

  if (suiteUpdateState.status === 'ready') {
    return [{
      key: `suite-update-ready:${suiteUpdateState.currentVersion}:${suiteUpdateState.availableVersion ?? 'n/a'}`,
      level: 'warning',
      title: 'Aggiornamento suite pronto',
      subtitle: `Versione ${sanitizeText(suiteUpdateState.availableVersion)} pronta all'installazione`,
      actions: [
        { action: 'install-suite-update', actionLabel: 'Installa ora' },
        { action: 'dismiss', actionLabel: 'Posponi' },
      ],
    }];
  }

  if (suiteUpdateState.status === 'checking') {
    return [{
      key: 'suite-update-checking',
      level: 'warning',
      title: 'Verifica aggiornamenti suite',
      subtitle: 'Controllo in corso',
      actions: [{ action: 'dismiss', actionLabel: 'Nascondi' }],
    }];
  }

  if (suiteUpdateState.status === 'error') {
    return [{
      key: `suite-update-error:${sanitizeText(suiteUpdateState.error)}`,
      level: notificationSeverityFromSuiteStatus('error'),
      title: 'Errore aggiornamento suite',
      subtitle: sanitizeText(suiteUpdateState.error || 'Errore durante il controllo'),
      actions: [
        { action: 'check-suite-update', actionLabel: 'Riprova' },
        { action: 'prepare-suite-update', actionLabel: 'Ricarica pacchetti' },
      ],
    }];
  }

  if (suiteUpdateState.status === 'installing') {
    return [{
      key: `suite-update-installing:${suiteUpdateState.currentVersion}`,
      level: notificationSeverityFromSuiteStatus('installing'),
      title: 'Installazione suite in corso',
      subtitle: "Al termine verrà eseguito il riavvio dell'app",
      actions: [{ action: 'dismiss', actionLabel: 'Nascondi' }],
    }];
  }

  return [];
}

function buildLicenseNotifications() {
  if (!licenseState || licenseState.canUseTools) return [];

  return [{
    key: `license-${sanitizeText(licenseState.status)}`,
    level: notificationSeverityFromLicenseStatus(licenseState.status),
    title: `Licenza: ${sanitizeText(licenseState.status)}`,
    subtitle: sanitizeText(licenseState.message || 'La licenza non e\'attiva.'),
    actions: [
      { action: 'open-license-checkout', billing: 'annual', actionLabel: 'Rinnova ora' },
      { action: 'refresh-license', actionLabel: 'Riprova' },
    ],
  }];
}

function buildToolNotifications() {
  return states
    .filter((state) => state.installed && state.status === 'update-available')
    .map((toolState) => {
      const label = toolNames[toolState.toolId] || toolState.toolName;
      return {
        key: `tool-update-${toolState.toolId}:${sanitizeText(toolState.latestVersion)}`,
        level: 'warning',
        title: `Aggiornamento pronto: ${label}`,
        subtitle: `Versione ${sanitizeText(toolState.installedVersion || '—')} -> ${sanitizeText(toolState.latestVersion || 'Nuova versione')}`,
        actions: [{ action: 'open-tool', toolId: toolState.toolId, actionLabel: 'Apri tool' }],
      };
    });
}

async function syncNotifications() {
  if (notificationsInFlight) return;
  notificationsInFlight = true;
  try {
    const [nextSuiteState, nextLicenseState] = await Promise.all([
      api.getSuiteUpdateState().catch(() => null),
      api.getLicenseState().catch(() => null),
    ]);
    suiteUpdateState = nextSuiteState;
    licenseState = nextLicenseState;

    const next = [
      ...buildSuiteNotifications(),
      ...buildToolNotifications(),
      ...buildLicenseNotifications(),
    ];
    addOrUpdateNotifications(next);
  } finally {
    notificationsInFlight = false;
  }
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
    await syncNotifications();
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
  applyEdgeAnchorUi();
  document.body.classList.toggle('collapsed', dockState.collapsed);
  suiteToggle.title = dockState.collapsed ? 'Espandi FileX Dock' : 'Riduci FileX Dock';
  suiteToggle.setAttribute('aria-expanded', String(!dockState.collapsed));
  if (!dockState.collapsed && !notificationCenter.hidden) clearAutoCollapseTimer();
}

async function setCollapsed(collapsed) {
  clearAutoCollapseTimer();
  if (collapsed) {
    controls.hidden = true;
    notificationCenter.hidden = true;
    notificationsButton.setAttribute('aria-expanded', 'false');
    settingsButton.setAttribute('aria-expanded', 'false');
    isHoverReveal = false;
  }
  dockState = await api.saveSuiteDockState({
    collapsed,
    settingsOpen: collapsed ? false : dockState.settingsOpen,
    notificationCenterOpen: collapsed ? false : dockState.notificationCenterOpen,
  });
  updateCollapsedUi();
  if (!collapsed) scheduleAutoCollapse();
}

async function setSettingsOpen(settingsOpen) {
  if (settingsOpen && dockState.collapsed) await setCollapsed(false);
  controls.hidden = !settingsOpen;
  notificationCenter.hidden = true;
  notificationsButton.setAttribute('aria-expanded', 'false');
  dockState = await api.saveSuiteDockState({ settingsOpen, notificationCenterOpen: false });
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

async function openToolFromNotification(toolId) {
  const state = states.find((item) => item.toolId === toolId);
  if (!state?.installed) {
    alert('Tool non installato.');
    return;
  }

  const result = await api.openInstalledTool(toolId);
  if (!result.ok) throw new Error(result.message);
  if (dockState.autoHide) setTimeout(() => { void setCollapsed(true); }, 220);
}

function resetMagnification() {
  pointerPosition = null;
  scheduleMagnification();
}

function scheduleMagnification() {
  if (magnificationFrame !== null) return;
  magnificationFrame = requestAnimationFrame(() => {
    magnificationFrame = null;
    const items = root.querySelectorAll('.dock-item');
    for (const item of items) {
      if (pointerPosition === null || dragState?.active) {
        item.style.transform = '';
        continue;
      }
      const rect = item.getBoundingClientRect();
      const itemCenter = isSideDock()
        ? rect.top + rect.height / 2
        : rect.left + rect.width / 2;
      const distance = Math.abs(pointerPosition - itemCenter);
      const normalized = Math.min(1, distance / 145);
      const influence = (Math.cos(normalized * Math.PI) + 1) / 2;
      const scale = 1 + 0.16 * influence;
      const lift = -10 * influence;
      const translateX = isSideDock()
        ? (dockState.edgeAnchor === 'left' ? -lift : lift)
        : 0;
      const translateY = isSideDock() ? 0 : lift;
      item.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`;
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
    const deltaY = previous.top - current.top;
    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) continue;
    item.animate(
      [{ transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
      { duration: 210, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
  }
}

function moveDraggedButton(clientPosition) {
  if (!dragState?.active) return;
  const button = dragState.button;
  const siblings = [...root.querySelectorAll('.dock-item')].filter((item) => item !== button);
  const reference = siblings.find((item) => {
    const rect = item.getBoundingClientRect();
    return clientPosition < (isSideDock() ? rect.top + rect.height / 2 : rect.left + rect.width / 2);
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

function onNotificationAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const toolId = button.dataset.toolId;
  const billing = button.dataset.billing;
  const id = button.dataset.notificationId;

  if (action === 'dismiss' && id) {
    notifications = notifications.filter((notification) => notification.id !== id);
    renderNotifications();
    return;
  }

  button.disabled = true;
  void (async () => {
    try {
      if (action === 'open-tool' && toolId) {
        await openToolFromNotification(toolId);
      }
      if (action === 'check-suite-update') {
        suiteUpdateState = await api.checkSuiteUpdate();
        await syncNotifications();
      }
      if (action === 'install-suite-update') {
        await api.installSuiteUpdate();
        await syncNotifications();
      }
      if (action === 'prepare-suite-update') {
        await api.prepareSuiteUpdate();
        await syncNotifications();
      }
      if (action === 'open-license-checkout') {
        await api.openLicenseCheckout(billing === 'monthly' ? 'monthly' : 'annual');
        await syncNotifications();
      }
      if (action === 'refresh-license') {
        licenseState = await api.getLicenseState(true);
        await syncNotifications();
      }
    } catch (error) {
      alert(error.message || String(error));
    } finally {
      button.disabled = false;
    }
  })();
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
      moveDraggedButton(isSideDock() ? event.clientY : event.clientX);
      return;
    }
  }
  pointerPosition = isSideDock() ? event.clientY : event.clientX;
  scheduleMagnification();
});

root.addEventListener('pointerleave', () => {
  if (!dragState?.active) resetMagnification();
});
root.addEventListener('pointerup', finishDrag);
root.addEventListener('pointercancel', finishDrag);

suiteToggle.addEventListener('click', () => {
  if (isHoverReveal && !dockState.collapsed) {
    isHoverReveal = false;
    clearAutoCollapseTimer();
    return;
  }
  void setCollapsed(!dockState.collapsed);
});
settingsButton.addEventListener('click', () => { void setSettingsOpen(controls.hidden); });
dockEdgeAnchor?.addEventListener('change', async (event) => {
  isHoverReveal = false;
  dockState = await api.saveSuiteDockState({ edgeAnchor: event.target.value, x: 0, y: 0 });
  updateCollapsedUi();
});
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
document.querySelector('#dock-disable').addEventListener('click', async () => {
  const shouldDisable = window.confirm(
    "Disattivare la Dock Station? Potrai riattivarla dal menu FileX vicino all'orologio di Windows.",
  );
  if (!shouldDisable) return;
  if (typeof api.setSuiteDockEnabled !== 'function') {
    window.alert('Questa versione della Suite non permette di disattivare la Dock Station.');
    return;
  }
  try {
    await api.setSuiteDockEnabled(false);
  } catch (error) {
    window.alert(`Impossibile disattivare la Dock Station: ${error?.message || error}`);
  }
});
document.querySelector('#dock-close-settings').addEventListener('click', () => { void setSettingsOpen(false); });

dockWindow.addEventListener('mouseenter', () => {
  clearAutoCollapseTimer();
  if (isSideDock() && dockState.collapsed) {
    isHoverReveal = true;
    void setCollapsed(false);
  }
});
dockWindow.addEventListener('mouseleave', () => {
  if (isHoverReveal && isSideDock() && controls.hidden && notificationCenter.hidden) {
    clearAutoCollapseTimer();
    autoCollapseTimer = setTimeout(() => {
      isHoverReveal = false;
      void setCollapsed(true);
    }, 550);
    return;
  }
  scheduleAutoCollapse();
});

notificationList?.addEventListener('click', onNotificationAction);
notificationClose?.addEventListener('click', () => {
  void setNotificationCenterOpen(false);
});
notificationClearAll?.addEventListener('click', clearNotifications);
notificationsButton?.addEventListener('click', () => {
  void setNotificationCenterOpen(notificationCenter.hidden);
});
notificationCenter?.addEventListener('mouseenter', clearAutoCollapseTimer);
notificationCenter?.addEventListener('mouseleave', scheduleAutoCollapse);

window.addEventListener('mousedown', (event) => {
  if (!notificationCenter || notificationCenter.hidden) return;
  if (event.target.closest('#dock-notification-center') || event.target.closest('#dock-notifications') || event.target.closest('.dock-controls')) {
    return;
  }
  void setNotificationCenterOpen(false);
});

window.addEventListener('mouseup', () => { void api.saveSuiteDockState({}); });
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!notificationCenter.hidden) {
    void setNotificationCenterOpen(false);
    return;
  }
  if (!controls.hidden) void setSettingsOpen(false);
  else if (!dockState.collapsed) void setCollapsed(true);
});

async function boot() {
  dockState = await api.getSuiteDockState();
  controls.hidden = true;
  dockState = await api.saveSuiteDockState({ settingsOpen: false, notificationCenterOpen: false });
  document.querySelector('#dock-opacity').value = String(Math.round(dockState.opacity * 100));
  document.querySelector('#dock-autohide').checked = dockState.autoHide;
  applyEdgeAnchorUi();
  notificationsButton?.setAttribute('aria-expanded', 'false');
  updateCollapsedUi();
  document.body.classList.remove('booting');
  if (notificationCenter) notificationCenter.hidden = true;
  await refresh();
  await syncNotifications();
  scheduleAutoCollapse();

  api.onSuiteUpdateState((state) => {
    suiteUpdateState = state;
    void syncNotifications();
  });
}

setInterval(() => { void refresh(); }, 5000);
setInterval(() => { void syncNotifications(); }, 12000);
boot().catch((error) => {
  document.body.classList.remove('booting');
  root.innerHTML = `<span class="dock-error">${error.message || error}</span>`;
});
