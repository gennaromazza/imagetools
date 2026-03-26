import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function ConfirmModal({ title, description, confirmText = "Conferma", cancelText = "Annulla", isDangerous = true, children, onConfirm, onCancel }) {
    return (_jsx("div", { className: "modal-backdrop", onClick: onCancel, children: _jsxs("div", { className: "modal-panel modal-panel--confirm", onClick: (e) => e.stopPropagation(), role: "alertdialog", "aria-modal": "true", "aria-labelledby": "confirm-title", "aria-describedby": "confirm-description", children: [_jsx("div", { className: "modal-panel__header", children: _jsxs("div", { children: [_jsx("h2", { id: "confirm-title", children: title }), _jsx("p", { id: "confirm-description", children: description })] }) }), children ? _jsx("div", { className: "modal-panel__body", children: children }) : null, _jsxs("div", { className: "modal-panel__footer", children: [_jsx("button", { type: "button", className: "ghost-button", onClick: onCancel, children: cancelText }), _jsx("button", { type: "button", className: isDangerous ? "primary-button primary-button--danger" : "primary-button", onClick: () => {
                                onConfirm();
                                onCancel();
                            }, children: confirmText })] })] }) }));
}
//# sourceMappingURL=ConfirmModal.js.map