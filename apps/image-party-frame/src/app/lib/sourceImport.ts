const PARTY_FRAME_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".tif",
  ".tiff",
  ".heic",
  ".heif",
]);

export function isPartyFrameSourceName(name: string): boolean {
  const dotIndex = name.lastIndexOf(".");
  return dotIndex >= 0 && PARTY_FRAME_IMAGE_EXTENSIONS.has(name.slice(dotIndex).toLocaleLowerCase());
}

export function createNativeFilePlaceholder(name: string, lastModified: number): File {
  return new File([], name, { lastModified });
}

export interface NativeSourceReference {
  absolutePath?: string;
  size?: number;
  lastModified?: number;
  path: string;
}

export interface NativeSourceStat {
  name: string;
  absolutePath: string;
  size: number;
  lastModified: number;
}

export function restoreVerifiedNativeSessionFiles(
  references: readonly NativeSourceReference[],
  stats: readonly NativeSourceStat[]
): File[] | null {
  const byPath = new Map(stats.map((entry) => [entry.absolutePath, entry]));
  const restored = references.map((reference) => {
    if (!reference.absolutePath) return null;
    const current = byPath.get(reference.absolutePath);
    if (!current) return null;
    if (reference.size !== undefined && reference.size !== current.size) return null;
    if (
      reference.lastModified !== undefined &&
      Math.abs(reference.lastModified - current.lastModified) > 1
    ) {
      return null;
    }
    return createNativeFilePlaceholder(current.name || reference.path, current.lastModified);
  });

  return restored.some((file) => file === null) ? null : restored as File[];
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("La concorrenza deve essere un intero positivo");
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runWorker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]!, index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker())
  );
  return results;
}
