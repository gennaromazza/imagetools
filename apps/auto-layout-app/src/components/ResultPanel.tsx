import type { AutoLayoutResult } from "@photo-tools/shared-types";

interface ResultPanelProps {
  result: AutoLayoutResult;
}

export function ResultPanel({ result }: ResultPanelProps) {
  const usedImages = result.summary.totalImages - result.unassignedAssets.length;

  return (
    <div className="stack">
      <div className="stats-grid">
        <div className="stat-card stat-card--highlight">
          <span>Foto per foglio</span>
          <strong>{result.summary.targetPhotosPerSheet}</strong>
        </div>
        <div className="stat-card">
          <span>Fogli generati</span>
          <strong>{result.summary.generatedSheetCount}</strong>
        </div>
        <div className="stat-card">
          <span>Immagini residue</span>
          <strong>{result.summary.residualImages}</strong>
        </div>
        <div className="stat-card">
          <span>Gia' impaginate</span>
          <strong>{usedImages}</strong>
        </div>
      </div>

      {result.unassignedAssets.length > 0 ? (
        <div className="message-box message-box--warning">
          {result.unassignedAssets.length} foto sono ancora fuori dai fogli. Puoi trascinarle in uno slot
          oppure creare un nuovo foglio.
        </div>
      ) : null}

      <ul className="sheet-plan">
        {result.pages.map((page) => (
          <li key={page.id}>
            <strong>Foglio {page.pageNumber}</strong>
            <span>{page.templateLabel}</span>
            <span>{page.assignments.length} foto assegnate</span>
          </li>
        ))}
      </ul>

      {result.warnings.length > 0 ? (
        <div className="message-box message-box--warning">
          {result.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
