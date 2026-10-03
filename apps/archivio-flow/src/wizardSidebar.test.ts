import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SidebarNav } from "./components/SidebarNav.js";
import { initialSidebarCollapsed, isGuidedFlow, visibleNavItems } from "./wizardModel.js";

(globalThis as { React?: typeof React }).React = React;

const noop = () => undefined;
const base = { archiveSummary: "202 lavori salvati", backupBusy: false, onSelect: noop };

test("barra laterale: nel percorso a passi restano solo le voci utili", () => {
  assert.deepEqual(visibleNavItems(false), ["import", "archive", "drive", "backup", "settings"]);
  assert.deepEqual(visibleNavItems(true), ["import", "archive", "exit"]);
  assert.equal(isGuidedFlow("nuovo"), true);
  for (const screen of ["sd", "archivio", "drive", "impostazioni"]) assert.equal(isGuidedFlow(screen), false, screen);
});

test("barra laterale: parte stretta, e chi l'aveva già allargata scegliendo la nuova chiave la mantiene", () => {
  assert.equal(initialSidebarCollapsed(null), true);
  assert.equal(initialSidebarCollapsed("true"), true);
  assert.equal(initialSidebarCollapsed("false"), false);
});

test("barra laterale: voci con nomi d'azione, nessun sottotitolo tranne il numero di lavori, tutte con suggerimento", () => {
  const html = renderToStaticMarkup(createElement(SidebarNav, { ...base, screen: "sd", inGuidedFlow: false }));
  for (const label of ["Importa dalla scheda", "Archivio lavori", "Google Drive", "Backup Guard", "Impostazioni"]) {
    assert.match(html, new RegExp(`title="${label}"`));
    assert.match(html, new RegExp(`aria-label="${label}"`));
  }
  assert.doesNotMatch(html, /Nuovo lavoro|Importa da SD card|Registro remoto|Seconda copia|Radice archivio|Esci dal percorso/);
  assert.equal((html.match(/<small>/g) ?? []).length, 1);
  assert.match(html, /<small>202 lavori salvati<\/small>/);
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(html, /workflow-step workflow-step--active"[^>]*title="Importa dalla scheda"/);
});

test("barra laterale: nel percorso compaiono Archivio ed Esci, e la voce attiva resta Importa", () => {
  const html = renderToStaticMarkup(createElement(SidebarNav, { ...base, screen: "nuovo", inGuidedFlow: true }));
  assert.match(html, /Importa dalla scheda/);
  assert.match(html, /Archivio lavori/);
  assert.match(html, /Esci dal percorso/);
  assert.doesNotMatch(html, /Google Drive|Backup Guard|Impostazioni/);
  assert.match(html, /workflow-step workflow-step--active"[^>]*title="Importa dalla scheda"/);
});

test("barra laterale: la sezione aperta è quella evidenziata e Backup Guard si spegne mentre si apre", () => {
  for (const [screen, label] of [["archivio", "Archivio lavori"], ["drive", "Google Drive"], ["impostazioni", "Impostazioni"]] as const) {
    const html = renderToStaticMarkup(createElement(SidebarNav, { ...base, screen, inGuidedFlow: false }));
    assert.match(html, new RegExp(`workflow-step--active"[^>]*title="${label}"`), label);
  }
  const busy = renderToStaticMarkup(createElement(SidebarNav, { ...base, screen: "sd", inGuidedFlow: false, backupBusy: true }));
  assert.match(busy, /Apro Backup Guard…/);
  assert.match(busy, /title="Apro Backup Guard…"[^>]*disabled/);
  assert.match(renderToStaticMarkup(createElement(SidebarNav, { ...base, archiveSummary: "Controllo nomi in corso…", screen: "sd", inGuidedFlow: false })), /Controllo nomi in corso…/);
});
