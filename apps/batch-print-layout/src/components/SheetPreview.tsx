import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getPreviewRenderDpi } from "../print-engine";
import { renderPageCanvas } from "../render-export";
import type { Workbench } from "../hooks/useWorkbench";

/**
 * Anteprima del foglio. Il canvas è disegnato a una risoluzione limitata
 * (indipendente dai DPI di stampa) e il box CSS mantiene sempre il rapporto
 * reale del foglio, così lo strato cliccabile delle foto combacia.
 */
export function SheetPreview({ wb, interactive, caption }: { wb: Workbench; interactive: boolean; caption?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const renderIdRef = useRef(0);
  const [stage, setStage] = useState({ width: 430, height: 560 });
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  const { pages, currentPage, previewPageIndex, layout, printSpec, assetsById, cropsById, logo, adjustments, finishing, isDraggingCrop, setStatus } = wb;

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const measure = () => {
      const width = Math.max(160, Math.floor(element.clientWidth - 24));
      const height = Math.max(220, Math.floor(Math.min(window.innerHeight * 0.8, element.clientHeight) - 24));
      setStage((current) => (current.width === width && current.height === height ? current : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let frameId = 0;
    let timerId = 0;
    const renderId = renderIdRef.current + 1;
    renderIdRef.current = renderId;

    const draw = async () => {
      const target = canvasRef.current;
      if (!target || !currentPage) {
        setSize(null);
        return;
      }
      try {
        const rendered = await renderPageCanvas(currentPage, {
          assetsById,
          cropsById,
          printSpec,
          layout,
          logo,
          adjustments,
          finishing,
          renderDpi: getPreviewRenderDpi(layout, printSpec.dpi),
        });
        if (cancelled || renderIdRef.current !== renderId) return;
        const ctx = target.getContext("2d");
        if (!ctx) return;
        const scale = Math.min(stage.width / rendered.width, stage.height / rendered.height);
        const cssWidth = Math.max(1, Math.floor(rendered.width * scale));
        const cssHeight = Math.max(1, Math.floor(rendered.height * scale));
        const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
        target.width = Math.min(rendered.width, Math.round(cssWidth * pixelRatio));
        target.height = Math.min(rendered.height, Math.round(cssHeight * pixelRatio));
        setSize({ width: cssWidth, height: cssHeight });
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(rendered, 0, 0, target.width, target.height);
      } catch (error) {
        if (!cancelled && renderIdRef.current === renderId) {
          setStatus(error instanceof Error ? `Anteprima non disponibile: ${error.message}` : "Anteprima non disponibile.");
        }
      }
    };

    const schedule = () => {
      frameId = window.requestAnimationFrame(() => {
        void draw();
      });
    };
    if (isDraggingCrop) timerId = window.setTimeout(schedule, 33);
    else schedule();

    return () => {
      cancelled = true;
      if (frameId) window.cancelAnimationFrame(frameId);
      if (timerId) window.clearTimeout(timerId);
    };
  }, [adjustments, assetsById, cropsById, currentPage, finishing, isDraggingCrop, layout, logo, printSpec, setStatus, stage]);

  const hasSheet = Boolean(currentPage) && wb.ready;

  return (
    <div className="sheet-column">
      <div className="sheet-head">
        <div>
          <strong>Foglio {pages.length ? previewPageIndex + 1 : 0} di {pages.length}</strong>
          <span>
            {wb.ready
              ? `${layout.sheetWidthCm} × ${layout.sheetHeightCm} cm · ${wb.perPage} foto per foglio`
              : "Completa i passi precedenti per vedere il foglio"}
          </span>
        </div>
        <div className="sheet-nav">
          <button type="button" aria-label="Foglio precedente" title="Foglio precedente" onClick={() => wb.setPreviewPageIndex((value) => Math.max(0, value - 1))} disabled={previewPageIndex === 0}>
            <ChevronLeft size={16} />
          </button>
          <button type="button" aria-label="Foglio successivo" title="Foglio successivo" onClick={() => wb.setPreviewPageIndex((value) => Math.min(pages.length - 1, value + 1))} disabled={previewPageIndex >= pages.length - 1}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="sheet-stage" ref={stageRef}>
        {hasSheet && currentPage ? (
          <div
            className="sheet-surface"
            style={{ width: size ? `${size.width}px` : undefined, height: size ? `${size.height}px` : undefined }}
          >
            <canvas ref={canvasRef} />
            <div className={interactive ? "sheet-slot-layer" : "sheet-slot-layer sheet-slot-layer--passive"} aria-label="Foto sul foglio">
              {currentPage.slots.map((slot, index) => {
                const asset = assetsById.get(slot.assetId);
                const isActive = interactive && wb.activeAsset?.id === slot.assetId;
                const style = {
                  left: `${(slot.x / layout.sheetWidthPx) * 100}%`,
                  top: `${(slot.y / layout.sheetHeightPx) * 100}%`,
                  width: `${(slot.width / layout.sheetWidthPx) * 100}%`,
                  height: `${(slot.height / layout.sheetHeightPx) * 100}%`,
                };
                if (!interactive) return <span key={`${slot.assetId}-${index}`} className="sheet-slot sheet-slot--passive" style={style} />;
                return (
                  <button
                    key={`${slot.assetId}-${index}`}
                    type="button"
                    className={isActive ? "sheet-slot sheet-slot--active" : "sheet-slot"}
                    style={style}
                    onClick={() => wb.selectAssetById(slot.assetId)}
                    onPointerDown={(event) => wb.startSheetSlotDrag(event, slot.assetId)}
                    onPointerMove={wb.moveSheetSlotDrag}
                    onPointerUp={wb.stopSheetSlotDrag}
                    onPointerCancel={wb.stopSheetSlotDrag}
                    aria-label={`Modifica ${asset?.relativePath || asset?.fileName || "foto"}`}
                    aria-pressed={isActive}
                    title="Clicca per scegliere, trascina per riposizionare"
                  />
                );
              })}
            </div>
          </div>
        ) : (
          <div className="sheet-placeholder">{wb.assets.length === 0 ? "Scegli prima le foto" : "Anteprima del foglio"}</div>
        )}
      </div>
      {caption ? <p className="sheet-caption">{caption}</p> : null}
    </div>
  );
}
