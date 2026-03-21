import { extractEmbeddedJpeg } from "./raw-jpeg-extractor";

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<RawPreviewRequest>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

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

workerScope.onmessage = (event: MessageEvent<RawPreviewRequest>) => {
  const { id, buffer } = event.data;

  try {
    const jpegBuffer = extractEmbeddedJpeg(buffer);
    if (!jpegBuffer) {
      workerScope.postMessage({
        id,
        error: "No embedded preview found",
      } satisfies RawPreviewError);
      return;
    }

    workerScope.postMessage(
      {
        id,
        jpegBuffer,
      } satisfies RawPreviewResult,
      [jpegBuffer],
    );
  } catch (error) {
    workerScope.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies RawPreviewError);
  }
};
