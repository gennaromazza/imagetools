import {
  calculateGridLayout,
  calculatePhotoSizeForCount,
  getCenteredPagePositions,
  PHOTO_COUNT_ASPECTS,
  PHOTO_PRESETS,
  photoFitsSheet,
  SHEET_PRESETS,
  type GridLayout,
  type PhotoPreset,
  type PhotoPrintSpec,
  type PrintSheetSpec,
  type SheetOrientation,
} from "./print-engine";

/**
 * Cosa l'utente vuole stampare. È il primo dato del percorso guidato: la carta
 * viene scelta dopo, valutandola contro questo obiettivo.
 */
export type PrintGoal =
  | { kind: "count"; count: number; aspectId: string }
  | { kind: "format"; presetId: string }
  | { kind: "custom"; widthCm: number; heightCm: number };

/** Carta tra cui scegliere: i fogli standard più, se serve, il supporto originale del formato. */
export interface PaperOption {
  id: string;
  label: string;
  widthCm: number;
  heightCm: number;
  marginMm: number;
  gapMm: number;
  /** "media": il foglio coincide con il formato (es. carta Hi-Print), una foto per foglio. */
  kind: "preset" | "media" | "custom";
}

export const CUSTOM_PAPER_ID = "custom";
export const MEDIA_PAPER_PREFIX = "media:";
export const DEFAULT_PAPER_ID = "a4";

export interface PaperChoice {
  /** null = nessuna scelta ancora: vale la carta consigliata per l'obiettivo. */
  paperId: string | null;
  customWidthCm: number;
  customHeightCm: number;
  marginMm: number | null;
  gapMm: number | null;
  orientation: SheetOrientation;
}

export const DEFAULT_PAPER_CHOICE: PaperChoice = {
  paperId: null,
  customWidthCm: 15,
  customHeightCm: 10,
  marginMm: null,
  gapMm: null,
  orientation: "auto",
};

export const MIN_PHOTO_EDGE_CM = 1;
export const MAX_PHOTO_EDGE_CM = 120;
export const MAX_PHOTOS_PER_PAGE = 100;

export function getPhotoPreset(presetId: string): PhotoPreset | undefined {
  return PHOTO_PRESETS.find((preset) => preset.presetId === presetId);
}

export function getStandardPapers(): PaperOption[] {
  return SHEET_PRESETS
    .filter((preset) => preset.presetId !== CUSTOM_PAPER_ID)
    .map((preset) => ({
      id: preset.presetId,
      label: preset.label,
      widthCm: preset.widthCm,
      heightCm: preset.heightCm,
      marginMm: preset.marginMm,
      gapMm: preset.gapMm,
      kind: "preset" as const,
    }));
}

export function isGoalValid(goal: PrintGoal): boolean {
  if (goal.kind === "count") {
    return Number.isInteger(goal.count) && goal.count >= 1 && goal.count <= MAX_PHOTOS_PER_PAGE;
  }
  if (goal.kind === "format") return Boolean(getPhotoPreset(goal.presetId));
  return Number.isFinite(goal.widthCm)
    && Number.isFinite(goal.heightCm)
    && goal.widthCm >= MIN_PHOTO_EDGE_CM
    && goal.heightCm >= MIN_PHOTO_EDGE_CM
    && goal.widthCm <= MAX_PHOTO_EDGE_CM
    && goal.heightCm <= MAX_PHOTO_EDGE_CM;
}

function mediaPaperFor(preset: PhotoPreset): PaperOption {
  return {
    id: `${MEDIA_PAPER_PREFIX}${preset.presetId}`,
    label: `Carta ${preset.label} (${preset.widthCm} × ${preset.heightCm} cm)`,
    widthCm: preset.widthCm,
    heightCm: preset.heightCm,
    marginMm: 0,
    gapMm: 0,
    kind: "media",
  };
}

/** Supporti reali (carta adesiva Hi-Print): si scelgono come carta, una foto per foglio. */
export function getMediaPapers(): PaperOption[] {
  return PHOTO_PRESETS.filter((preset) => preset.media).map(mediaPaperFor);
}

/** Tutte le carte tra cui l'utente può scegliere al passo «Carta». */
export function getAllPapers(): PaperOption[] {
  return [...getStandardPapers(), ...getMediaPapers()];
}

/** Il preset è un supporto reale: ha senso usarlo come foglio. */
export function goalOffersMediaPaper(goal: PrintGoal): PaperOption | null {
  if (goal.kind !== "format") return null;
  const preset = getPhotoPreset(goal.presetId);
  return preset?.media ? mediaPaperFor(preset) : null;
}

/** Carte confrontate per consigliare un'alternativa all'obiettivo: standard, più il supporto del formato scelto. */
export function getAvailablePapers(goal: PrintGoal): PaperOption[] {
  const media = goalOffersMediaPaper(goal);
  return media ? [media, ...getStandardPapers()] : getStandardPapers();
}

export function buildCustomPaper(choice: PaperChoice): PaperOption {
  return {
    id: CUSTOM_PAPER_ID,
    label: "Altra misura",
    widthCm: choice.customWidthCm,
    heightCm: choice.customHeightCm,
    marginMm: 3,
    gapMm: 1,
    kind: "custom",
  };
}

export function resolvePaperOption(goal: PrintGoal, choice: PaperChoice, recommendedId: string): PaperOption {
  void goal;
  const id = choice.paperId ?? recommendedId;
  if (id === CUSTOM_PAPER_ID) return buildCustomPaper(choice);
  const papers = getAllPapers();
  return papers.find((paper) => paper.id === id) ?? papers.find((paper) => paper.id === recommendedId) ?? papers[0];
}

export function toSheetSpec(paper: PaperOption, choice: PaperChoice): PrintSheetSpec {
  const media = paper.kind === "media";
  return {
    presetId: paper.id,
    label: paper.label,
    widthCm: paper.widthCm,
    heightCm: paper.heightCm,
    // Sul supporto originale non ci sono margini da personalizzare.
    marginMm: media ? 0 : (choice.marginMm ?? paper.marginMm),
    gapMm: media ? 0 : (choice.gapMm ?? paper.gapMm),
    orientation: choice.orientation,
  };
}

export interface ResolvedPhoto {
  spec: PhotoPrintSpec | null;
  fits: boolean;
}

/** Misura della singola foto per l'obiettivo, sul foglio indicato. */
export function resolvePhotoSpec(goal: PrintGoal, sheet: PrintSheetSpec, dpi: number): ResolvedPhoto {
  if (!isGoalValid(goal)) return { spec: null, fits: false };
  if (goal.kind === "count") {
    const ratio = PHOTO_COUNT_ASPECTS.find((aspect) => aspect.id === goal.aspectId)?.ratio ?? null;
    const result = calculatePhotoSizeForCount(sheet, goal.count, ratio);
    if (!result) return { spec: null, fits: false };
    return { spec: { widthCm: result.widthCm, heightCm: result.heightCm, dpi, frameStyle: "none" }, fits: true };
  }
  if (goal.kind === "format") {
    const preset = getPhotoPreset(goal.presetId);
    if (!preset) return { spec: null, fits: false };
    const spec: PhotoPrintSpec = {
      widthCm: preset.widthCm,
      heightCm: preset.heightCm,
      dpi,
      frameStyle: preset.frameStyle ?? "none",
    };
    return { spec, fits: photoFitsSheet(spec, sheet) };
  }
  const spec: PhotoPrintSpec = { widthCm: goal.widthCm, heightCm: goal.heightCm, dpi, frameStyle: "none" };
  return { spec, fits: photoFitsSheet(spec, sheet) };
}

export interface PaperEvaluation {
  paper: PaperOption;
  sheet: PrintSheetSpec;
  photo: PhotoPrintSpec | null;
  fits: boolean;
  /** Foto che finiscono davvero su ogni foglio pieno. */
  perPage: number;
  /** Fogli necessari per il numero di stampe richieste. */
  sheetsNeeded: number;
  /** Quota di carta coperta dalle foto (0-1). */
  coverage: number;
  /** Orientamento che il foglio avrà (con "auto" è quello che ne contiene di più). */
  orientation: "portrait" | "landscape";
  layout: GridLayout | null;
  recommended: boolean;
}

export function getPerPage(goal: PrintGoal, layout: GridLayout): number {
  if (layout.photosPerSheet <= 0) return 0;
  return goal.kind === "count" ? Math.max(1, Math.min(goal.count, layout.photosPerSheet)) : layout.photosPerSheet;
}

export function evaluatePaper(
  goal: PrintGoal,
  paper: PaperOption,
  choice: PaperChoice,
  options: { dpi: number; printCount: number },
): PaperEvaluation {
  const sheet = toSheetSpec(paper, choice);
  const resolved = resolvePhotoSpec(goal, sheet, options.dpi);
  const base = {
    paper,
    sheet,
    photo: resolved.spec,
    orientation: "portrait" as const,
    recommended: false,
  };
  if (!resolved.spec || !resolved.fits) {
    return { ...base, fits: false, perPage: 0, sheetsNeeded: 0, coverage: 0, layout: null };
  }
  const layout = calculateGridLayout(resolved.spec, sheet);
  const perPage = getPerPage(goal, layout);
  if (perPage <= 0) {
    return { ...base, fits: false, perPage: 0, sheetsNeeded: 0, coverage: 0, layout };
  }
  const photoArea = resolved.spec.widthCm * resolved.spec.heightCm;
  const sheetArea = layout.sheetWidthCm * layout.sheetHeightCm;
  return {
    ...base,
    fits: true,
    perPage,
    sheetsNeeded: Math.max(1, Math.ceil(Math.max(1, options.printCount) / perPage)),
    coverage: Math.min(1, (perPage * photoArea) / Math.max(0.001, sheetArea)),
    orientation: layout.sheetWidthCm <= layout.sheetHeightCm ? "portrait" : "landscape",
    layout,
  };
}

/** Tolleranza (8%) entro cui due carte consumano "la stessa" quantità di carta. */
const PAPER_AREA_TOLERANCE = 1.08;
/** Formati poco usati in Italia: mai consigliati se esiste un'alternativa. */
const NOT_RECOMMENDED_PAPER_IDS = new Set(["letter"]);

/**
 * Valuta ogni carta per l'obiettivo e indica quella consigliata: la carta che
 * consuma meno superficie in totale (fogli necessari × area del foglio). Tra
 * carte equivalenti vince quella con meno fogli, poi la più piccola. Per
 * "quante foto per pagina" la carta non cambia il numero di foto ma la loro
 * misura, quindi il consiglio è un default ragionevole (A4).
 */
export function evaluatePapers(
  goal: PrintGoal,
  choice: PaperChoice,
  options: { dpi: number; printCount: number },
): PaperEvaluation[] {
  const evaluations = getAvailablePapers(goal).map((paper) => evaluatePaper(goal, paper, choice, options));
  const recommendedId = recommendPaperId(goal, evaluations);
  return evaluations.map((evaluation) => ({ ...evaluation, recommended: evaluation.paper.id === recommendedId }));
}

export function recommendPaperId(goal: PrintGoal, evaluations: PaperEvaluation[]): string {
  if (goal.kind === "count") return "a4";
  const media = evaluations.find((evaluation) => evaluation.paper.kind === "media" && evaluation.fits);
  if (media) return media.paper.id;
  const usable = evaluations.filter((evaluation) => evaluation.fits);
  if (usable.length === 0) return "a4";
  const preferred = usable.filter((evaluation) => !NOT_RECOMMENDED_PAPER_IDS.has(evaluation.paper.id));
  const pool = preferred.length > 0 ? preferred : usable;
  const sheetArea = (evaluation: PaperEvaluation) => evaluation.paper.widthCm * evaluation.paper.heightCm;
  const consumed = (evaluation: PaperEvaluation) => evaluation.sheetsNeeded * sheetArea(evaluation);
  const minConsumed = Math.min(...pool.map(consumed));
  const candidates = pool.filter((evaluation) => consumed(evaluation) <= minConsumed * PAPER_AREA_TOLERANCE);
  candidates.sort((a, b) => (a.sheetsNeeded - b.sheetsNeeded) || (sheetArea(a) - sheetArea(b)));
  return candidates[0].paper.id;
}

export interface FormatEvaluation {
  preset: PhotoPreset;
  evaluation: PaperEvaluation;
}

/** Quanti esemplari di ogni formato istantaneo entrano nella carta scelta. */
export function evaluateFormats(
  paper: PaperOption,
  choice: PaperChoice,
  options: { dpi: number; printCount: number },
): FormatEvaluation[] {
  return PHOTO_PRESETS.map((preset) => ({
    preset,
    evaluation: evaluatePaper({ kind: "format", presetId: preset.presetId }, paper, choice, options),
  }));
}

export interface BorderlessSuggestion {
  currentPerPage: number;
  borderlessPerPage: number;
}

/**
 * Con margini e distanza a zero (stampa a bordo vivo) entrano più foto?
 * È il caso tipico di due 10×15 su un 15×20, che con 3 mm di margine mancano per pochi millimetri.
 */
export function suggestBorderless(
  goal: PrintGoal,
  paper: PaperOption,
  choice: PaperChoice,
  dpi: number,
): BorderlessSuggestion | null {
  if (goal.kind === "count" || paper.kind === "media" || !isGoalValid(goal)) return null;
  const perPage = (candidate: PaperChoice): number => {
    const sheet = toSheetSpec(paper, candidate);
    const resolved = resolvePhotoSpec(goal, sheet, dpi);
    if (!resolved.spec || !resolved.fits) return 0;
    return getPerPage(goal, calculateGridLayout(resolved.spec, sheet));
  };
  const currentPerPage = perPage(choice);
  const borderlessPerPage = perPage({ ...choice, marginMm: 0, gapMm: 0 });
  const alreadyBorderless = (choice.marginMm ?? paper.marginMm) === 0 && (choice.gapMm ?? paper.gapMm) === 0;
  if (alreadyBorderless || borderlessPerPage <= currentPerPage) return null;
  return { currentPerPage, borderlessPerPage };
}

export interface OrientationAdvice {
  portraitCount: number;
  landscapeCount: number;
  best: "portrait" | "landscape" | "equal";
}

export function adviseOrientation(goal: PrintGoal, paper: PaperOption, choice: PaperChoice, dpi: number): OrientationAdvice | null {
  const count = (orientation: SheetOrientation): number => {
    const sheet = toSheetSpec(paper, { ...choice, orientation });
    const resolved = resolvePhotoSpec(goal, sheet, dpi);
    if (!resolved.spec || !resolved.fits) return 0;
    return getPerPage(goal, calculateGridLayout(resolved.spec, sheet));
  };
  const portraitCount = count("portrait");
  const landscapeCount = count("landscape");
  if (portraitCount === 0 && landscapeCount === 0) return null;
  return {
    portraitCount,
    landscapeCount,
    best: portraitCount === landscapeCount ? "equal" : portraitCount > landscapeCount ? "portrait" : "landscape",
  };
}

/** Posizioni normalizzate (0-1) delle foto sul foglio, per le miniature. */
export function getThumbnailSlots(layout: GridLayout, perPage: number): Array<{ x: number; y: number; w: number; h: number }> {
  const positions = perPage >= layout.photosPerSheet
    ? layout.positions
    : getCenteredPagePositions(layout, perPage);
  return positions.slice(0, perPage).map((position) => ({
    x: position.x / layout.sheetWidthPx,
    y: position.y / layout.sheetHeightPx,
    w: layout.photoWidthPx / layout.sheetWidthPx,
    h: layout.photoHeightPx / layout.sheetHeightPx,
  }));
}

/** Riduce proporzionalmente la misura personalizzata finché entra nel foglio. */
export function shrinkGoalToSheet(goal: PrintGoal, sheet: PrintSheetSpec): PrintGoal {
  if (goal.kind !== "custom") return goal;
  let low = 0;
  let high = 1;
  const candidate = (factor: number): PhotoPrintSpec => ({
    widthCm: goal.widthCm * factor,
    heightCm: goal.heightCm * factor,
    dpi: 300,
  });
  if (photoFitsSheet(candidate(1), sheet)) return goal;
  for (let step = 0; step < 24; step += 1) {
    const mid = (low + high) / 2;
    if (photoFitsSheet(candidate(mid), sheet)) low = mid;
    else high = mid;
  }
  return {
    kind: "custom",
    widthCm: Math.max(MIN_PHOTO_EDGE_CM, Math.floor(goal.widthCm * low * 100) / 100),
    heightCm: Math.max(MIN_PHOTO_EDGE_CM, Math.floor(goal.heightCm * low * 100) / 100),
  };
}
