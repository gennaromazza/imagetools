import type { ToolNavigationItem } from "@photo-tools/shared-types";

interface SidebarProps {
  tools: ToolNavigationItem[];
  activeToolId: string;
}

export function Sidebar({ tools, activeToolId }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__eyebrow">ImageTools Suite</span>
        <h1>Auto Layout Studio</h1>
        <p>Stesso linguaggio visivo di Image Party Frame, adattato al planning e alla revisione dei fogli.</p>
      </div>
      <nav className="sidebar__nav" aria-label="Navigazione strumenti">
        {tools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={tool.id === activeToolId ? "tool-pill tool-pill--active" : "tool-pill"}
            disabled={!tool.isEnabled}
            aria-label={`${tool.label}: ${tool.description}`}
            aria-current={tool.id === activeToolId ? "page" : undefined}
          >
            <strong>{tool.label}</strong>
          </button>
        ))}
      </nav>
    </aside>
  );
}
