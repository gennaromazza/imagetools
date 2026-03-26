interface DismissibleBannerProps {
    title: string;
    message: string;
    type?: "info" | "success" | "warning" | "error";
    onDismiss?: () => void;
    icon?: React.ReactNode;
    action?: {
        label: string;
        onClick: () => void;
    };
}
export declare function DismissibleBanner({ title, message, type, onDismiss, icon, action }: DismissibleBannerProps): import("react/jsx-runtime").JSX.Element | null;
export {};
