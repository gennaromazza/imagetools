import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FEATURES_SEEN_KEY, WHATS_NEW, WHATS_NEW_KEY, compareVersions, lastSeenVersion, markFeatureSeen, releasesToShow, rememberVersion, seenFeatures, shouldShowWhatsNew, type WhatsNewRelease } from "./whatsNew";

const here = dirname(fileURLToPath(import.meta.url));
const memory = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, data };
};
const release = (version: string): WhatsNewRelease => ({ version, date: "2026-01-01", headline: version, items: [{ title: "x", text: "y" }] });

test("novità: ogni release ha la sua voce, completa e con i nomi dei pulsanti", () => {
  const current = JSON.parse(readFileSync(join(here, "..", "..", "package.json"), "utf8")).version as string;
  assert.ok(WHATS_NEW.some((entry) => entry.version === current), `manca la voce «Novità» per Album Flow ${current}: aggiungila in src/model/whatsNew.ts prima di rilasciare`);
  const versions = WHATS_NEW.map((entry) => entry.version);
  assert.equal(new Set(versions).size, versions.length, "versioni duplicate");
  assert.deepEqual([...versions].sort((a, b) => compareVersions(b, a)), versions, "dal più recente al più vecchio");
  for (const entry of WHATS_NEW) {
    assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(entry.headline.trim().length > 10 && entry.items.length > 0);
    const titles = entry.items.map((item) => item.title);
    assert.equal(new Set(titles).size, titles.length, `${entry.version}: titoli doppi`);
    for (const item of entry.items) assert.ok(item.title.trim() && item.text.trim().length > 20, `${entry.version}/${item.title}: testo mancante`);
  }
  // Le funzioni con un pulsante devono dire quale: è lo scopo della finestra.
  const latest = WHATS_NEW[0];
  assert.ok(latest.items.filter((item) => item.where?.length).length >= Math.ceil(latest.items.length / 2), "indica dove trovare le funzioni nuove");
});

test("novità: confronto tra versioni e quali voci mostrare", () => {
  assert.ok(compareVersions("0.2.0", "0.1.9") > 0 && compareVersions("0.10.0", "0.9.0") > 0 && compareVersions("1.0.0", "0.99.99") > 0);
  assert.equal(compareVersions("0.2.0", "0.2.0"), 0);
  assert.equal(compareVersions("0.2.0-beta.1", "0.2.0"), 0, "il suffisso non conta");
  const all = [release("0.3.0"), release("0.2.1"), release("0.2.0"), release("0.1.0")];
  assert.deepEqual(releasesToShow("0.2.0", "0.3.0", all).map((entry) => entry.version), ["0.3.0", "0.2.1"].reverse());
  assert.deepEqual(releasesToShow("0.1.0", "0.2.1", all).map((entry) => entry.version), ["0.2.0", "0.2.1"], "tutti quelli saltati, dal più vecchio");
  assert.deepEqual(releasesToShow(null, "0.2.1", all).map((entry) => entry.version), ["0.2.0", "0.2.1"], "versione ignota: si parte dalla prima uscita");
  assert.deepEqual(releasesToShow("0.3.0", "0.3.0", all), []);
  assert.deepEqual(releasesToShow("0.2.0", "0.2.1", [release("0.3.0")]), [], "le voci future non compaiono");
});

test("novità: si mostrano a chi aggiorna, non al primo avvio, e fino a «Ho capito»", () => {
  const all = [release("0.2.0")];
  assert.equal(shouldShowWhatsNew("0.1.0", "0.2.0", true, all), true);
  assert.equal(shouldShowWhatsNew(null, "0.2.0", true, all), true, "chi ha già album ma non ricorda la versione");
  assert.equal(shouldShowWhatsNew(null, "0.2.0", false, all), false, "primo avvio assoluto: niente di nuovo da raccontare");
  assert.equal(shouldShowWhatsNew("0.2.0", "0.2.0", true, all), false, "già visto");
  assert.equal(shouldShowWhatsNew("0.2.0", "0.2.1", true, all), false, "nessuna voce nuova: nessuna finestra");
  const storage = memory();
  assert.equal(lastSeenVersion(storage), null);
  rememberVersion("0.2.0", storage);
  assert.equal(lastSeenVersion(storage), "0.2.0");
  assert.equal(lastSeenVersion(memory({ [WHATS_NEW_KEY]: "boh" })), null);
  assert.doesNotThrow(() => rememberVersion("0.2.0", { getItem: () => null, setItem: () => { throw new Error("pieno"); } }));
  assert.equal(lastSeenVersion(null), null);
});

test("novità: l'etichetta «Nuovo» dei pulsanti sparisce dopo il primo uso e resta ricordata", () => {
  const storage = memory();
  assert.deepEqual(seenFeatures(storage), []);
  assert.deepEqual(markFeatureSeen("personalizza", storage), ["personalizza"]);
  assert.deepEqual(markFeatureSeen("drive", storage), ["personalizza", "drive"]);
  assert.deepEqual(markFeatureSeen("drive", storage), ["personalizza", "drive"], "senza doppioni");
  assert.deepEqual(seenFeatures(storage), ["personalizza", "drive"]);
  assert.deepEqual(seenFeatures(memory({ [FEATURES_SEEN_KEY]: "{rotto" })), []);
  assert.deepEqual(seenFeatures(memory({ [FEATURES_SEEN_KEY]: JSON.stringify(["ok", 4, null]) })), ["ok"]);
});
