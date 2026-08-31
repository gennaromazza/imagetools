import { describe, expect, it } from "vitest";
import {
  DOCUMENT_PROFILES,
  effectiveCropPixelSize,
  evaluateTechnicalChecks,
  safeJobName,
} from "./domain";
import {
  createIdPhotoJobId,
  deleteIdPhotoJob,
  deriveIdPhotoJobStatus,
  ID_PHOTO_ACTIVE_JOB_STORAGE_KEY,
  ID_PHOTO_JOBS_STORAGE_KEY,
  ID_PHOTO_MAX_ASSETS_PER_JOB,
  ID_PHOTO_MAX_REGISTRY_CHARACTERS,
  ID_PHOTO_MAX_STORED_JOBS,
  IdPhotoStorageError,
  jobDisplayName,
  loadActiveIdPhotoJob,
  loadIdPhotoJobs,
  parseIdPhotoJob,
  pendingIdPhotoExportMatchesContext,
  recordPendingIdPhotoExport,
  saveIdPhotoJob,
  selectLastExportForSnapshot,
  type PersistedIdPhotoJob,
} from "./job-store";

class FakeStorage {
  private readonly values = new Map<string, string>();
  private failure: Error | null = null;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failure) throw this.failure;
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  failWritesWith(error: Error): void {
    this.failure = error;
  }
}

function makeJob(overrides: Partial<PersistedIdPhotoJob> = {}): PersistedIdPhotoJob {
  return {
    schemaVersion: 1,
    id: "idp-test-1",
    createdAt: "2026-08-31T10:00:00.000Z",
    updatedAt: "2026-08-31T10:00:00.000Z",
    customer: "Mario Rossi",
    jobName: "CIE",
    profileId: "it-cie-35x45-v1",
    folderPath: "C:\\Foto",
    selectedAssetId: "asset-1",
    assets: [{
      id: "asset-1",
      fileName: "ritratto.jpg",
      absolutePath: "C:\\Foto\\ritratto.jpg",
      originalAbsolutePath: "C:\\Foto\\ritratto.jpg",
      width: 2400,
      height: 3200,
      size: 2_000_000,
      lastModified: 1_788_000_000_000,
      revisions: [{
        kind: "original",
        absolutePath: "C:\\Foto\\ritratto.jpg",
        createdAt: "2026-08-31T10:00:00.000Z",
      }],
    }],
    crops: {
      "asset-1": {
        assetId: "asset-1",
        cropLeft: 0.1,
        cropTop: 0.1,
        cropWidth: 0.8,
        cropHeight: 0.8,
        rotation: 0,
        reviewed: true,
      },
    },
    manualChecks: { face: true, expression: true, accessories: true },
    technicalWarningsAccepted: true,
    sheetId: "10x15",
    copies: 8,
    format: "pdf",
    cutGuides: true,
    outputDirectoryPath: "C:\\Output",
    lastExport: null,
    pendingExport: null,
    status: "laid-out",
    ...overrides,
  };
}

describe("FileX ID Photo — profili e geometria pura", () => {
  it("mantiene identificatori univoci e metadati verificabili per i profili ufficiali", () => {
    expect(new Set(DOCUMENT_PROFILES.map((profile) => profile.id)).size).toBe(DOCUMENT_PROFILES.length);
    for (const profile of DOCUMENT_PROFILES) {
      expect(profile.widthMm).toBeGreaterThan(0);
      expect(profile.heightMm).toBeGreaterThan(0);
      expect(Date.parse(profile.sourceCheckedAt)).not.toBeNaN();
      expect(Date.parse(profile.nextReviewAt)).toBeGreaterThan(Date.parse(profile.sourceCheckedAt));
      if (profile.kind === "official") {
        expect(profile.sourceUrl).toMatch(/^https:\/\//);
        expect(profile.editingPolicy).not.toBe("studio-controlled");
      }
    }
  });

  it("calcola il ritaglio utile sugli assi finali per tutte le rotazioni ortogonali", () => {
    const crop = { cropLeft: 0.1, cropTop: 0.25, cropWidth: 0.5, cropHeight: 0.5 };
    expect(effectiveCropPixelSize(1200, 800, { ...crop, rotation: 0 })).toEqual({ width: 600, height: 400 });
    expect(effectiveCropPixelSize(1200, 800, { ...crop, rotation: 90 })).toEqual({ width: 400, height: 600 });
    expect(effectiveCropPixelSize(1200, 800, { ...crop, rotation: 180 })).toEqual({ width: 600, height: 400 });
    expect(effectiveCropPixelSize(1200, 800, { ...crop, rotation: -90 })).toEqual({ width: 400, height: 600 });
    expect(effectiveCropPixelSize(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({ width: 0, height: 0 });
  });

  it("non approva come sufficiente un crop che scende sotto i pixel del profilo", () => {
    const resolution = evaluateTechnicalChecks({
      width: 2000,
      height: 2000,
      meanLuma: 130,
      contrast: 40,
      sharpness: 150,
      backgroundUniformity: 90,
    }, DOCUMENT_PROFILES[0], {
      cropLeft: 0.4,
      cropTop: 0.4,
      cropWidth: 0.2,
      cropHeight: 0.2,
      rotation: 0,
    }).find((check) => check.id === "resolution");

    expect(resolution).toMatchObject({ status: "fail", value: "400×400 px utili" });
  });

  it("produce nomi portabili anche con caratteri ostili e device name Windows", () => {
    expect(safeJobName("Mario/Rossi", "CIE:* 2026")).toBe("Mario-Rossi-CIE-2026");
    expect(safeJobName("CON", "")).toBe("filex-CON");
    expect(safeJobName("con.txt", "")).toBe("filex-con.txt");
    expect(safeJobName("", "")).toBe("filex-id-photo");
    expect(safeJobName("à".repeat(100), "")).toHaveLength(64);
  });
});

describe("FileX ID Photo — stato commessa", () => {
  const readyForReview = {
    assetCount: 1,
    hasCrop: true,
    manualReady: true,
    technicalFailures: 0,
    warningsAccepted: true,
    technicalWarnings: 0,
    pageCount: 0,
    hasExport: false,
  };

  it("copre l'intera progressione senza saltare la revisione", () => {
    expect(deriveIdPhotoJobStatus({ ...readyForReview, assetCount: 0 })).toBe("draft");
    expect(deriveIdPhotoJobStatus({ ...readyForReview, hasCrop: false })).toBe("preparing");
    expect(deriveIdPhotoJobStatus({ ...readyForReview, manualReady: false })).toBe("to-review");
    expect(deriveIdPhotoJobStatus({ ...readyForReview, technicalFailures: 1 })).toBe("to-review");
    expect(deriveIdPhotoJobStatus({ ...readyForReview, technicalWarnings: 1, warningsAccepted: false })).toBe("to-review");
    expect(deriveIdPhotoJobStatus(readyForReview)).toBe("approved");
    expect(deriveIdPhotoJobStatus({ ...readyForReview, pageCount: 1 })).toBe("laid-out");
    expect(deriveIdPhotoJobStatus({ ...readyForReview, hasExport: true })).toBe("ready");
  });

  it("crea ID riconoscibili e nomi commessa leggibili", () => {
    expect(createIdPhotoJobId(new Date("2026-08-31T12:34:56.000Z"))).toMatch(/^idp-20260831123456-[a-z0-9-]{8}$/i);
    expect(jobDisplayName(makeJob())).toBe("Mario Rossi · CIE");
    expect(jobDisplayName({ customer: "  ", jobName: "  " })).toBe("Commessa senza nome");
  });

  it("preserva l'output verificato se la commessa viene chiusa mentre l'analisi riparte", () => {
    const verifiedExport = {
      completedAt: "2026-08-31T12:00:00.000Z",
      contextFingerprint: "context-verificato",
      format: "pdf" as const,
      files: ["Fototessera.pdf"],
      verifiedFiles: [{
        absolutePath: "C:\\Output\\Fototessera.pdf",
        size: 123,
        lastModified: 456,
        sha256: "a".repeat(64),
      }],
      outputDirectoryPath: "C:\\Output",
      sheetId: "10x15",
      copies: 8,
    };

    expect(selectLastExportForSnapshot({
      lastExport: verifiedExport,
      contextualLastExport: null,
      assetCount: 1,
      technicalCheckCount: 0,
    })).toBe(verifiedExport);
    expect(selectLastExportForSnapshot({
      lastExport: verifiedExport,
      contextualLastExport: null,
      assetCount: 1,
      technicalCheckCount: 4,
    })).toBeNull();
  });
});

describe("FileX ID Photo — parsing e persistenza", () => {
  it("limita in modo deterministico le foto persistite per singola commessa", () => {
    const baseAsset = makeJob().assets[0]!;
    const assets = Array.from({ length: ID_PHOTO_MAX_ASSETS_PER_JOB + 25 }, (_, index) => ({
      ...baseAsset,
      id: `asset-${index}`,
      fileName: `ritratto-${index}.jpg`,
    }));
    expect(parseIdPhotoJob({ ...makeJob(), assets })?.assets).toHaveLength(ID_PHOTO_MAX_ASSETS_PER_JOB);
  });

  it("rifiuta schemi incompleti o futuri", () => {
    expect(parseIdPhotoJob(null)).toBeNull();
    expect(parseIdPhotoJob({ schemaVersion: 99, id: "future" })).toBeNull();
    expect(parseIdPhotoJob({ schemaVersion: 1, id: "missing-dates" })).toBeNull();
  });

  it("normalizza numeri, formato, controlli e crop provenienti dallo storage", () => {
    const parsed = parseIdPhotoJob({
      ...makeJob(),
      copies: Number.NaN,
      format: "exe",
      manualChecks: { face: true, expression: "yes", accessories: 1 },
      crops: {
        "asset-1": {
          assetId: "asset-sbagliato",
          cropLeft: -1,
          cropTop: 0.95,
          cropWidth: 2,
          cropHeight: 0.5,
          rotation: -90,
          reviewed: "yes",
        },
        valid: {
          cropLeft: 0.1,
          cropTop: 0.2,
          cropWidth: 0.5,
          cropHeight: 0.6,
          rotation: -90,
          reviewed: true,
        },
        broken: { cropLeft: 0, cropTop: 0, cropWidth: Number.NaN, cropHeight: 1 },
      },
      lastExport: {
        completedAt: "2026-08-31T12:00:00.000Z",
        contextFingerprint: "fingerprint-test",
        format: "jpg",
        files: ["foglio.jpg", 42, null],
        verifiedFiles: [
          {
            absolutePath: "C:\\Output\\foglio.jpg",
            size: 1234,
            lastModified: 4567,
            sha256: "a".repeat(64),
          },
          { absolutePath: 42, size: "bad", lastModified: null, sha256: "no" },
        ],
        outputDirectoryPath: 42,
        sheetId: 42,
        copies: Number.POSITIVE_INFINITY,
      },
      status: "unknown",
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.copies).toBe(1);
    expect(parsed?.format).toBe("pdf");
    expect(parsed?.manualChecks).toEqual({ face: true, expression: false, accessories: false });
    expect(parsed?.status).toBe("draft");
    expect(parsed?.lastExport).toEqual({
      completedAt: "2026-08-31T12:00:00.000Z",
      contextFingerprint: "fingerprint-test",
      format: "jpg",
      files: ["foglio.jpg"],
      verifiedFiles: [{
        absolutePath: "C:\\Output\\foglio.jpg",
        size: 1234,
        lastModified: 4567,
        sha256: "a".repeat(64),
      }],
      outputDirectoryPath: null,
      sheetId: "10x15",
      copies: 1,
    });
    expect(parsed?.crops).toEqual({
      valid: {
        assetId: "valid",
        cropLeft: 0.1,
        cropTop: 0.2,
        cropWidth: 0.5,
        cropHeight: 0.6,
        rotation: 270,
        reviewed: true,
      },
    });
  });

  it("salva, ordina, aggiorna e riapre la commessa attiva senza duplicati", () => {
    const storage = new FakeStorage();
    const older = makeJob({ id: "older", updatedAt: "2026-08-30T10:00:00.000Z" });
    const newer = makeJob({ id: "newer", updatedAt: "2026-08-31T10:00:00.000Z" });
    saveIdPhotoJob(storage, newer);
    saveIdPhotoJob(storage, older);

    expect(loadIdPhotoJobs(storage).map((job) => job.id)).toEqual(["newer", "older"]);
    expect(loadActiveIdPhotoJob(storage)?.id).toBe("older");

    saveIdPhotoJob(storage, { ...older, customer: "Cliente aggiornato", updatedAt: "2026-09-01T10:00:00.000Z" });
    expect(loadIdPhotoJobs(storage).map((job) => job.id)).toEqual(["older", "newer"]);
    expect(loadIdPhotoJobs(storage).filter((job) => job.id === "older")).toHaveLength(1);
    expect(loadActiveIdPhotoJob(storage)?.customer).toBe("Cliente aggiornato");
  });

  it("persiste un output pubblicato in attesa di SHA senza marcarlo come verificato", () => {
    const storage = new FakeStorage();
    const pendingExport = {
      completedAt: "2026-08-31T12:00:00.000Z",
      contextFingerprint: "context-pending",
      atomicTransactionId: "a".repeat(32),
      format: "pdf" as const,
      files: ["Fototessera.pdf"],
      expectedFiles: [{
        fileName: "Fototessera.pdf",
        size: 123,
        sha256: "a".repeat(64),
      }],
      outputDirectoryPath: "C:\\Output",
      sheetId: "10x15",
      copies: 8,
    };
    const previouslyReady = makeJob({
      status: "ready",
      lastExport: {
        ...pendingExport,
        verifiedFiles: [{
          absolutePath: "C:\\Output\\Fototessera.pdf",
          size: 123,
          lastModified: 456,
          sha256: "a".repeat(64),
        }],
      },
    });
    const snapshotWrittenBeforeSha = recordPendingIdPhotoExport(
      previouslyReady,
      pendingExport,
      "2026-08-31T12:00:01.000Z",
    );
    saveIdPhotoJob(storage, snapshotWrittenBeforeSha);

    const restored = loadActiveIdPhotoJob(storage);
    expect(restored?.pendingExport).toEqual(pendingExport);
    expect(restored?.lastExport).toBeNull();
    expect(restored?.status).not.toBe("ready");
    expect(restored?.updatedAt).toBe("2026-08-31T12:00:01.000Z");
    expect(pendingIdPhotoExportMatchesContext(pendingExport, {
      contextFingerprint: "context-pending",
      format: "pdf",
      outputDirectoryPath: "C:\\Output",
      sheetId: "10x15",
      copies: 8,
    })).toBe(true);
    expect(pendingIdPhotoExportMatchesContext(pendingExport, {
      contextFingerprint: "context-modificato",
      format: "pdf",
      outputDirectoryPath: "C:\\Output",
      sheetId: "10x15",
      copies: 8,
    })).toBe(false);
  });

  it("scarta record pending incompleti o con nomi file non sicuri", () => {
    expect(parseIdPhotoJob({
      ...makeJob(),
      pendingExport: {
        completedAt: "2026-08-31T12:00:00.000Z",
        contextFingerprint: "context-pending",
        atomicTransactionId: null,
        format: "pdf",
        files: ["..\\altro.pdf"],
        expectedFiles: [{ fileName: "..\\altro.pdf", size: 123, sha256: "a".repeat(64) }],
        outputDirectoryPath: "C:\\Output",
        sheetId: "10x15",
        copies: 8,
      },
    })?.pendingExport).toBeNull();
  });

  it("elimina il riferimento attivo e recupera in sicurezza storage corrotto", () => {
    const storage = new FakeStorage();
    saveIdPhotoJob(storage, makeJob());
    expect(deleteIdPhotoJob(storage, "idp-test-1")).toEqual([]);
    expect(storage.getItem(ID_PHOTO_ACTIVE_JOB_STORAGE_KEY)).toBeNull();

    storage.setItem(ID_PHOTO_JOBS_STORAGE_KEY, "{json interrotto");
    expect(loadIdPhotoJobs(storage)).toEqual([]);
    expect(loadActiveIdPhotoJob(storage)).toBeNull();
  });

  it("preserva tutte le commesse valide e le ordina per ultimo aggiornamento", () => {
    const storage = new FakeStorage();
    const jobs = Array.from({ length: 55 }, (_, index) => makeJob({
      id: `job-${index}`,
      updatedAt: new Date(Date.UTC(2026, 7, 1, 0, index)).toISOString(),
    }));
    storage.setItem(ID_PHOTO_JOBS_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, jobs }));

    const loaded = loadIdPhotoJobs(storage);
    expect(loaded).toHaveLength(55);
    expect(loaded[0].id).toBe("job-54");
    expect(loaded.at(-1)?.id).toBe("job-0");
  });

  it("non espelle né cancella silenziosamente una vecchia commessa", () => {
    const storage = new FakeStorage();
    for (let index = 0; index < 50; index += 1) {
      saveIdPhotoJob(storage, makeJob({
        id: `retention-${index}`,
        updatedAt: new Date(Date.UTC(2026, 7, 1, 0, index)).toISOString(),
      }));
    }

    const jobs = saveIdPhotoJob(storage, makeJob({
      id: "retention-new",
      updatedAt: "2026-08-31T12:00:00.000Z",
    }));

    expect(jobs).toHaveLength(51);
    expect(jobs.some((job) => job.id === "retention-0")).toBe(true);
    expect(jobs[0].id).toBe("retention-new");
  });

  it("blocca esplicitamente una nuova commessa quando il registro ha raggiunto il limite", () => {
    const storage = new FakeStorage();
    for (let index = 0; index < ID_PHOTO_MAX_STORED_JOBS; index += 1) {
      saveIdPhotoJob(storage, makeJob({
        id: `bounded-${index}`,
        updatedAt: new Date(Date.UTC(2026, 7, 1, 0, index)).toISOString(),
      }));
    }

    expect(() => saveIdPhotoJob(storage, makeJob({ id: "bounded-overflow" })))
      .toThrowError(IdPhotoStorageError);
    expect(loadIdPhotoJobs(storage)).toHaveLength(ID_PHOTO_MAX_STORED_JOBS);
    expect(loadIdPhotoJobs(storage).some((job) => job.id === "bounded-0")).toBe(true);
  });

  it("rifiuta prima della scrittura un registro troppo grande senza eliminare dati esistenti", () => {
    const storage = new FakeStorage();
    saveIdPhotoJob(storage, makeJob({ id: "preserved" }));

    expect(() => saveIdPhotoJob(storage, makeJob({
      id: "oversized",
      folderPath: `C:\\${"x".repeat(ID_PHOTO_MAX_REGISTRY_CHARACTERS)}`,
    }))).toThrowError(/archivio locale di ID Photo è pieno/i);
    expect(loadIdPhotoJobs(storage).map((job) => job.id)).toEqual(["preserved"]);
  });

  it("trasforma un errore quota del browser in un errore di salvataggio esplicito", () => {
    const storage = new FakeStorage();
    storage.failWritesWith(new DOMException("Quota superata", "QuotaExceededError"));

    expect(() => saveIdPhotoJob(storage, makeJob())).toThrowError(
      /finestra resterà segnalata come non salvata/i,
    );
  });
});
