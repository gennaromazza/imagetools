import { describe, expect, it } from "vitest";
import { addGroup, addPhotos, createGroup, createOrder, setCopies, setCustomer, type Order } from "./model";
import { exportOrder, type ExportDeps } from "./export";

function fakeDeps(existing: string[] = [], failOn?: string) {
  const published: string[] = [];
  let staged: string[] = [];
  let folder = "";
  let rollbacks = 0;
  const deps: ExportDeps = {
    api: {
      beginAtomicWriteTransaction: async (path) => { folder = path; staged = []; return "t"; },
      stageAtomicWriteTransactionFile: async (_id, file) => { staged.push(`${folder}/${file.fileName}`); },
      commitAtomicWriteTransaction: async () => { published.push(...staged); return staged; },
      finalizeAtomicWriteTransaction: async () => true,
      rollbackAtomicWriteTransaction: async () => { rollbacks += 1; return true; },
    },
    ensureSubfolder: async (parent, name) => `${parent}/${name}`,
    fileExists: async (path, name) => existing.includes(`${path}/${name}`),
    renderFile: async (_group, item) => {
      if (item.fileName === failOn) throw new Error("illeggibile");
      return new Uint8Array([1]);
    },
  };
  return { deps, published, rollbacks: () => rollbacks };
}

function twoGroupOrder(): Order {
  let order = addGroup(createOrder(), { ...createGroup(), borderMm: 5 });
  const [first, second] = order.groups.map((group) => group.id);
  const source = (name: string) => ({ sourceKey: name, fileName: `${name}.jpg`, width: 3, height: 2 });
  order = addPhotos(order, first, [source("a"), source("b")]);
  order = addPhotos(order, second, [source("c")]);
  return setCopies(order, first, order.groups[0].photos[0].id, 2);
}

describe("export dell'ordine", () => {
  it("scrive una cartella per gruppo con le copie", async () => {
    const { deps, published } = fakeDeps();
    const report = await exportOrder({ order: twoGroupOrder(), outputPath: "out" }, deps);
    expect(published).toEqual(["out/10x15/a.jpg", "out/10x15/a_copia2.jpg", "out/10x15/b.jpg", "out/10x15_bordo5mm/c.jpg"]);
    expect(report.done.map((item) => item.files)).toEqual([3, 1]);
    expect(report.done[0]).toMatchObject({ folderPath: "out/10x15", sample: expect.stringContaining("a.jpg") });
  });

  it("con un cliente mette i formati dentro la sua cartella", async () => {
    const { deps, published } = fakeDeps();
    const order = setCustomer(twoGroupOrder(), "Mario Rossi", "2026-11-26");
    const report = await exportOrder({ order, outputPath: "out" }, deps);
    expect(published[0]).toBe("out/Mario Rossi - 2026-11-26/10x15/a.jpg");
    expect(report.done.map((item) => item.folder)).toEqual([
      "Mario Rossi - 2026-11-26/10x15",
      "Mario Rossi - 2026-11-26/10x15_bordo5mm",
    ]);
  });

  it("non sovrascrive i file già presenti", async () => {
    const { deps, published } = fakeDeps(["out/10x15/a.jpg", "out/10x15/a-2.jpg"]);
    await exportOrder({ order: twoGroupOrder(), outputPath: "out" }, deps);
    expect(published[0]).toBe("out/10x15/a-3.jpg");
    expect(new Set(published).size).toBe(published.length);
  });

  it("un gruppo fallito non ferma gli altri e si può riprovare da solo", async () => {
    const order = twoGroupOrder();
    const { deps, published, rollbacks } = fakeDeps([], "b.jpg");
    const report = await exportOrder({ order, outputPath: "out" }, deps);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].message).toContain("illeggibile");
    expect(published).toEqual(["out/10x15_bordo5mm/c.jpg"]);
    expect(rollbacks()).toBe(1);
    const retry = fakeDeps();
    await exportOrder({ order, outputPath: "out", groupIds: [report.failed[0].groupId] }, retry.deps);
    expect(retry.published.every((path) => path.startsWith("out/10x15/"))).toBe(true);
  });

  it("annullando non pubblica file parziali", async () => {
    const controller = new AbortController();
    const { deps, published, rollbacks } = fakeDeps();
    const report = await exportOrder({
      order: twoGroupOrder(),
      outputPath: "out",
      signal: controller.signal,
      onProgress: () => controller.abort(),
    }, deps);
    expect(report.cancelled).toBe(true);
    expect(published).toEqual([]);
    expect(rollbacks()).toBe(1);
  });
});
