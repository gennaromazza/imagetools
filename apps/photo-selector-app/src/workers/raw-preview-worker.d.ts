export interface RawPreviewRequest {
    id: string;
    buffer: ArrayBuffer;
}
export interface RawPreviewResult {
    id: string;
    jpegBuffer: ArrayBuffer;
}
export interface RawPreviewError {
    id: string;
    error: string;
}
