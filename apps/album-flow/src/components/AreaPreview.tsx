import { memo, useMemo } from "react";
import type { AlbumArea, AlbumAssetV2, AlbumSpread, LayoutNode, SheetSpec } from "@photo-tools/shared-types";
import { insetRect, layoutCells, areaOuterRects } from "../engine/geometry";
import { useAssetSrc } from "../hooks/useAssetSrc";
import { placeItem } from "../model/placement";
import { areaGeometryFor, replaceArea } from "../model/project";
import { PhotoBox } from "./PhotoBox";

function PreviewCell({ asset, placement, mono, borderColor, origin, style }: { asset: AlbumAssetV2 | undefined; placement: ReturnType<typeof placeItem>; mono: boolean; borderColor: string; origin: { x: number; y: number; w: number; h: number }; style?: React.CSSProperties }) {
  const src = useAssetSrc(asset, 360);
  return <PhotoBox origin={origin} placement={placement} src={src} rotation={asset?.rotationDegrees} mono={mono} borderColor={borderColor} style={style} />;
}

/**
 * Anteprima di un'area con un layout alternativo, con le foto vere (usata dal browser dei layout).
 * Si passa un albero oppure un'intera area (per i template liberi, con foto sovrapposte e ruotate).
 */
export const AreaPreview = memo(function AreaPreview({ sheet, spread, areaIndex, tree, area: override, assets }: { sheet: SheetSpec; spread: AlbumSpread; areaIndex: number; tree?: LayoutNode; area?: AlbumArea; assets: ReadonlyMap<string, AlbumAssetV2> }) {
  const area = override ?? spread.areas[areaIndex];
  const outer = areaOuterRects(sheet, spread.split)[areaIndex];
  const cells = useMemo(() => {
    if (override) return areaGeometryFor(sheet, replaceArea(spread, areaIndex, override), areaIndex).cells;
    const inner = insetRect(outer, area.style.paddingCm * 10);
    return layoutCells(tree ?? area.layout, inner, area.style.gapCm * 10).cells;
  }, [override, tree, sheet, spread, areaIndex, outer, area.layout, area.style.paddingCm, area.style.gapCm]);
  const ordered = useMemo(() => (cells.some((cell) => cell.z !== undefined) ? [...cells].sort((a, b) => (a.z ?? 0) - (b.z ?? 0)) : cells), [cells]);
  return (
    <div className="area-preview" style={{ aspectRatio: `${outer.w} / ${outer.h}`, background: area.style.background }}>
      {ordered.map((cell) => {
        const item = area.items.find((candidate) => candidate.id === cell.itemId);
        if (!item) return null;
        const asset = assets.get(item.assetId);
        const placement = placeItem(cell.rect, { zoom: 1, cx: 0.5, cy: 0.5 }, asset, area.style, null, cell.anchor);
        return <PreviewCell key={cell.itemId} asset={asset} placement={placement} mono={area.style.mono} borderColor={area.style.borderColor} origin={outer} style={cell.rotation ? { transform: `rotate(${cell.rotation}deg)` } : undefined} />;
      })}
    </div>
  );
});
