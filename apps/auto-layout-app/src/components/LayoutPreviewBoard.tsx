import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type {
  AutoLayoutResult,
  GeneratedPageLayout,
  ImageAsset,
  LayoutMove,
  LayoutTemplate
} from "@photo-tools/shared-types";
import { ImageSlotPreview } from "./ImageSlotPreview";
import { PhotoReplaceModal } from "./PhotoReplaceModal";

type AssetFilter = "all" | "unused" | "used";
type PageSectionFilter = "all" | "opening" | "middle" | "finale";

interface DragState {
  kind: "asset" | "slot";
  imageId: string;
  sourcePageId?: string;
  sourceSlotId?: string;
}

interface AssetUsage {
  pageId: string;
  pageNumber: number;
  slotId: string;
}

interface ReplaceTarget {
  pageId: string;
  pageNumber: number;
  slotId: string;
  currentImageId?: string;
}

interface LayoutPreviewBoardProps {
  result: AutoLayoutResult;
  assets: ImageAsset[];
  availableAssetsForPicker: ImageAsset[];
  activeAssetIds: string[];
  assetsById: Map<string, ImageAsset>;
  usageByAssetId: Map<string, AssetUsage>;
  selectedPageId: string | null;
  selectedSlotKey: string | null;
  dragState: DragState | null;
  onSelectPage: (pageId: string, slotId?: string) => void;
  onStartSlotDrag: (pageId: string, slotId: string, imageId: string) => void;
  onDragAssetStart: (imageId: string) => void;
  onDragEnd: () => void;
  onDrop: (move: LayoutMove) => void;
  onAssetDropped: (pageId: string, slotId: string, imageId: string) => void;
  onDropToUnused: () => void;
  onClearSlot: (pageId: string, slotId: string) => void;
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
  onClearSlot: (pageId: string, slotId: string) => void,
  onOpenPicker: (pageId: string, pageNumber: number, slotId: string, currentImageId?: string) => void,
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
            className={[
              "sheet-slot",
              isSelected ? "sheet-slot--selected" : "",
              isDragging ? "sheet-slot--dragging" : "",
              assignment ? "" : "sheet-slot--empty"
            ]
              .filter(Boolean)
              .join(" ")}
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
              <>
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
                <button
                  type="button"
                  className="slot-action slot-action--replace"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenPicker(page.id, page.pageNumber, slot.id, assignment?.imageId);
                  }}
                  aria-label={
                    assignment
                      ? `Sostituisci foto nello slot ${slot.id}`
                      : `Scegli una foto per lo slot ${slot.id}`
                  }
                >
                  Foto
                </button>
                {assignment ? (
                  <button
                    type="button"
                    className="slot-action slot-action--remove"
                    onClick={(event) => {
                      event.stopPropagation();
                      onClearSlot(page.id, slot.id);
                    }}
                    aria-label={`Rimuovi foto dallo slot ${slot.id}`}
                  >
                    x
                  </button>
                ) : null}
              </>
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

function renderEmptySheetPlaceholder(label: string) {
  return (
    <div className="sheet-preview sheet-preview--hero sheet-preview--placeholder">
      <div className="sheet-preview__placeholder-copy">
        <strong>{label}</strong>
        <span>Seleziona un altro foglio oppure crea nuove pagine dalle foto non usate.</span>
      </div>
    </div>
  );
}

export function LayoutPreviewBoard({
  result,
  assets,
  availableAssetsForPicker,
  activeAssetIds,
  assetsById,
  usageByAssetId,
  selectedPageId,
  selectedSlotKey,
  dragState,
  onSelectPage,
  onStartSlotDrag,
  onDragAssetStart,
  onDragEnd,
  onDrop,
  onAssetDropped,
  onDropToUnused,
  onClearSlot,
  onTemplateChange,
  onRemovePage
}: LayoutPreviewBoardProps) {
  const [isTemplateChooserOpen, setIsTemplateChooserOpen] = useState(false);
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("all");
  const [pageSectionFilter, setPageSectionFilter] = useState<PageSectionFilter>("all");
  const [replaceTarget, setReplaceTarget] = useState<ReplaceTarget | null>(null);
  const activePage = result.pages.find((page) => page.id === selectedPageId) ?? result.pages[0] ?? null;
  const activeIndex = activePage ? result.pages.findIndex((page) => page.id === activePage.id) : 0;
  const spreadStartIndex = activeIndex <= 0 ? 0 : activeIndex % 2 === 0 ? activeIndex : activeIndex - 1;
  const spreadPages = result.pages.slice(spreadStartIndex, spreadStartIndex + 2);
  const leftPage = spreadPages[0] ?? null;
  const rightPage = spreadPages[1] ?? null;
  const compatibleTemplates = useMemo(
    () =>
      activePage
        ? getTemplateOptions(result.availableTemplates, Math.max(activePage.imageIds.length, 1))
        : [],
    [activePage, result.availableTemplates]
  );
  const filteredAssets = assets.filter((asset) => {
    const isUsed = usageByAssetId.has(asset.id);
    if (assetFilter === "unused") {
      return !isUsed;
    }
    if (assetFilter === "used") {
      return isUsed;
    }
    return true;
  });
  const sectionedPages = result.pages.filter((page, index, pages) => {
    if (pageSectionFilter === "all") {
      return true;
    }

    const third = Math.max(1, Math.ceil(pages.length / 3));

    if (pageSectionFilter === "opening") {
      return index < third;
    }

    if (pageSectionFilter === "middle") {
      return index >= third && index < third * 2;
    }

    return index >= third * 2;
  });
  const deferredAssets = useDeferredValue(filteredAssets);
  const deferredPages = useDeferredValue(sectionedPages);

  useEffect(() => {
    setIsTemplateChooserOpen(false);
    setReplaceTarget(null);
  }, [activePage?.id]);

  if (!activePage) {
    return <p className="helper-copy">Non ci sono ancora fogli da mostrare.</p>;
  }

  return (
    <div className="layout-studio">
      <div className="layout-studio__topbar">
        <div>
          <span className="layout-studio__eyebrow">Sala Impaginazione</span>
          <h3>
            Spread {leftPage?.pageNumber ?? "-"}
            {rightPage ? `-${rightPage.pageNumber}` : ""}
            {" "} | foglio attivo {activePage.pageNumber}
          </h3>
          <p>
            {activePage.assignments.length} foto posizionate | formato {activePage.sheetSpec.label} |
            margine {activePage.sheetSpec.marginCm.toFixed(1)} cm
          </p>
        </div>

        <div className="layout-studio__top-actions">
          <button
            type="button"
            className={
              isTemplateChooserOpen
                ? "secondary-button layout-studio__template-button layout-studio__template-button--active"
                : "secondary-button layout-studio__template-button"
            }
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
            <span>F</span>
            <small>Focus</small>
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
          <div className="spread-canvas">
            <div className="spread-canvas__page">
              {leftPage
                ? renderSheetSurface(
                    leftPage,
                    assetsById,
                    selectedSlotKey,
                    dragState,
                    onSelectPage,
                    onStartSlotDrag,
                    onDragEnd,
                    onDrop,
                    onAssetDropped,
                    onClearSlot,
                    (pageId, pageNumber, slotId, currentImageId) =>
                      setReplaceTarget({ pageId, pageNumber, slotId, currentImageId }),
                    "hero"
                  )
                : renderEmptySheetPlaceholder("Pagina sinistra")}
              {leftPage ? <span className="spread-canvas__page-number">{leftPage.pageNumber}</span> : null}
            </div>

            <div className="spread-canvas__gutter" />

            <div className="spread-canvas__page">
              {rightPage
                ? renderSheetSurface(
                    rightPage,
                    assetsById,
                    selectedSlotKey,
                    dragState,
                    onSelectPage,
                    onStartSlotDrag,
                    onDragEnd,
                    onDrop,
                    onAssetDropped,
                    onClearSlot,
                    (pageId, pageNumber, slotId, currentImageId) =>
                      setReplaceTarget({ pageId, pageNumber, slotId, currentImageId }),
                    "hero"
                  )
                : renderEmptySheetPlaceholder("Pagina destra")}
              <span className="spread-canvas__page-number">{rightPage?.pageNumber ?? spreadStartIndex + 2}</span>
            </div>
          </div>
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
          <div
            className={dragState ? "rail-warning rail-warning--drop" : "rail-warning rail-warning--ok"}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => onDropToUnused()}
          >
            <span>
              {dragState
                ? "Rilascia qui per togliere la foto dal layout"
                : activePage.warnings[0] ?? "Se il drag non basta, usa il bottone Foto dentro ogni slot."}
            </span>
          </div>
        </div>
      </div>

      <div className="layout-strip">
        <div className="layout-strip__sections">
          {([
            ["all", "Tutti"],
            ["opening", "Apertura"],
            ["middle", "Centro"],
            ["finale", "Finale"]
          ] as [PageSectionFilter, string][]).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={pageSectionFilter === value ? "layout-strip__section layout-strip__section--active" : "layout-strip__section"}
              onClick={() => setPageSectionFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>

        {deferredPages.map((page) => {
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
                  onClearSlot,
                  () => undefined,
                  "thumb"
                )}
              </div>
              <strong>Foglio {page.pageNumber}</strong>
              <span>{page.templateLabel}</span>
            </button>
          );
        })}
      </div>

      <div className="layout-photo-ribbon">
        <div className="layout-photo-ribbon__header">
          <div className="segmented-control">
            {([
              ["all", "Tutte"],
              ["unused", "Non usate"],
              ["used", "Usate"]
            ] as [AssetFilter, string][]).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={assetFilter === value ? "segment segment--active" : "segment"}
                onClick={() => setAssetFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="helper-inline">
            {usageByAssetId.size} usate | {assets.length - usageByAssetId.size} libere
          </span>
        </div>

        <div className="layout-photo-ribbon__track">
          {deferredAssets.map((asset) => {
            const usage = usageByAssetId.get(asset.id);
            const isActive = dragState?.imageId === asset.id;

            return (
              <button
                key={asset.id}
                type="button"
                draggable
                className={isActive ? "ribbon-photo ribbon-photo--dragging" : "ribbon-photo"}
                onDragStart={(event) => {
                  event.dataTransfer.setData("text/plain", asset.id);
                  onDragAssetStart(asset.id);
                }}
                onDragEnd={onDragEnd}
              >
                {asset.previewUrl ? (
                  <img src={asset.previewUrl} alt={asset.fileName} className="ribbon-photo__image" />
                ) : (
                  <div className="ribbon-photo__placeholder">{asset.fileName}</div>
                )}
                <div className="ribbon-photo__meta">
                  <strong>{asset.fileName}</strong>
                  <span>{usage ? `Foglio ${usage.pageNumber}` : "Disponibile"}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {replaceTarget ? (
        <PhotoReplaceModal
          assets={availableAssetsForPicker}
          activeAssetIds={activeAssetIds}
          usageByAssetId={usageByAssetId}
          currentImageId={replaceTarget.currentImageId}
          title={`Scegli la foto per foglio ${replaceTarget.pageNumber}, slot ${replaceTarget.slotId}`}
          onClose={() => setReplaceTarget(null)}
          onChoose={(imageId) => {
            onAssetDropped(replaceTarget.pageId, replaceTarget.slotId, imageId);
            onSelectPage(replaceTarget.pageId, replaceTarget.slotId);
            setReplaceTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}
