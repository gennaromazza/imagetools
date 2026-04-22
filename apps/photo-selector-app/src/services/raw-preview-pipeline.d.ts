export declare class RawPreviewPipeline {
    private workers;
    private busyWorkers;
    private queue;
    private currentJobByWorker;
    private readonly poolSize;
    constructor();
    private spawnWorker;
    extract(id: string, buffer: ArrayBuffer, priority?: number): Promise<ArrayBuffer | null>;
    bumpPriority(id: string, priority?: number): void;
    private findInFlightJob;
    private sortQueue;
    private dispatch;
    private releaseWorker;
    private resolveJob;
    private handleWorkerMessage;
    private handleWorkerCrash;
}
