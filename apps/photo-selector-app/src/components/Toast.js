import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function Toast({ message, type, onClose }) {
    const getIcon = () => {
        switch (type) {
            case "success":
                return "OK";
            case "error":
                return "ER";
            case "warning":
                return "!";
            case "info":
                return "i";
            default:
                return "";
        }
    };
    return (_jsxs("div", { className: `toast toast--${type}`, role: "status", "aria-live": "polite", children: [_jsx("span", { className: "toast__icon", children: getIcon() }), _jsx("p", { className: "toast__message", children: message }), _jsx("button", { type: "button", className: "toast__close", onClick: onClose, "aria-label": "Chiudi notifica", children: "x" })] }));
}
//# sourceMappingURL=Toast.js.map