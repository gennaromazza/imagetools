import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResumeBannerView } from "./components/ResumeBanner.js";
import { describeInterrupted, findResumableSession, type ResumableLike } from "./wizardModel.js";

(globalThis as { React?: typeof React }).React = React;

const now = new Date("2026-10-02T21:00:00").getTime();
const hoursAgo = (hours: number) => now - hours * 3_600_000;

function session(extra: Partial<ResumableLike> = {}): ResumableLike {
  return { id: "s1", sourceRoot: "J:\\", status: "INTERRUPTED", plannedFiles: 800, verifiedFiles: 312, updatedAt: hoursAgo(5), ...extra };
}

test("ripresa: si propone solo l'importazione interrotta di questa scheda con foto ancora da copiare", () => {
  assert.equal(findResumableSession([session()], "J:\\", now)?.id, "s1");
  assert.equal(findResumableSession([session()], "j:/", now)?.id, "s1", "stessa scheda scritta in altro modo");
  assert.equal(findResumableSession([session()], "K:\\", now), null, "un'altra scheda");
  for (const status of ["COMPLETED", "CANCELLED", "IMPORTING", "READY"]) assert.equal(findResumableSession([session({ status })], "J:\\", now), null, status);
  for (const status of ["PAUSED", "INTERRUPTED", "FAILED"]) assert.ok(findResumableSession([session({ status })], "J:\\", now), status);
  assert.equal(findResumableSession([session({ verifiedFiles: 800 })], "J:\\", now), null, "non resta nulla da copiare");
  assert.equal(findResumableSession([session({ plannedFiles: 0, verifiedFiles: 0 })], "J:\\", now), null);
  assert.equal(findResumableSession([session({ updatedAt: now - 15 * 86_400_000 })], "J:\\", now), null, "troppo vecchia");
  assert.equal(findResumableSession([], "J:\\", now), null);
});

test("ripresa: tra più sessioni sceglie la più recente", () => {
  const older = session({ id: "vecchia", updatedAt: hoursAgo(30) });
  const newer = session({ id: "nuova", updatedAt: hoursAgo(2) });
  assert.equal(findResumableSession([older, newer], "J:\\", now)?.id, "nuova");
  assert.equal(findResumableSession([newer, older], "J:\\", now)?.id, "nuova");
});

test("ripresa: descrizione con giorno e numeri in parole semplici", () => {
  assert.equal(describeInterrupted(session(), now), "L'importazione di oggi si è fermata a 312 file su 800.");
  assert.match(describeInterrupted(session({ updatedAt: now - 86_400_000 }), now), /di ieri/);
  assert.match(describeInterrupted(session({ updatedAt: now - 3 * 86_400_000 }), now), /di 3 giorni fa/);
  assert.match(describeInterrupted(session({ plannedFiles: 12_500, verifiedFiles: 1 }), now), /1 file su 12\.500/);
});

test("ripresa: il riquadro cambia aspetto in base alla fase e non permette azioni mentre lavora", () => {
  const noop = () => undefined;
  const base = { session: session(), now, onResume: noop, onDismiss: noop };
  const idle = renderToStaticMarkup(createElement(ResumeBannerView, { ...base, phase: "idle", jobName: "Rossi" }));
  assert.match(idle, /Importazione interrotta/);
  assert.match(idle, /si è fermata a 312 file su 800/);
  assert.match(idle, /Lavoro: «Rossi»/);
  assert.match(idle, />Riprendi</);
  assert.match(idle, />Ignora</);
  const running = renderToStaticMarkup(createElement(ResumeBannerView, { ...base, phase: "running", progressPct: 41.6, progressLabel: "Copia file" }));
  assert.match(running, /Copia file · 42%/);
  assert.match(running, /<progress[^>]*value="41\.6"/);
  assert.doesNotMatch(running, /<button/, "durante la ripresa nessun pulsante");
  const done = renderToStaticMarkup(createElement(ResumeBannerView, { ...base, phase: "done", message: "Ho copiato altri 488 file." }));
  assert.match(done, /Ripresa completata/);
  assert.match(done, /488 file/);
  assert.match(done, />Chiudi</);
  assert.doesNotMatch(done, />Riprendi</);
  const failed = renderToStaticMarkup(createElement(ResumeBannerView, { ...base, phase: "error", message: "Ricollega la scheda sorgente prima di riprendere" }));
  assert.match(failed, /Non sono riuscito a riprendere/);
  assert.match(failed, /role="alert"/);
  assert.match(failed, />Riprova</);
});
