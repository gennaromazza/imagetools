import { describe, expect, it } from "vitest";
import { addPhotos, createGroup, createOrder, customFormat, replaceSource, setCrop, type OrderPhoto } from "./model";
import { cropFor } from "./geometry";
import { assessQuality, describePhoto } from "./quality";
import { workingCopyName } from "./naming";

const photo = (width: number, height: number): OrderPhoto => ({ id: "p", sourceKey: "k", fileName: "a.jpg", width, height, copies: 1 });

describe("punteggio di stampa", () => {
  it("dice se la foto viene bene in quel formato", () => {
    const group = createGroup();
    expect(assessQuality(group, photo(6000, 4000))).toMatchObject({ score: 100, level: "ottima", cutPercent: 0 });
    expect(assessQuality(group, photo(1500, 1000))).toMatchObject({ level: "buona" });
    expect(assessQuality(group, photo(1300, 867))).toMatchObject({ level: "accettabile" });
    expect(assessQuality(group, photo(600, 400))).toMatchObject({ level: "scarsa", verdict: "Non viene bene" });
  });

  it("misura quanta foto resta fuori", () => {
    const square = { ...createGroup(customFormat(10, 10)) };
    expect(assessQuality(square, photo(6000, 4000)).cutPercent).toBe(33);
    expect(assessQuality({ ...square, fitMode: "contain" }, photo(6000, 4000)).cutPercent).toBe(0);
  });

  it("descrive l'originale", () => {
    expect(describePhoto({ width: 5152, height: 7728, size: 17_757_184 })).toEqual({
      pixels: "5152 × 7728 pixel",
      megapixels: "39,8 MP",
      largestPrint: "43 × 65 cm",
      fileSize: "16,9 MB",
    });
  });
});

describe("foto ritoccata", () => {
  const loaded = () => {
    let order = createOrder();
    order = addPhotos(order, order.groups[0].id, [{ sourceKey: "vecchia", fileName: "a.jpg", width: 3000, height: 2000 }]);
    const [first] = order.groups[0].photos;
    return setCrop(order, order.groups[0].id, first.id, { ...cropFor(order.groups[0], first), reviewed: true });
  };

  it("tiene il ritaglio se le proporzioni non cambiano, lo rifà dopo un'espansione", () => {
    const order = loaded();
    const same = replaceSource(order, "vecchia", { sourceKey: "nuova", fileName: "a_ritocco.jpg", width: 3000, height: 2000 });
    expect(same.groups[0].photos[0]).toMatchObject({ sourceKey: "nuova", fileName: "a_ritocco.jpg" });
    expect(same.groups[0].photos[0].crop).toBeDefined();
    const expanded = replaceSource(order, "vecchia", { sourceKey: "nuova", fileName: "a.jpg", width: 3600, height: 2000 });
    expect(expanded.groups[0].photos[0]).toMatchObject({ width: 3600, copies: 1 });
    expect(expanded.groups[0].photos[0].crop).toBeUndefined();
    expect(replaceSource(order, "ignota", { sourceKey: "x", fileName: "x.jpg", width: 1, height: 1 })).toBe(order);
  });

  it("chiama la copia di lavoro senza ripetere il suffisso", () => {
    expect(workingCopyName("IMG_1.JPG")).toBe("IMG_1_ritocco.JPG");
    expect(workingCopyName("IMG_1_ritocco.jpg")).toBe("IMG_1_ritocco.jpg");
    expect(workingCopyName("IMG_1.jpg", 2)).toBe("IMG_1_ritocco2.jpg");
  });
});
