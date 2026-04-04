const runtimeInfoEl = document.querySelector("#runtime-info");
const toolsGridEl = document.querySelector("#tools-grid");
const aiStatusEl = document.querySelector("#ai-status");
const refreshBtn = document.querySelector("#refresh-btn");
const installMissingBtn = document.querySelector("#install-missing-btn");

const desktopApi = window.filexDesktop;

function normalizeToolName(toolId) {
  return toolId.replace(/-/g, " ");
}

function renderStatusPill(state) {
  if (state.status === "installed") {
    return '<span class="pill ok">Installato</span>';
  }
  if (state.status === "update-available") {
    return '<span class="pill warn">Aggiornamento</span>';
  }
  return '<span class="pill off">Non installato</span>';
}

function renderToolCard(state) {
  const latest = state.latestVersion ? `latest ${state.latestVersion}` : "latest n/d";
  const installed = state.installedVersion ? `installed ${state.installedVersion}` : "installed n/d";
  const toolName = state.toolName || normalizeToolName(state.toolId);

  return `
    <article class="card" data-tool-id="${state.toolId}">
      <div class="head">
        <strong>${toolName}</strong>
        ${renderStatusPill(state)}
      </div>
      <p class="meta">${installed} · ${latest}</p>
      <div class="actions">
        <button class="btn secondary" data-action="open" data-tool-id="${state.toolId}">Apri</button>
        <button class="btn primary" data-action="install" data-tool-id="${state.toolId}">Installa/Aggiorna</button>
        <button class="btn ghost" data-action="check" data-tool-id="${state.toolId}">Controlla update</button>
      </div>
    </article>
  `;
}

async function refreshRuntime() {
  const runtime = await desktopApi.getRuntimeInfo();
  runtimeInfoEl.textContent = `Canale ${runtime.releaseChannel} · versione launcher ${runtime.appVersion} · piattaforma ${runtime.platform}`;
  return runtime;
}

async function refreshTools() {
  const tools = await desktopApi.listAvailableTools();
  toolsGridEl.innerHTML = tools.map(renderToolCard).join("");
  return tools;
}

async function refreshAiStatus() {
  const ai = await desktopApi.getImageIdPrintAiStatus();
  if (ai.installed && ai.pythonFound) {
    aiStatusEl.textContent = "AI sidecar installata e runtime Python disponibile.";
    return;
  }
  if (!ai.installed) {
    aiStatusEl.textContent = "AI sidecar non installata. Installazione opzionale disponibile post-release.";
    return;
  }
  aiStatusEl.textContent = "AI sidecar presente ma runtime Python non rilevato.";
}

async function installOrUpdateTool(toolId) {
  const job = await desktopApi.downloadToolUpdate(toolId);
  if (job.status !== "ready-to-apply") {
    alert(`Download update fallito: ${job.error || "errore sconosciuto"}`);
    return;
  }
  const applied = await desktopApi.applyToolUpdate(job.id);
  if (applied.status !== "completed") {
    alert(`Apply update fallito: ${applied.error || "errore sconosciuto"}`);
    return;
  }
  await refreshTools();
}

async function checkTool(toolId) {
  const check = await desktopApi.checkToolUpdate(toolId);
  if (!check.release) {
    alert("Nessuna release trovata per questo tool.");
    return;
  }
  if (check.available) {
    alert(`Nuova versione disponibile: ${check.release.version}`);
  } else {
    alert("Tool aggiornato all'ultima versione disponibile.");
  }
}

async function openTool(toolId) {
  const result = await desktopApi.openInstalledTool(toolId);
  if (!result.ok) {
    alert(result.message);
  }
}

async function installMissingTools() {
  const tools = await desktopApi.listAvailableTools();
  const missing = tools.filter((tool) => !tool.installed);
  for (const tool of missing) {
    await installOrUpdateTool(tool.toolId);
  }
}

toolsGridEl.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;
  const toolId = target.dataset.toolId;
  const action = target.dataset.action;
  if (!toolId || !action) return;

  target.disabled = true;
  try {
    if (action === "install") {
      await installOrUpdateTool(toolId);
    } else if (action === "check") {
      await checkTool(toolId);
    } else if (action === "open") {
      await openTool(toolId);
    }
  } finally {
    target.disabled = false;
  }
});

refreshBtn.addEventListener("click", async () => {
  refreshBtn.disabled = true;
  try {
    await Promise.all([refreshRuntime(), refreshTools(), refreshAiStatus()]);
  } finally {
    refreshBtn.disabled = false;
  }
});

installMissingBtn.addEventListener("click", async () => {
  installMissingBtn.disabled = true;
  try {
    await installMissingTools();
  } finally {
    installMissingBtn.disabled = false;
  }
});

Promise.all([refreshRuntime(), refreshTools(), refreshAiStatus()]).catch((error) => {
  runtimeInfoEl.textContent = `Errore launcher: ${error instanceof Error ? error.message : String(error)}`;
});
