import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { createPortal } from "react-dom";
import { COLOR_LABEL_NAMES, COLOR_LABELS, getColorShortcutHint } from "../services/photo-classification";
export function PhotoColorContextMenu({ x, y, selectedColor, title = "Etichetta colore", onSelect }) {
    const menu = (_jsxs("div", { className: "ribbon-color-menu", style: { left: `${x}px`, top: `${y}px` }, onMouseDown: (event) => event.stopPropagation(), children: [_jsx("span", { className: "ribbon-color-menu__title", children: title }), _jsx("button", { type: "button", className: "ribbon-color-menu__clear", onClick: () => onSelect(null), children: "Rimuovi colore" }), _jsx("div", { className: "ribbon-color-menu__swatches", children: COLOR_LABELS.map((value) => (_jsx("button", { type: "button", className: selectedColor === value
                        ? `asset-color-dot asset-color-dot--${value} asset-color-dot--selected`
                        : `asset-color-dot asset-color-dot--${value}`, title: `${COLOR_LABEL_NAMES[value]} | ${getColorShortcutHint(value)}`, onClick: () => onSelect(value) }, value))) })] }));
    if (typeof document === "undefined") {
        return menu;
    }
    return createPortal(menu, document.body);
}
//# sourceMappingURL=PhotoColorContextMenu.js.map