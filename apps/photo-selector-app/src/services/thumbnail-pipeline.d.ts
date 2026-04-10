export interface ThumbnailUpdate {
    id: string;
    url: string;
    blob: Blob;
    width: number;
    height: number;
    sourceFileKey?: string;
}
type BatchCallback = (batch: ThumbnailUpdate[]) => void;
type ErrorCallback = (failedCount: number, failedId: string) => void;
export interface ThumbnailPipelineOptions {
    maxDimension?: number;
    quality?: number;
    minimumPreviewShortSide?: number;
}
interface QueueItem {
    id: string;
    file?: File;
    loadFile?: () => Promise<File | null>;
    absolutePath?: string;
    sourceFileKey?: string;
    createSourceFileKey?: (file: File) => string;
    priority: number;
}
export declare class ThumbnailPipeline {
    private queue;
    private queuedItems;
    private activeDesktopTasks;
    private completed;
    private failedIds;
    private pendingBatch;
    private batchTimer;
    private destroyed;
    private onBatch;
    private onError;
    private maxDimension;
    private quality;
    private desktopTaskLimit;
    constructor(onBatch: BatchCallback, onError?: ErrorCallback, options?: ThumbnailPipelineOptions);
    enqueue(items: Array<Omit<QueueItem, "priority">>, priority?: number): void;
    updateViewport(visibleIds: Set<string>, prioritizedIds?: Set<string>): void;
    get pendingCount(): number;
    get completedCount(): number;
    get failedCount(): number;
    updateOptions(options?: ThumbnailPipelineOptions): void;
    invalidate(ids: Iterable<string>): void;
    destroy(): void;
    private sortQueue;
    private schedule;
    private dispatchDesktop;
    private releaseDesktopTask;
    private markCompleted;
    private markFailed;
    private flushBatch;
}
export {};
