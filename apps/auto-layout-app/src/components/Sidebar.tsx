import type { ToolNavigationItem } from "@photo-tools/shared-types";
import albumMakerLogo from "../assets/album_maker.png";

interface SidebarProps {
  tools: ToolNavigationItem[];
  activeToolId: string;
}

export function Sidebar({ tools, activeToolId }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <img
          src={albumMakerLogo}
          alt="ImageAlbumMaker"
          style={{
            width: "100%",
            maxWidth: "172px",
            borderRadius: "18px",
            boxShadow: "0 16px 28px rgba(0, 0, 0, 0.18)",
          }}
        />
        <span className="sidebar__eyebrow">ImageAlbumMaker</span>
        <h1>ImageAlbumMaker Studio</h1>
        <p>Workspace dedicato alla progettazione, revisione ed export di album fotografici multifoto.</p>
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
