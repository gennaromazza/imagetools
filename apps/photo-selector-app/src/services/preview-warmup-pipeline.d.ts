type WarmPreviewFn = (assetId: string, maxDimension: number, priority: number) => Promise<boolean>;
export declare class PreviewWarmupPipeline {
    private queue;
    private queued;
    private active;
    private destroyed;
    private readonly concurrency;
    private readonly warmPreview;
    constructor(warmPreview: WarmPreviewFn);
    enqueue(items: Array<{
        assetId: string;
        maxDimension: number;
    }>, priority?: number): void;
    destroy(): void;
    private sortQueue;
    private schedule;
}
export {};
