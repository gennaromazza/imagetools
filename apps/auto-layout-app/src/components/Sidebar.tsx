import type { ToolNavigationItem } from "@photo-tools/shared-types";

interface SidebarProps {
  tools: ToolNavigationItem[];
  activeToolId: string;
}

export function Sidebar({ tools, activeToolId }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__eyebrow">Photo Tools</span>
        <h1>Centro Produzione</h1>
        <p>Layout di stampa rapidi per eventi e matrimoni.</p>
      </div>

      <nav className="sidebar__nav" aria-label="Navigazione strumenti">
        {tools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={tool.id === activeToolId ? "tool-pill tool-pill--active" : "tool-pill"}
            disabled={!tool.isEnabled}
          >
            <strong>{tool.label}</strong>
            <span>{tool.description}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
