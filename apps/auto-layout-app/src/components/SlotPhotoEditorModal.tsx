import { useEffect, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { GeneratedPageLayout, ImageAsset, LayoutAssignment, LayoutSlot } from "@photo-tools/shared-types";
import { AssignmentInspector } from "./AssignmentInspector";
import { ImageSlotPreview } from "./ImageSlotPreview";
import { getEffectiveSlotAspectRatio } from "../utils/slot-geometry";

interface SlotPhotoEditorModalProps {
  asset: ImageAsset | null;
  pageId: string;
  pageLabel: string;
  sheetSpec: GeneratedPageLayout["sheetSpec"];
  slotCount?: number;
  slot: LayoutSlot;
  assignment: LayoutAssignment;
  onClose: () => void;
  onUpdateSlotAssignment: (
    pageId: string,
    slotId: string,
    changes: Partial<
      Pick<
        LayoutAssignment,
        "fitMode" | "zoom" | "offsetX" | "offsetY" | "rotation" | "locked" | "cropLeft" | "cropTop" | "cropWidth" | "cropHeight"
      >
    >
  ) => void;
  onClearSlot: (pageId: string, slotId: string) => void;
  onOpenCropEditor: (pageId: string, slotId: string) => void;
}

export function SlotPhotoEditorModal({
  asset,
  pageId,
  pageLabel,
  sheetSpec,
  slotCount = 1,
  slot,
  assignment,
  onClose,
  onUpdateSlotAssignment,
  onClearSlot,
  onOpenCropEditor
}: SlotPhotoEditorModalProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTextEntry =
        target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

      if (isTextEntry) {
        return;
      }

      event.preventDefault();
      onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!asset) {
    return null;
  }

  const previewUrl = asset.previewUrl ?? asset.thumbnailUrl ?? asset.sourceUrl;
  const rawSlotAspect = getEffectiveSlotAspectRatio(slot, sheetSpec, slotCount);
  const slotAspect = Number.isFinite(rawSlotAspect) && rawSlotAspect > 0 ? rawSlotAspect : 1;
  const slotPreviewStyle: CSSProperties = {
    ["--slot-border-width" as string]: `${Math.max(0, (sheetSpec.photoBorderWidthCm ?? 0) * 8)}px`,
    ["--slot-border-color" as string]: sheetSpec.photoBorderColor ?? "#ffffff",
    backgroundColor: sheetSpec.backgroundColor ?? "#ffffff",
    backgroundImage: sheetSpec.backgroundImageUrl ? `url("${sheetSpec.backgroundImageUrl}")` : undefined,
    backgroundSize: sheetSpec.backgroundImageUrl ? "cover" : undefined,
    backgroundPosition: sheetSpec.backgroundImageUrl ? "center" : undefined
  };

  const modalContent = (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Editor foto nello slot">
      <div className="modal-panel modal-panel--wide slot-photo-editor" onClick={(event) => event.stopPropagation()}>
        <div className="modal-panel__header slot-photo-editor__header">
          <div>
            <strong>{asset.fileName}</strong>
            <p>
              {pageLabel} | slot {slot.id} | {asset.width ?? "?"} x {asset.height ?? "?"}
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Chiudi
          </button>
        </div>

        <div className="slot-photo-editor__layout">
          <div className="slot-photo-editor__visuals">
            <div className="slot-photo-editor__sheet-preview">
              <div className="slot-photo-editor__section-head">
                <strong>Risultato sul foglio</strong>
                <span>Anteprima reale dello slot aggiornabile in tempo reale</span>
              </div>
              <div className="slot-photo-editor__sheet-card">
                <div
                  className="slot-photo-editor__sheet-card-inner"
                  style={{ ...slotPreviewStyle, ["--slot-editor-aspect" as string]: String(slotAspect) }}
                >
                  <ImageSlotPreview
                    asset={asset}
                    assignment={assignment}
                    slot={slot}
                    label={`${pageLabel} | slot ${slot.id}`}
                    sheetSpec={sheetSpec}
                    slotCount={slotCount}
                    showMeta={false}
                  />
                </div>
              </div>
            </div>

            <div className="slot-photo-editor__stage">
              <div className="slot-photo-editor__section-head">
                <strong>Foto sorgente</strong>
                <span>Riferimento completo dell'immagine originale</span>
              </div>
              <div className="slot-photo-editor__stage-frame">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={asset.fileName || "Anteprima foto"}
                    className="slot-photo-editor__image"
                    draggable={false}
                  />
                ) : (
                  <div className="slot-photo-editor__placeholder">{asset.fileName}</div>
                )}
              </div>
            </div>
          </div>

          <aside className="slot-photo-editor__inspector">
            <AssignmentInspector
              pageLabel={pageLabel}
              slot={slot}
              assignment={assignment}
              asset={asset}
              sheetSpec={sheetSpec}
              slotCount={slotCount}
              onChange={(changes) => onUpdateSlotAssignment(pageId, slot.id, changes)}
              onClear={() => onClearSlot(pageId, slot.id)}
              onOpenCropEditor={() => onOpenCropEditor(pageId, slot.id)}
            />
          </aside>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return modalContent;
  }

  return createPortal(modalContent, document.body);
}
