import { memo, useState, useCallback } from "react";
import type { GeneratedPageLayout } from "@photo-tools/shared-types";

interface PageReorderStripProps {
  pages: GeneratedPageLayout[];
  selectedPageId: string | null;
  onSelectPage: (pageId: string, slotId?: string) => void;
  onReorderPages: (fromIndex: number, toIndex: number) => void;
}

function PageReorderStripContent({
  pages,
  selectedPageId,
  onSelectPage,
  onReorderPages
}: PageReorderStripProps) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = useCallback((event: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", index.toString());
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent, index: number) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  }, []);

  const handleDrop = useCallback((event: React.DragEvent, dropIndex: number) => {
    event.preventDefault();
    const dragIndex = Number.parseInt(event.dataTransfer.getData("text/plain"), 10);

    if (
      Number.isInteger(dragIndex) &&
      dragIndex >= 0 &&
      dragIndex < pages.length &&
      dragIndex !== dropIndex &&
      dragIndex !== dropIndex - 1
    ) {
      onReorderPages(dragIndex, dropIndex);
    }

    setDraggedIndex(null);
    setDragOverIndex(null);
  }, [onReorderPages, pages.length]);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragOverIndex(null);
    }
  }, []);

  return (
    <div className="layout-strip">
      <div className="layout-strip__sections">
        {([
          ["all", "Tutti"],
          ["opening", "Apertura"],
          ["middle", "Centro"],
          ["finale", "Finale"]
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className="layout-strip__section"
          >
            {label}
          </button>
        ))}
      </div>

      <div className="layout-strip__pages">
        {pages.map((page, index) => {
          const isActive = page.id === selectedPageId;
          const isDragged = draggedIndex === index;
          const isDragOver = dragOverIndex === index;

          return (
            <div
              key={page.id}
              className={`layout-strip__item-wrapper${
                isDragged ? " layout-strip__item-wrapper--dragged" : ""
              }${
                isDragOver ? " layout-strip__item-wrapper--drag-over" : ""
              }`}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragLeave={handleDragLeave}
            >
              <button
                type="button"
                draggable
                className={isActive ? "layout-strip__item layout-strip__item--active" : "layout-strip__item"}
                onClick={() => onSelectPage(page.id, page.slotDefinitions[0]?.id)}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragEnd={handleDragEnd}
              >
                <div className="layout-strip__thumb">
                  {/* Mini preview would go here */}
                  <div className="layout-strip__thumb-placeholder">
                    {page.assignments.length}/{page.slotDefinitions.length}
                  </div>
                </div>
                <div className="layout-strip__meta">
                  <strong>Foglio {page.pageNumber}</strong>
                  <span>{page.templateLabel}</span>
                </div>
                <div className="layout-strip__drag-handle">⋮⋮</div>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const PageReorderStrip = memo(PageReorderStripContent);
PageReorderStrip.displayName = "PageReorderStrip";
