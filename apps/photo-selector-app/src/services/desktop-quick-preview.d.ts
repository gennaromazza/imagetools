import type { DesktopQuickPreviewFrame, DesktopQuickPreviewRequest, DesktopQuickPreviewWarmResult } from "@photo-tools/desktop-contracts";
export declare function hasDesktopQuickPreviewApi(): boolean;
export declare function getDesktopQuickPreviewFrame(request: DesktopQuickPreviewRequest): Promise<DesktopQuickPreviewFrame | null>;
export declare function getCachedDesktopQuickPreviewFrame(request: DesktopQuickPreviewRequest): DesktopQuickPreviewFrame | null;
export declare function peekDesktopQuickPreviewFrame(request: DesktopQuickPreviewRequest): DesktopQuickPreviewFrame | null;
export declare function clearDesktopQuickPreviewFrameCache(): void;
export declare function invalidateDesktopQuickPreviewFrame(request: DesktopQuickPreviewRequest): Promise<void>;
export declare function warmDesktopQuickPreviewFrames(requests: DesktopQuickPreviewRequest[]): Promise<DesktopQuickPreviewWarmResult | null>;
export declare function releaseDesktopQuickPreviewFrames(tokens: string[]): Promise<void>;
