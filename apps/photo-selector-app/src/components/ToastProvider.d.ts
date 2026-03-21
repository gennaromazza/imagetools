import { ReactNode } from "react";
export type ToastType = "success" | "error" | "info" | "warning";
interface ToastContextType {
    addToast: (message: string, type: ToastType, duration?: number) => void;
    removeToast: (id: string) => void;
}
export declare function useToast(): ToastContextType;
interface ToastProviderProps {
    children: ReactNode;
}
export declare function ToastProvider({ children }: ToastProviderProps): import("react/jsx-runtime").JSX.Element;
export {};
