import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
export function DismissibleBanner({ title, message, type = "info", onDismiss, icon, action }) {
    const [isDismissed, setIsDismissed] = useState(false);
    const handleDismiss = () => {
        setIsDismissed(true);
        onDismiss?.();
    };
    if (isDismissed)
        return null;
    const typeIcons = {
        info: "i",
        success: "OK",
        warning: "!",
        error: "ER"
    };
    return (_jsxs("div", { className: `dismissible-banner dismissible-banner--${type}`, children: [_jsxs("div", { className: "dismissible-banner__content", children: [_jsx("div", { className: "dismissible-banner__icon", children: icon || typeIcons[type] }), _jsxs("div", { className: "dismissible-banner__text", children: [_jsx("h4", { className: "dismissible-banner__title", children: title }), _jsx("p", { className: "dismissible-banner__message", children: message })] })] }), _jsxs("div", { className: "dismissible-banner__actions", children: [action && (_jsx("button", { type: "button", className: "dismissible-banner__action-button", onClick: action.onClick, children: action.label })), _jsx("button", { type: "button", className: "dismissible-banner__close", onClick: handleDismiss, "aria-label": "Chiudi questo messaggio", title: "Chiudi", children: "x" })] })] }));
}
//# sourceMappingURL=DismissibleBanner.js.map