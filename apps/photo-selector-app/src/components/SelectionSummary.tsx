import { useMemo } from "react";
import type { ImageAsset } from "@photo-tools/shared-types";
import { useToast } from "./ToastProvider";
import {
  COLOR_LABEL_NAMES,
  getAssetColorLabel,
  getAssetPickStatus,
  getAssetRating,
} from "../services/photo-classification";

interface SelectionSummaryProps {
  allAssets: ImageAsset[];
  activeAssetIds: string[];
  projectName: string;
  onExportSelection: () => void;
  onBackToSelection: () => void;
  onOpenProjectSelector: () => void;
}

export function SelectionSummary({
  allAssets,
  activeAssetIds,
  projectName,
  onExportSelection,
  onBackToSelection,
  onOpenProjectSelector,
}: SelectionSummaryProps) {
  const { addToast } = useToast();

  const stats = useMemo(() => {
    const activeSet = new Set(activeAssetIds);
    const active = allAssets.filter((a) => activeSet.has(a.id));

    let vertical = 0;
    let horizontal = 0;
    let square = 0;
    let picked = 0;
    let rejected = 0;
    let unmarked = 0;
    const ratingCounts = [0, 0, 0, 0, 0, 0];
    const colorCounts: Record<string, number> = {};

    for (const asset of active) {
      if (asset.orientation === "vertical") vertical++;
      else if (asset.orientation === "horizontal") horizontal++;
      else square++;

      const status = getAssetPickStatus(asset);
      if (status === "picked") picked++;
      else if (status === "rejected") rejected++;
      else unmarked++;

      ratingCounts[getAssetRating(asset)]++;

      const color = getAssetColorLabel(asset);
      if (color) colorCounts[color] = (colorCounts[color] ?? 0) + 1;
    }

    return {
      active,
      totalImported: allAssets.length,
      totalActive: active.length,
      vertical,
      horizontal,
      square,
      picked,
      rejected,
      unmarked,
      ratingCounts,
      colorCounts,
    };
  }, [allAssets, activeAssetIds]);

  async function handleCopyFileNames() {
    if (stats.totalActive === 0) return;

    const fileNames = stats.active.map((asset) => asset.fileName).join("\n");
    try {
      await navigator.clipboard.writeText(fileNames);
      addToast(`${stats.totalActive} nomi file copiati negli appunti.`, "success");
    } catch {
      addToast("Impossibile copiare negli appunti in questo browser.", "error");
    }
  }

  function handleExportFileList() {
    if (stats.totalActive === 0) return;

    const fileNames = stats.active.map((asset) => asset.fileName).join("\n");
    const blob = new Blob([fileNames], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(projectName || "selezione").replace(/[^a-zA-Z0-9_-]/g, "_")}_lista.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addToast(`Lista file esportata: ${stats.totalActive} nomi.`, "success");
  }

  function handleExportCsv() {
    if (stats.totalActive === 0) return;

    const headers = ["fileName", "path", "rating", "pickStatus", "colorLabel"];
    const rows = stats.active.map((a) => [
      a.fileName,
      a.path ?? "",
      String(getAssetRating(a)),
      getAssetPickStatus(a),
      getAssetColorLabel(a) ?? "",
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(projectName || "selezione").replace(/[^a-zA-Z0-9_-]/g, "_")}_lista.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addToast(`CSV esportato: ${stats.totalActive} foto.`, "success");
  }

  function handleExportJson() {
    if (stats.totalActive === 0) return;

    const data = stats.active.map((a) => ({
      fileName: a.fileName,
      path: a.path ?? "",
      rating: getAssetRating(a),
      pickStatus: getAssetPickStatus(a),
      colorLabel: getAssetColorLabel(a) ?? null,
    }));
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(projectName || "selezione").replace(/[^a-zA-Z0-9_-]/g, "_")}_lista.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addToast(`JSON esportato: ${stats.totalActive} foto.`, "success");
  }

  return (
    <div className="stack">
      <div className="selection-summary__header">
        <h3 className="selection-summary__title">
          {projectName || "Selezione foto"}
        </h3>
        <span className="selection-summary__subtitle">
          {stats.totalActive} foto selezionate su {stats.totalImported} caricate
        </span>
      </div>

      <div className="selection-summary__actions">
        <button type="button" className="ghost-button" onClick={onBackToSelection}>
          Torna alla selezione
        </button>
        <button type="button" className="ghost-button" onClick={onOpenProjectSelector} disabled={stats.totalImported === 0}>
          Apri selezione progetto
        </button>
        <button type="button" className="ghost-button" onClick={handleCopyFileNames} disabled={stats.totalActive === 0}>
          Copia nomi file
        </button>
        <button type="button" className="ghost-button" onClick={handleExportFileList} disabled={stats.totalActive === 0}>
          Esporta lista TXT
        </button>
        <button type="button" className="ghost-button" onClick={handleExportCsv} disabled={stats.totalActive === 0}>
          Esporta CSV
        </button>
        <button type="button" className="ghost-button" onClick={handleExportJson} disabled={stats.totalActive === 0}>
          Esporta JSON
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={onExportSelection}
          disabled={stats.totalActive === 0}
        >
          Esporta selezione ({stats.totalActive} foto)
        </button>
      </div>

      <div className="stats-grid">
        <div className="stat-card stat-card--highlight">
          <span>Selezionate</span>
          <strong>{stats.totalActive}</strong>
        </div>
        <div className="stat-card">
          <span>Verticali</span>
          <strong>{stats.vertical}</strong>
        </div>
        <div className="stat-card">
          <span>Orizzontali</span>
          <strong>{stats.horizontal}</strong>
        </div>
        <div className="stat-card">
          <span>Quadrate</span>
          <strong>{stats.square}</strong>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <span>Pick</span>
          <strong>{stats.picked}</strong>
        </div>
        <div className="stat-card">
          <span>Scartate</span>
          <strong>{stats.rejected}</strong>
        </div>
        <div className="stat-card">
          <span>Neutre</span>
          <strong>{stats.unmarked}</strong>
        </div>
        <div className="stat-card">
          <span>Escluse</span>
          <strong>{stats.totalImported - stats.totalActive}</strong>
        </div>
      </div>

      {stats.totalActive > 0 ? (
        <div className="selection-summary__rating-distribution">
          <span className="selection-summary__label">Distribuzione stelle</span>
          <div className="selection-summary__rating-bars">
            {[5, 4, 3, 2, 1, 0].map((rating) => (
              <div key={rating} className="selection-summary__rating-row">
                <span className="selection-summary__rating-label">
                  {rating > 0 ? "★".repeat(rating) : "Nessuna"}
                </span>
                <div className="selection-summary__rating-bar">
                  <div
                    className="selection-summary__rating-fill"
                    style={{
                      width: `${stats.totalActive > 0 ? (stats.ratingCounts[rating] / stats.totalActive) * 100 : 0}%`,
                    }}
                  />
                </div>
                <span className="selection-summary__rating-count">
                  {stats.ratingCounts[rating]}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {Object.keys(stats.colorCounts).length > 0 ? (
        <div className="selection-summary__colors">
          <span className="selection-summary__label">Etichette colore</span>
          <div className="selection-summary__color-chips">
            {Object.entries(stats.colorCounts).map(([color, count]) => (
              <span key={color} className="selection-summary__color-chip">
                <span className={`asset-color-dot asset-color-dot--${color}`} />
                <span>
                  {COLOR_LABEL_NAMES[color as keyof typeof COLOR_LABEL_NAMES]} ({count})
                </span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
