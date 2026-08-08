import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { WorkspacePanel } from "./WorkspacePanel";
import type { WorkspaceDockZone, WorkspacePanelId, WorkspacePanelLayoutItem } from "./workspace-types";

export interface WorkspacePanelDefinition {
  id: WorkspacePanelId;
  title: string;
  content: ReactNode;
}

interface DockableWorkspaceProps {
  layout: WorkspacePanelLayoutItem[];
  panels: WorkspacePanelDefinition[];
  children: ReactNode;
  onMovePanel: (id: WorkspacePanelId, zone: WorkspaceDockZone) => void;
  onTogglePanel: (id: WorkspacePanelId) => void;
}

const ZONES: WorkspaceDockZone[] = ["top", "left", "right", "bottom"];
const LEFT_DOCK_WIDTH_KEY = "image-select-pro.left-dock-width.v1";
const MIN_LEFT_DOCK_WIDTH = 190;
const MAX_LEFT_DOCK_WIDTH = 380;

function loadLeftDockWidth(): number {
  if (typeof window === "undefined") return 240;
  const stored = Number(window.localStorage.getItem(LEFT_DOCK_WIDTH_KEY));
  return Number.isFinite(stored)
    ? Math.max(MIN_LEFT_DOCK_WIDTH, Math.min(MAX_LEFT_DOCK_WIDTH, stored))
    : 240;
}

function readDraggedPanel(event: React.DragEvent): WorkspacePanelId | null {
  const value = event.dataTransfer.getData("application/x-image-select-panel")
    || event.dataTransfer.getData("text/plain");
  return value === "filters" || value === "selection" || value === "view" || value === "stats"
    ? value
    : null;
}

export function DockableWorkspace({
  layout,
  panels,
  children,
  onMovePanel,
  onTogglePanel,
}: DockableWorkspaceProps) {
  const definitions = new Map(panels.map((panel) => [panel.id, panel]));
  const bodyRef = useRef<HTMLDivElement>(null);
  const leftDockWidthRef = useRef(loadLeftDockWidth());
  const leftItems = layout.filter((item) => item.zone === "left");
  const leftDockIsCollapsed = leftItems.length > 0 && leftItems.every((item) => item.collapsed);
  const leftDockIsEmpty = leftItems.length === 0;

  const handleLeftResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (leftDockIsCollapsed || leftDockIsEmpty) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = leftDockWidthRef.current;
    let nextWidth = startWidth;
    let frame = 0;

    const applyWidth = () => {
      frame = 0;
      bodyRef.current?.style.setProperty("--workspace-left-width", `${nextWidth}px`);
    };
    const handleMove = (moveEvent: PointerEvent) => {
      nextWidth = Math.max(MIN_LEFT_DOCK_WIDTH, Math.min(MAX_LEFT_DOCK_WIDTH, startWidth + moveEvent.clientX - startX));
      if (frame === 0) frame = window.requestAnimationFrame(applyWidth);
    };
    const handleUp = () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
        applyWidth();
      }
      leftDockWidthRef.current = nextWidth;
      try {
        window.localStorage.setItem(LEFT_DOCK_WIDTH_KEY, String(nextWidth));
      } catch {
        // Il ridimensionamento resta valido per la sessione corrente.
      }
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      document.body.classList.remove("workspace-is-resizing");
      window.dispatchEvent(new Event("resize"));
    };

    document.body.classList.add("workspace-is-resizing");
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  };

  const renderZone = (zone: WorkspaceDockZone) => {
    const items = layout.filter((item) => item.zone === zone);
    return (
      <div
        className={`workspace-dock workspace-dock--${zone}${items.length === 0 ? " workspace-dock--empty" : ""}`}
        data-workspace-zone={zone}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          event.preventDefault();
          const panelId = readDraggedPanel(event);
          if (panelId) onMovePanel(panelId, zone);
        }}
        aria-label={`Area pannelli ${zone}`}
      >
        {items.map((item) => {
          const definition = definitions.get(item.id);
          if (!definition) return null;
          return (
            <WorkspacePanel
              key={item.id}
              id={item.id}
              title={definition.title}
              zone={zone}
              collapsed={item.collapsed}
              onToggle={onTogglePanel}
            >
              {definition.content}
            </WorkspacePanel>
          );
        })}
      </div>
    );
  };

  return (
    <div className="dockable-workspace">
      {renderZone("top")}
      <div
        ref={bodyRef}
        className={`dockable-workspace__body${leftDockIsCollapsed ? " dockable-workspace__body--left-collapsed" : ""}${leftDockIsEmpty ? " dockable-workspace__body--left-empty" : ""}`}
        style={{ "--workspace-left-width": `${leftDockWidthRef.current}px` } as CSSProperties}
      >
        {renderZone("left")}
        <div
          className="workspace-dock-resizer"
          onPointerDown={handleLeftResizeStart}
          role="separator"
          aria-label="Ridimensiona pannelli sinistri"
          aria-orientation="vertical"
        />
        <div className="dockable-workspace__canvas">{children}</div>
        {renderZone("right")}
      </div>
      {renderZone("bottom")}
    </div>
  );
}
