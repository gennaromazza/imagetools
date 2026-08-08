import type { ReactNode } from "react";
import type { WorkspaceDockZone, WorkspacePanelId } from "./workspace-types";

interface WorkspacePanelProps {
  id: WorkspacePanelId;
  title: string;
  zone: WorkspaceDockZone;
  collapsed: boolean;
  children: ReactNode;
  onToggle: (id: WorkspacePanelId) => void;
}

export function WorkspacePanel({ id, title, zone, collapsed, children, onToggle }: WorkspacePanelProps) {
  const collapseGlyph = zone === "right" ? ">" : "<";
  const expandGlyph = zone === "right" ? "<" : ">";

  return (
    <section
      className={`workspace-panel workspace-panel--${zone}${collapsed ? " workspace-panel--collapsed" : ""}`}
      data-workspace-panel={id}
    >
      <header className="workspace-panel__header">
        <button
          type="button"
          className="workspace-panel__drag-handle"
          draggable
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("application/x-image-select-panel", id);
            event.dataTransfer.setData("text/plain", id);
            const dragPreview = document.createElement("div");
            dragPreview.className = "workspace-panel__drag-preview";
            dragPreview.textContent = title;
            document.body.appendChild(dragPreview);
            event.dataTransfer.setDragImage(dragPreview, 16, 16);
            window.requestAnimationFrame(() => dragPreview.remove());
          }}
          title={`Trascina il pannello ${title}`}
          aria-label={`Trascina il pannello ${title}`}
        >
          =
        </button>
        <strong className="workspace-panel__title">{title}</strong>
        <button
          type="button"
          className="workspace-panel__collapse"
          onClick={() => onToggle(id)}
          title={collapsed ? `Riapri ${title}` : `Richiudi ${title}`}
          aria-expanded={!collapsed}
        >
          {collapsed ? expandGlyph : collapseGlyph}
        </button>
      </header>
      {!collapsed ? <div className="workspace-panel__content">{children}</div> : null}
    </section>
  );
}
