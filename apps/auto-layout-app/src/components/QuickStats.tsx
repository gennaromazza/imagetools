import { memo } from "react";
import type { AutoLayoutResult, ImageAsset } from "@photo-tools/shared-types";

interface QuickStatsProps {
  result: AutoLayoutResult;
  allAssets: ImageAsset[];
  usedImagesCount: number;
}

function QuickStatsContent({ result, allAssets, usedImagesCount }: QuickStatsProps) {
  const totalPhotos = allAssets.length;
  const unusedPhotos = totalPhotos - usedImagesCount;
  const completionPercentage = totalPhotos > 0 ? Math.round((usedImagesCount / totalPhotos) * 100) : 0;

  const pagesWithIssues = result.pages.filter((page) => {
    const hasWarnings = page.warnings && page.warnings.length > 0;
    const isEmpty = page.assignments.length === 0;
    const isOverloaded = page.assignments.length > page.slotDefinitions.length;
    return hasWarnings || isEmpty || isOverloaded;
  }).length;

  const getCompletionColor = () => {
    if (completionPercentage >= 90) return "success";
    if (completionPercentage >= 70) return "warning";
    return "error";
  };

  const getIssuesColor = () => {
    if (pagesWithIssues === 0) return "success";
    if (pagesWithIssues <= 2) return "warning";
    return "error";
  };

  return (
    <div className="quick-stats">
      <div className="quick-stats__rail">
        <div className={`quick-stats__item quick-stats__item--${getCompletionColor()}`}>
          <div className="quick-stats__icon">{completionPercentage >= 90 ? "OK" : completionPercentage >= 70 ? "!" : "X"}</div>
          <div className="quick-stats__content">
            <strong>{completionPercentage}%</strong>
            <span>Completamento</span>
          </div>
        </div>

        <div className="quick-stats__item">
          <div className="quick-stats__icon">Pg</div>
          <div className="quick-stats__content">
            <strong>{result.pages.length}</strong>
            <span>Pagine</span>
          </div>
        </div>

        <div className="quick-stats__item">
          <div className="quick-stats__icon">Ft</div>
          <div className="quick-stats__content">
            <strong>{usedImagesCount}</strong>
            <span>Usate</span>
          </div>
        </div>

        <div className={`quick-stats__item quick-stats__item--${getIssuesColor()}`}>
          <div className="quick-stats__icon">{pagesWithIssues === 0 ? "OK" : pagesWithIssues <= 2 ? "!" : "X"}</div>
          <div className="quick-stats__content">
            <strong>{pagesWithIssues}</strong>
            <span>Problemi</span>
          </div>
        </div>
      </div>

      <div className="quick-stats__progress">
        <div className="quick-stats__progress-copy">
          <strong>Progresso progetto</strong>
          <div className="progress-bar__labels">
            <span>{usedImagesCount} di {totalPhotos} foto usate</span>
            <span>{unusedPhotos} libere</span>
          </div>
        </div>

        <div className="progress-bar">
          <div className="progress-bar__fill" style={{ width: `${completionPercentage}%` }} />
        </div>
      </div>

      {pagesWithIssues > 0 ? (
        <div className="quick-stats__alert">
          <span>Attenzione</span>
          <span>{pagesWithIssues} pagina{pagesWithIssues > 1 ? "e" : ""} con problemi - controlla il pannello Avvisi</span>
        </div>
      ) : null}
    </div>
  );
}

export const QuickStats = memo(QuickStatsContent);
QuickStats.displayName = "QuickStats";
