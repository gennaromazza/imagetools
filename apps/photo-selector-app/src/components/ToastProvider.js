import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { createContext, useContext, useState, useCallback } from "react";
import { Toast } from "./Toast";
const ToastContext = createContext(undefined);
export function useToast() {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error("useToast must be used within ToastProvider");
    }
    return context;
}
export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);
    const removeToast = useCallback((id) => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
    }, []);
    const addToast = useCallback((message, type = "info", duration = 4000) => {
        const id = `toast-${Date.now()}-${Math.random()}`;
        const toast = { id, message, type, duration };
        setToasts((current) => [...current, toast]);
        if (duration > 0) {
            setTimeout(() => removeToast(id), duration);
        }
    }, [removeToast]);
    return (_jsxs(ToastContext.Provider, { value: { addToast, removeToast }, children: [children, _jsx("div", { className: "toast-container", children: toasts.map((toast) => (_jsx(Toast, { message: toast.message, type: toast.type, onClose: () => removeToast(toast.id) }, toast.id))) })] }));
}
//# sourceMappingURL=ToastProvider.js.map