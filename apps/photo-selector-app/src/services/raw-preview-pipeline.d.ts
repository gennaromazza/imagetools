export declare class RawPreviewPipeline {
    private workers;
    private busyWorkers;
    private queue;
    private currentJobByWorker;
    constructor();
    extract(id: string, buffer: ArrayBuffer, priority?: number): Promise<ArrayBuffer | null>;
    bumpPriority(id: string, priority?: number): void;
    private sortQueue;
    private dispatch;
    private releaseWorker;
    private handleWorkerMessage;
    private handleWorkerCrash;
}
