import type { FolderOpenDiagnostics } from "../services/folder-access";
interface ImportProgressModalProps {
    isOpen: boolean;
    phase: "reading" | "preparing";
    supported: number;
    ignored: number;
    total: number;
    processed: number;
    currentFile: string | null;
    folderLabel: string;
    diagnostics: FolderOpenDiagnostics | null;
    onDismiss: () => void;
    onCancel: () => void;
}
export declare function ImportProgressModal({ isOpen, phase, supported, ignored, total, processed, currentFile, folderLabel, diagnostics, onDismiss, onCancel, }: ImportProgressModalProps): import("react/jsx-runtime").JSX.Element | null;
export {};
