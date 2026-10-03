import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ImportStepper } from "./components/ImportStepper.js";
import { JobPicker } from "./components/JobPicker.js";
import {
  WIZARD_STEPS, canJumpToStep, folderStepApplies, formatItalianDate, issuesForScreen, lastPathSegment, macroStepOf, nextScreen, pickJobs, screenForStep, selectionSummary,
  type FlowContext,
} from "./wizardModel.js";
import type { Job } from "./types.js";

// tsx compila i componenti con il runtime JSX classico: React deve essere raggiungibile come globale.
(globalThis as { React?: typeof React }).React = React;

function job(id: string, name: string, date: string, author = "Gennaro", extra: Partial<Job> = {}): Job {
  return { id, nomeLavoro: name, dataLavoro: date, autore: author, percorsoCartella: `D:/Archivio/${date.slice(0, 4)}/${name}`, nomeCartella: name, dataCreazione: date, numeroFile: 10, folderExists: true, ...extra };
}

const jobs = [
  job("a", "Maria Rossi Shooting", "2026-03-21"),
  job("b", "Matrimonio Ferdinando", "2026-06-14"),
  job("c", "Comunione Giulia", "2026-05-10"),
  job("d", "Cerimonia Perù", "2025-09-02", "Anna"),
];

test("percorso: quattro tappe stabili, si torna indietro ma non si salta avanti", () => {
  assert.deepEqual(WIZARD_STEPS.map(item => item.step), [1, 2, 3, 4]);
  assert.equal(canJumpToStep(4, 1), true);
  assert.equal(canJumpToStep(4, 3), true);
  assert.equal(canJumpToStep(2, 3), false, "Avanti passa dai controlli");
  assert.equal(canJumpToStep(2, 2), false);
  assert.deepEqual((["who", "pick", "newjob", "folder", "confirm", "done"] as const).map(macroStepOf), [2, 2, 2, 3, 4, 4]);
});

const ctx = (extra: Partial<FlowContext> = {}): FlowContext => ({ mode: null, jobChosen: false, hasFolderChoices: false, ...extra });

test("percorso: una domanda per schermata, la scelta iniziale decide la strada", () => {
  assert.equal(nextScreen("who", ctx()), "who", "senza scelta si resta");
  assert.equal(nextScreen("who", ctx({ mode: "new" })), "newjob");
  assert.equal(nextScreen("who", ctx({ mode: "existing" })), "pick");
  assert.equal(nextScreen("pick", ctx({ mode: "existing" })), "pick", "senza lavoro scelto non si va avanti");
  assert.equal(nextScreen("pick", ctx({ mode: "existing", jobChosen: true })), "folder");
  assert.equal(nextScreen("folder", ctx()), "confirm");
  assert.equal(nextScreen("confirm", ctx()), "done");
  assert.equal(nextScreen("done", ctx()), "done");
});

test("percorso: la domanda sulla cartella si salta da sola per un lavoro nuovo senza cartelle da proporre", () => {
  assert.equal(folderStepApplies(ctx({ mode: "new", hasFolderChoices: false })), false);
  assert.equal(nextScreen("newjob", ctx({ mode: "new", hasFolderChoices: false })), "confirm");
  assert.equal(nextScreen("newjob", ctx({ mode: "new", hasFolderChoices: true })), "folder");
  assert.equal(folderStepApplies(ctx({ mode: "existing", hasFolderChoices: false })), true, "in un lavoro esistente si chiede sempre");
});

test("percorso: dall'indicatore si torna alla schermata giusta di ogni tappa", () => {
  assert.equal(screenForStep(1, ctx()), null, "la tappa 1 e' la griglia della scheda");
  assert.equal(screenForStep(2, ctx({ mode: "new" })), "newjob");
  assert.equal(screenForStep(2, ctx({ mode: "existing", jobChosen: true })), "pick");
  assert.equal(screenForStep(2, ctx()), "who");
  assert.equal(screenForStep(3, ctx()), "folder");
  assert.equal(screenForStep(4, ctx()), "confirm");
});

test("controlli: ogni schermata blocca solo i propri campi", () => {
  const issues = [
    { field: "nomeLavoro", message: "a" }, { field: "existingJobId", message: "b" }, { field: "dataLavoro", message: "c" },
    { field: "autore", message: "d" }, { field: "destinazione", message: "e" },
    { field: "sdPath", message: "f" }, { field: "filters", message: "g" }, { field: "rangeOverlap", message: "h" },
  ];
  assert.deepEqual(issuesForScreen("newjob", issues).map(issue => issue.field), ["nomeLavoro", "dataLavoro"]);
  assert.deepEqual(issuesForScreen("pick", issues).map(issue => issue.field), ["existingJobId"]);
  assert.deepEqual(issuesForScreen("folder", issues), []);
  assert.deepEqual(issuesForScreen("who", issues), []);
  assert.deepEqual(issuesForScreen("newjob", []), []);
});

test("riepilogo della scelta in linguaggio semplice", () => {
  assert.equal(selectionSummary({ explicitCount: 1, filtered: false, matchedCount: null }), "1 foto scelta");
  assert.equal(selectionSummary({ explicitCount: 12500, filtered: false, matchedCount: null }), "12.500 foto scelte");
  assert.equal(selectionSummary({ explicitCount: null, filtered: false, matchedCount: 1006 }), "1006 file: tutta la scheda");
  assert.equal(selectionSummary({ explicitCount: null, filtered: true, matchedCount: 40 }), "40 file nell'intervallo scelto");
  assert.equal(selectionSummary({ explicitCount: null, filtered: false, matchedCount: null }), "Tutta la scheda");
  assert.equal(selectionSummary({ explicitCount: null, filtered: true, matchedCount: null }), "Solo i file dell'intervallo scelto");
});

test("lavoro esistente: i più recenti prima, ricerca per parole e senza accenti", () => {
  assert.deepEqual(pickJobs(jobs, "", "").items.map(item => item.id), ["b", "c", "a", "d"]);
  assert.deepEqual(pickJobs(jobs, "rossi", "").items.map(item => item.id), ["a"]);
  assert.deepEqual(pickJobs(jobs, "peru", "").items.map(item => item.id), ["d"], "Perù si trova anche scrivendo peru");
  assert.deepEqual(pickJobs(jobs, "MATRIMONIO 2026", "").items.map(item => item.id), ["b"], "tutte le parole, in qualunque ordine e maiuscole");
  assert.deepEqual(pickJobs(jobs, "matrimonio maria", "").items, [], "nessun lavoro con entrambe le parole");
  assert.deepEqual(pickJobs(jobs, "anna", "").items.map(item => item.id), ["d"], "cerca anche nell'autore");
});

test("lavoro esistente: elenco corto, il lavoro scelto resta in cima anche se filtrato fuori", () => {
  const many = Array.from({ length: 30 }, (_, i) => job(`j${i}`, `Lavoro ${i}`, `2026-01-${String(i + 1).padStart(2, "0")}`));
  const base = pickJobs(many, "", "", 6);
  assert.equal(base.items.length, 6);
  assert.equal(base.total, 30);
  assert.equal(base.hidden, 24);
  assert.equal(base.items[0]!.id, "j29", "il più recente");
  const pinned = pickJobs(many, "", "j0", 6);
  assert.equal(pinned.items[0]!.id, "j0");
  assert.equal(pinned.items.length, 6);
  const pinnedOutsideSearch = pickJobs(many, "Lavoro 29", "j0", 6);
  assert.equal(pinnedOutsideSearch.items[0]!.id, "j0", "il lavoro scelto resta in cima anche se non corrisponde alla ricerca");
  assert.ok(pinnedOutsideSearch.items.some(item => item.id === "j29"));
  assert.equal(pickJobs([], "", "").total, 0);
});

test("percorsi: si mostra il nome della cartella, non tutto il percorso", () => {
  assert.equal(lastPathSegment("D:\\Archivio\\2026\\2026-03-21 - Rossi - 21-03-2026"), "2026-03-21 - Rossi - 21-03-2026");
  assert.equal(lastPathSegment("/archivio/2026/Rossi/"), "Rossi");
  assert.equal(lastPathSegment("Rossi"), "Rossi");
  assert.equal(lastPathSegment("—"), "—");
  assert.equal(lastPathSegment(""), "");
});

test("date in formato italiano", () => {
  assert.equal(formatItalianDate("2026-03-21"), "21/03/2026");
  assert.equal(formatItalianDate("non-una-data"), "non-una-data");
});

test("schermata: l'indicatore mostra il passo corrente e rende cliccabili solo i passi già fatti", () => {
  const html = renderToStaticMarkup(createElement(ImportStepper, { current: 4, onGoTo: () => undefined }));
  assert.match(html, /aria-current="step"/);
  assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
  assert.match(html, /Torna al passo 1/);
  assert.match(html, /Torna al passo 2/);
  assert.match(html, /Torna al passo 3/);
  assert.doesNotMatch(html, /Torna al passo 4/);
  assert.match(html, /aria-current="step"[^>]*>.*Controlla e avvia/s, "il passo corrente e' l'ultimo");
  const middle = renderToStaticMarkup(createElement(ImportStepper, { current: 3, onGoTo: () => undefined }));
  assert.match(middle, /Torna al passo 2/);
  assert.doesNotMatch(middle, /Torna al passo 3/);
  const first = renderToStaticMarkup(createElement(ImportStepper, { current: 1, onGoTo: () => undefined }));
  assert.doesNotMatch(first, /<button/, "al primo passo non si torna da nessuna parte");
  const readOnly = renderToStaticMarkup(createElement(ImportStepper, { current: 4 }));
  assert.doesNotMatch(readOnly, /<button/);
  for (const title of ["Scegli le foto", "Per quale lavoro", "In che cartella", "Controlla e avvia"]) assert.match(html, new RegExp(title));
});

test("schermata: la scelta del lavoro mostra schede, segnala quello scelto e spiega quando non c'è nulla", () => {
  const noop = () => undefined;
  const html = renderToStaticMarkup(createElement(JobPicker, { jobs, selectedId: "a", query: "", onQueryChange: noop, onPick: noop }));
  assert.match(html, /Maria Rossi Shooting/);
  assert.match(html, /21\/03\/2026 · Gennaro/);
  assert.match(html, /✓ Scelto/);
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Mostra altri/);

  const empty = renderToStaticMarkup(createElement(JobPicker, { jobs: [], selectedId: "", query: "", onQueryChange: noop, onPick: noop }));
  assert.match(empty, /ancora nessun lavoro/);
  const noMatch = renderToStaticMarkup(createElement(JobPicker, { jobs, selectedId: "", query: "zzz", onQueryChange: noop, onPick: noop }));
  assert.match(noMatch, /Nessun lavoro trovato/);

  const many = Array.from({ length: 20 }, (_, i) => job(`j${i}`, `Lavoro ${i}`, `2026-01-${String(i + 1).padStart(2, "0")}`));
  const long = renderToStaticMarkup(createElement(JobPicker, { jobs: many, selectedId: "", query: "", onQueryChange: noop, onPick: noop }));
  assert.match(long, /Mostra altri \(14\)/);
  const invalid = renderToStaticMarkup(createElement(JobPicker, { jobs, selectedId: "", query: "", invalid: true, onQueryChange: noop, onPick: noop }));
  assert.match(invalid, /job-picker__list--invalid/);
});
