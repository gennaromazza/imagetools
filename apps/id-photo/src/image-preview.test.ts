import { describe, expect, it, vi } from "vitest";
import {
  collectDistinctBlobUrls,
  createBrowserAssetPreviewResources,
  fitPreviewWithinBounds,
  revokeBlobUrls,
  withDetailPreview,
} from "./image-preview";

describe("fitPreviewWithinBounds", () => {
  it("riduce il lato lungo senza ingrandire la sorgente", () => {
    expect(fitPreviewWithinBounds(6000, 4000, 192)).toEqual({ width: 192, height: 128 });
    expect(fitPreviewWithinBounds(100, 80, 192)).toEqual({ width: 100, height: 80 });
  });

  it("rifiuta dimensioni non utilizzabili", () => {
    expect(() => fitPreviewWithinBounds(0, 100, 192)).toThrow(/non valide/i);
    expect(() => fitPreviewWithinBounds(100, 100, Number.NaN)).toThrow(/non valide/i);
  });
});

describe("gestione URL delle anteprime browser", () => {
  it("crea il clone per il dettaglio senza sostituire la sorgente originale usata dall'export", () => {
    const base = {
      id: "asset-1",
      sourceUrl: "blob:original-full-resolution",
      previewUrl: "blob:rail-thumbnail",
      width: 6000,
      height: 4000,
    };
    const detail = withDetailPreview(base, { url: "blob:selected-detail", width: 1600, height: 1067 });

    expect(detail).toMatchObject({
      sourceUrl: "blob:selected-detail",
      previewUrl: "blob:selected-detail",
      width: 1600,
      height: 1067,
    });
    expect(base.sourceUrl).toBe("blob:original-full-resolution");
    expect(base.previewUrl).toBe("blob:rail-thumbnail");
  });

  it("deduplica e revoca sorgente e thumbnail una sola volta", () => {
    const revoke = vi.fn();
    expect(collectDistinctBlobUrls("blob:source", "blob:thumb", "blob:source", "https://example.test/a.jpg"))
      .toEqual(["blob:source", "blob:thumb"]);

    revokeBlobUrls(["blob:source", "blob:thumb", "blob:source"], revoke);
    expect(revoke.mock.calls).toEqual([["blob:source"], ["blob:thumb"]]);
  });

  it("continua a revocare gli URL successivi se una revoca fallisce", () => {
    const revoked: string[] = [];
    revokeBlobUrls(["blob:first", "blob:second"], (url) => {
      revoked.push(url);
      if (url === "blob:first") throw new Error("already released");
    });
    expect(revoked).toEqual(["blob:first", "blob:second"]);
  });

  it("revoca la sorgente se la decodifica della thumbnail fallisce", async () => {
    const revokeObjectURL = vi.fn();
    await expect(createBrowserAssetPreviewResources({} as Blob, 192, {
      urlApi: {
        createObjectURL: vi.fn(() => "blob:source"),
        revokeObjectURL,
      },
      renderPreview: vi.fn(async () => { throw new Error("decode failed"); }),
    })).rejects.toThrow("decode failed");

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:source");
  });

  it("revoca la sorgente se non riesce a creare l'URL della thumbnail", async () => {
    const revokeObjectURL = vi.fn();
    let objectUrlCall = 0;
    await expect(createBrowserAssetPreviewResources({} as Blob, 192, {
      urlApi: {
        createObjectURL: vi.fn(() => {
          objectUrlCall += 1;
          if (objectUrlCall === 1) return "blob:source";
          throw new Error("URL unavailable");
        }),
        revokeObjectURL,
      },
      renderPreview: vi.fn(async () => ({
        blob: {} as Blob,
        width: 192,
        height: 128,
        sourceWidth: 6000,
        sourceHeight: 4000,
      })),
    })).rejects.toThrow("URL unavailable");

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:source");
  });
});
