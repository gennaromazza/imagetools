import type { PreviewMediaFile } from "./previewPolicy.js";
import type { DesktopPhotoToolHandoffTargetToolId } from "@photo-tools/desktop-contracts";

export const PHOTO_TOOL_SELECTION_LIMIT = 500;

export type PhotoToolTargetId = DesktopPhotoToolHandoffTargetToolId;

export interface PhotoToolTargetDefinition {
  id: PhotoToolTargetId;
  label: string;
  selectionMode: "single" | "multiple";
}

export const PHOTO_TOOL_TARGETS: readonly PhotoToolTargetDefinition[] = [
  { id: "image-party-frame", label: "Party Frame", selectionMode: "multiple" },
  { id: "batch-print-layout", label: "Batch Layout", selectionMode: "multiple" },
  { id: "id-photo", label: "Photo ID", selectionMode: "single" },
] as const;

// Formati che i tre flussi desktop possono decodificare tramite il servizio
// immagini condiviso. I RAW restano visibili nell'archivio, ma non sono inviati
// automaticamente: richiedono prima sviluppo/conversione.
const ROUTABLE_PHOTO_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".tif",
  ".tiff",
  ".heic",
  ".heif",
]);

export interface SelectionUpdate {
  selectedPaths: Set<string>;
  addedCount: number;
  limitReached: boolean;
}

function normalizedExtension(file: Pick<PreviewMediaFile, "ext" | "fileName">): string {
  const declared = file.ext.trim().toLocaleLowerCase();
  if (declared) return declared.startsWith(".") ? declared : `.${declared}`;
  const dotIndex = file.fileName.lastIndexOf(".");
  return dotIndex >= 0 ? file.fileName.slice(dotIndex).toLocaleLowerCase() : "";
}

export function isPhotoToolCompatible(file: PreviewMediaFile): boolean {
  return file.mediaType === "photo" && ROUTABLE_PHOTO_EXTENSIONS.has(normalizedExtension(file));
}

export function togglePhotoSelection(
  current: ReadonlySet<string>,
  filePath: string,
  limit = PHOTO_TOOL_SELECTION_LIMIT,
): SelectionUpdate {
  const next = new Set(current);
  if (next.delete(filePath)) {
    return { selectedPaths: next, addedCount: 0, limitReached: false };
  }
  if (next.size >= limit) {
    return { selectedPaths: next, addedCount: 0, limitReached: true };
  }
  next.add(filePath);
  return { selectedPaths: next, addedCount: 1, limitReached: false };
}

export function addVisibleCompatiblePhotos(
  current: ReadonlySet<string>,
  visibleFiles: readonly PreviewMediaFile[],
  limit = PHOTO_TOOL_SELECTION_LIMIT,
): SelectionUpdate {
  const next = new Set(current);
  let addedCount = 0;
  let limitReached = false;
  for (const file of visibleFiles) {
    if (!isPhotoToolCompatible(file) || next.has(file.filePath)) continue;
    if (next.size >= limit) {
      limitReached = true;
      break;
    }
    next.add(file.filePath);
    addedCount += 1;
  }
  return { selectedPaths: next, addedCount, limitReached };
}

export function validatePhotoToolSelection(
  targetToolId: PhotoToolTargetId,
  selectedCount: number,
): { valid: true } | { valid: false; message: string } {
  if (selectedCount < 1) {
    return { valid: false, message: "Seleziona almeno una foto." };
  }
  if (selectedCount > PHOTO_TOOL_SELECTION_LIMIT) {
    return { valid: false, message: `Puoi inviare al massimo ${PHOTO_TOOL_SELECTION_LIMIT} foto alla volta.` };
  }
  if (targetToolId === "id-photo" && selectedCount !== 1) {
    return { valid: false, message: "Photo ID accetta una sola foto alla volta." };
  }
  return { valid: true };
}
