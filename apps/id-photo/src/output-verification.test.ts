import { describe, expect, it, vi } from "vitest";
import {
  createPersistedExportVerifier,
  outputFilePath,
  promotePendingIdPhotoExport,
  verifyPersistedExport,
} from "./output-verification";
import type { PersistedIdPhotoExport, PersistedIdPhotoPendingExport } from "./job-store";

const fingerprint = {
  name: "foglio.pdf",
  absolutePath: "C:\\Output\\foglio.pdf",
  size: 1234,
  lastModified: 5678,
  sha256: "a".repeat(64),
};

function makeExport(overrides: Partial<PersistedIdPhotoExport> = {}): PersistedIdPhotoExport {
  return {
    completedAt: "2026-08-31T12:00:00.000Z",
    contextFingerprint: "context",
    format: "pdf",
    files: ["foglio.pdf"],
    verifiedFiles: [fingerprint],
    outputDirectoryPath: "C:\\Output",
    sheetId: "10x15",
    copies: 8,
    ...overrides,
  };
}

function makePendingExport(
  overrides: Partial<PersistedIdPhotoPendingExport> = {},
): PersistedIdPhotoPendingExport {
  const { verifiedFiles: _verifiedFiles, ...pending } = makeExport();
  return {
    ...pending,
    atomicTransactionId: null,
    expectedFiles: [{ fileName: fingerprint.name, size: fingerprint.size, sha256: fingerprint.sha256 }],
    outputDirectoryPath: "C:\\Output",
    ...overrides,
  };
}

describe("verifica output persistito", () => {
  it("riconosce lo stesso file tramite percorso, metadati e SHA-256", async () => {
    const reader = vi.fn(async () => [{ ...fingerprint, absolutePath: "c:\\output\\FOGLIO.pdf" }]);
    await expect(verifyPersistedExport(makeExport(), reader)).resolves.toBe("valid");
    expect(reader).toHaveBeenCalledWith(["C:\\Output\\foglio.pdf"]);
  });

  it("invalida un file sostituito anche a parità di nome e dimensione", async () => {
    const reader = async () => [{ ...fingerprint, sha256: "b".repeat(64) }];
    await expect(verifyPersistedExport(makeExport(), reader)).resolves.toBe("invalid");
  });

  it("invalida output mancanti o privi di fingerprint", async () => {
    await expect(verifyPersistedExport(makeExport(), async () => [])).resolves.toBe("invalid");
    await expect(verifyPersistedExport(makeExport({ verifiedFiles: [] }), async () => [fingerprint])).resolves.toBe("invalid");
  });

  it("distingue un errore temporaneo del reader da un file alterato", async () => {
    await expect(verifyPersistedExport(makeExport(), async () => { throw new Error("share non disponibile"); })).resolves.toBe("unavailable");
    await expect(verifyPersistedExport(makeExport(), undefined)).resolves.toBe("unavailable");
  });

  it("ritenta dopo un errore transitorio senza perdere il record", async () => {
    const reader = vi.fn()
      .mockRejectedValueOnce(new Error("volume temporaneamente offline"))
      .mockResolvedValueOnce([fingerprint]);
    const verifier = createPersistedExportVerifier(reader, { timeoutMs: 500 });

    await expect(verifier(makeExport())).resolves.toBe("unavailable");
    await expect(verifier(makeExport())).resolves.toBe("valid");
    expect(reader).toHaveBeenCalledTimes(2);
  });

  it("applica un timeout e mantiene una sola lettura in corso", async () => {
    vi.useFakeTimers();
    try {
      let finishRead: ((value: typeof fingerprint[]) => void) | undefined;
      const reader = vi.fn(() => new Promise<typeof fingerprint[]>((resolve) => { finishRead = resolve; }));
      const verifier = createPersistedExportVerifier(reader, { timeoutMs: 100 });

      const first = verifier(makeExport());
      const second = verifier(makeExport());
      await vi.advanceTimersByTimeAsync(100);
      await expect(first).resolves.toBe("unavailable");
      await expect(second).resolves.toBe("unavailable");
      expect(reader).toHaveBeenCalledTimes(1);

      finishRead?.([fingerprint]);
      await vi.runAllTicks();
    } finally {
      vi.useRealTimers();
    }
  });

  it("libera il single-flight dopo il timeout anche se l'IPC non termina", async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<typeof fingerprint[]>(() => undefined);
      const reader = vi.fn()
        .mockReturnValueOnce(never)
        .mockResolvedValueOnce([fingerprint]);
      const verifier = createPersistedExportVerifier(reader, { timeoutMs: 100 });

      const first = verifier(makeExport());
      await vi.advanceTimersByTimeAsync(100);
      await expect(first).resolves.toBe("unavailable");

      await expect(verifier(makeExport({ completedAt: "2026-08-31T12:01:00.000Z" }))).resolves.toBe("valid");
      expect(reader).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("conserva il pending dopo timeout e ritenta gli stessi file senza riesportare", async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<typeof fingerprint[]>(() => undefined);
      const reader = vi.fn()
        .mockReturnValueOnce(never)
        .mockResolvedValueOnce([fingerprint]);
      const verifier = createPersistedExportVerifier(reader, { timeoutMs: 100 });

      const firstExport = verifier.verifyPendingOutput(makePendingExport());
      await vi.advanceTimersByTimeAsync(100);
      await expect(firstExport).resolves.toEqual({ status: "unavailable" });
      await expect(verifier.verifyPendingOutput(makePendingExport())).resolves.toEqual({
        status: "valid",
        exportRecord: makeExport(),
      });
      expect(reader).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("promuove un pending solo quando tutti i percorsi pubblicati hanno una fingerprint", async () => {
    expect(promotePendingIdPhotoExport(makePendingExport(), [fingerprint])).toEqual(makeExport());
    expect(promotePendingIdPhotoExport(makePendingExport(), [])).toBeNull();
    expect(promotePendingIdPhotoExport(makePendingExport(), [{
      ...fingerprint,
      absolutePath: "C:\\Output\\altro.pdf",
    }])).toBeNull();
    expect(promotePendingIdPhotoExport(makePendingExport(), [{ ...fingerprint, sha256: "non-valido" }])).toBeNull();
    const verifier = createPersistedExportVerifier(async () => [fingerprint]);
    await expect(verifier.verifyPendingOutput(makePendingExport())).resolves.toEqual({
      status: "valid",
      exportRecord: makeExport(),
    });
  });

  it("rifiuta un file sostituito dopo il commit anche se percorso e dimensione coincidono", async () => {
    const replaced = { ...fingerprint, sha256: "b".repeat(64) };
    expect(promotePendingIdPhotoExport(makePendingExport(), [replaced])).toBeNull();

    const verifier = createPersistedExportVerifier(async () => [replaced]);
    await expect(verifier.verifyPendingOutput(makePendingExport())).resolves.toEqual({ status: "invalid" });
  });

  it("serializza monitor periodico e verifica post-export", async () => {
    let releaseMonitor: ((value: typeof fingerprint[]) => void) | undefined;
    let concurrentReads = 0;
    let maxConcurrentReads = 0;
    const reader = vi.fn(async () => {
      concurrentReads += 1;
      maxConcurrentReads = Math.max(maxConcurrentReads, concurrentReads);
      try {
        if (reader.mock.calls.length === 1) {
          return await new Promise<typeof fingerprint[]>((resolve) => { releaseMonitor = resolve; });
        }
        return [fingerprint];
      } finally {
        concurrentReads -= 1;
      }
    });
    const verifier = createPersistedExportVerifier(reader, { timeoutMs: 500 });

    const monitor = verifier(makeExport());
    const postExport = verifier.verifyPendingOutput(makePendingExport());
    await Promise.resolve();
    expect(reader).toHaveBeenCalledTimes(1);
    releaseMonitor?.([fingerprint]);

    await expect(monitor).resolves.toBe("valid");
    await expect(postExport).resolves.toEqual({ status: "valid", exportRecord: makeExport() });
    expect(reader).toHaveBeenCalledTimes(2);
    expect(maxConcurrentReads).toBe(1);
  });

  it("compone percorsi Windows e POSIX senza doppio separatore", () => {
    expect(outputFilePath("C:\\Output\\", "foglio.pdf")).toBe("C:\\Output\\foglio.pdf");
    expect(outputFilePath("/tmp/output/", "foglio.pdf")).toBe("/tmp/output/foglio.pdf");
  });
});
