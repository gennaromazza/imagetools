import type { DesktopRuntimeInfo } from "@photo-tools/desktop-contracts";
export declare function getDesktopRuntimeInfo(): Promise<DesktopRuntimeInfo | null>;
export declare function consumePendingDesktopOpenFolderPath(): Promise<string | null>;
export declare function markDesktopOpenFolderRequestReady(): Promise<void>;
export declare function subscribeDesktopOpenFolderRequest(listener: (folderPath: string) => void): (() => void) | null;
