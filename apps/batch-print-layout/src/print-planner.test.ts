import { describe, expect, it } from "vitest";
import { photoFitsSheet } from "./print-engine";
import {
  adviseOrientation,
  DEFAULT_PAPER_CHOICE,
  evaluateFormats,
  evaluatePapers,
  getAllPapers,
  getAvailablePapers,
  getThumbnailSlots,
  isGoalValid,
  recommendPaperId,
  resolvePaperOption,
  resolvePhotoSpec,
  shrinkGoalToSheet,
  suggestBorderless,
  toSheetSpec,
  type PrintGoal,
} from "./print-planner";

const OPTIONS = { dpi: 300, printCount: 10 };

describe("print planner", () => {
  it("validates goals before they reach the layout engine", () => {
    expect(isGoalValid({ kind: "count", count: 4, aspectId: "free" })).toBe(true);
    expect(isGoalValid({ kind: "count", count: 0, aspectId: "free" })).toBe(false);
    expect(isGoalValid({ kind: "count", count: 2.5, aspectId: "free" })).toBe(false);
    expect(isGoalValid({ kind: "format", presetId: "inesistente" })).toBe(false);
    expect(isGoalValid({ kind: "custom", widthCm: 0, heightCm: 5 })).toBe(false);
    expect(isGoalValid({ kind: "custom", widthCm: 6, heightCm: 7 })).toBe(true);
  });

  it("evaluates every paper for a photo format and flags the ones that do not fit", () => {
    const goal: PrintGoal = { kind: "format", presetId: "polaroid-integral" };
    const evaluations = evaluatePapers(goal, DEFAULT_PAPER_CHOICE, OPTIONS);
    const byId = new Map(evaluations.map((evaluation) => [evaluation.paper.id, evaluation]));
    // 8,85 × 10,75 cm non entra in 10×15 con margini? Entra: 1 foto. Ma non in nessun modo in meno.
    expect(byId.get("10x15")?.fits).toBe(true);
    expect(byId.get("10x15")?.perPage).toBe(1);
    expect(byId.get("a4")?.perPage).toBeGreaterThan(byId.get("10x15")!.perPage);
    for (const evaluation of evaluations.filter((item) => item.fits)) {
      expect(evaluation.sheetsNeeded).toBe(Math.ceil(OPTIONS.printCount / evaluation.perPage));
      expect(evaluation.coverage).toBeGreaterThan(0);
      expect(evaluation.coverage).toBeLessThanOrEqual(1);
    }
  });

  it("recommends exactly one paper and never one that does not fit", () => {
    for (const presetId of ["polaroid-go", "polaroid-integral", "instax-mini", "instax-wide"]) {
      const evaluations = evaluatePapers({ kind: "format", presetId }, DEFAULT_PAPER_CHOICE, OPTIONS);
      const recommended = evaluations.filter((evaluation) => evaluation.recommended);
      expect(recommended).toHaveLength(1);
      expect(recommended[0].fits).toBe(true);
    }
  });

  it("offers the original media as a one-per-sheet paper for Hi-Print formats only", () => {
    const hiPrint: PrintGoal = { kind: "format", presetId: "polaroid-hi-print-4x6" };
    expect(getAvailablePapers(hiPrint)[0].kind).toBe("media");
    expect(getAvailablePapers({ kind: "format", presetId: "polaroid-go" }).every((paper) => paper.kind === "preset")).toBe(true);

    const evaluations = evaluatePapers(hiPrint, DEFAULT_PAPER_CHOICE, OPTIONS);
    const media = evaluations.find((evaluation) => evaluation.paper.kind === "media")!;
    expect(media.fits).toBe(true);
    expect(media.perPage).toBe(1);
    expect(media.sheet.marginMm).toBe(0);
    expect(media.recommended).toBe(true);
  });

  it("sizes photos for the requested count on every standard paper", () => {
    const goal: PrintGoal = { kind: "count", count: 4, aspectId: "free" };
    const evaluations = evaluatePapers(goal, DEFAULT_PAPER_CHOICE, { dpi: 300, printCount: 9 });
    for (const evaluation of evaluations) {
      expect(evaluation.fits).toBe(true);
      expect(evaluation.perPage).toBe(4);
      expect(evaluation.sheetsNeeded).toBe(3);
      expect(photoFitsSheet(evaluation.photo!, evaluation.sheet)).toBe(true);
    }
    expect(evaluations.find((evaluation) => evaluation.recommended)?.paper.id).toBe("a4");
  });

  it("marks papers too small for a custom size and keeps the larger ones", () => {
    const goal: PrintGoal = { kind: "custom", widthCm: 16, heightCm: 12 };
    const byId = new Map(evaluatePapers(goal, DEFAULT_PAPER_CHOICE, OPTIONS).map((evaluation) => [evaluation.paper.id, evaluation]));
    expect(byId.get("10x15")?.fits).toBe(false);
    expect(byId.get("13x18")?.fits).toBe(true);
    expect(byId.get("a3")?.fits).toBe(true);
  });

  it("respects the chosen orientation and margin overrides", () => {
    const goal: PrintGoal = { kind: "custom", widthCm: 6, heightCm: 4 };
    const paper = resolvePaperOption(goal, { ...DEFAULT_PAPER_CHOICE, paperId: "a4" }, "a4");
    const landscape = toSheetSpec(paper, { ...DEFAULT_PAPER_CHOICE, orientation: "landscape", marginMm: 12, gapMm: 0 });
    expect(landscape.marginMm).toBe(12);
    expect(landscape.gapMm).toBe(0);
    expect(landscape.orientation).toBe("landscape");
    const resolved = resolvePhotoSpec(goal, landscape, 300);
    expect(resolved.fits).toBe(true);
  });

  it("advises the orientation that holds more photos", () => {
    const goal: PrintGoal = { kind: "custom", widthCm: 9, heightCm: 5.5 };
    const paper = resolvePaperOption(goal, { ...DEFAULT_PAPER_CHOICE, paperId: "10x15" }, "10x15");
    const advice = adviseOrientation(goal, paper, DEFAULT_PAPER_CHOICE, 300)!;
    expect(advice.portraitCount).toBeGreaterThan(0);
    expect(advice.landscapeCount).toBeGreaterThan(0);
    expect(["portrait", "landscape", "equal"]).toContain(advice.best);
  });

  it("builds normalized thumbnail slots inside the sheet", () => {
    const goal: PrintGoal = { kind: "count", count: 5, aspectId: "free" };
    const evaluation = evaluatePapers(goal, { ...DEFAULT_PAPER_CHOICE, orientation: "portrait" }, OPTIONS)
      .find((item) => item.paper.id === "a4")!;
    const slots = getThumbnailSlots(evaluation.layout!, evaluation.perPage);
    expect(slots).toHaveLength(5);
    for (const slot of slots) {
      expect(slot.x).toBeGreaterThanOrEqual(0);
      expect(slot.y).toBeGreaterThanOrEqual(0);
      expect(slot.x + slot.w).toBeLessThanOrEqual(1.0001);
      expect(slot.y + slot.h).toBeLessThanOrEqual(1.0001);
    }
  });

  it("shrinks a custom goal proportionally until it fits the sheet", () => {
    const sheet = toSheetSpec(resolvePaperOption({ kind: "custom", widthCm: 1, heightCm: 1 }, { ...DEFAULT_PAPER_CHOICE, paperId: "10x15" }, "10x15"), DEFAULT_PAPER_CHOICE);
    const shrunk = shrinkGoalToSheet({ kind: "custom", widthCm: 20, heightCm: 12 }, sheet);
    expect(shrunk.kind).toBe("custom");
    if (shrunk.kind === "custom") {
      expect(photoFitsSheet({ widthCm: shrunk.widthCm, heightCm: shrunk.heightCm, dpi: 300 }, sheet)).toBe(true);
      expect(shrunk.widthCm / shrunk.heightCm).toBeCloseTo(20 / 12, 1);
    }
  });

  it("falls back to A4 when nothing fits", () => {
    const goal: PrintGoal = { kind: "custom", widthCm: 100, heightCm: 100 };
    const evaluations = evaluatePapers(goal, DEFAULT_PAPER_CHOICE, OPTIONS);
    expect(evaluations.every((evaluation) => !evaluation.fits)).toBe(true);
    expect(recommendPaperId(goal, evaluations)).toBe("a4");
  });

  it("recommends the paper that consumes the least surface, never Letter or a huge sheet by default", () => {
    const goal: PrintGoal = { kind: "format", presetId: "polaroid-go" };
    const one = evaluatePapers(goal, DEFAULT_PAPER_CHOICE, { dpi: 300, printCount: 1 });
    expect(one.find((evaluation) => evaluation.recommended)?.paper.id).toBe("10x15");

    const seven = evaluatePapers(goal, DEFAULT_PAPER_CHOICE, { dpi: 300, printCount: 7 });
    const recommended = seven.find((evaluation) => evaluation.recommended)!;
    expect(["a3", "20x30", "letter"]).not.toContain(recommended.paper.id);
    const consumed = (evaluation: (typeof seven)[number]) => evaluation.sheetsNeeded * evaluation.paper.widthCm * evaluation.paper.heightCm;
    const cheapest = Math.min(...seven.filter((evaluation) => evaluation.fits && evaluation.paper.id !== "letter").map(consumed));
    expect(consumed(recommended)).toBeLessThanOrEqual(cheapest * 1.08);
  });

  it("lists every format with how many fit on the paper chosen first", () => {
    const a4 = resolvePaperOption({ kind: "count", count: 1, aspectId: "free" }, { ...DEFAULT_PAPER_CHOICE, paperId: "a4" }, "a4");
    const formats = evaluateFormats(a4, DEFAULT_PAPER_CHOICE, OPTIONS);
    expect(formats.length).toBeGreaterThan(5);
    expect(formats.every((item) => item.evaluation.fits && item.evaluation.perPage >= 1)).toBe(true);
    const small = resolvePaperOption({ kind: "count", count: 1, aspectId: "free" }, { ...DEFAULT_PAPER_CHOICE, paperId: "10x15" }, "a4");
    const onSmall = new Map(evaluateFormats(small, DEFAULT_PAPER_CHOICE, OPTIONS).map((item) => [item.preset.presetId, item.evaluation]));
    expect(onSmall.get("polaroid-go")!.perPage).toBeGreaterThan(onSmall.get("polaroid-integral")!.perPage);
  });

  it("offers Hi-Print supports as papers of their own, one photo per sheet", () => {
    const media = getAllPapers().filter((paper) => paper.kind === "media");
    expect(media.length).toBe(3);
    const paper = resolvePaperOption({ kind: "count", count: 1, aspectId: "free" }, { ...DEFAULT_PAPER_CHOICE, paperId: media[0].id }, "a4");
    expect(paper.kind).toBe("media");
    expect(toSheetSpec(paper, DEFAULT_PAPER_CHOICE).marginMm).toBe(0);
  });

  it("suggests borderless printing when two 10x15 almost fit a 15x20", () => {
    const goal: PrintGoal = { kind: "custom", widthCm: 10, heightCm: 15 };
    const paper = resolvePaperOption(goal, { ...DEFAULT_PAPER_CHOICE, paperId: "15x20" }, "a4");
    const suggestion = suggestBorderless(goal, paper, DEFAULT_PAPER_CHOICE, 300);
    expect(suggestion).toEqual({ currentPerPage: 1, borderlessPerPage: 2 });
    const borderless = { ...DEFAULT_PAPER_CHOICE, marginMm: 0, gapMm: 0 };
    expect(suggestBorderless(goal, paper, borderless, 300)).toBeNull();
    const evaluation = evaluatePapers(goal, borderless, OPTIONS).find((item) => item.paper.id === "15x20")!;
    expect(evaluation.perPage).toBe(2);
    expect(suggestBorderless({ kind: "count", count: 2, aspectId: "free" }, paper, DEFAULT_PAPER_CHOICE, 300)).toBeNull();
  });

  it("avoids thin strips for free proportions", () => {
    const a4 = resolvePaperOption({ kind: "count", count: 1, aspectId: "free" }, { ...DEFAULT_PAPER_CHOICE, paperId: "a4" }, "a4");
    const sheet = toSheetSpec(a4, DEFAULT_PAPER_CHOICE);
    for (const count of [2, 3, 4, 5, 6, 8, 9, 12]) {
      const result = resolvePhotoSpec({ kind: "count", count, aspectId: "free" }, sheet, 300);
      expect(result.fits).toBe(true);
      const { widthCm, heightCm } = result.spec!;
      expect(Math.max(widthCm, heightCm) / Math.min(widthCm, heightCm)).toBeLessThanOrEqual(2.001);
    }
    const three = resolvePhotoSpec({ kind: "count", count: 3, aspectId: "free" }, sheet, 300).spec!;
    expect(three.widthCm * three.heightCm).toBeGreaterThan(100);
  });
});
