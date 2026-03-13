import { useEffect, useMemo, useState } from "react";
import type {
  AutoLayoutResult,
  GeneratedPageLayout,
  ImageAsset,
  LayoutMove,
  LayoutTemplate
} from "@photo-tools/shared-types";
import { ImageSlotPreview } from "./ImageSlotPreview";

interface DragState {
  kind: "asset" | "slot";
  imageId: string;
  sourcePageId?: string;
  sourceSlotId?: string;
}

interface LayoutPreviewBoardProps {
  result: AutoLayoutResult;
  assetsById: Map<string, ImageAsset>;
  selectedPageId: string | null;
  selectedSlotKey: string | null;
  dragState: DragState | null;
  onSelectPage: (pageId: string, slotId?: string) => void;
  onStartSlotDrag: (pageId: string, slotId: string, imageId: string) => void;
  onDragEnd: () => void;
  onDrop: (move: LayoutMove) => void;
  onAssetDropped: (pageId: string, slotId: string, imageId: string) => void;
  onTemplateChange: (pageId: string, templateId: string) => void;
  onRemovePage: (pageId: string) => void;
}

function getTemplateOptions(templates: LayoutTemplate[], photoCount: number): LayoutTemplate[] {
  return templates.filter(
    (template) => photoCount >= template.minPhotos && photoCount <= template.maxPhotos
  );
}

function getSheetAspectRatio(page: GeneratedPageLayout): string {
  return page.sheetSpec.widthCm > page.sheetSpec.heightCm ? "4 / 3" : "3 / 4";
}

function renderTemplateMiniMap(template: LayoutTemplate) {
  return (
    <div className="template-card__map">
      {template.slots.map((slot) => (
        <span
          key={slot.id}
          className="template-card__slot"
          style={{
            left: `${slot.x * 100}%`,
            top: `${slot.y * 100}%`,
            width: `${slot.width * 100}%`,
            height: `${slot.height * 100}%`
          }}
        />
      ))}
    </div>
  );
}

function renderSheetSurface(
  page: GeneratedPageLayout,
  assetsById: Map<string, ImageAsset>,
  selectedSlotKey: string | null,
  dragState: DragState | null,
  onSelectPage: (pageId: string, slotId?: string) => void,
  onStartSlotDrag: (pageId: string, slotId: string, imageId: string) => void,
  onDragEnd: () => void,
  onDrop: (move: LayoutMove) => void,
  onAssetDropped: (pageId: string, slotId: string, imageId: string) => void,
  size: "hero" | "thumb"
) {
  const interactive = size === "hero";

  return (
    <div
      className={size === "hero" ? "sheet-preview sheet-preview--hero" : "sheet-preview sheet-preview--thumb"}
      style={{ aspectRatio: getSheetAspectRatio(page) }}
    >
      {page.slotDefinitions.map((slot) => {
        const assignment = page.assignments.find((item) => item.slotId === slot.id);
        const asset = assignment ? assetsById.get(assignment.imageId) : undefined;
        const isSelected = selectedSlotKey === `${page.id}:${slot.id}`;
        const isDragging =
          dragState?.kind === "slot" &&
          dragState.sourcePageId === page.id &&
          dragState.sourceSlotId === slot.id;

        return (
          <div
            key={slot.id}
            className={
              isSelected
                ? "sheet-slot sheet-slot--selected"
                : isDragging
                  ? "sheet-slot sheet-slot--dragging"
                  : "sheet-slot"
            }
            style={{
              left: `${slot.x * 100}%`,
              top: `${slot.y * 100}%`,
              width: `${slot.width * 100}%`,
              height: `${slot.height * 100}%`
            }}
            onClick={interactive ? () => onSelectPage(page.id, slot.id) : undefined}
            onDragOver={interactive ? (event) => event.preventDefault() : undefined}
            onDrop={
              interactive
                ? () => {
                    if (!dragState) {
                      return;
                    }

                    if (dragState.kind === "slot" && dragState.sourcePageId && dragState.sourceSlotId) {
                      onDrop({
                        sourcePageId: dragState.sourcePageId,
                        sourceSlotId: dragState.sourceSlotId,
                        targetPageId: page.id,
                        targetSlotId: slot.id
                      });
                      return;
                    }

                    onAssetDropped(page.id, slot.id, dragState.imageId);
                  }
                : undefined
            }
          >
            {interactive ? (
              <button
                type="button"
                className="slot-asset"
                draggable={Boolean(assignment)}
                onDragStart={(event) => {
                  if (!assignment) {
                    return;
                  }

                  event.dataTransfer.setData("text/plain", assignment.imageId);
                  onStartSlotDrag(page.id, slot.id, assignment.imageId);
                }}
                onDragEnd={onDragEnd}
              >
                <ImageSlotPreview
                  asset={asset}
                  assignment={assignment}
                  label={assignment ? asset?.fileName ?? assignment.imageId : slot.id}
                />
              </button>
            ) : (
              <div className="slot-asset slot-asset--thumb">
                <ImageSlotPreview
                  asset={asset}
                  assignment={assignment}
                  label={assignment ? asset?.fileName ?? assignment.imageId : slot.id}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function LayoutPreviewBoard({
  result,
  assetsById,
  selectedPageId,
  selectedSlotKey,
  dragState,
  onSelectPage,
  onStartSlotDrag,
  onDragEnd,
  onDrop,
  onAssetDropped,
  onTemplateChange,
  onRemovePage
}: LayoutPreviewBoardProps) {
  const [isTemplateChooserOpen, setIsTemplateChooserOpen] = useState(false);
  const activePage = result.pages.find((page) => page.id === selectedPageId) ?? result.pages[0] ?? null;
  const compatibleTemplates = useMemo(
    () =>
      activePage
        ? getTemplateOptions(result.availableTemplates, Math.max(activePage.imageIds.length, 1))
        : [],
    [activePage, result.availableTemplates]
  );

  useEffect(() => {
    setIsTemplateChooserOpen(false);
  }, [activePage?.id]);

  if (!activePage) {
    return <p className="helper-copy">Non ci sono ancora fogli da mostrare.</p>;
  }

  return (
    <div className="layout-studio">
      <div className="layout-studio__topbar">
        <div>
          <span className="layout-studio__eyebrow">Sala Impaginazione</span>
          <h3>Foglio {activePage.pageNumber} · {activePage.templateLabel}</h3>
          <p>
            {activePage.assignments.length} foto posizionate · formato {activePage.sheetSpec.label} ·
            margine {activePage.sheetSpec.marginCm.toFixed(1)} cm
          </p>
        </div>

        <div className="layout-studio__top-actions">
          <button
            type="button"
            className={isTemplateChooserOpen ? "secondary-button layout-studio__template-button layout-studio__template-button--active" : "secondary-button layout-studio__template-button"}
            onClick={() => setIsTemplateChooserOpen((current) => !current)}
          >
            Template per questo foglio
          </button>
          <button type="button" className="ghost-button" onClick={() => onRemovePage(activePage.id)}>
            Elimina foglio
          </button>
        </div>
      </div>

      {isTemplateChooserOpen ? (
        <div className="template-drawer">
          <div className="template-drawer__header">
            <div>
              <strong>Template compatibili</strong>
              <p>Scegli in un click la struttura migliore per il foglio attivo.</p>
            </div>
            <button type="button" className="ghost-button" onClick={() => setIsTemplateChooserOpen(false)}>
              Chiudi
            </button>
          </div>

          <div className="template-drawer__grid">
            {compatibleTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                className={
                  template.id === activePage.templateId
                    ? "template-card template-card--active"
                    : "template-card"
                }
                onClick={() => {
                  onTemplateChange(activePage.id, template.id);
                  setIsTemplateChooserOpen(false);
                }}
              >
                {renderTemplateMiniMap(template)}
                <strong>{template.label}</strong>
                <span>{template.description}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="layout-studio__stage">
        <div className="layout-studio__rail">
          <button
            type="button"
            className={isTemplateChooserOpen ? "rail-button rail-button--active" : "rail-button"}
            onClick={() => setIsTemplateChooserOpen((current) => !current)}
          >
            <span>T</span>
            <small>Template</small>
          </button>
          <button
            type="button"
            className="rail-button"
            onClick={() => onSelectPage(activePage.id, activePage.slotDefinitions[0]?.id)}
          >
            <span>S</span>
            <small>Slot</small>
          </button>
          <div className="rail-metric">
            <small>Foto</small>
            <strong>{activePage.assignments.length}</strong>
          </div>
          <div className="rail-metric">
            <small>Slot</small>
            <strong>{activePage.slotDefinitions.length}</strong>
          </div>
        </div>

        <div className="layout-studio__canvas">
          {renderSheetSurface(
            activePage,
            assetsById,
            selectedSlotKey,
            dragState,
            onSelectPage,
            onStartSlotDrag,
            onDragEnd,
            onDrop,
            onAssetDropped,
            "hero"
          )}
        </div>

        <div className="layout-studio__rail layout-studio__rail--right">
          <div className="rail-metric">
            <small>Formato</small>
            <strong>{activePage.sheetSpec.label}</strong>
          </div>
          <div className="rail-metric">
            <small>Gap</small>
            <strong>{activePage.sheetSpec.gapCm.toFixed(1)}</strong>
          </div>
          <div className="rail-metric">
            <small>DPI</small>
            <strong>{activePage.sheetSpec.dpi}</strong>
          </div>
          {activePage.warnings.length > 0 ? (
            <div className="rail-warning">
              {activePage.warnings.map((warning) => (
                <span key={warning}>{warning}</span>
              ))}
            </div>
          ) : (
            <div className="rail-warning rail-warning--ok">
              <span>Foglio coerente e pronto alla rifinitura.</span>
            </div>
          )}
        </div>
      </div>

      <div className="layout-strip">
        {result.pages.map((page) => {
          const isActive = page.id === activePage.id;

          return (
            <button
              key={page.id}
              type="button"
              className={isActive ? "layout-strip__item layout-strip__item--active" : "layout-strip__item"}
              onClick={() => onSelectPage(page.id, page.slotDefinitions[0]?.id)}
            >
              <div className="layout-strip__thumb">
                {renderSheetSurface(
                  page,
                  assetsById,
                  selectedSlotKey,
                  null,
                  onSelectPage,
                  onStartSlotDrag,
                  onDragEnd,
                  onDrop,
                  onAssetDropped,
                  "thumb"
                )}
              </div>
              <strong>Foglio {page.pageNumber}</strong>
              <span>{page.templateLabel}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
