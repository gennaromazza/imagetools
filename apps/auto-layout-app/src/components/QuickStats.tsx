import { memo } from "react";
import type { AutoLayoutResult, ImageAsset } from "@photo-tools/shared-types";
import { getPageWarnings } from "./WarningsPanel";

interface QuickStatsProps {
  result: AutoLayoutResult;
  allAssets: ImageAsset[];
  usedImagesCount: number;
}

function QuickStatsContent({ result, allAssets, usedImagesCount }: QuickStatsProps) {
  const totalPhotos = allAssets.length;
  const unusedPhotos = Math.max(0, totalPhotos - usedImagesCount);
  const completionPercentage =
    totalPhotos > 0 ? Math.max(0, Math.min(100, Math.round((usedImagesCount / totalPhotos) * 100))) : 0;
  const warnings = getPageWarnings(result.pages);
  const errorCount = warnings.filter((warning) => warning.severity === "error").length;
  const warningCount = warnings.filter((warning) => warning.severity === "warning").length;
  const infoCount = warnings.filter((warning) => warning.severity === "info").length;
  const pagesWithIssues = new Set(warnings.map((warning) => warning.pageId)).size;
  const totalSignals = warnings.length;
  const coverageTone = completionPercentage >= 90 ? "success" : completionPercentage >= 70 ? "warning" : "error";
  const signalTone = errorCount > 0 ? "error" : totalSignals > 0 || unusedPhotos > 0 ? "warning" : "success";

  const projectMessage =
    errorCount > 0
      ? `${errorCount} errori bloccanti su ${pagesWithIssues} fogli: conviene passare prima dal pannello Avvisi.`
      : totalSignals > 0
        ? `${warningCount + infoCount} segnalazioni leggere ancora aperte: fai una revisione veloce prima dell'output.`
        : unusedPhotos > 0
          ? `${unusedPhotos} foto restano libere, ma i fogli attuali sono gia esportabili.`
          : "Nessuna anomalia attiva: il progetto e pronto per la consegna.";

  return (
    <div className="quick-stats">
      <div className="quick-stats__rail">
        <div className={`quick-stats__item quick-stats__item--${coverageTone}`}>
          <div className="quick-stats__icon">{completionPercentage >= 90 ? "OK" : completionPercentage >= 70 ? "!" : "X"}</div>
          <div className="quick-stats__content">
            <strong>{completionPercentage}%</strong>
            <span>Copertura foto</span>
          </div>
        </div>

        <div className="quick-stats__item">
          <div className="quick-stats__icon">Pg</div>
          <div className="quick-stats__content">
            <strong>{result.pages.length}</strong>
            <span>Fogli</span>
          </div>
        </div>

        <div className="quick-stats__item">
          <div className="quick-stats__icon">Img</div>
          <div className="quick-stats__content">
            <strong>{unusedPhotos}</strong>
            <span>Foto libere</span>
          </div>
        </div>

        <div className={`quick-stats__item quick-stats__item--${signalTone}`}>
          <div className="quick-stats__icon">{errorCount > 0 ? "!" : totalSignals > 0 ? "~" : "OK"}</div>
          <div className="quick-stats__content">
            <strong>{totalSignals}</strong>
            <span>Segnalazioni</span>
          </div>
        </div>
      </div>

      <div className="quick-stats__progress">
        <div className="quick-stats__progress-copy">
          <strong>Avanzamento progetto</strong>
          <div className="progress-bar__labels">
            <span>{usedImagesCount} di {totalPhotos} foto gia usate</span>
            <span>{pagesWithIssues > 0 ? `${pagesWithIssues} fogli da rivedere` : "Nessun foglio critico"}</span>
          </div>
        </div>

        <div className="progress-bar">
          <div className="progress-bar__fill" style={{ width: `${completionPercentage}%` }} />
        </div>
      </div>

      <div className={`quick-stats__alert quick-stats__alert--${signalTone}`}>
        <span>Prossimo passo</span>
        <span>{projectMessage}</span>
      </div>
    </div>
  );
}

export const QuickStats = memo(QuickStatsContent);
QuickStats.displayName = "QuickStats";
