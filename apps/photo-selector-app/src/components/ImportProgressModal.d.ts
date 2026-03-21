interface ImportProgressModalProps {
    isOpen: boolean;
    phase: "reading" | "preparing";
    supported: number;
    ignored: number;
    total: number;
    processed: number;
    currentFile: string | null;
    folderLabel: string;
}
export declare function ImportProgressModal({ isOpen, phase, supported, ignored, total, processed, currentFile, folderLabel }: ImportProgressModalProps): import("react/jsx-runtime").JSX.Element | null;
export {};
