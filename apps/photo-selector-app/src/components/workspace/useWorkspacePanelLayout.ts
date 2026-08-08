import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_WORKSPACE_PANEL_LAYOUT,
  type WorkspaceDockZone,
  type WorkspacePanelId,
  type WorkspacePanelLayoutItem,
} from "./workspace-types";

const STORAGE_KEY = "image-select-pro.workspace-layout.v1";
const VALID_PANEL_IDS = new Set<WorkspacePanelId>(DEFAULT_WORKSPACE_PANEL_LAYOUT.map((item) => item.id));
const VALID_ZONES = new Set<WorkspaceDockZone>(["top", "left", "right", "bottom"]);

function cloneDefaultLayout(): WorkspacePanelLayoutItem[] {
  return DEFAULT_WORKSPACE_PANEL_LAYOUT.map((item) => ({ ...item }));
}

function loadLayout(): WorkspacePanelLayoutItem[] {
  if (typeof window === "undefined") return cloneDefaultLayout();

  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as unknown;
    if (!Array.isArray(parsed)) return cloneDefaultLayout();

    const validItems = parsed.filter((item): item is WorkspacePanelLayoutItem => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Partial<WorkspacePanelLayoutItem>;
      return VALID_PANEL_IDS.has(candidate.id as WorkspacePanelId)
        && VALID_ZONES.has(candidate.zone as WorkspaceDockZone)
        && typeof candidate.collapsed === "boolean";
    });
    if (validItems.length !== DEFAULT_WORKSPACE_PANEL_LAYOUT.length) return cloneDefaultLayout();
    if (new Set(validItems.map((item) => item.id)).size !== VALID_PANEL_IDS.size) return cloneDefaultLayout();
    return validItems;
  } catch {
    return cloneDefaultLayout();
  }
}

export function useWorkspacePanelLayout() {
  const [layout, setLayout] = useState<WorkspacePanelLayoutItem[]>(loadLayout);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // Il workspace resta utilizzabile anche se lo storage è disabilitato.
    }
  }, [layout]);

  const movePanel = useCallback((id: WorkspacePanelId, zone: WorkspaceDockZone) => {
    setLayout((current) => [
      ...current.filter((item) => item.id !== id),
      { ...current.find((item) => item.id === id)!, zone },
    ]);
  }, []);

  const togglePanel = useCallback((id: WorkspacePanelId) => {
    setLayout((current) => current.map((item) => (
      item.id === id ? { ...item, collapsed: !item.collapsed } : item
    )));
  }, []);

  const resetLayout = useCallback(() => setLayout(cloneDefaultLayout()), []);

  useEffect(() => {
    const handleExternalReset = () => resetLayout();
    window.addEventListener("image-select-pro:reset-workspace-layout", handleExternalReset);
    return () => window.removeEventListener("image-select-pro:reset-workspace-layout", handleExternalReset);
  }, [resetLayout]);

  return { layout, movePanel, togglePanel, resetLayout };
}
