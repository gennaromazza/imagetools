import assert from "node:assert/strict";
import test from "node:test";
import { quickSelections, type SdFile } from "./sdBrowserModel.js";

function photo(iso: string, name = iso): SdFile {
  return { filePath: `I:/DCIM/${name}.JPG`, fileName: `${name}.JPG`, mtimeMs: Date.parse(iso), size: 1000, ext: ".jpg", isJpg: true, mediaType: "photo" };
}

const now = new Date("2026-10-02T21:30:00");

test("scelte rapide: tutta la scheda, solo oggi e solo l'ultimo giorno non si ripetono mai", () => {
  const files = [photo("2026-10-01T10:00:00", "a"), photo("2026-10-01T11:00:00", "b"), photo("2026-10-02T09:00:00", "c")];
  const choices = quickSelections(files, now);
  assert.deepEqual(choices.map(choice => choice.id), ["all", "today"], "il giorno piu' recente e' oggi: niente doppione");
  assert.equal(choices[0]!.paths.length, 3);
  assert.deepEqual(choices[1]!.paths, ["I:/DCIM/c.JPG"]);
  assert.equal(choices[1]!.day, "2026-10-02");
  assert.match(choices[1]!.label, /Solo oggi \(1\)/);

  const old = quickSelections([photo("2026-09-20T10:00:00", "a"), photo("2026-09-21T10:00:00", "b"), photo("2026-09-21T11:00:00", "c")], now);
  assert.deepEqual(old.map(choice => choice.id), ["all", "latestDay"]);
  assert.match(old[1]!.label, /Solo 21 settembre \(2\)/);
  assert.deepEqual(old[1]!.paths.sort(), ["I:/DCIM/b.JPG", "I:/DCIM/c.JPG"]);
});

test("scelte rapide: un solo giorno o una scheda vuota non propongono scorciatoie inutili", () => {
  assert.deepEqual(quickSelections([], now), []);
  const oneDay = quickSelections([photo("2026-10-02T09:00:00", "a"), photo("2026-10-02T10:00:00", "b")], now);
  assert.deepEqual(oneDay.map(choice => choice.id), ["all"], "tutto coincide con oggi");
});

test("scelte rapide: gli ultimi N scatti sono i più recenti e compaiono solo se la scheda è più grande", () => {
  const many = Array.from({ length: 250 }, (_, i) => photo(new Date(Date.parse("2026-09-01T08:00:00") + i * 60_000).toISOString().slice(0, 19), `p${i}`));
  const choices = quickSelections(many, now);
  const last = choices.find(choice => choice.id === "last")!;
  assert.equal(last.paths.length, 100);
  assert.equal(last.paths[0], "I:/DCIM/p249.JPG", "il piu' recente per primo");
  assert.ok(!last.paths.includes("I:/DCIM/p0.JPG"));
  assert.match(last.label, /Ultimi 100 scatti/);
  assert.equal(quickSelections(many.slice(0, 60), now).some(choice => choice.id === "last"), false);
  assert.equal(quickSelections(many, now, 40).find(choice => choice.id === "last")!.paths.length, 40);
});

test("scelte rapide: se un giorno ha esattamente N foto gli ultimi N non duplicano quella scelta", () => {
  const exact = [...Array.from({ length: 100 }, (_, i) => photo(`2026-09-10T08:${String(i % 60).padStart(2, "0")}:00`, `x${i}`)), ...Array.from({ length: 50 }, (_, i) => photo(`2026-09-09T08:${String(i % 60).padStart(2, "0")}:00`, `y${i}`))];
  const choices = quickSelections(exact, now);
  assert.equal(choices.some(choice => choice.id === "last"), false);
  assert.ok(choices.some(choice => choice.id === "latestDay" && choice.paths.length === 100));
});

test("scelte rapide: 'solo le nuove' compare solo quando alcune foto sono già in archivio e altre no", () => {
  const files = [photo("2026-09-10T08:00:00", "a"), photo("2026-09-10T08:01:00", "b"), photo("2026-09-11T08:00:00", "c")];
  const ids = (archived?: Set<string>) => quickSelections(files, now, 100, archived).map(choice => choice.id);
  assert.ok(!ids().includes("new"));
  assert.ok(!ids(new Set()).includes("new"));
  assert.ok(!ids(new Set(files.map(file => file.filePath))).includes("new"), "tutte già archiviate: niente da scegliere");
  const some = quickSelections(files, now, 100, new Set(["I:/DCIM/a.JPG"])).find(choice => choice.id === "new")!;
  assert.deepEqual(some.paths.sort(), ["I:/DCIM/b.JPG", "I:/DCIM/c.JPG"]);
  assert.match(some.label, /Solo le nuove \(2\)/);
});
