import { describe, expect, it } from "vitest";
import type { BatchCropState } from "@photo-tools/batch-print-layout/print-engine";
import { displayedCropPosition, moveCropInDisplayedAxes } from "./crop-position";

const baseCrop: BatchCropState = {
  assetId: "asset",
  cropLeft: 0.1,
  cropTop: 0.2,
  cropWidth: 0.4,
  cropHeight: 0.2,
  rotation: 0,
  reviewed: false,
};

describe("assi crop ruotati", () => {
  it("espone la posizione sugli assi realmente visibili", () => {
    const positions = [0, 90, 180, 270].map((rotation) => displayedCropPosition({ ...baseCrop, rotation }));
    expect(positions[0].horizontal).toBeCloseTo(0.3);
    expect(positions[0].vertical).toBeCloseTo(0.3);
    expect(positions[1].horizontal).toBeCloseTo(0.7);
    expect(positions[1].vertical).toBeCloseTo(0.3);
    expect(positions[2].horizontal).toBeCloseTo(0.7);
    expect(positions[2].vertical).toBeCloseTo(0.7);
    expect(positions[3].horizontal).toBeCloseTo(0.3);
    expect(positions[3].vertical).toBeCloseTo(0.7);
  });

  it("muove orizzontale e verticale negli assi corretti a 90 gradi", () => {
    const rotated = { ...baseCrop, rotation: 90 };
    const horizontal = moveCropInDisplayedAxes(rotated, "horizontal", 0.8);
    const vertical = moveCropInDisplayedAxes(rotated, "vertical", 0.6);
    expect(horizontal.cropLeft).toBeCloseTo(0.1);
    expect(horizontal.cropTop).toBeCloseTo(0.1);
    expect(vertical.cropLeft).toBeCloseTo(0.4);
    expect(vertical.cropTop).toBeCloseTo(0.2);
  });

  it("rispetta i bordi del crop dopo l'inversione a 180 gradi", () => {
    const moved = moveCropInDisplayedAxes({ ...baseCrop, rotation: 180 }, "horizontal", 0);
    expect(moved.cropLeft).toBeCloseTo(0.6);
    expect(moved.cropTop).toBeCloseTo(0.2);
  });
});
