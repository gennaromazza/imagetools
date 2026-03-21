import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo } from "react";
import { useToast } from "./ToastProvider";
import { COLOR_LABEL_NAMES, getAssetColorLabel, getAssetPickStatus, getAssetRating, } from "../services/photo-classification";
export function SelectionSummary({ allAssets, activeAssetIds, projectName, onExportSelection, onBackToSelection, onOpenProjectSelector, }) {
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
        const colorCounts = {};
        for (const asset of active) {
            if (asset.orientation === "vertical")
                vertical++;
            else if (asset.orientation === "horizontal")
                horizontal++;
            else
                square++;
            const status = getAssetPickStatus(asset);
            if (status === "picked")
                picked++;
            else if (status === "rejected")
                rejected++;
            else
                unmarked++;
            ratingCounts[getAssetRating(asset)]++;
            const color = getAssetColorLabel(asset);
            if (color)
                colorCounts[color] = (colorCounts[color] ?? 0) + 1;
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
        if (stats.totalActive === 0)
            return;
        const fileNames = stats.active.map((asset) => asset.fileName).join("\n");
        try {
            await navigator.clipboard.writeText(fileNames);
            addToast(`${stats.totalActive} nomi file copiati negli appunti.`, "success");
        }
        catch {
            addToast("Impossibile copiare negli appunti in questo browser.", "error");
        }
    }
    function handleExportFileList() {
        if (stats.totalActive === 0)
            return;
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
    return (_jsxs("div", { className: "stack", children: [_jsxs("div", { className: "selection-summary__header", children: [_jsx("h3", { className: "selection-summary__title", children: projectName || "Selezione foto" }), _jsxs("span", { className: "selection-summary__subtitle", children: [stats.totalActive, " foto selezionate su ", stats.totalImported, " caricate"] })] }), _jsxs("div", { className: "selection-summary__actions", children: [_jsx("button", { type: "button", className: "ghost-button", onClick: onBackToSelection, children: "Torna alla selezione" }), _jsx("button", { type: "button", className: "ghost-button", onClick: onOpenProjectSelector, disabled: stats.totalImported === 0, children: "Apri selezione progetto" }), _jsx("button", { type: "button", className: "ghost-button", onClick: handleCopyFileNames, disabled: stats.totalActive === 0, children: "Copia nomi file" }), _jsx("button", { type: "button", className: "ghost-button", onClick: handleExportFileList, disabled: stats.totalActive === 0, children: "Esporta lista TXT" }), _jsxs("button", { type: "button", className: "primary-button", onClick: onExportSelection, disabled: stats.totalActive === 0, children: ["Esporta selezione (", stats.totalActive, " foto)"] })] }), _jsxs("div", { className: "stats-grid", children: [_jsxs("div", { className: "stat-card stat-card--highlight", children: [_jsx("span", { children: "Selezionate" }), _jsx("strong", { children: stats.totalActive })] }), _jsxs("div", { className: "stat-card", children: [_jsx("span", { children: "Verticali" }), _jsx("strong", { children: stats.vertical })] }), _jsxs("div", { className: "stat-card", children: [_jsx("span", { children: "Orizzontali" }), _jsx("strong", { children: stats.horizontal })] }), _jsxs("div", { className: "stat-card", children: [_jsx("span", { children: "Quadrate" }), _jsx("strong", { children: stats.square })] })] }), _jsxs("div", { className: "stats-grid", children: [_jsxs("div", { className: "stat-card", children: [_jsx("span", { children: "Pick" }), _jsx("strong", { children: stats.picked })] }), _jsxs("div", { className: "stat-card", children: [_jsx("span", { children: "Scartate" }), _jsx("strong", { children: stats.rejected })] }), _jsxs("div", { className: "stat-card", children: [_jsx("span", { children: "Neutre" }), _jsx("strong", { children: stats.unmarked })] }), _jsxs("div", { className: "stat-card", children: [_jsx("span", { children: "Escluse" }), _jsx("strong", { children: stats.totalImported - stats.totalActive })] })] }), stats.totalActive > 0 ? (_jsxs("div", { className: "selection-summary__rating-distribution", children: [_jsx("span", { className: "selection-summary__label", children: "Distribuzione stelle" }), _jsx("div", { className: "selection-summary__rating-bars", children: [5, 4, 3, 2, 1, 0].map((rating) => (_jsxs("div", { className: "selection-summary__rating-row", children: [_jsx("span", { className: "selection-summary__rating-label", children: rating > 0 ? "★".repeat(rating) : "Nessuna" }), _jsx("div", { className: "selection-summary__rating-bar", children: _jsx("div", { className: "selection-summary__rating-fill", style: {
                                            width: `${stats.totalActive > 0 ? (stats.ratingCounts[rating] / stats.totalActive) * 100 : 0}%`,
                                        } }) }), _jsx("span", { className: "selection-summary__rating-count", children: stats.ratingCounts[rating] })] }, rating))) })] })) : null, Object.keys(stats.colorCounts).length > 0 ? (_jsxs("div", { className: "selection-summary__colors", children: [_jsx("span", { className: "selection-summary__label", children: "Etichette colore" }), _jsx("div", { className: "selection-summary__color-chips", children: Object.entries(stats.colorCounts).map(([color, count]) => (_jsxs("span", { className: "selection-summary__color-chip", children: [_jsx("span", { className: `asset-color-dot asset-color-dot--${color}` }), _jsxs("span", { children: [COLOR_LABEL_NAMES[color], " (", count, ")"] })] }, color))) })] })) : null] }));
}
//# sourceMappingURL=SelectionSummary.js.map