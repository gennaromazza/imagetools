import { generatePageLayouts } from "@photo-tools/layout-engine";
import type { AutoLayoutRequest, AutoLayoutResult } from "@photo-tools/shared-types";
import { buildAutoLayoutResult } from "./result-state";

export function createAutoLayoutPlan(
  request: AutoLayoutRequest
): AutoLayoutResult {
  const { pages, targetPhotosPerSheet, templates } = generatePageLayouts(request);
  const result = buildAutoLayoutResult(request, pages, templates);

  return {
    ...result,
    summary: {
      ...result.summary,
      targetPhotosPerSheet
    }
  };
}
