import { describe, expect, it } from "vitest";
import { createIdPhotoOrderId, createIdPhotoOutputPlan, selectDroppedIdPhotoFile } from "./id-photo-workflow";

describe("flusso output ID Photo", () => {
  it("prepara sempre foto singola JPG e foglio nel formato scelto", () => {
    expect(createIdPhotoOutputPlan("Mario Rossi / Passaporto", "pdf")).toEqual({
      safeJobName: "Mario Rossi - Passaporto",
      layoutPrefix: "Mario Rossi - Passaporto-foglio",
      singlePhotoFileName: "Mario Rossi - Passaporto-foto-singola.jpg",
      layoutDescription: "foglio PDF + foto singola JPG",
    });
    expect(createIdPhotoOutputPlan("CIE", "jpg").layoutDescription).toBe("foglio JPG + foto singola JPG");
  });

  it("genera un ID ordine sicuro come nome cartella", () => {
    const id = createIdPhotoOrderId(new Date(2026, 8, 30, 9, 5, 7));
    expect(id).toBe("ID-20260930-090507");
    expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u);
  });

  it("accetta una sola immagine da drag and drop anche quando il MIME manca", () => {
    const text = new File(["x"], "note.txt", { type: "text/plain" });
    const photo = new File(["x"], "ritratto.HEIC", { type: "" });
    expect(selectDroppedIdPhotoFile([text, photo])).toBe(photo);
    expect(selectDroppedIdPhotoFile([text])).toBeNull();
  });
});
