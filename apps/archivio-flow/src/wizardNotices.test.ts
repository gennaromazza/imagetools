import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CardChooser } from "./components/CardChooser.js";
import { RecentImportsView } from "./components/RecentImports.js";
import { CancelImportView } from "./components/steps/CancelImport.js";
import { DoneStep } from "./components/steps/DoneStep.js";
import type { ImportResult } from "./types.js";
import {
  describeCancelled, describeCard, describeCardStatus, describeWhen, lightboxView, recentImports, shouldSwitchToNewCard,
  type SessionLike,
} from "./wizardModel.js";

(globalThis as { React?: typeof React }).React = React;

const noop = () => undefined;
const now = new Date("2026-10-03T10:00:00").getTime();
const at = (iso: string) => new Date(iso).getTime();

test("scheda già scaricata: avviso netto se è tutta in archivio, più morbido se quasi tutta o per metà, nessuno se poche", () => {
  const archived = (count: number, where = "in «Evento 1»") => ({ count, bytes: 0, where });
  const all = describeCardStatus(800, archived(800))!;
  assert.equal(all.level, "all");
  assert.match(all.text, /già scaricata: tutte le 800 foto e i video sono già in archivio in «Evento 1»/);
  assert.match(all.text, /Non serve importarli di nuovo/);
  const almost = describeCardStatus(800, archived(760))!;
  assert.equal(almost.level, "almost");
  assert.match(almost.text, /quasi tutta già scaricata: 760 su 800/);
  const mostly = describeCardStatus(800, archived(450, ""))!;
  assert.equal(mostly.level, "mostly");
  assert.match(mostly.text, /Più della metà.*450 su 800.*già in archivio\.$/);
  assert.equal(describeCardStatus(800, archived(100)), null, "poche: bastano le tessere in grigio");
  assert.equal(describeCardStatus(800, null), null);
  assert.equal(describeCardStatus(0, archived(0)), null);
  assert.equal(describeCardStatus(1, archived(1))!.level, "all");
});

test("stop all'importazione: dice cosa resta e come proseguire, senza parlare di errori", () => {
  assert.match(describeCancelled(0, 800), /Non ho copiato nessuna foto: puoi ricominciare/);
  const partial = describeCancelled(312, 800);
  assert.match(partial, /Le 312 foto già copiate restano al loro posto, ne mancano 488/);
  assert.match(partial, /salto quelle già copiate/);
  assert.match(describeCancelled(1, 800), /La foto già copiata resta al loro posto/);
  assert.doesNotMatch(describeCancelled(800, 800), /ne mancano/);
  assert.doesNotMatch(partial, /errore|fallit/i);
});

test("anteprima grande: miniatura subito mentre arriva la foto, ripiego se la grande non c'è", () => {
  assert.equal(lightboxView("ready", true, true), "full");
  assert.equal(lightboxView("ready", true, false), "full");
  assert.equal(lightboxView("loading", false, true), "progressive");
  assert.equal(lightboxView("loading", false, false), "loading");
  assert.equal(lightboxView("error", false, true), "thumb-fallback");
  assert.equal(lightboxView("error", false, false), "error");
  assert.equal(lightboxView("ready", false, true), "progressive", "pronta ma ancora senza immagine: si mostra la miniatura");
});

test("più schede: descrizione leggibile e cambio automatico solo se non se ne usa già una", () => {
  assert.equal(describeCard({ path: "J:\\", volumeName: "FUJI", totalSize: 59_400_000_000 }), "FUJI (J:) · 59,4 GB");
  assert.equal(describeCard({ path: "K:\\", volumeName: "", totalSize: 127_800_000_000 }), "Scheda (K:) · 128 GB");
  assert.equal(describeCard({ path: "L:\\" }), "Scheda (L:)");
  const state = (hasActive: boolean, activePresent: boolean, hasNewCard: boolean) => shouldSwitchToNewCard({ hasActive, activePresent, hasNewCard });
  assert.equal(state(false, false, true), true, "prima scheda inserita: si apre da sola");
  assert.equal(state(true, true, true), false, "una seconda scheda non toglie la scelta in corso");
  assert.equal(state(true, false, true), true, "la scheda in uso è stata tolta: si passa alla nuova");
  assert.equal(state(true, true, false), false);
  assert.equal(state(false, false, false), false);
});

test("più schede: l'elenco compare solo con due o più schede e segna quella in uso", () => {
  const cards = [{ path: "J:\\", volumeName: "FUJI", totalSize: 59_400_000_000 }, { path: "K:\\", volumeName: "SONY", totalSize: 127_800_000_000 }];
  assert.equal(renderToStaticMarkup(createElement(CardChooser, { cards: [cards[0]!], activePath: "J:\\", onChoose: noop })), "");
  assert.equal(renderToStaticMarkup(createElement(CardChooser, { cards: [], activePath: null, onChoose: noop })), "");
  const html = renderToStaticMarkup(createElement(CardChooser, { cards, activePath: "j:\\", onChoose: noop }));
  assert.match(html, /FUJI \(J:\) · 59,4 GB/);
  assert.match(html, /SONY \(K:\) · 128 GB/);
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.match(html, /is-active[^>]*aria-pressed="true"[^>]*>FUJI/);
});

function session(extra: Partial<SessionLike> = {}): SessionLike {
  return { id: "s", jobId: "j1", sourceRoot: "J:\\", destinationRoot: "D:\\Archivio\\Rossi\\FOTO_SD\\Gennaro", status: "COMPLETED", updatedAt: at("2026-10-02T16:40:00"), completedAt: at("2026-10-02T16:45:00"), verifiedFiles: 312, ...extra };
}

test("ultime importazioni: solo quelle concluse, dalla più recente, con il nome del lavoro", () => {
  const jobs = [{ id: "j1", nomeLavoro: "Rossi" }, { id: "j2", nomeLavoro: "Bianchi" }];
  const list = recentImports([
    session({ id: "vecchia", completedAt: at("2026-09-20T10:00:00") }),
    session({ id: "recente", jobId: "j2", completedAt: at("2026-10-03T09:30:00") }),
    session({ id: "fallita", status: "FAILED" }),
    session({ id: "vuota", verifiedFiles: 0 }),
    session({ id: "senza-data", completedAt: null, updatedAt: at("2026-10-01T08:00:00"), jobId: null }),
  ], jobs, 6, now);
  assert.deepEqual(list.map((item) => item.id), ["recente", "senza-data", "vecchia"]);
  assert.equal(list[0]!.id, "recente");
  assert.equal(list[0]!.jobName, "Bianchi");
  assert.equal(list.find((item) => item.id === "senza-data")!.jobName, null);
  assert.ok(!list.some((item) => ["fallita", "vuota"].includes(item.id)));
  assert.equal(recentImports([session(), session({ id: "b" }), session({ id: "c" })], jobs, 2, now).length, 2, "rispetta il limite");
  assert.deepEqual(recentImports([], jobs, 6, now), []);
});

test("ultime importazioni: quando in parole semplici", () => {
  assert.equal(describeWhen(at("2026-10-03T09:30:00"), now), "oggi alle 09:30");
  assert.equal(describeWhen(at("2026-10-02T16:40:00"), now), "ieri alle 16:40");
  assert.match(describeWhen(at("2026-09-20T10:00:00"), now), /^20 settembre alle 10:00$/);
});

test("ultime importazioni: la lista mostra lavoro, quantità, quando e il pulsante per aprire la cartella", () => {
  const items = recentImports([session({ verifiedFiles: 1 }), session({ id: "b", verifiedFiles: 312, jobId: null })], [{ id: "j1", nomeLavoro: "Rossi" }], 6, now);
  const html = renderToStaticMarkup(createElement(RecentImportsView, { items, onOpen: noop }));
  assert.match(html, /Rossi/);
  assert.match(html, /1 file · ieri alle 16:45/);
  assert.match(html, /312 file/);
  assert.match(html, /Lavoro senza nome/);
  assert.equal((html.match(/Apri cartella/g) ?? []).length, 2);
  assert.match(renderToStaticMarkup(createElement(RecentImportsView, { items: [], onOpen: noop })), /Qui compariranno le tue ultime importazioni/);
});

test("interruzione: prima si spiega, poi si conferma", () => {
  const ask = renderToStaticMarkup(createElement(CancelImportView, { confirming: false, onAsk: noop, onKeep: noop, onConfirm: noop }));
  assert.match(ask, />Interrompi importazione</);
  assert.doesNotMatch(ask, /Sì, ferma/);
  const confirm = renderToStaticMarkup(createElement(CancelImportView, { confirming: true, onAsk: noop, onKeep: noop, onConfirm: noop }));
  assert.match(confirm, /Vuoi fermarti\?/);
  assert.match(confirm, /restano al loro posto/);
  assert.match(confirm, />Sì, ferma</);
  assert.match(confirm, />No, continua</);
});

test("schermata finale: durata, Bridge ed espulsione compaiono solo se disponibili", () => {
  const result = { job: { nomeLavoro: "Rossi", percorsoCartella: "E:\\2026\\BATTESIMI\\Rossi" }, copiedFiles: 312, skippedFiles: 0, jpgGenerati: 0, errors: [] as string[], cartellaFotoFinale: "E:\\2026\\BATTESIMI\\2026-10-18 - Romeo - 18-10-2026\\FOTO_SD\\Gennaro", cartellaVideoFinale: "", videoFiles: 0, incomplete: false } as unknown as ImportResult;
  const base = { result, onOpenFolders: noop, onAnother: noop, onArchive: noop, sdAvailable: true, format: { checking: false, result: null, error: null }, onCheckFormat: noop };
  const plain = renderToStaticMarkup(createElement(DoneStep, base));
  assert.doesNotMatch(plain, /Adobe Bridge/);
  assert.doesNotMatch(plain, /Espelli/);
  assert.doesNotMatch(plain, / in \d+ minut/);
  assert.match(plain, /title="E:\\2026\\BATTESIMI\\2026-10-18 - Romeo - 18-10-2026\\FOTO_SD\\Gennaro"/, "il percorso completo resta nel suggerimento");
  assert.match(plain, /…\\2026-10-18 - Romeo - 18-10-2026\\FOTO_SD\\Gennaro/, "a video si vede la parte utile");
  const rich = renderToStaticMarkup(createElement(DoneStep, {
    ...base, stats: { elapsedMs: 14 * 60_000 + 10_000, bytes: 38_400_000_000 },
    bridge: { message: null, onOpen: noop },
    eject: { ejecting: false, message: "Scheda espulsa: puoi toglierla.", onEject: noop },
  }));
  assert.match(rich, /in 14 minuti \(38,4 GB\)/);
  assert.match(rich, />Apri in Adobe Bridge</);
  assert.match(rich, /⏏ Espelli la scheda/);
  assert.match(rich, /Scheda espulsa: puoi toglierla\./);
  assert.match(renderToStaticMarkup(createElement(DoneStep, { ...base, eject: { ejecting: true, message: null, onEject: noop } })), /Espello…/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(DoneStep, { ...base, sdAvailable: false, eject: { ejecting: false, message: null, onEject: noop } })), /Espelli/, "senza scheda non si espelle nulla");
});
