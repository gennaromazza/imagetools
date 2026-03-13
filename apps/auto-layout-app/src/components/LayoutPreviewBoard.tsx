import type {
  AutoLayoutResult,
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
  return (
    <div className="layout-board">
      {result.pages.map((page) => (
        <article
          key={page.id}
          className={selectedPageId === page.id ? "layout-card layout-card--active" : "layout-card"}
        >
          <header className="layout-card__header">
            <div>
              <strong>Foglio {page.pageNumber}</strong>
              <span>{page.templateLabel}</span>
            </div>

            <div className="layout-card__actions">
              <select
                value={page.templateId}
                onChange={(event) => onTemplateChange(page.id, event.target.value)}
              >
                {getTemplateOptions(result.availableTemplates, Math.max(page.imageIds.length, 1)).map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.label}
                  </option>
                ))}
              </select>
              <button type="button" className="ghost-button" onClick={() => onRemovePage(page.id)}>
                Elimina foglio
              </button>
            </div>
          </header>

          <div
            className="sheet-preview"
            style={{
              aspectRatio:
                page.sheetSpec.widthCm > page.sheetSpec.heightCm ? "4 / 3" : "3 / 4"
            }}
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
                  onClick={() => onSelectPage(page.id, slot.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
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
                  }}
                >
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
                </div>
              );
            })}
          </div>

          {page.warnings.length > 0 ? (
            <div className="message-box message-box--warning">
              {page.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}
