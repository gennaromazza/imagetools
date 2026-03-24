import type { GeneratedPageLayout, LayoutSlot } from "@photo-tools/shared-types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function getEffectiveSlotAspectRatio(
  slot: LayoutSlot,
  sheetSpec?: GeneratedPageLayout["sheetSpec"],
  slotCount = 1
): number {
  if (!sheetSpec) {
    return slot.width / Math.max(slot.height, 0.001);
  }

  const sheetWidth = Math.max(sheetSpec.widthCm, 0.1);
  const sheetHeight = Math.max(sheetSpec.heightCm, 0.1);
  let width = slot.width * sheetWidth;
  let height = slot.height * sheetHeight;

  if (slotCount > 1 && sheetSpec.gapCm > 0) {
    const insetX = Math.min(sheetSpec.gapCm / 2, width / 3);
    const insetY = Math.min(sheetSpec.gapCm / 2, height / 3);
    width = Math.max(0.001, width - insetX * 2);
    height = Math.max(0.001, height - insetY * 2);
  }

  return clamp(width / Math.max(height, 0.001), 0.001, 1000);
}
