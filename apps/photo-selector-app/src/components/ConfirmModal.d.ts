interface ConfirmModalProps {
    title: string;
    description: string;
    confirmText?: string;
    cancelText?: string;
    isDangerous?: boolean;
    children?: React.ReactNode;
    onConfirm: () => void;
    onCancel: () => void;
}
export declare function ConfirmModal({ title, description, confirmText, cancelText, isDangerous, children, onConfirm, onCancel }: ConfirmModalProps): import("react/jsx-runtime").JSX.Element;
export {};
