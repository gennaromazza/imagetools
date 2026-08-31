import type { PersistedIdPhotoAsset } from "./job-store";

export function buildRehydrationCandidates(record: PersistedIdPhotoAsset): string[] {
  const newestSnapshotsFirst = (record.revisions ?? [])
    .filter((revision) => revision.kind === "photoshop")
    .slice()
    .reverse()
    .map((revision) => revision.absolutePath);
  const candidates = [
    record.workingCopyPath,
    ...newestSnapshotsFirst,
    record.absolutePath,
    record.originalAbsolutePath,
  ].filter((path): path is string => Boolean(path));
  const unique = new Map<string, string>();
  for (const path of candidates) {
    const key = path.toLocaleLowerCase();
    if (!unique.has(key)) unique.set(key, path);
  }
  return Array.from(unique.values());
}
