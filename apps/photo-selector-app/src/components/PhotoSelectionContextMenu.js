import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { createPortal } from "react-dom";
import { useLayoutEffect, useRef, useState } from "react";
import { COLOR_LABEL_NAMES, COLOR_LABELS, getColorShortcutHint, PICK_STATUS_LABELS, } from "../services/photo-classification";
export function PhotoSelectionContextMenu({ x, y, targetCount, colorLabelNames = COLOR_LABEL_NAMES, hasFileAccess = true, rootFolderPath, targetPath, onApplyRating, onApplyPickStatus, onApplyColor, onInvertVisible, onClearSelection, onToggleSelection, onOpenPreview, onCopyFiles, onMoveFiles, onSaveAs, onCopyPath, onOpenWithEditor, }) {
    const menuRef = useRef(null);
    const MARGIN = 12;
    // Start invisible at click position; after first paint measure real size and reposition.
    const [pos, setPos] = useState({
        top: y,
        left: x,
        visible: false,
    });
    useLayoutEffect(() => {
        const el = menuRef.current;
        if (!el)
            return;
        const h = el.offsetHeight;
        const w = el.offsetWidth;
        const top = y + h + MARGIN > window.innerHeight
            ? Math.max(MARGIN, window.innerHeight - h - MARGIN)
            : y;
        const left = x + w + MARGIN > window.innerWidth
            ? Math.max(MARGIN, window.innerWidth - w - MARGIN)
            : x;
        setPos({ top, left, visible: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [x, y]);
    const menu = (_jsxs("div", { ref: menuRef, className: "selection-context-menu", style: {
            left: `${pos.left}px`,
            top: `${pos.top}px`,
            visibility: pos.visible ? "visible" : "hidden",
        }, onMouseDown: (event) => event.stopPropagation(), role: "menu", "aria-label": targetCount === 1
            ? "Menu contestuale della foto selezionata"
            : `Menu contestuale per ${targetCount} foto selezionate`, children: [_jsx("div", { className: "selection-context-menu__header", children: _jsx("strong", { children: targetCount === 1 ? "1 foto selezionata" : `${targetCount} foto selezionate` }) }), _jsxs("div", { className: "selection-context-menu__section", children: [_jsxs("button", { type: "button", className: "selection-context-menu__action-item", onClick: onOpenPreview, role: "menuitem", children: [_jsx("span", { className: "icon", children: "\uD83D\uDD0D" }), " Anteprima a tutto schermo ", _jsx("span", { className: "shortcut", children: "Space" })] }), _jsxs("button", { type: "button", className: "selection-context-menu__action-item", onClick: onToggleSelection, role: "menuitem", children: [_jsx("span", { className: "icon", children: "\u2705" }), " ", targetCount === 1 ? "Inverti selezione singola" : "Aggiungi/Rimuovi tutto", " ", _jsx("span", { className: "shortcut", children: "Click" })] })] }), _jsx("div", { className: "selection-context-menu__divider" }), _jsxs("div", { className: "selection-context-menu__section", children: [_jsxs("span", { className: "selection-context-menu__label", children: ["Valutazione ", _jsx("span", { className: "shortcut-hint", children: "1-5" })] }), _jsxs("div", { className: "selection-context-menu__stars", children: [[1, 2, 3, 4, 5].map((value) => (_jsxs("button", { type: "button", className: "selection-context-menu__star", onClick: () => onApplyRating(value), role: "menuitem", children: [value, "\u2605"] }, value))), _jsx("button", { type: "button", className: "selection-context-menu__ghost", style: { fontSize: "0.7rem", padding: "0.2rem 0.4rem" }, onClick: () => onApplyRating(0), role: "menuitem", children: "0" })] })] }), _jsxs("div", { className: "selection-context-menu__section", children: [_jsxs("span", { className: "selection-context-menu__label", children: ["Stato ", _jsx("span", { className: "shortcut-hint", children: "P / X / U" })] }), _jsx("div", { className: "selection-context-menu__pills", children: ["picked", "rejected", "unmarked"].map((value) => (_jsx("button", { type: "button", className: `selection-context-menu__pill selection-context-menu__pill--${value}`, onClick: () => onApplyPickStatus(value), role: "menuitem", children: PICK_STATUS_LABELS[value] }, value))) })] }), _jsxs("div", { className: "selection-context-menu__section", children: [_jsxs("span", { className: "selection-context-menu__label", children: ["Etichetta colore ", _jsx("span", { className: "shortcut-hint", children: "6-9 / V" })] }), _jsxs("div", { className: "selection-context-menu__colors", children: [_jsx("button", { type: "button", className: "selection-context-menu__color-remove", onClick: () => onApplyColor(null), title: "Rimuovi colore (V)", role: "menuitem", children: "\u2715" }), COLOR_LABELS.map((value) => (_jsx("button", { type: "button", className: `asset-color-dot asset-color-dot--${value} asset-color-dot--interactive`, title: `${colorLabelNames[value]} | ${getColorShortcutHint(value)}`, onClick: () => onApplyColor(value), role: "menuitem" }, value)))] })] }), _jsx("div", { className: "selection-context-menu__section", children: _jsxs("button", { type: "button", className: "selection-context-menu__action-item", onClick: onInvertVisible, role: "menuitem", children: [_jsx("span", { className: "icon", children: "\uD83D\uDD04" }), " Inverti visibili"] }) }), _jsx("div", { className: "selection-context-menu__divider" }), _jsxs("div", { className: "selection-context-menu__section", children: [_jsx("span", { className: "selection-context-menu__label", children: "Operazioni file" }), _jsxs("button", { type: "button", className: "selection-context-menu__action-item", onClick: onOpenWithEditor, role: "menuitem", title: "Apre le foto nell'editor predefinito tramite script BAT (supporta selezione multipla)", children: [_jsx("span", { className: "icon", children: "\uD83C\uDFA8" }), " Apri con editor"] }), _jsxs("button", { type: "button", className: "selection-context-menu__action-item", onClick: onSaveAs, role: "menuitem", title: "Salva una copia accessibile per aprirla in Photoshop o altro editor", children: [_jsx("span", { className: "icon", children: "\uD83D\uDCBE" }), " Salva copia come..."] }), _jsxs("button", { type: "button", className: "selection-context-menu__action-item", onClick: onCopyFiles, role: "menuitem", title: "Copia i file fisicamente in un'altra cartella", children: [_jsx("span", { className: "icon", children: "\uD83D\uDCC1" }), " Copia in cartella..."] }), _jsxs("button", { type: "button", className: "selection-context-menu__action-item", onClick: onMoveFiles, role: "menuitem", title: "Sposta i file fisicamente in un'altra cartella (rimuove dall'originale)", children: [_jsx("span", { className: "icon", children: "\u2702\uFE0F" }), " Sposta in cartella..."] }), _jsxs("button", { type: "button", className: "selection-context-menu__action-item", onClick: onCopyPath, role: "menuitem", title: rootFolderPath && targetPath ? `${rootFolderPath.replace(/[\\/]+$/, "")}/${targetPath}` : !rootFolderPath ? "Imposta la cartella radice in ⚙ per ottenere il percorso assoluto" : "Copia il percorso negli appunti", children: [_jsx("span", { className: "icon", children: "\uD83D\uDCCB" }), " Copia percorso", !rootFolderPath ? " (configura radice in ⚙)" : ""] })] }), _jsx("div", { className: "selection-context-menu__divider" }), _jsx("div", { className: "selection-context-menu__section", children: _jsxs("button", { type: "button", className: "selection-context-menu__action-item selection-context-menu__action-item--danger", onClick: onClearSelection, role: "menuitem", children: [_jsx("span", { className: "icon", children: "\u2298" }), " Deseleziona tutto"] }) })] }));
    if (typeof document === "undefined") {
        return menu;
    }
    return createPortal(menu, document.body);
}
//# sourceMappingURL=PhotoSelectionContextMenu.js.map