import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { PHOTO_CLASSIFICATION_SHORTCUTS } from "../services/photo-classification";
export function PhotoClassificationHelpButton({ className, title = "Scorciatoie" }) {
    const [isOpen, setIsOpen] = useState(false);
    const rootRef = useRef(null);
    useEffect(() => {
        if (!isOpen) {
            return;
        }
        const handlePointerDown = (event) => {
            if (!rootRef.current?.contains(event.target)) {
                setIsOpen(false);
            }
        };
        const handleEscape = (event) => {
            if (event.key === "Escape") {
                setIsOpen(false);
            }
        };
        window.addEventListener("mousedown", handlePointerDown);
        window.addEventListener("keydown", handleEscape);
        return () => {
            window.removeEventListener("mousedown", handlePointerDown);
            window.removeEventListener("keydown", handleEscape);
        };
    }, [isOpen]);
    return (_jsxs("div", { ref: rootRef, className: className ? `shortcut-help ${className}` : "shortcut-help", children: [_jsx("button", { type: "button", className: "ghost-button shortcut-help__button", onClick: () => setIsOpen((current) => !current), "aria-expanded": isOpen, "aria-label": "Mostra scorciatoie classificazione foto", children: "Info" }), isOpen ? (_jsxs("div", { className: "shortcut-help__popover", role: "dialog", "aria-label": title, children: [_jsx("strong", { className: "shortcut-help__title", children: title }), _jsx("ul", { className: "shortcut-help__list", children: PHOTO_CLASSIFICATION_SHORTCUTS.map((item) => (_jsxs("li", { className: "shortcut-help__item", children: [_jsx("kbd", { className: "shortcut-help__kbd", children: item.keys }), _jsx("span", { children: item.description })] }, item.keys))) })] })) : null] }));
}
//# sourceMappingURL=PhotoClassificationHelpButton.js.map