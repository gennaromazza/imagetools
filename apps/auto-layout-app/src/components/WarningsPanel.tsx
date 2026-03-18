import { memo } from "react";
import type { GeneratedPageLayout } from "@photo-tools/shared-types";

interface PageWarning {
  pageId: string;
  pageNumber: number;
  type: "empty" | "overloaded" | "underloaded" | "template_mismatch";
  message: string;
  severity: "error" | "warning" | "info";
}

interface WarningsPanelProps {
  pages: GeneratedPageLayout[];
  onSelectPage: (pageId: string) => void;
}

function getPageWarnings(pages: GeneratedPageLayout[]): PageWarning[] {
  const warnings: PageWarning[] = [];

  pages.forEach(page => {
    // Check for empty pages
    if (page.assignments.length === 0) {
      warnings.push({
        pageId: page.id,
        pageNumber: page.pageNumber,
        type: "empty",
        message: "Questa pagina è vuota",
        severity: "warning"
      });
    }

    // Check for overloaded pages (more photos than slots)
    if (page.assignments.length > page.slotDefinitions.length) {
      warnings.push({
        pageId: page.id,
        pageNumber: page.pageNumber,
        type: "overloaded",
        message: `${page.assignments.length - page.slotDefinitions.length} foto in più rispetto agli slot disponibili`,
        severity: "error"
      });
    }

    // Check for underloaded pages (too few photos)
    const utilization = page.assignments.length / page.slotDefinitions.length;
    if (utilization < 0.5 && page.assignments.length > 0) {
      warnings.push({
        pageId: page.id,
        pageNumber: page.pageNumber,
        type: "underloaded",
        message: `Solo ${Math.round(utilization * 100)}% degli slot utilizzati`,
        severity: "info"
      });
    }

    // Check for template issues
    if (page.warnings && page.warnings.length > 0) {
      page.warnings.forEach(warning => {
        warnings.push({
          pageId: page.id,
          pageNumber: page.pageNumber,
          type: "template_mismatch",
          message: warning,
          severity: "warning"
        });
      });
    }
  });

  return warnings;
}

function WarningsPanelContent({ pages, onSelectPage }: WarningsPanelProps) {
  const warnings = getPageWarnings(pages);

  if (warnings.length === 0) {
    return (
      <div className="warnings-panel warnings-panel--empty">
        <div className="warnings-panel__empty">
          <span>✅</span>
          <p>Tutto a posto! Nessun problema rilevato.</p>
        </div>
      </div>
    );
  }

  const errorCount = warnings.filter(w => w.severity === "error").length;
  const warningCount = warnings.filter(w => w.severity === "warning").length;
  const infoCount = warnings.filter(w => w.severity === "info").length;

  return (
    <div className="warnings-panel">
      <div className="warnings-panel__header">
        <h4>Problemi rilevati</h4>
        <div className="warnings-panel__stats">
          {errorCount > 0 && <span className="warning-stat warning-stat--error">🔴 {errorCount}</span>}
          {warningCount > 0 && <span className="warning-stat warning-stat--warning">🟡 {warningCount}</span>}
          {infoCount > 0 && <span className="warning-stat warning-stat--info">🔵 {infoCount}</span>}
        </div>
      </div>

      <div className="warnings-panel__list">
        {warnings.map((warning, index) => (
          <button
            key={`${warning.pageId}-${index}`}
            type="button"
            className={`warning-item warning-item--${warning.severity}`}
            onClick={() => onSelectPage(warning.pageId)}
          >
            <div className="warning-item__icon">
              {warning.severity === "error" && "🔴"}
              {warning.severity === "warning" && "🟡"}
              {warning.severity === "info" && "🔵"}
            </div>
            <div className="warning-item__content">
              <strong>Foglio {warning.pageNumber}</strong>
              <span>{warning.message}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export const WarningsPanel = memo(WarningsPanelContent);
WarningsPanel.displayName = "WarningsPanel";