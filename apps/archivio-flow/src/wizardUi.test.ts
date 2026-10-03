import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { createElement } from "react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SdPhotoCell } from "./components/SdVirtualGrid.js";
import { StepFrame } from "./components/steps/StepFrame.js";
import type { SdFile } from "./sdBrowserModel.js";
import { formatElapsed, moveGridFocus, shortPath, shouldShowShiftTip } from "./wizardModel.js";

(globalThis as { React?: typeof React }).React = React;

test("percorsi: si mostrano gli ultimi elementi, con i puntini quando sono stati tolti", () => {
  assert.equal(shortPath("E:\\2026\\BATTESIMI\\2026-10-18 - Romeo - 18-10-2026\\FOTO_SD\\Gennaro"), "…\\2026-10-18 - Romeo - 18-10-2026\\FOTO_SD\\Gennaro");
  assert.equal(shortPath("/archivio/2026/Rossi/FOTO_SD"), "…/2026/Rossi/FOTO_SD");
  assert.equal(shortPath("D:\\Foto\\Rossi"), "D:\\Foto\\Rossi", "già corto: resta intero");
  assert.equal(shortPath("E:\\a\\b\\c\\d", 2), "…\\c\\d");
  assert.equal(shortPath(""), "");
});

test("durata effettiva in parole semplici", () => {
  assert.equal(formatElapsed(20_000), "meno di un minuto");
  assert.equal(formatElapsed(60_000), "1 minuto");
  assert.equal(formatElapsed(14 * 60_000 + 20_000), "14 minuti");
  assert.equal(formatElapsed(3_600_000), "1 ora");
  assert.equal(formatElapsed(3_600_000 + 60_000), "1 ora e 1 minuto");
  assert.equal(formatElapsed(2 * 3_600_000 + 5 * 60_000), "2 ore e 5 minuti");
  assert.equal(formatElapsed(-1), "—");
});

test("suggerimento Maiusc: solo con una foto scelta e finché non è stato usato", () => {
  assert.equal(shouldShowShiftTip(1, false), true);
  assert.equal(shouldShowShiftTip(0, false), false);
  assert.equal(shouldShowShiftTip(2, false), false);
  assert.equal(shouldShowShiftTip(1, true), false);
});

const rows = [
  { header: true, files: [] as unknown[] },
  { header: false, files: [1, 2, 3, 4] },
  { header: false, files: [5, 6] },
  { header: true, files: [] as unknown[] },
  { header: false, files: [7, 8, 9, 10] },
  { header: false, files: [11] },
];

test("tastiera nella griglia: frecce, salto delle intestazioni dei giorni e riga più corta", () => {
  const move = (row: number, col: number, key: string) => moveGridFocus(rows, { row, col }, key);
  assert.deepEqual(move(1, 1, "ArrowRight"), { row: 1, col: 2 });
  assert.deepEqual(move(1, 3, "ArrowRight"), { row: 2, col: 0 }, "a fine riga si passa alla successiva");
  assert.deepEqual(move(2, 1, "ArrowRight"), { row: 4, col: 0 }, "salta l'intestazione del giorno");
  assert.deepEqual(move(4, 0, "ArrowLeft"), { row: 2, col: 1 }, "e torna indietro oltre l'intestazione");
  assert.deepEqual(move(1, 3, "ArrowDown"), { row: 2, col: 1 }, "la riga sotto è più corta: ultima colonna disponibile");
  assert.deepEqual(move(2, 1, "ArrowUp"), { row: 1, col: 1 });
  assert.deepEqual(move(4, 2, "ArrowDown"), { row: 5, col: 0 });
  assert.deepEqual(move(1, 0, "ArrowUp"), { row: 1, col: 0 }, "in cima non si esce");
  assert.deepEqual(move(1, 0, "ArrowLeft"), { row: 1, col: 0 });
  assert.deepEqual(move(5, 0, "ArrowDown"), { row: 5, col: 0 }, "in fondo non si esce");
  assert.deepEqual(move(5, 0, "ArrowRight"), { row: 5, col: 0 });
  assert.deepEqual(move(2, 1, "Home"), { row: 1, col: 0 });
  assert.deepEqual(move(1, 0, "End"), { row: 5, col: 0 });
  assert.deepEqual(move(1, 2, "PageDown"), { row: 5, col: 0 }, "tre righe di foto più in basso, limitato alla fine");
  assert.deepEqual(move(5, 0, "PageUp"), { row: 1, col: 0 });
  assert.deepEqual(move(1, 1, "a"), { row: 1, col: 1 }, "altri tasti: nessun movimento");
  assert.deepEqual(move(0, 0, "ArrowDown"), { row: 0, col: 0 }, "l'intestazione non è una tessera");
  assert.deepEqual(moveGridFocus([], { row: 0, col: 0 }, "Home"), { row: 0, col: 0 });
});

test("invio: avanza dai campi di testo, ma non da pulsanti o elenchi e non se Avanti è spento", () => {
  let advanced = 0;
  const build = (nextDisabled = false) => StepFrame({ title: "t", children: null, onNext: () => { advanced += 1; }, nextDisabled }) as ReactElement<{ onKeyDown: (event: unknown) => void }>;
  const press = (element: ReactElement<{ onKeyDown: (event: unknown) => void }>, key: string, tagName: string, defaultPrevented = false) => {
    let prevented = false;
    element.props.onKeyDown({ key, defaultPrevented, target: { tagName, isContentEditable: false }, preventDefault: () => { prevented = true; } });
    return prevented;
  };
  assert.equal(press(build(), "Enter", "INPUT"), true);
  assert.equal(advanced, 1);
  assert.equal(press(build(), "Enter", "BUTTON"), false, "su un pulsante Invio lo preme");
  assert.equal(press(build(), "Enter", "SELECT"), false);
  assert.equal(press(build(), "Enter", "TEXTAREA"), false);
  assert.equal(press(build(), "Escape", "INPUT"), false);
  assert.equal(press(build(), "Enter", "INPUT", true), false, "già gestito altrove");
  assert.equal(press(build(true), "Enter", "INPUT"), false, "Avanti spento");
  assert.equal(advanced, 1);
  const noNext = StepFrame({ title: "t", children: null }) as ReactElement<{ onKeyDown: (event: unknown) => void }>;
  assert.equal(press(noNext, "Enter", "INPUT"), false);
});

function file(extra: Partial<SdFile> = {}): SdFile {
  return { filePath: "J:\\DCIM\\DSC01.ARW", fileName: "DSC01.ARW", mtimeMs: Date.parse("2026-10-02T16:40:00"), size: 25_000_000, ext: ".arw", isJpg: false, mediaType: "photo", ...extra };
}

test("tessera: tipo di file, video sempre segnalati, ingrandimento solo per le foto e percorso per la tastiera", () => {
  const noop = () => undefined;
  const props = { isSelected: false, session: "s", sdPath: "J:\\", onSelect: noop, onOpen: noop };
  const photo = renderToStaticMarkup(createElement(SdPhotoCell, { ...props, file: file() }));
  assert.match(photo, /sd-browser-type"[^>]*>ARW</);
  assert.doesNotMatch(photo, /is-video/);
  assert.match(photo, /data-path="J:\\DCIM\\DSC01\.ARW"/);
  assert.match(photo, /sd-browser-zoom/);
  const video = renderToStaticMarkup(createElement(SdPhotoCell, { ...props, file: file({ filePath: "J:\\clip.mp4", fileName: "clip.mp4", ext: ".mp4", mediaType: "video" }) }));
  assert.match(video, /sd-browser-type is-video"[^>]*>▶ VIDEO</);
  assert.doesNotMatch(video, /sd-browser-zoom/, "i video non si ingrandiscono");
  const archived = renderToStaticMarkup(createElement(SdPhotoCell, { ...props, file: file(), isSelected: true, archivedLabel: "Già in «Evento 1»" }));
  assert.match(archived, /is-selected/);
  assert.match(archived, /is-archived/);
  assert.match(archived, /Già in «Evento 1»/);
  assert.match(archived, /aria-pressed="true"/);
});
