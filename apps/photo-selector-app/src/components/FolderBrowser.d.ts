import { type FolderOpenResult } from "../services/folder-access";
interface FolderBrowserProps {
    onFolderOpened: (result: FolderOpenResult) => void | Promise<void>;
    isBusy?: boolean;
}
export declare function FolderBrowser({ onFolderOpened, isBusy }: FolderBrowserProps): import("react/jsx-runtime").JSX.Element;
export {};
