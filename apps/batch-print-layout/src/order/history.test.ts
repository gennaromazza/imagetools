import { describe, expect, it } from "vitest";
import { HISTORY_KEY, loadHistory, recordHistory } from "./history";

function memory(initial = "") {
  const store = new Map<string, string>(initial ? [[HISTORY_KEY, initial]] : []);
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
}

describe("cronologia dei lavori", () => {
  it("registra l'ordine alla creazione e lo completa all'export senza perdere la data", () => {
    const storage = memory();
    recordHistory(storage, { id: "1", customerName: "Rossi", createdAt: "2026-11-26T10:00:00Z" });
    recordHistory(storage, { id: "2", customerName: "Bianchi", createdAt: "2026-11-26T11:00:00Z" });
    recordHistory(storage, { id: "1", customerName: "Rossi", createdAt: "2026-11-27T09:00:00Z", checkFile: "D:/x/a.jpg", prints: 4 });
    const list = loadHistory(storage);
    expect(list.map((item) => item.customerName)).toEqual(["Bianchi", "Rossi"]);
    expect(list[1]).toMatchObject({ createdAt: "2026-11-26T10:00:00Z", checkFile: "D:/x/a.jpg", prints: 4 });
  });

  it("scarta dati rotti senza fermare l'app", () => {
    expect(loadHistory(memory("non è json"))).toEqual([]);
    expect(loadHistory(memory('{"a":1}'))).toEqual([]);
    expect(loadHistory(memory('[null,{"id":1},{"id":"ok","customerName":"","createdAt":"x"}]'))).toHaveLength(1);
  });
});
