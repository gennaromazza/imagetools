import { describe, expect, it } from "vitest";
import { buildRehydrationCandidates } from "./asset-rehydration";
import type { PersistedIdPhotoAsset } from "./job-store";

function makeAsset(overrides: Partial<PersistedIdPhotoAsset> = {}): PersistedIdPhotoAsset {
  return {
    id: "asset-1",
    fileName: "original.jpg",
    absolutePath: "C:\\foto\\original.jpg",
    originalAbsolutePath: "C:\\foto\\original.jpg",
    workingCopyPath: "C:\\FileX\\working.png",
    width: 1200,
    height: 1600,
    revisions: [],
    ...overrides,
  };
}

describe("buildRehydrationCandidates", () => {
  it("prova prima la copia corrente, poi gli snapshot dal più recente e infine l'originale", () => {
    const asset = makeAsset({
      revisions: [
        { kind: "original", absolutePath: "C:\\foto\\original.jpg", createdAt: "2026-01-01T00:00:00.000Z" },
        { kind: "photoshop", absolutePath: "C:\\FileX\\revision-old.png", createdAt: "2026-01-02T00:00:00.000Z" },
        { kind: "photoshop", absolutePath: "C:\\FileX\\revision-new.png", createdAt: "2026-01-03T00:00:00.000Z" },
      ],
    });

    expect(buildRehydrationCandidates(asset)).toEqual([
      "C:\\FileX\\working.png",
      "C:\\FileX\\revision-new.png",
      "C:\\FileX\\revision-old.png",
      "C:\\foto\\original.jpg",
    ]);
  });

  it("rimuove i duplicati Windows senza cambiare la priorità", () => {
    const asset = makeAsset({
      revisions: [{ kind: "photoshop", absolutePath: "c:\\filex\\WORKING.png", createdAt: "2026-01-03T00:00:00.000Z" }],
    });

    expect(buildRehydrationCandidates(asset)).toEqual([
      "C:\\FileX\\working.png",
      "C:\\foto\\original.jpg",
    ]);
  });
});
