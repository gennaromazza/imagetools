import { type FolderEntry } from "../services/folder-access";
interface FolderBrowserProps {
    onFolderOpened: (name: string, entries: FolderEntry[]) => void;
}
export declare function FolderBrowser({ onFolderOpened }: FolderBrowserProps): import("react/jsx-runtime").JSX.Element;
export {};
