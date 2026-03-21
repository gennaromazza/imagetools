interface InputPanelProps {
    sourceFolderPath: string;
    loadedImages: number;
    activeImages: number;
    totalImages: number;
    verticalCount: number;
    horizontalCount: number;
    squareCount: number;
    isImporting: boolean;
    usesMockData: boolean;
    onSourceFolderChange: (value: string) => void;
    onFolderSelected: (files: FileList | null) => void;
    onLoadMockData: () => void;
    onOpenSelector: () => void;
}
export declare function InputPanel({ sourceFolderPath, loadedImages, activeImages, totalImages, verticalCount, horizontalCount, squareCount, isImporting, usesMockData, onSourceFolderChange, onFolderSelected, onLoadMockData, onOpenSelector }: InputPanelProps): import("react/jsx-runtime").JSX.Element;
export {};
