import { test } from "node:test";
import assert from "node:assert/strict";
// Node non ha un parser XML del browser: per i test si usa quello di xmldom (già presente come dipendenza indiretta).
import { DOMParser as XmlDomParser, XMLSerializer } from "@xmldom/xmldom";

/** Come i browser: un XML non valido produce un documento con <parsererror>, non un documento parziale. */
class StrictDOMParser {
  parseFromString(xml: string, type: string) {
    let failed = false;
    const parser = new XmlDomParser({ errorHandler: { warning: () => undefined, error: () => { failed = true; }, fatalError: () => { failed = true; } } });
    const doc = parser.parseFromString(xml, type);
    if (failed) return new XmlDomParser().parseFromString("<parsererror xmlns=\"http://www.w3.org/1999/xhtml\">errore</parsererror>", "text/xml");
    return doc;
  }
}
Object.assign(globalThis, { DOMParser: StrictDOMParser, XMLSerializer });

const { parseXmpState, readXmpKeywords, readXmpRating, upsertXmpFlags, upsertXmpRating, upsertXmpState } = await import("./xmp-sidecar");

// Sidecar reale scritto da Image Select Pro (etichetta personalizzata, selezionata, 2 stelle).
const SELECTOR_XMP = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:photosuite="https://imagetool.local/ns/photosuite/1.0/" rdf:about="" photosuite:Rejected="False" photosuite:Selected="True" xmp:Rating="2"><photosuite:CustomLabels><rdf:Bag><rdf:li>A</rdf:li></rdf:Bag></photosuite:CustomLabels></rdf:Description>
  </rdf:RDF>
</x:xmpmeta><?xpacket end="w"?>`;

const ADOBE_XMP = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" xmp:Rating="1" xmp:Label="Red" crs:Exposure2012="+0.45" crs:Temperature="5200"/></rdf:RDF></x:xmpmeta>`;

test("stelle: lettura da un sidecar del Selector", () => {
  assert.equal(readXmpRating(SELECTOR_XMP), 2);
  assert.equal(readXmpRating(null), null);
  assert.equal(readXmpRating("<x:xmpmeta xmlns:x='adobe:ns:meta/'/>"), null);
  assert.equal(parseXmpState(SELECTOR_XMP).selected, true);
  assert.deepEqual(parseXmpState(SELECTOR_XMP).customLabels, ["A"]);
});

test("stelle: aggiornare la valutazione non tocca etichette né selezione", () => {
  const updated = upsertXmpRating(SELECTOR_XMP, 5);
  const state = parseXmpState(updated);
  assert.equal(state.rating, 5);
  assert.equal(state.selected, true, "la selezione resta");
  assert.deepEqual(state.customLabels, ["A"], "le etichette restano");
  assert.equal(state.pickStatus === "rejected", false);
  assert.equal(readXmpRating(upsertXmpRating(updated, 0)), 0, "si può azzerare");
});

test("stelle: valori fuori scala vengono limitati", () => {
  assert.equal(readXmpRating(upsertXmpRating(SELECTOR_XMP, 9)), 5);
  assert.equal(readXmpRating(upsertXmpRating(SELECTOR_XMP, -4)), 0);
  assert.equal(readXmpRating(upsertXmpRating(SELECTOR_XMP, 3.6)), 4);
  assert.equal(readXmpRating(upsertXmpRating(SELECTOR_XMP, Number.NaN)), 0);
});

test("stelle: un sidecar nuovo contiene la sola valutazione", () => {
  const created = upsertXmpRating(null, 3);
  const state = parseXmpState(created);
  assert.equal(state.rating, 3);
  assert.equal(state.selected, false);
  assert.deepEqual(state.customLabels ?? [], []);
  assert.equal(readXmpRating(upsertXmpRating("", 2)), 2, "testo vuoto = nessun sidecar");
});

test("stelle: le regolazioni di Lightroom/Camera Raw non vengono perse", () => {
  const updated = upsertXmpRating(ADOBE_XMP, 4);
  assert.match(updated, /crs:Exposure2012="\+0\.45"/);
  assert.match(updated, /crs:Temperature="5200"/);
  const state = parseXmpState(updated);
  assert.equal(state.rating, 4);
  assert.equal(state.colorLabel, "red", "l'etichetta colore di Adobe resta");
  assert.equal(state.hasCameraRawAdjustments, true);
});

test("stelle: una foto scartata resta scartata, cambia solo la valutazione preservata", () => {
  const rejected = upsertXmpState(null, { rating: 3, pickStatus: "rejected", colorLabel: null, customLabels: [] } as never, true);
  const before = parseXmpState(rejected);
  assert.equal(before.pickStatus, "rejected");
  const updated = upsertXmpRating(rejected, 5);
  const after = parseXmpState(updated);
  assert.equal(after.pickStatus, "rejected", "resta scartata");
  assert.match(updated, /PreservedRating="5"/);
});

test("stelle: un sidecar esistente ma illeggibile non viene mai sostituito", () => {
  assert.throws(() => upsertXmpRating("<non xml <<<", 3), /non|illeggibile|valido/i);
});

test("stelle: la scrittura è stabile (riscrivere lo stesso valore non cambia il significato)", () => {
  const once = upsertXmpRating(SELECTOR_XMP, 4);
  const twice = upsertXmpRating(once, 4);
  assert.deepEqual(parseXmpState(twice), parseXmpState(once));
});

// --- Lightroom: colore, scarto, etichette come parole chiave ---------------------------------

test("Lightroom: il colore e lo scarto cambiano senza toccare stelle, selezione e regolazioni", () => {
  const colored = upsertXmpFlags(ADOBE_XMP, { colorLabel: "green" });
  const state = parseXmpState(colored);
  assert.equal(state.colorLabel, "green");
  assert.equal(state.rating, 1, "le stelle restano");
  assert.match(colored, /xmp:Label="Green"/, "Lightroom legge il nome del colore in xmp:Label");
  assert.match(colored, /crs:Exposure2012="\+0\.45"/);

  const rejected = upsertXmpFlags(colored, { pickStatus: "rejected" });
  assert.equal(parseXmpState(rejected).pickStatus, "rejected");
  assert.match(rejected, /xmp:Rating="-1"/, "Adobe segna lo scarto con -1");
  assert.equal(parseXmpState(rejected).colorLabel, "green", "il colore non si perde con lo scarto");

  const restored = upsertXmpFlags(rejected, { pickStatus: "unmarked" });
  assert.equal(parseXmpState(restored).pickStatus === "rejected", false);
  assert.equal(parseXmpState(restored).rating, 1);
  assert.equal(parseXmpState(upsertXmpFlags(restored, { colorLabel: null })).colorLabel ?? null, null);
});

test("Lightroom: le etichette personalizzate compaiono anche come parole chiave", () => {
  const written = upsertXmpFlags(SELECTOR_XMP, { customLabels: ["A", "Cerimonia"] });
  assert.deepEqual(readXmpKeywords(written), ["A", "Cerimonia"]);
  assert.deepEqual(parseXmpState(written).customLabels, ["A", "Cerimonia"]);
  assert.equal(parseXmpState(written).selected, true);
});

test("Lightroom: le parole chiave tue restano, quelle nostre si aggiornano e si tolgono", () => {
  const withMine = ADOBE_XMP.replace("</rdf:RDF>", "").replace("/></", `><dc:subject xmlns:dc="http://purl.org/dc/elements/1.1/"><rdf:Bag><rdf:li>Famiglia</rdf:li></rdf:Bag></dc:subject></rdf:Description></rdf:RDF></`);
  const once = upsertXmpFlags(withMine, { customLabels: ["Torta"] });
  assert.deepEqual(readXmpKeywords(once), ["Famiglia", "Torta"]);
  const renamed = upsertXmpFlags(once, { customLabels: ["Brindisi"] });
  assert.deepEqual(readXmpKeywords(renamed), ["Famiglia", "Brindisi"], "la vecchia etichetta esce, la parola chiave tua resta");
  const cleared = upsertXmpFlags(renamed, { customLabels: [] });
  assert.deepEqual(readXmpKeywords(cleared), ["Famiglia"]);
  const noMine = upsertXmpFlags(SELECTOR_XMP, { customLabels: ["X"] });
  assert.deepEqual(readXmpKeywords(upsertXmpFlags(noMine, { customLabels: [] })), [], "senza altre parole chiave il campo sparisce");
});

test("Lightroom: nessuna parola chiave doppia e scrittura stabile", () => {
  const once = upsertXmpFlags(SELECTOR_XMP, { customLabels: ["A"] });
  const twice = upsertXmpFlags(once, { customLabels: ["A"] });
  assert.deepEqual(readXmpKeywords(twice), ["A"]);
  assert.deepEqual(parseXmpState(twice), parseXmpState(once));
});

test("Lightroom: cambiando stelle o colore in Lightroom, la lettura li vede", () => {
  const fromLightroom = ADOBE_XMP.replace('xmp:Rating="1"', 'xmp:Rating="4"').replace('xmp:Label="Red"', 'xmp:Label="Blue"');
  const state = parseXmpState(fromLightroom);
  assert.equal(state.rating, 4);
  assert.equal(state.colorLabel, "blue");
  assert.equal(parseXmpState(ADOBE_XMP.replace('xmp:Rating="1"', 'xmp:Rating="-1"')).pickStatus, "rejected");
});
