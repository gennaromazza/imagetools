import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CROSS_FOLDER_MAX_MTIME_GAP_MS, groupEntriesByBaseName } from "./raw-jpg-pairing.js";

const T0 = 1_700_000_000_000;

function entry(relativePath: string, lastModified = T0) {
  return { name: relativePath.split(/[\\/]/).pop()!, relativePath, lastModified };
}

function describeGroups(groups: ReturnType<typeof groupEntriesByBaseName>) {
  return groups.map((group) => (group.companion ? `${group.primary.relativePath}+${group.companion.relativePath}` : group.primary.relativePath));
}

describe("groupEntriesByBaseName — stessa cartella", () => {
  it("unisce JPG e RAW con lo stesso nome ignorando le maiuscole", () => {
    const groups = groupEntriesByBaseName([entry("IMG_0001.CR2"), entry("img_0001.jpg"), entry("IMG_0002.JPG")]);
    assert.deepEqual(describeGroups(groups), ["img_0001.jpg+IMG_0001.CR2", "IMG_0002.JPG"]);
  });

  it("non unisce nomi che differiscono anche solo di una cifra", () => {
    const groups = groupEntriesByBaseName([entry("IMG_0001.JPG"), entry("IMG_00010.CR2")]);
    assert.deepEqual(describeGroups(groups), ["IMG_0001.JPG", "IMG_00010.CR2"]);
  });

  it("lascia singoli RAW senza JPG e formati diversi da JPG", () => {
    const groups = groupEntriesByBaseName([entry("a.NEF"), entry("b.png"), entry("b.CR3"), entry("c.psd")]);
    assert.deepEqual(describeGroups(groups), ["a.NEF", "b.png", "b.CR3", "c.psd"]);
  });

  it("mantiene l'ordine d'ingresso e mette la coppia dove sta il JPG", () => {
    const groups = groupEntriesByBaseName([entry("a.JPG"), entry("z.JPG"), entry("a.ARW"), entry("m.JPG")]);
    assert.deepEqual(describeGroups(groups), ["a.JPG+a.ARW", "z.JPG", "m.JPG"]);
  });

  it("accetta percorsi con barre rovesciate", () => {
    const groups = groupEntriesByBaseName([entry("sera\\IMG_1.JPG"), entry("sera\\IMG_1.RAF")]);
    assert.deepEqual(describeGroups(groups), ["sera\\IMG_1.JPG+sera\\IMG_1.RAF"]);
  });
});

describe("groupEntriesByBaseName — cartelle diverse (RAW/ e JPG/)", () => {
  it("unisce stesso nome in cartelle diverse se scritti quasi insieme", () => {
    const groups = groupEntriesByBaseName([
      entry("JPG/IMG_0001.JPG", T0),
      entry("JPG/IMG_0002.JPG", T0 + 5_000),
      entry("RAW/IMG_0001.CR2", T0 + 1_000),
      entry("RAW/IMG_0002.CR2", T0 + 5_000),
    ]);
    assert.deepEqual(describeGroups(groups), ["JPG/IMG_0001.JPG+RAW/IMG_0001.CR2", "JPG/IMG_0002.JPG+RAW/IMG_0002.CR2"]);
  });

  it("non unisce se i file distano più della soglia (contatore riusato)", () => {
    const groups = groupEntriesByBaseName([
      entry("Cerimonia/IMG_0001.JPG", T0),
      entry("Festa/IMG_0001.CR2", T0 + CROSS_FOLDER_MAX_MTIME_GAP_MS + 1),
    ]);
    assert.deepEqual(describeGroups(groups), ["Cerimonia/IMG_0001.JPG", "Festa/IMG_0001.CR2"]);
  });

  it("unisce proprio alla soglia", () => {
    const groups = groupEntriesByBaseName([
      entry("JPG/IMG_0001.JPG", T0),
      entry("RAW/IMG_0001.CR2", T0 + CROSS_FOLDER_MAX_MTIME_GAP_MS),
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.companion?.relativePath, "RAW/IMG_0001.CR2");
  });

  it("non unisce senza data di modifica attendibile", () => {
    const groups = groupEntriesByBaseName([entry("JPG/IMG_0001.JPG", 0), entry("RAW/IMG_0001.CR2", 0)]);
    assert.equal(groups.length, 2);
  });

  it("non indovina quando due JPG sono ugualmente vicini allo stesso RAW", () => {
    const groups = groupEntriesByBaseName([
      entry("A/IMG_0001.JPG", T0),
      entry("B/IMG_0001.JPG", T0 + 2_000),
      entry("RAW/IMG_0001.CR2", T0 + 1_000),
    ]);
    assert.equal(groups.length, 3);
    assert.ok(groups.every((group) => !group.companion));
  });

  it("sceglie il JPG giusto quando solo uno è vicino nel tempo", () => {
    const groups = groupEntriesByBaseName([
      entry("Vecchio/IMG_0001.JPG", T0 - 10 * 60_000),
      entry("Nuovo/IMG_0001.JPG", T0),
      entry("RAW/IMG_0001.CR2", T0 + 500),
    ]);
    assert.deepEqual(describeGroups(groups), ["Vecchio/IMG_0001.JPG", "Nuovo/IMG_0001.JPG+RAW/IMG_0001.CR2"]);
  });

  it("la coppia della stessa cartella ha la precedenza su quella tra cartelle", () => {
    const groups = groupEntriesByBaseName([
      entry("A/IMG_0001.JPG", T0),
      entry("A/IMG_0001.CR2", T0),
      entry("B/IMG_0001.CR2", T0),
    ]);
    assert.deepEqual(describeGroups(groups), ["A/IMG_0001.JPG+A/IMG_0001.CR2", "B/IMG_0001.CR2"]);
  });
});
