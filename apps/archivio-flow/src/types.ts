import type {
  ArchivioArchiveHierarchyConfig,
  ArchivioArchiveAnalysisItem,
  ArchivioArchiveAnalysisResult,
  ArchivioArchiveRenameResult,
  ArchivioArchiveRenameRequest,
  ArchivioFilterPreviewData,
  ArchivioImportProgressSnapshot,
  ArchivioImportRequest,
  ArchivioImportResult,
  ArchivioJob,
  ArchivioSelectionCandidate,
  ArchivioLowQualityProgressSnapshot,
  ArchivioSdCard,
  ArchivioSdPreview,
  ArchivioSettings,
} from "@photo-tools/desktop-contracts";

export type SdCard = ArchivioSdCard;
export type SdPreview = ArchivioSdPreview;
export type Job = ArchivioJob;
export type ImportRequest = ArchivioImportRequest;
export type ImportResult = ArchivioImportResult;
export type ImportProgressSnapshot = ArchivioImportProgressSnapshot;
export type LowQualityProgressSnapshot = ArchivioLowQualityProgressSnapshot;
export type ArchiveHierarchySettings = ArchivioArchiveHierarchyConfig;
export type ArchivioFlowSettings = ArchivioSettings;
export type FilterPreviewData = ArchivioFilterPreviewData;
export type SelectionCandidate = ArchivioSelectionCandidate;
export type ArchiveAnalysisItem = ArchivioArchiveAnalysisItem;
export type ArchiveAnalysisResult = ArchivioArchiveAnalysisResult;
export type ArchiveRenameResult = ArchivioArchiveRenameResult;
export type ArchiveRenameRequest = ArchivioArchiveRenameRequest;
