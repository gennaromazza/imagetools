import type { GridLayout } from "../print-engine";
import { getThumbnailSlots } from "../print-planner";

/** Miniatura vettoriale di un foglio con le foto disposte, per confrontare le carte a colpo d'occhio. */
export function SheetThumb({ layout, perPage }: { layout: GridLayout; perPage: number }) {
  const longEdge = Math.max(layout.sheetWidthCm, layout.sheetHeightCm, 1);
  const width = (layout.sheetWidthCm / longEdge) * 100;
  const height = (layout.sheetHeightCm / longEdge) * 100;
  const slots = getThumbnailSlots(layout, perPage);
  return (
    <svg className="sheet-thumb" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${perPage} foto su un foglio ${layout.sheetWidthCm} per ${layout.sheetHeightCm} centimetri`}>
      <rect x={0.5} y={0.5} width={width - 1} height={height - 1} rx={2} className="sheet-thumb__paper" />
      {slots.map((slot, index) => (
        <rect
          key={index}
          x={slot.x * width}
          y={slot.y * height}
          width={Math.max(0.5, slot.w * width)}
          height={Math.max(0.5, slot.h * height)}
          rx={0.8}
          className="sheet-thumb__photo"
        />
      ))}
    </svg>
  );
}
