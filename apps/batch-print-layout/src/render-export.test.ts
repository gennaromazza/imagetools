import { describe, expect, it, vi } from "vitest";
import type { BatchCropState, BatchPrintPage, PhotoAsset } from "./print-engine";
import {
  fingerprintPreparedOutput,
  mapCommittedOutputMetadata,
  resolvePageAssetsForExport,
  runDesktopAtomicWriteTransaction,
} from "./render-export";

function makeCopy(id: string, overrides: Partial<PhotoAsset> = {}): PhotoAsset {
  return {
    id,
    fileName: "photo.jpg",
    relativePath: "cliente/photo.jpg",
    absolutePath: "C:\\Foto\\photo.jpg",
    size: 2_000_000,
    lastModified: 1_788_000_000_000,
    sourceUrl: "blob:photo-preview",
    previewUrl: "blob:photo-preview",
    width: 2400,
    height: 3200,
    ...overrides,
  };
}

function makeCrop(assetId: string, overrides: Partial<BatchCropState> = {}): BatchCropState {
  return {
    assetId,
    cropLeft: 0.1,
    cropTop: 0.1,
    cropWidth: 0.8,
    cropHeight: 0.8,
    rotation: 0,
    reviewed: true,
    ...overrides,
  };
}

describe("fingerprintPreparedOutput", () => {
  it("ancora nome, dimensione e SHA-256 ai byte preparati prima del commit", async () => {
    await expect(fingerprintPreparedOutput(
      "Fototessera.pdf",
      new TextEncoder().encode("abc"),
    )).resolves.toEqual({
      fileName: "Fototessera.pdf",
      size: 3,
      sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });
  });

  it("lega per ordine le impronte pre-commit ai nomi finali con suffisso", () => {
    expect(mapCommittedOutputMetadata([
      { fileName: "foglio-001.jpg", size: 101, sha256: "a".repeat(64) },
      { fileName: "foglio-002.jpg", size: 202, sha256: "b".repeat(64) },
    ], ["foglio-001-2.jpg", "foglio-002-2.jpg"])).toEqual([
      { fileName: "foglio-001-2.jpg", size: 101, sha256: "a".repeat(64) },
      { fileName: "foglio-002-2.jpg", size: 202, sha256: "b".repeat(64) },
    ]);
  });

  it("rifiuta metadati incompleti prima che possano rappresentare un batch", () => {
    expect(() => mapCommittedOutputMetadata(
      [{ fileName: "foglio-001.jpg", size: 101, sha256: "a".repeat(64) }],
      ["foglio-001.jpg", "foglio-002.jpg"],
    )).toThrow(/impronte.*incomplete/i);
  });
});

function makePage(assetIds: string[]): BatchPrintPage {
  return {
    pageNumber: 1,
    slots: assetIds.map((assetId, index) => ({
      assetId,
      x: index * 10,
      y: 0,
      width: 10,
      height: 10,
      rotation: 0,
    })),
  };
}

describe("resolvePageAssetsForExport", () => {
  it("risolve una sola volta photo-copy-1…N quando sorgente, versione e crop coincidono", async () => {
    const copies = Array.from({ length: 8 }, (_, index) => makeCopy(`photo-copy-${index + 1}`));
    const assetsById = new Map(copies.map((asset) => [asset.id, asset]));
    const cropsById = new Map(copies.map((asset) => [asset.id, makeCrop(asset.id)]));
    const release = vi.fn();
    const resolver = vi.fn(async (asset: PhotoAsset) => ({
      asset: { ...asset, sourceUrl: "blob:resolved", previewUrl: "blob:resolved" },
      release,
    }));

    const resolved = await resolvePageAssetsForExport(
      makePage(copies.map((asset) => asset.id)),
      assetsById,
      cropsById,
      3200,
      resolver,
    );

    expect(resolver).toHaveBeenCalledTimes(1);
    for (const copy of copies) {
      expect(resolved.assetsById.get(copy.id)).toMatchObject({
        id: copy.id,
        absolutePath: copy.absolutePath,
        sourceUrl: "blob:resolved",
      });
    }
    resolved.release();
    resolved.release();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("non unisce asset con sorgente, versione o trasformazione diverse", async () => {
    const assets = [
      makeCopy("source-a"),
      makeCopy("source-b", { absolutePath: "C:\\Foto\\altra.jpg" }),
      makeCopy("version-b", { lastModified: 1_788_000_000_001 }),
      makeCopy("crop-b"),
    ];
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    const cropsById = new Map(assets.map((asset) => [
      asset.id,
      makeCrop(asset.id, asset.id === "crop-b" ? { cropWidth: 0.7 } : {}),
    ]));
    const resolver = vi.fn(async (asset: PhotoAsset) => ({
      asset: { ...asset, sourceUrl: `blob:resolved-${asset.id}` },
    }));

    const resolved = await resolvePageAssetsForExport(
      makePage(assets.map((asset) => asset.id)),
      assetsById,
      cropsById,
      3200,
      resolver,
    );

    expect(resolver).toHaveBeenCalledTimes(4);
    expect(new Set(assets.map((asset) => resolved.assetsById.get(asset.id)?.sourceUrl)).size).toBe(4);
  });
});

describe("runDesktopAtomicWriteTransaction", () => {
  it("staggia un file per volta, valida e solo dopo esegue il commit", async () => {
    const events: string[] = [];
    const api = {
      beginAtomicWriteTransaction: vi.fn(async () => {
        events.push("begin");
        return "transaction-one";
      }),
      stageAtomicWriteTransactionFile: vi.fn(async (_transactionId: string, file: { fileName: string }) => {
        events.push(`stage:${file.fileName}`);
      }),
      commitAtomicWriteTransaction: vi.fn(async () => {
        events.push("commit");
        return ["pagina-001.jpg", "pagina-002.jpg", "pagina-003.jpg"];
      }),
      finalizeAtomicWriteTransaction: vi.fn(async () => {
        events.push("finalize");
        return true;
      }),
      rollbackAtomicWriteTransaction: vi.fn(async () => true),
    };

    const result = await runDesktopAtomicWriteTransaction(
      api,
      "C:\\Output",
      async (stageFile) => {
        for (let index = 1; index <= 3; index += 1) {
          const fileName = `pagina-${String(index).padStart(3, "0")}.jpg`;
          events.push(`render:${fileName}`);
          await stageFile({ fileName, bytes: new Uint8Array([index]) });
        }
      },
      async () => {
        events.push("validate");
      },
      async () => {
        events.push("persist-pending");
      },
    );

    expect(result).toEqual(["pagina-001.jpg", "pagina-002.jpg", "pagina-003.jpg"]);
    expect(events).toEqual([
      "begin",
      "render:pagina-001.jpg",
      "stage:pagina-001.jpg",
      "render:pagina-002.jpg",
      "stage:pagina-002.jpg",
      "render:pagina-003.jpg",
      "stage:pagina-003.jpg",
      "validate",
      "commit",
      "persist-pending",
      "finalize",
    ]);
    expect(api.rollbackAtomicWriteTransaction).not.toHaveBeenCalled();
  });

  it("annulla lo staging quando produzione o validazione falliscono", async () => {
    const api = {
      beginAtomicWriteTransaction: vi.fn(async () => "transaction-two"),
      stageAtomicWriteTransactionFile: vi.fn(async () => undefined),
      commitAtomicWriteTransaction: vi.fn(async () => ["mai.jpg"]),
      finalizeAtomicWriteTransaction: vi.fn(async () => true),
      rollbackAtomicWriteTransaction: vi.fn(async () => true),
    };

    await expect(runDesktopAtomicWriteTransaction(
      api,
      "C:\\Output",
      async (stageFile) => {
        await stageFile({ fileName: "pagina.jpg", bytes: new Uint8Array([1]) });
      },
      async () => {
        throw new Error("sorgente modificata");
      },
    )).rejects.toThrow("sorgente modificata");

    expect(api.commitAtomicWriteTransaction).not.toHaveBeenCalled();
    expect(api.rollbackAtomicWriteTransaction).toHaveBeenCalledExactlyOnceWith("transaction-two");
  });

  it("non nasconde un rollback incompleto", async () => {
    const api = {
      beginAtomicWriteTransaction: vi.fn(async () => "transaction-three"),
      stageAtomicWriteTransactionFile: vi.fn(async () => undefined),
      commitAtomicWriteTransaction: vi.fn(async () => {
        throw new Error("commit fallito");
      }),
      finalizeAtomicWriteTransaction: vi.fn(async () => true),
      rollbackAtomicWriteTransaction: vi.fn(async () => {
        throw new Error("residuo non eliminabile");
      }),
    };

    await expect(runDesktopAtomicWriteTransaction(
      api,
      "C:\\Output",
      async (stageFile) => {
        await stageFile({ fileName: "pagina.jpg", bytes: new Uint8Array([1]) });
      },
    )).rejects.toMatchObject({
      name: "AggregateError",
      message: "Export fallito e rollback dei file incompleto.",
    });
  });

  it("esegue rollback se il pending non può essere persistito prima del finalize", async () => {
    const api = {
      beginAtomicWriteTransaction: vi.fn(async () => "transaction-four"),
      stageAtomicWriteTransactionFile: vi.fn(async () => undefined),
      commitAtomicWriteTransaction: vi.fn(async () => ["pagina.jpg"]),
      finalizeAtomicWriteTransaction: vi.fn(async () => true),
      rollbackAtomicWriteTransaction: vi.fn(async () => true),
    };

    await expect(runDesktopAtomicWriteTransaction(
      api,
      "C:\\Output",
      async (stageFile) => {
        await stageFile({ fileName: "pagina.jpg", bytes: new Uint8Array([1]) });
      },
      undefined,
      async () => {
        throw new Error("pending non persistito");
      },
    )).rejects.toThrow("pending non persistito");

    expect(api.finalizeAtomicWriteTransaction).not.toHaveBeenCalled();
    expect(api.rollbackAtomicWriteTransaction).toHaveBeenCalledExactlyOnceWith("transaction-four");
  });
});
