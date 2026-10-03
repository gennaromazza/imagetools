// Modulo «Assistenza» della dashboard: invio di un messaggio al supporto con ripiego via email.

export const SUPPORT_EMAIL = 'image.studio.fotografico@gmail.com';
export const SUPPORT_MESSAGE_MIN = 10;
export const SUPPORT_MESSAGE_MAX = 4000;

const KIND_LABELS = { problem: 'Problema', suggestion: 'Suggerimento', question: 'Domanda' };
const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

export function validateSupportForm(form) {
  if (!KIND_LABELS[form.kind]) return 'Scegli il tipo di messaggio.';
  if (!EMAIL_PATTERN.test(String(form.email || '').trim())) return 'Inserisci un indirizzo email valido per ricevere la risposta.';
  const length = String(form.message || '').trim().length;
  if (length < SUPPORT_MESSAGE_MIN) return `Descrivi meglio la richiesta: servono almeno ${SUPPORT_MESSAGE_MIN} caratteri.`;
  if (length > SUPPORT_MESSAGE_MAX) return `Il messaggio è troppo lungo: massimo ${SUPPORT_MESSAGE_MAX} caratteri.`;
  return '';
}

export function supportSubject(form, toolName) {
  return `FileX · ${KIND_LABELS[form.kind] || 'Messaggio'} · ${toolName || 'Suite'}`;
}

// Testo riutilizzabile per «Copia» e per l'email: stessa struttura che il supporto legge nel messaggio inviato.
export function buildSupportText(form, environment, toolName) {
  const lines = [
    `Tipo: ${KIND_LABELS[form.kind] || '-'}`,
    `Tool: ${toolName || 'Tutta la Suite'}`,
  ];
  if (String(form.name || '').trim()) lines.push(`Nome: ${String(form.name).trim()}`);
  lines.push(`Email per la risposta: ${String(form.email || '').trim()}`, '', String(form.message || '').trim());
  if (form.includeDiagnostics && environment) {
    lines.push('', '--- Informazioni tecniche ---',
      `Versione Suite: ${environment.suiteVersion}`,
      `Sistema: ${environment.system}`,
      `Licenza: ${environment.licenseStatus}`);
  }
  return lines.join('\n');
}

export function buildMailto(form, environment, toolName) {
  const subject = encodeURIComponent(supportSubject(form, toolName));
  const body = encodeURIComponent(buildSupportText(form, environment, toolName));
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
}

const STORAGE_KEY = 'filex-support-contact-v1';

function readContact() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}

function saveContact(email, name) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ email, name })); } catch { /* il ricordo dei dati è facoltativo */ }
}

export function initSupport({ api, getTools, showToast }) {
  const dialog = document.querySelector('#support-dialog');
  if (!dialog) return;
  const field = id => dialog.querySelector(id);
  const kind = field('#support-kind');
  const tool = field('#support-tool');
  const email = field('#support-email');
  const name = field('#support-name');
  const message = field('#support-message');
  const counter = field('#support-counter');
  const diagnostics = field('#support-diagnostics');
  const diagnosticsPreview = field('#support-diagnostics-preview');
  const send = field('#support-send');
  const status = field('#support-status');
  const formView = field('#support-form-view');
  const doneView = field('#support-done-view');
  const ticket = field('#support-ticket');
  let environment = null;

  function toolName() {
    return tool.value === 'generale' ? '' : tool.selectedOptions[0]?.textContent || tool.value;
  }

  function readForm() {
    return { kind: kind.value, toolId: tool.value, email: email.value.trim(), name: name.value.trim(), message: message.value, includeDiagnostics: diagnostics.checked };
  }

  function showStatus(text, isError) {
    status.textContent = text;
    status.hidden = !text;
    status.classList.toggle('support-error', Boolean(isError));
  }

  function renderTools() {
    const current = tool.value || 'generale';
    tool.replaceChildren(new Option('Tutta la Suite / non so', 'generale'));
    for (const item of getTools()) tool.append(new Option(item.name, item.id));
    tool.value = [...tool.options].some(option => option.value === current) ? current : 'generale';
  }

  function renderDiagnostics() {
    diagnosticsPreview.textContent = environment
      ? `Versione Suite: ${environment.suiteVersion}\nSistema: ${environment.system}\nLicenza: ${environment.licenseStatus}\nLingua: ${navigator.language}\n\nNon vengono inviati foto, nomi di file, cartelle o la chiave di licenza.`
      : 'Informazioni non disponibili.';
  }

  function updateCounter() {
    const length = message.value.trim().length;
    counter.textContent = `${length} / ${SUPPORT_MESSAGE_MAX}`;
    counter.classList.toggle('support-error', length > SUPPORT_MESSAGE_MAX);
  }

  async function open() {
    const saved = readContact();
    if (!email.value && saved.email) email.value = saved.email;
    if (!name.value && saved.name) name.value = saved.name;
    formView.hidden = false;
    doneView.hidden = true;
    showStatus('', false);
    renderTools();
    updateCounter();
    dialog.showModal();
    environment = await api.getSupportEnvironment?.().catch(() => null) ?? null;
    renderDiagnostics();
  }

  field('#support-copy').addEventListener('click', async () => {
    const form = readForm();
    const text = buildSupportText(form, environment, toolName());
    try { await navigator.clipboard.writeText(text); showToast('Testo copiato.'); }
    catch { showStatus('Non riesco a copiare negli appunti: seleziona il testo e copialo a mano.', true); }
  });

  field('#support-mailto').addEventListener('click', () => {
    const form = readForm();
    const problem = validateSupportForm(form);
    if (problem) { showStatus(problem, true); return; }
    window.open(buildMailto(form, environment, toolName()));
  });

  send.addEventListener('click', async () => {
    const form = readForm();
    const problem = validateSupportForm(form);
    if (problem) { showStatus(problem, true); return; }
    if (typeof api.sendSupportMessage !== 'function') { showStatus('Invio non disponibile in questa versione: usa «Scrivi con la tua email».', true); return; }
    send.disabled = true;
    send.textContent = 'Invio in corso…';
    showStatus('', false);
    try {
      const result = await api.sendSupportMessage(form);
      saveContact(form.email, form.name);
      ticket.textContent = result.ticketId;
      formView.hidden = true;
      doneView.hidden = false;
      message.value = '';
      updateCounter();
    } catch (error) {
      showStatus(`${error?.message || 'Invio non riuscito.'} Il testo non è andato perso: puoi copiarlo o scrivere con la tua email.`, true);
    } finally {
      send.disabled = false;
      send.textContent = 'Invia messaggio';
    }
  });

  field('#support-another').addEventListener('click', () => { formView.hidden = false; doneView.hidden = true; message.focus(); });
  message.addEventListener('input', updateCounter);
  document.querySelector('#support-btn')?.addEventListener('click', () => { void open(); });
}
