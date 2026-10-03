// Scheda «Assistenza»: legge i messaggi degli utenti. Il testo degli utenti non e' attendibile: solo textContent, mai HTML.
(() => {
  const KIND_LABELS = { problem: "Problema", suggestion: "Suggerimento", question: "Domanda" };
  const STATUS_LABELS = { new: "nuovo", read: "letto", resolved: "risolto" };
  const list = $("#supportList");
  const detail = $("#supportDetail");
  const badge = $("#supportBadge");
  const filter = $("#supportFilter");
  let selectedId = null;
  let selectedMarkdown = "";

  function setBadge(count) {
    badge.textContent = String(count);
    badge.hidden = count === 0;
  }

  function formatDate(millis) {
    if (!millis) return "-";
    const date = new Date(millis);
    return date.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
  }

  function row(item) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "support-row" + (item.id === selectedId ? " selected" : "");
    const top = document.createElement("div");
    top.className = "support-row__top";
    const status = document.createElement("span");
    status.className = "badge " + (item.status === "new" ? "wait" : item.status === "resolved" ? "on" : "external");
    status.textContent = STATUS_LABELS[item.status] || item.status;
    const title = document.createElement("strong");
    title.textContent = `${item.id} · ${KIND_LABELS[item.kind] || item.kind} · ${item.toolId}`;
    const when = document.createElement("span");
    when.className = "support-row__when";
    when.textContent = formatDate(item.createdAt);
    top.append(status, title, when);
    const who = document.createElement("div");
    who.className = "support-row__who";
    who.textContent = `${item.contactName ? item.contactName + " · " : ""}${item.contactEmail}${item.verifiedActivation ? " · licenza verificata" : ""}`;
    const preview = document.createElement("div");
    preview.className = "support-row__preview";
    preview.textContent = item.preview;
    button.append(top, who, preview);
    button.addEventListener("click", () => openMessage(item.id));
    return button;
  }

  async function refreshSupport({ quiet = false } = {}) {
    try {
      const data = await api("/api/support/messages?status=" + encodeURIComponent(filter.value));
      list.replaceChildren(...(data.items.length ? data.items.map(row) : [Object.assign(document.createElement("p"), { className: "hint", textContent: "Nessun messaggio in questo elenco." })]));
      if (filter.value === "all" || filter.value === "new") setBadge(data.newCount);
    } catch (error) {
      if (!quiet) toast(error.message + " Verifica di essere autenticati con `firebase login`.", true);
    }
  }

  async function openMessage(id) {
    selectedId = id;
    try {
      const data = await api(`/api/support/messages/${id}/export`);
      selectedMarkdown = data.markdown;
      $("#supportExport").textContent = selectedMarkdown;
      detail.hidden = false;
      $("#supportSelectedId").textContent = id;
      await refreshSupport({ quiet: true });
    } catch (error) { toast(error.message, true); }
  }

  async function setStatus(status) {
    if (!selectedId) return;
    try {
      await api(`/api/support/messages/${selectedId}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
      toast(`${selectedId}: ${STATUS_LABELS[status]}.`);
      await openMessage(selectedId);
    } catch (error) { toast(error.message, true); }
  }

  $("#supportRefresh").addEventListener("click", () => refreshSupport());
  filter.addEventListener("change", () => refreshSupport());
  $("#supportCopyClaude").addEventListener("click", async () => {
    try { await copyLogContent("supportExport"); toast("Segnalazione copiata: incollala in Claude."); }
    catch (error) { toast(error.message, true); }
  });
  $("#supportMarkRead").addEventListener("click", () => setStatus("read"));
  $("#supportMarkResolved").addEventListener("click", () => setStatus("resolved"));
  $("#supportMarkNew").addEventListener("click", () => setStatus("new"));

  refreshSupport({ quiet: true });
  setInterval(() => refreshSupport({ quiet: true }), 5 * 60 * 1000);
})();
