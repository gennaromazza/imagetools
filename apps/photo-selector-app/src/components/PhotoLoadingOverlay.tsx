interface PhotoLoadingOverlayProps {
  done: number;
  total: number;
  scanning?: boolean;
}

export function PhotoLoadingOverlay({ done, total, scanning = false }: PhotoLoadingOverlayProps) {
  const progress = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <div className="photo-loading-overlay" role="status" aria-live="polite" aria-label="Preparazione fotografie">
      <div className="photo-loading-overlay__card">
        <span className="photo-loading-overlay__spinner" aria-hidden="true" />
        <div className="photo-loading-overlay__copy">
          <strong>{scanning ? "Analisi della cartella…" : "Preparo le prime anteprime…"}</strong>
          <span>
            {total > 0
              ? `${done} di ${total} · la griglia diventerà utilizzabile appena pronte le prime foto`
              : "Indicizzazione delle fotografie in corso"}
          </span>
        </div>
        {total > 0 ? (
          <div className="photo-loading-overlay__progress" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
