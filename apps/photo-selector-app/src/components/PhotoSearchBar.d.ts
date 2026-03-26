interface PhotoSearchBarProps {
    value: string;
    onChange: (query: string) => void;
    resultCount: number;
    totalCount: number;
}
export declare function PhotoSearchBar({ value, onChange, resultCount, totalCount }: PhotoSearchBarProps): import("react/jsx-runtime").JSX.Element;
export {};
