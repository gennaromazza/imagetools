import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect } from "react";
function formatDiagnosticsSource(source) {
    switch (source) {
        case "desktop-native":
            return "Desktop Windows";
        case "browser-native":
            return "Browser picker";
        case "file-input":
            return "Fallback input";
        default:
            return source;
    }
}
export function ImportProgressModal({ isOpen, phase, supported, ignored, total, processed, currentFile, folderLabel, diagnostics, onDismiss, onCancel, }) {
    useEffect(() => {
        if (!isOpen) {
            return undefined;
        }
        const onKeyDown = (event) => {
            if (event.key !== "Escape") {
                return;
            }
            event.preventDefault();
            onDismiss();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [isOpen, onDismiss]);
    if (!isOpen) {
        return null;
    }
    const safeTotal = Math.max(total, 1);
    const progressPercent = phase === "reading" ? 8 : Math.round((processed / safeTotal) * 100);
    const phaseTitle = phase === "reading" ? "Lettura cartella" : "Preparazione anteprime";
    const phaseDescription = phase === "reading"
        ? "Sto controllando la cartella selezionata e contando le immagini supportate."
        : "Sto preparando anteprime e metadati delle foto per la schermata selezione.";
    return (_jsx("aside", { className: "import-progress-panel", "aria-live": "polite", children: _jsxs("div", { className: "modal-panel modal-panel--import import-progress-panel__content", role: "dialog", "aria-modal": "false", "aria-labelledby": "import-progress-title", children: [_jsxs("div", { className: "modal-panel__header", children: [_jsxs("div", { children: [_jsx("h2", { id: "import-progress-title", children: "Caricamento foto in corso" }), _jsx("p", { children: folderLabel || "Preparazione cartella selezionata" })] }), _jsx("button", { type: "button", className: "import-progress-panel__close", onClick: onDismiss, "aria-label": "Nascondi pannello caricamento", title: "Nascondi", children: "x" })] }), _jsxs("div", { className: "modal-panel__body import-progress", children: [_jsxs("div", { className: "import-progress__phase", children: [_jsx("span", { className: phase === "reading" ? "import-progress__phase-pill import-progress__phase-pill--active" : "import-progress__phase-pill", children: "1. Lettura cartella" }), _jsx("span", { className: phase === "preparing" ? "import-progress__phase-pill import-progress__phase-pill--active" : "import-progress__phase-pill", children: "2. Preparazione anteprime" })] }), _jsxs("div", { className: "import-progress__summary", children: [_jsx("strong", { children: phase === "reading" ? "Analisi cartella in corso" : `${processed} di ${total} immagini pronte` }), _jsxs("span", { children: [progressPercent, "%"] })] }), _jsxs("div", { className: "import-progress__counts", children: [_jsxs("span", { children: [supported, " immagini supportate"] }), _jsxs("span", { children: [ignored, " ignorate"] })] }), _jsx("div", { className: "progress-bar", "aria-hidden": "true", children: _jsx("div", { className: "progress-bar__fill", style: { width: `${progressPercent}%` } }) }), _jsxs("div", { className: "import-progress__status", children: [_jsx("span", { children: phaseTitle }), _jsx("strong", { children: currentFile ?? phaseDescription })] }), diagnostics ? (_jsxs("div", { className: "import-progress__diagnostics", children: [_jsxs("div", { className: "import-progress__diagnostics-header", children: [_jsx("strong", { children: "Diagnostica import" }), _jsx("span", { children: formatDiagnosticsSource(diagnostics.source) })] }), _jsxs("div", { className: "import-progress__diagnostics-grid", children: [_jsx("span", { children: "Path selezionato" }), _jsx("strong", { title: diagnostics.selectedPath, children: diagnostics.selectedPath }), _jsx("span", { children: "Top-level caricati" }), _jsx("strong", { children: diagnostics.topLevelSupportedCount }), _jsx("span", { children: "Annidati scartati" }), _jsx("strong", { children: diagnostics.nestedSupportedDiscardedCount }), _jsx("span", { children: "Totale supportate viste" }), _jsx("strong", { children: diagnostics.totalSupportedSeen })] })] })) : null, _jsx("p", { className: "import-progress__hint", children: phaseDescription })] }), _jsxs("div", { className: "modal-panel__footer", children: [_jsx("button", { type: "button", className: "ghost-button", onClick: onDismiss, children: "Nascondi" }), _jsx("button", { type: "button", className: "secondary-button", onClick: onCancel, children: "Annulla caricamento" })] })] }) }));
}
//# sourceMappingURL=ImportProgressModal.js.map