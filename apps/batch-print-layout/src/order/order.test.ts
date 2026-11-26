import { describe, expect, it } from "vitest";
import {
  ALL_FORMATS,
  addGroup,
  addPhotos,
  countPrints,
  createGroup,
  createOrder,
  customFormat,
  removeGroup,
  setCopies,
  setCrop,
  setCustomer,
  transferPhotos,
  updateGroup,
  type OrderGroup,
  type OrderPhoto,
  type PhotoSource,
} from "./model";
import { contentSpec, cropFor, effectiveBorderMm, effectiveDpi, rotateCrop, zoomCrop } from "./geometry";
import { folderName, folderNames, orderFolderName, plannedFiles, sanitizeName } from "./naming";
import { loadOrder, parseOrder, saveOrder } from "./storage";

const source = (key: string, width = 6000, height = 4000): PhotoSource => ({ sourceKey: key, fileName: `${key}.jpg`, width, height });
const photo = (width = 6000, height = 4000, extra: Partial<OrderPhoto> = {}): OrderPhoto =>
  ({ id: "p", ...source("a", width, height), copies: 1, ...extra });
const group = (extra: Partial<OrderGroup> = {}): OrderGroup => ({ ...createGroup(), ...extra });

describe("modello dell'ordine", () => {
  it("non duplica la stessa foto nel gruppo e conta le copie", () => {
    let order = createOrder();
    const id = order.groups[0].id;
    order = addPhotos(order, id, [source("a"), source("a"), source("b")]);
    order = addPhotos(order, id, [source("b")]);
    expect(order.groups[0].photos).toHaveLength(2);
    order = setCopies(order, id, order.groups[0].photos[0].id, 4000);
    expect(countPrints(order.groups[0])).toBe(1000);
  });

  it("cambiando formato o bordo butta i ritagli, cambiando il logo no", () => {
    let order = addPhotos(createOrder(), "x", []);
    const id = order.groups[0].id;
    order = addPhotos(order, id, [source("a")]);
    const target = order.groups[0].photos[0];
    order = setCrop(order, id, target.id, cropFor(order.groups[0], target));
    expect(updateGroup(order, id, { logoEnabled: true }).groups[0].photos[0].crop).toBeDefined();
    expect(updateGroup(order, id, { borderMm: 5 }).groups[0].photos[0].crop).toBeUndefined();
    expect(updateGroup(order, id, { format: customFormat(20, 20) }).groups[0].photos[0].crop).toBeUndefined();
  });

  it("sposta e copia tra gruppi senza ritaglio e senza perdere foto", () => {
    let order = addGroup(createOrder(), createGroup());
    const [first, second] = order.groups.map((item) => item.id);
    order = addPhotos(order, first, [source("a")]);
    const photoId = order.groups[0].photos[0].id;
    const copied = transferPhotos(order, first, second, [photoId], "copy");
    expect(copied.groups.map((item) => item.photos.length)).toEqual([1, 1]);
    const moved = transferPhotos(order, first, second, [photoId], "move");
    expect(moved.groups.map((item) => item.photos.length)).toEqual([0, 1]);
    expect(transferPhotos(order, first, "ignoto", [photoId], "move")).toBe(order);
  });

  it("non rimuove l'ultimo gruppo e include i formati istantanei", () => {
    const order = createOrder();
    expect(removeGroup(order, order.groups[0].id)).toBe(order);
    expect(ALL_FORMATS.map((item) => item.id)).toEqual(expect.arrayContaining(["10x15", "instax-mini", "polaroid-go"]));
  });
});

describe("geometria", () => {
  it("il formato segue l'orientamento della foto, anche dopo la rotazione", () => {
    expect(contentSpec(group(), photo())).toMatchObject({ widthCm: 15, heightCm: 10 });
    expect(contentSpec(group(), photo(4000, 6000))).toMatchObject({ widthCm: 10, heightCm: 15 });
    const rotated = rotateCrop(group(), photo());
    expect(rotated.rotation).toBe(90);
    expect(contentSpec(group(), photo(6000, 4000, { crop: rotated }))).toMatchObject({ widthCm: 10, heightCm: 15 });
    // La foto 3:2 ruotata riempie il 2:3 senza ulteriori tagli.
    expect(rotated.cropWidth).toBeCloseTo(1);
    expect(rotated.cropHeight).toBeCloseTo(1);
  });

  it("limita il bordino e lo ignora nei formati con cornice", () => {
    expect(effectiveBorderMm(group({ borderMm: 5 }))).toBe(5);
    expect(effectiveBorderMm(group({ borderMm: 900 }))).toBe(25);
    expect(effectiveBorderMm(group({ borderMm: -3 }))).toBe(0);
    expect(effectiveBorderMm(group({ borderMm: Number.NaN }))).toBe(0);
    const instax = ALL_FORMATS.find((item) => item.id === "instax-mini")!;
    expect(effectiveBorderMm(group({ format: instax, borderMm: 5 }))).toBe(0);
    expect(contentSpec(group({ format: instax }), photo())).toMatchObject({ widthCm: 5.4, heightCm: 8.6 });
  });

  it("zoom e risoluzione effettiva", () => {
    const base = cropFor(group(), photo());
    const zoomed = zoomCrop(base, base, 2);
    expect(zoomed.cropWidth).toBeCloseTo(base.cropWidth / 2);
    expect(effectiveDpi(group(), photo())).toBeGreaterThan(900);
    expect(effectiveDpi(group(), photo(900, 600))).toBeLessThan(200);
  });
});

describe("nomi", () => {
  it("distingue omonimi, copie ed estensioni", () => {
    const files = plannedFiles([
      photo(1, 1, { id: "1", fileName: "IMG.jpg", copies: 2 }),
      photo(1, 1, { id: "2", fileName: "img.png" }),
    ]);
    expect(files.map((item) => item.fileName)).toEqual(["IMG.jpg", "IMG_copia2.jpg", "img-2.jpg"]);
  });

  it("resiste a nomi riservati e lunghissimi", () => {
    expect(sanitizeName("CON.jpg")).toBe("foto");
    expect(sanitizeName("a/b:c?")).toBe("abc");
    const [file] = plannedFiles([photo(1, 1, { fileName: `${"x".repeat(150)}.jpeg` })]);
    expect(file.fileName).toBe(`${"x".repeat(100)}.jpg`);
  });

  it("dà a ogni gruppo una cartella propria", () => {
    expect(folderName(group({ borderMm: 5 }))).toBe("10x15_bordo5mm");
    expect(folderName(group({ fitMode: "contain", format: customFormat(7.5, 10) }))).toBe("7.5x10cm_intera");
    const first = group();
    const second = group();
    expect([...folderNames([first, second]).values()]).toEqual(["10x15", "10x15_2"]);
  });
});

describe("salvataggio", () => {
  it("riapre l'ordine salvato", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
    let order = createOrder();
    order = addPhotos(order, order.groups[0].id, [source("a")]);
    expect(saveOrder(storage, order)).toBe(true);
    expect(loadOrder(storage)?.groups[0].photos[0].sourceKey).toBe("a");
    expect(saveOrder({ ...storage, setItem: () => { throw new Error("quota"); } }, order)).toBe(false);
  });

  it("rifiuta dati rotti senza lanciare errori", () => {
    expect(parseOrder("non è json")).toBeNull();
    const order = createOrder();
    const broken = (format: object) => JSON.stringify({ ...order, groups: [{ ...order.groups[0], format }] });
    expect(parseOrder(broken({ id: "x", widthCm: -1, heightCm: 10 }))).toBeNull();
    expect(parseOrder(broken({ id: "x", widthCm: 5, heightCm: 10, frameStyle: "finta" }))).toBeNull();
  });
});

describe("ordine di un cliente", () => {
  it("dà alla cartella nome e data, e la data non cambia correggendo il nome", () => {
    let order = setCustomer(createOrder(), "  Mario Rossi ", "2026-11-26");
    expect(orderFolderName(order.customer)).toBe("Mario Rossi - 2026-11-26");
    order = setCustomer(order, "Rossi: Mario/Anna?", "2027-01-01");
    expect(orderFolderName(order.customer)).toBe("Rossi MarioAnna - 2026-11-26");
    expect(orderFolderName(setCustomer(order, "   ", "2027-01-01").customer)).toBeNull();
    expect(orderFolderName(setCustomer(createOrder(), "///", "2026-11-26").customer)).toBe("Cliente - 2026-11-26");
    expect(orderFolderName(setCustomer(createOrder(), "x".repeat(300), "2026-11-26").customer)!.length).toBeLessThanOrEqual(120);
  });

  it("si salva e scarta un cliente rotto senza perdere l'ordine", () => {
    const order = setCustomer(createOrder(), "Bianchi", "2026-11-26");
    expect(parseOrder(JSON.stringify(order))?.customer).toEqual({ name: "Bianchi", date: "2026-11-26" });
    const broken = parseOrder(JSON.stringify({ ...order, customer: { name: "X", date: "../.." } }));
    expect(broken).not.toBeNull();
    expect(broken?.customer).toBeUndefined();
  });
});
