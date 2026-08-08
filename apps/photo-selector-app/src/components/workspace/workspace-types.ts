export type WorkspacePanelId = "filters" | "selection" | "view" | "stats";

export type WorkspaceDockZone = "top" | "left" | "right" | "bottom";

export interface WorkspacePanelLayoutItem {
  id: WorkspacePanelId;
  zone: WorkspaceDockZone;
  collapsed: boolean;
}

export const DEFAULT_WORKSPACE_PANEL_LAYOUT: WorkspacePanelLayoutItem[] = [
  { id: "selection", zone: "top", collapsed: false },
  { id: "view", zone: "top", collapsed: false },
  { id: "filters", zone: "left", collapsed: false },
  { id: "stats", zone: "left", collapsed: false },
];
