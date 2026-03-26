import { ToastType } from "./ToastProvider";
interface ToastProps {
    message: string;
    type: ToastType;
    onClose: () => void;
}
export declare function Toast({ message, type, onClose }: ToastProps): import("react/jsx-runtime").JSX.Element;
export {};
