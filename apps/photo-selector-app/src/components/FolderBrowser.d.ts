import { type FolderOpenResult } from "../services/folder-access";
interface FolderBrowserProps {
    onFolderOpened: (result: FolderOpenResult) => void | Promise<void>;
}
export declare function FolderBrowser({ onFolderOpened }: FolderBrowserProps): import("react/jsx-runtime").JSX.Element;
export {};
