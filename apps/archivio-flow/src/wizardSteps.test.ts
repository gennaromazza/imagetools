import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfirmStep } from "./components/steps/ConfirmStep.js";
import { DoneStep, describeFormatCheck } from "./components/steps/DoneStep.js";
import { FolderStep } from "./components/steps/FolderStep.js";
import { NewJobStep } from "./components/steps/NewJobStep.js";
import { PickJobStep } from "./components/steps/PickJobStep.js";
import { WhoStep } from "./components/steps/WhoStep.js";
import type { ImportResult, Job, SafeToFormatResult } from "./types.js";

// tsx compila i componenti con il runtime JSX classico: React deve essere raggiungibile come globale.
(globalThis as { React?: typeof React }).React = React;

const noop = () => undefined;

function job(id: string, name: string, date: string): Job {
  return { id, nomeLavoro: name, dataLavoro: date, autore: "Gennaro", percorsoCartella: `D:/Archivio/${name}`, nomeCartella: name, dataCreazione: date, numeroFile: 10, folderExists: true };
}

const jobs = [job("a", "Maria Rossi Shooting", "2026-03-21"), job("b", "Matrimonio Ferdinando", "2026-06-14")];

test("prima domanda: il lavoro probabile compare in cima, prima delle due scelte", () => {
  const withSuggestion = renderToStaticMarkup(createElement(WhoStep, {
    photosText: "42 foto scelte", onChangePhotos: noop, suggestions: [{ job: jobs[0]!, reason: "scattate durante un'importazione precedente" }],
    onAcceptSuggestion: noop, onNew: noop, onExisting: noop,
  }));
  assert.ok(withSuggestion.indexOf("Sembrano del lavoro") < withSuggestion.indexOf("Un lavoro nuovo"), "il consiglio viene prima delle scelte");
  assert.match(withSuggestion, /Maria Rossi Shooting/);
  assert.match(withSuggestion, /Sì, aggiungi a questo lavoro/);
  assert.match(withSuggestion, /No, è un altro/);
  assert.match(withSuggestion, /Oppure scegli tu/);
  assert.match(withSuggestion, /42 foto scelte/);
  const without = renderToStaticMarkup(createElement(WhoStep, { photosText: "Tutta la scheda", onChangePhotos: noop, suggestions: [], onAcceptSuggestion: noop, onNew: noop, onExisting: noop }));
  assert.doesNotMatch(without, /Ti consiglio/);
  assert.match(without, /Queste foto sono per/);
  assert.match(without, /Un lavoro già esistente/);
});

test("lavoro esistente: Avanti resta spento finché non si sceglie un lavoro", () => {
  const props = { photosText: "3 foto scelte", onChangePhotos: noop, jobs, query: "", onQueryChange: noop, onPick: noop, issues: [], onBack: noop, onNext: noop };
  const nothing = renderToStaticMarkup(createElement(PickJobStep, { ...props, selectedId: "" }));
  assert.match(nothing, /<button[^>]*class="primary-button"[^>]*disabled/);
  assert.match(nothing, /Scegli un lavoro dall&#x27;elenco/);
  const chosen = renderToStaticMarkup(createElement(PickJobStep, { ...props, selectedId: "a" }));
  assert.doesNotMatch(chosen, /<button[^>]*class="primary-button"[^>]*disabled/);
});

test("lavoro nuovo: solo nome e giorno, il tipo di lavoro compare solo se esiste", () => {
  const props = { photosText: "3 foto scelte", onChangePhotos: noop, name: "", onName: noop, day: "2026-10-02", onDay: noop, categories: [] as Array<{ key: string; label: string }>, categoryKey: "", onCategory: noop, issues: [], onBack: noop, onNext: noop };
  const empty = renderToStaticMarkup(createElement(NewJobStep, props));
  assert.match(empty, /Come si chiama il lavoro\?/);
  assert.match(empty, /<button[^>]*class="primary-button"[^>]*disabled/);
  assert.doesNotMatch(empty, /Tipo di lavoro/);
  const filled = renderToStaticMarkup(createElement(NewJobStep, { ...props, name: "Rossi", categories: [{ key: "matrimoni", label: "Matrimoni" }], dayHint: "È il giorno delle foto." }));
  assert.doesNotMatch(filled, /<button[^>]*class="primary-button"[^>]*disabled/);
  assert.match(filled, /Matrimoni/);
  assert.match(filled, /È il giorno delle foto/);
  const withIssue = renderToStaticMarkup(createElement(NewJobStep, { ...props, issues: [{ message: "Scrivi il nome del cliente o del lavoro." }] }));
  assert.match(withIssue, /role="alert"/);
});

test("cartella: facoltativa, e il pulsante dice cosa succede se si salta", () => {
  const base = { photosText: "3 foto scelte", onChangePhotos: noop, folders: ["Promessa", "Cerimonia"], presets: ["Festa", "Promessa"], value: "", onChange: noop, similar: [] as string[], onBack: noop, onNext: noop };
  const created = renderToStaticMarkup(createElement(FolderStep, base));
  assert.match(created, /Vuoi una cartella dedicata\?/);
  assert.match(created, /Salta, nessuna cartella/);
  assert.doesNotMatch(created, /📁/, "per un lavoro nuovo non ci sono cartelle già presenti");
  const existing = renderToStaticMarkup(createElement(FolderStep, { ...base, existingJobName: "Rossi" }));
  assert.match(existing, /In quale cartella del lavoro\?/);
  assert.match(existing, /Rossi/);
  assert.match(existing, /Avanti, nella cartella principale/);
  assert.match(existing, /📁 Promessa/);
  assert.equal((existing.match(/>Promessa</g) ?? []).length, 0, "un preset già presente non si ripete tra i predefiniti");
  assert.match(renderToStaticMarkup(createElement(FolderStep, { ...base, value: "Brindisi" })), />Avanti →</);
  assert.match(renderToStaticMarkup(createElement(FolderStep, { ...base, existingJobName: "Rossi", value: "Promesa", similar: ["Promessa"] })), /nome simile/);
});

test("riepilogo: righe, opzione sui duplicati solo se serve, pulsanti spenti durante l'importazione", () => {
  const base = {
    photosText: "42 foto scelte", onChangePhotos: noop, rows: [{ label: "Lavoro", value: "Rossi · 02/10/2026" }, { label: "Foto", value: "42 foto scelte" }],
    rename: true, onRename: noop, lightCopies: false, onLightCopies: noop, finish: "FINE", moreSettings: "ALTRO", moreSettingsOpen: false,
    importing: false, onBack: noop, onStart: noop,
  };
  const html = renderToStaticMarkup(createElement(ConfirmStep, base));
  assert.match(html, /Tutto pronto\?/);
  assert.match(html, /Rossi · 02\/10\/2026/);
  assert.match(html, /Avvia importazione/);
  assert.doesNotMatch(html, /già in archivio/);
  assert.doesNotMatch(html, /<details[^>]*open/);
  assert.match(renderToStaticMarkup(createElement(ConfirmStep, { ...base, moreSettingsOpen: true })), /<details[^>]*open/);
  const duplicates = renderToStaticMarkup(createElement(ConfirmStep, { ...base, skipArchived: { count: 80, where: "in Evento 1", value: true, onChange: noop } }));
  assert.match(duplicates, /Salta le 80 foto già in archivio/);
  assert.match(duplicates, /in Evento 1/);
  const busy = renderToStaticMarkup(createElement(ConfirmStep, { ...base, importing: true }));
  assert.match(busy, /Importazione in corso/);
  assert.equal((busy.match(/disabled/g) ?? []).length, 2, "Indietro e Avvia sono spenti");
});

test("schermata finale: dice cosa è successo e la formattazione non è mai obbligatoria", () => {
  const result = { job: jobs[0]!, copiedFiles: 120, jpgGenerati: 0, errors: [] as string[], cartellaFotoFinale: "D:/Archivio/Rossi/FOTO_SD", cartellaVideoFinale: "", videoFiles: 0, incomplete: false } as unknown as ImportResult;
  const base = { result, onOpenFolders: noop, onAnother: noop, onArchive: noop, sdAvailable: true, format: { checking: false, result: null, error: null }, onCheckFormat: noop };
  const html = renderToStaticMarkup(createElement(DoneStep, base));
  assert.match(html, /Fatto!/);
  assert.match(html, /Ho copiato 120 file/);
  assert.match(html, /Apri la cartella/);
  assert.match(html, /Importa un’altra scheda/);
  assert.match(html, /Non è obbligatorio/);
  assert.doesNotMatch(html, /Posso formattare/, "nessun avviso o obbligo di formattazione");
  assert.doesNotMatch(renderToStaticMarkup(createElement(DoneStep, { ...base, sdAvailable: false })), /formattare/);
  const incomplete = renderToStaticMarkup(createElement(DoneStep, { ...base, result: { ...result, incomplete: true, errors: ["DSC1.ARW: errore"] } as ImportResult }));
  assert.match(incomplete, /Importazione incompleta/);
  assert.match(incomplete, /DSC1\.ARW: errore/);
  assert.match(renderToStaticMarkup(createElement(DoneStep, { ...base, result: { ...result, copiedFiles: 1 } as ImportResult })), /Ho copiato 1 file/);
});

test("controllo formattazione: parole semplici per tutto salvato e per salvato in parte", () => {
  assert.match(describeFormatCheck({ status: "SAFE", totalFiles: 1200, verifiedFiles: 1200, unknownFiles: 0, sessions: [] } as SafeToFormatResult), /Tutte le 1200 foto/);
  const partial = describeFormatCheck({ status: "PARTIAL", totalFiles: 10, verifiedFiles: 7, unknownFiles: 3, reason: "3 file non risultano archiviati", sessions: [] } as SafeToFormatResult);
  assert.match(partial, /7 file su 10/);
  assert.match(partial, /3 file non risultano archiviati/);
});

test("riepilogo: il pulsante Avvia si ferma con un motivo chiaro (disco pieno, foto già tutte in archivio)", () => {
  const base = {
    photosText: "42 foto scelte", onChangePhotos: noop, rows: [{ label: "Foto", value: "42" }],
    rename: true, onRename: noop, lightCopies: false, onLightCopies: noop, finish: "", moreSettings: "", moreSettingsOpen: false,
    importing: false, onBack: noop, onStart: noop,
  };
  const blocked = renderToStaticMarkup(createElement(ConfirmStep, { ...base, startBlockedReason: "Non c'è abbastanza spazio sul disco di destinazione." }));
  assert.match(blocked, /role="alert"/);
  assert.match(blocked, /Non c&#x27;è abbastanza spazio/);
  assert.match(blocked, /<button[^>]*class="primary-button"[^>]*disabled/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(ConfirmStep, base)), /role="alert"/);
  const importingWithReason = renderToStaticMarkup(createElement(ConfirmStep, { ...base, importing: true, startBlockedReason: "x" }));
  assert.doesNotMatch(importingWithReason, /role="alert"/, "durante l'importazione il motivo non serve");
});

test("schermata finale: dice quanti file c'erano già e non sono stati ricopiati", () => {
  const result = { job: jobs[0]!, copiedFiles: 40, skippedFiles: 80, jpgGenerati: 0, errors: [] as string[], cartellaFotoFinale: "D:/A", cartellaVideoFinale: "", videoFiles: 0 } as unknown as ImportResult;
  const base = { result, onOpenFolders: noop, onAnother: noop, onArchive: noop, sdAvailable: false, format: { checking: false, result: null, error: null }, onCheckFormat: noop };
  assert.match(renderToStaticMarkup(createElement(DoneStep, base)), /Altri 80 file c&#x27;erano già e non li ho ricopiati/);
  assert.match(renderToStaticMarkup(createElement(DoneStep, { ...base, result: { ...result, skippedFiles: 1 } as ImportResult })), /Un altro file c&#x27;era già e non l&#x27;ho ricopiato/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(DoneStep, { ...base, result: { ...result, skippedFiles: 0 } as ImportResult })), /c&#x27;era già|c&#x27;erano già/);
});
