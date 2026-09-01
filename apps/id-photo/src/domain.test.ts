import { describe, expect, it } from "vitest";
import { canProduceIdPhotoOutput, DOCUMENT_PROFILES, effectiveCropPixelSize, evaluateTechnicalChecks, safeJobName } from "./domain";
import { deriveIdPhotoJobStatus, parseIdPhotoJob } from "./job-store";

describe("FileX ID Photo domain", () => {
  it("lascia produrre l'output con avvisi qualità ma blocca la risoluzione insufficiente", () => {
    const common = { hasAsset: true, hasCrop: true, pageCount: 1, pendingSourceChange: false };
    expect(canProduceIdPhotoOutput({
      ...common,
      checks: [{ id: "brightness", label: "Luminosità", status: "fail", value: "20", message: "Avviso" }],
    })).toBe(true);
    expect(canProduceIdPhotoOutput({
      ...common,
      checks: [{ id: "resolution", label: "Risoluzione", status: "fail", value: "100×100", message: "Blocco" }],
    })).toBe(false);
  });
  it("mantiene il profilo CIE versionato e con fonte", () => {
    const cie = DOCUMENT_PROFILES.find((profile) => profile.id === "it-cie-35x45-v1");
    expect(cie).toMatchObject({
      widthMm: 35,
      heightMm: 45,
      faceHeightMinPct: 70,
      faceHeightMaxPct: 80,
      eyeLineFromBottomMinMm: 23,
      eyeLineFromBottomMaxMm: 31,
      digitalMinDpi: 400,
      digitalMaxBytes: 500_000,
      digitalFormats: ["jpg"],
      kind: "official",
    });
    expect(cie?.sourceUrl).toMatch(/^https:\/\//);
    expect(cie?.sourceCheckedAt).toBe("2026-08-31");
    expect(cie?.editingPolicy).toBe("technical-only");
  });

  it("mantiene il profilo passaporto collegato alla fonte MAECI canonica", () => {
    const passport = DOCUMENT_PROFILES.find((profile) => profile.id === "it-passport-icao-35x45-v2");
    expect(passport).toMatchObject({
      widthMm: 35,
      heightMm: 45,
      faceHeightMinPct: 70,
      faceHeightMaxPct: 80,
      kind: "official",
      backgroundPolicy: "uniform-required",
    });
    expect(passport?.sourceUrl).toContain("/servizi-opportunita/");
    expect(passport?.sourceCheckedAt).toBe("2026-08-31");
  });

  it("valuta la risoluzione del ritaglio e non dell'intero originale", () => {
    const checks = evaluateTechnicalChecks({
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
    });
    expect(checks.find((check) => check.id === "resolution")?.status).toBe("fail");
    expect(effectiveCropPixelSize(1200, 800, {
      cropLeft: 0,
      cropTop: 0,
      cropWidth: 0.5,
      cropHeight: 1,
      rotation: 90,
    })).toEqual({ width: 800, height: 600 });
  });

  it("blocca lo stato pronto finché controlli e warning non sono confermati", () => {
    expect(deriveIdPhotoJobStatus({
      assetCount: 1,
      hasCrop: true,
      manualReady: true,
      technicalFailures: 0,
      warningsAccepted: false,
      technicalWarnings: 1,
      pageCount: 1,
      hasExport: false,
    })).toBe("to-review");
    expect(deriveIdPhotoJobStatus({
      assetCount: 1,
      hasCrop: true,
      manualReady: true,
      technicalFailures: 0,
      warningsAccepted: true,
      technicalWarnings: 1,
      pageCount: 1,
      hasExport: false,
    })).toBe("laid-out");
  });

  it("rifiuta commesse persistite con schema sconosciuto", () => {
    expect(parseIdPhotoJob({ schemaVersion: 99, id: "x" })).toBeNull();
  });

  it("segnala una sorgente troppo piccola per il profilo CIE", () => {
    const profile = DOCUMENT_PROFILES[0];
    const checks = evaluateTechnicalChecks({
      width: 300,
      height: 400,
      meanLuma: 130,
      contrast: 40,
      sharpness: 150,
      backgroundUniformity: 90,
    }, profile);
    expect(checks.find((check) => check.id === "resolution")?.status).toBe("fail");
  });

  it("non produce nomi file Windows ostili", () => {
    expect(safeJobName("Mario/Rossi", "CIE:* 2026")).toBe("Mario-Rossi-CIE-2026");
    expect(safeJobName("", "")).toBe("filex-id-photo");
  });
});
