import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, Crop, ImagePlus, Move, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  CustomTemplate,
  CustomTemplateVariant,
  getCustomTemplateBackgroundFiles,
  setCustomTemplateBackgroundFile,
  useProject,
} from "../contexts/ProjectContext";
import { cmToPx } from "../lib/templateGeometry";
import { saveTemplateToLibrary } from "../lib/savedTemplates";
import { preserveCustomTemplateLibraryIdentity } from "../lib/templateLibrary";

type Orientation = "vertical" | "horizontal";

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type VariantDraft = {
  widthCm: string;
  heightCm: string;
  dpi: string;
  photoRatioX: string;
  photoRatioY: string;
  lockAspectRatio: boolean;
  photoArea: Rect;
  backgroundPreviewUrl: string;
  backgroundFileName: string;
  borderSizePx: string;
  borderColor: string;
};

type BackgroundFeedback = {
  message: string;
  tone: "muted" | "warning" | "success";
};

type DragState = {
  pointerId: number;
  orientation: Orientation;
  startX: number;
  startY: number;
  origin: Rect;
  mode: "move" | "resize";
};

type PreviewGeometry = {
  widthPx: number;
  heightPx: number;
  ratio: number;
  photoArea: Rect;
  borderSizePx: number;
};

type VariantValidationResult =
  | { ok: true; variant: CustomTemplateVariant }
  | { ok: false; errors: string[] };

type TemplateBuildResult =
  | { ok: true; template: CustomTemplate }
  | { ok: false; errors: string[] };

const DEFAULT_DPI = 300;
const MIN_SIZE_CM = 1;
const MAX_SIZE_CM = 100;
const MIN_DPI = 72;
const MAX_DPI = 600;
const MIN_CANVAS_SIDE_PX = 64;
const MAX_CANVAS_SIDE_PX = 12_000;
const MAX_CANVAS_PIXELS = 50_000_000;
const MIN_PHOTO_AREA_SIDE_PX = 40;
const MIN_RATIO_PART = 0.1;
const MAX_RATIO_PART = 100;
const MIN_PHOTO_ASPECT_RATIO = 0.1;
const MAX_PHOTO_ASPECT_RATIO = 10;
const MAX_BORDER_SIZE_PX = 2_000;
const MAX_CLIENT_OPTIMIZATION_PIXELS = 24_000_000;
const SOFT_WARNING_BYTES = 12 * 1024 * 1024;
const AUTO_OPTIMIZE_BYTES = 18 * 1024 * 1024;
const HARD_LIMIT_BYTES = 35 * 1024 * 1024;

function formatFileSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFeedbackToneClass(tone: BackgroundFeedback["tone"]): string {
  switch (tone) {
    case "warning":
      return "text-[var(--brand-accent)]";
    case "success":
      return "text-[var(--success)]";
    default:
      return "text-[var(--app-text-muted)]";
  }
}

async function loadImageElement(file: File): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file);

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Impossibile leggere ${file.name}`));
    };
    image.src = objectUrl;
  });
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Impossibile ottimizzare l'immagine del template."));
        return;
      }
      resolve(blob);
    }, type, quality);
  });
}

async function optimizeTemplateBackground(
  file: File,
  targetWidth: number,
  targetHeight: number
): Promise<{
  file: File;
  feedback: BackgroundFeedback;
}> {
  if (file.size > HARD_LIMIT_BYTES) {
    throw new Error(`"${file.name}" pesa ${formatFileSize(file.size)}. Il limite per gli sfondi template è 35 MB.`);
  }

  const image = await loadImageElement(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (sourceWidth < 1 || sourceHeight < 1) {
    throw new Error(`"${file.name}" non contiene un'immagine con dimensioni valide.`);
  }
  const boundedWidth = Math.max(targetWidth, Math.round(targetWidth * 1.15));
  const boundedHeight = Math.max(targetHeight, Math.round(targetHeight * 1.15));
  const scale = Math.min(1, boundedWidth / sourceWidth, boundedHeight / sourceHeight);
  const shouldResize = scale < 0.98;
  const shouldOptimize = file.size > AUTO_OPTIMIZE_BYTES || shouldResize;
  const shouldWarn = file.size > SOFT_WARNING_BYTES;

  if (!shouldOptimize) {
    if (shouldWarn) {
      return {
        file,
        feedback: {
          tone: "warning",
          message: `Sfondo pesante (${formatFileSize(file.size)}). Nessuna ottimizzazione applicata.`,
        },
      };
    }

    return {
      file,
      feedback: {
        tone: "muted",
        message: `Sfondo pronto: ${formatFileSize(file.size)}.`,
      },
    };
  }

  const outputWidth = Math.max(1, Math.round(sourceWidth * scale));
  const outputHeight = Math.max(1, Math.round(sourceHeight * scale));
  if (outputWidth * outputHeight > MAX_CLIENT_OPTIMIZATION_PIXELS) {
    return {
      file,
      feedback: {
        tone: "warning",
        message: `Sfondo ad alta risoluzione mantenuto originale (${formatFileSize(file.size)}) per evitare un'elaborazione troppo pesante nel browser.`,
      },
    };
  }

  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Impossibile preparare il canvas per ottimizzare lo sfondo.");
  }

  context.drawImage(image, 0, 0, outputWidth, outputHeight);
  const blob = await canvasToBlob(canvas, "image/webp", file.size > AUTO_OPTIMIZE_BYTES ? 0.88 : 0.92);
  const optimizedFile =
    blob.size < file.size || shouldResize
      ? new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", {
          type: "image/webp",
          lastModified: file.lastModified,
        })
      : file;

  const optimizedMessage =
    optimizedFile === file
      ? `Sfondo mantenuto originale: ${formatFileSize(file.size)}.`
      : `Sfondo ottimizzato da ${formatFileSize(file.size)} a ${formatFileSize(optimizedFile.size)}.`;

  return {
    file: optimizedFile,
    feedback: {
      tone: optimizedFile === file ? "warning" : "success",
      message: optimizedMessage,
    },
  };
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteNumberOr(value: string | number, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createCenteredPhotoArea(widthPx: number, heightPx: number, ratio: number): Rect {
  const maximumWidth = Math.max(MIN_PHOTO_AREA_SIDE_PX, Math.round(widthPx * 0.8));
  const maximumHeight = Math.max(MIN_PHOTO_AREA_SIDE_PX, Math.round(heightPx * 0.8));
  let width = maximumWidth;
  let height = Math.round(width / ratio);

  if (height > maximumHeight) {
    height = maximumHeight;
    width = Math.round(height * ratio);
  }

  width = clampNumber(width, MIN_PHOTO_AREA_SIDE_PX, widthPx);
  height = clampNumber(height, MIN_PHOTO_AREA_SIDE_PX, heightPx);

  return {
    x: Math.round((widthPx - width) / 2),
    y: Math.round((heightPx - height) / 2),
    width,
    height,
  };
}

function createDefaultVariant(orientation: Orientation): VariantDraft {
  const widthCm = orientation === "vertical" ? "10" : "15";
  const heightCm = orientation === "vertical" ? "15" : "10";
  const widthPx = cmToPx(Number(widthCm), DEFAULT_DPI);
  const heightPx = cmToPx(Number(heightCm), DEFAULT_DPI);
  const ratio = orientation === "vertical" ? 3 / 4 : 4 / 3;

  return {
    widthCm,
    heightCm,
    dpi: String(DEFAULT_DPI),
    photoRatioX: orientation === "vertical" ? "3" : "4",
    photoRatioY: orientation === "vertical" ? "4" : "3",
    lockAspectRatio: true,
    photoArea: createCenteredPhotoArea(widthPx, heightPx, ratio),
    backgroundPreviewUrl: "",
    backgroundFileName: "",
    borderSizePx: "0",
    borderColor: "#ffffff",
  };
}

function variantToDraft(variant: CustomTemplateVariant | undefined): VariantDraft {
  if (!variant) {
    return createDefaultVariant("horizontal");
  }

  return {
    widthCm: String(variant.widthCm),
    heightCm: String(variant.heightCm),
    dpi: String(variant.dpi),
    photoRatioX: String(variant.photoAspectRatio),
    photoRatioY: "1",
    lockAspectRatio: variant.lockAspectRatio,
    photoArea: {
      x: variant.photoAreaX,
      y: variant.photoAreaY,
      width: variant.photoAreaWidth,
      height: variant.photoAreaHeight,
    },
    backgroundPreviewUrl: variant.backgroundPreviewUrl ?? "",
    backgroundFileName: variant.backgroundFileName ?? "",
    borderSizePx: String(variant.borderSizePx ?? 0),
    borderColor: variant.borderColor ?? "#ffffff",
  };
}

function clampRect(rect: Rect, bounds: { width: number; height: number }, lockAspectRatio: boolean, ratio: number): Rect {
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  let width = clampNumber(Math.round(rect.width), MIN_PHOTO_AREA_SIDE_PX, bounds.width);
  let height = clampNumber(Math.round(rect.height), MIN_PHOTO_AREA_SIDE_PX, bounds.height);

  if (lockAspectRatio) {
    height = Math.round(width / safeRatio);
    if (height > bounds.height) {
      height = bounds.height;
      width = Math.round(height * safeRatio);
    }
    width = clampNumber(width, MIN_PHOTO_AREA_SIDE_PX, bounds.width);
    height = clampNumber(height, MIN_PHOTO_AREA_SIDE_PX, bounds.height);
  }

  return {
    x: clampNumber(Math.round(rect.x), 0, Math.max(0, bounds.width - width)),
    y: clampNumber(Math.round(rect.y), 0, Math.max(0, bounds.height - height)),
    width,
    height,
  };
}

function orientationLabel(orientation: Orientation): string {
  return orientation === "vertical" ? "Verticale" : "Orizzontale";
}

function getPreviewGeometry(draft: VariantDraft): PreviewGeometry {
  const widthCm = clampNumber(finiteNumberOr(draft.widthCm, 10), MIN_SIZE_CM, MAX_SIZE_CM);
  const heightCm = clampNumber(finiteNumberOr(draft.heightCm, 15), MIN_SIZE_CM, MAX_SIZE_CM);
  const dpi = clampNumber(finiteNumberOr(draft.dpi, DEFAULT_DPI), MIN_DPI, MAX_DPI);
  const rawWidthPx = Math.max(MIN_CANVAS_SIDE_PX, cmToPx(widthCm, dpi));
  const rawHeightPx = Math.max(MIN_CANVAS_SIDE_PX, cmToPx(heightCm, dpi));
  const pixelScale = Math.min(
    1,
    MAX_CANVAS_SIDE_PX / rawWidthPx,
    MAX_CANVAS_SIDE_PX / rawHeightPx,
    Math.sqrt(MAX_CANVAS_PIXELS / (rawWidthPx * rawHeightPx))
  );
  const widthPx = Math.max(MIN_CANVAS_SIDE_PX, Math.round(rawWidthPx * pixelScale));
  const heightPx = Math.max(MIN_CANVAS_SIDE_PX, Math.round(rawHeightPx * pixelScale));
  const ratioX = clampNumber(finiteNumberOr(draft.photoRatioX, 4), MIN_RATIO_PART, MAX_RATIO_PART);
  const ratioY = clampNumber(finiteNumberOr(draft.photoRatioY, 3), MIN_RATIO_PART, MAX_RATIO_PART);
  const ratio = ratioX / ratioY;
  const rawPhotoArea = {
    x: finiteNumberOr(draft.photoArea.x, 0),
    y: finiteNumberOr(draft.photoArea.y, 0),
    width: finiteNumberOr(draft.photoArea.width, MIN_PHOTO_AREA_SIDE_PX),
    height: finiteNumberOr(draft.photoArea.height, MIN_PHOTO_AREA_SIDE_PX),
  };
  const photoArea = clampRect(rawPhotoArea, { width: widthPx, height: heightPx }, draft.lockAspectRatio, ratio);
  const maximumBorder = Math.max(0, Math.floor(Math.min(photoArea.width, photoArea.height) / 2) - 1);
  const borderSizePx = clampNumber(
    Math.round(finiteNumberOr(draft.borderSizePx, 0)),
    0,
    Math.min(MAX_BORDER_SIZE_PX, maximumBorder)
  );

  return { widthPx, heightPx, ratio, photoArea, borderSizePx };
}

function validateVariantDraft(draft: VariantDraft, orientation: Orientation): VariantValidationResult {
  const label = orientationLabel(orientation);
  const errors: string[] = [];
  const widthCm = Number(draft.widthCm);
  const heightCm = Number(draft.heightCm);
  const dpi = Number(draft.dpi);
  const ratioX = Number(draft.photoRatioX);
  const ratioY = Number(draft.photoRatioY);
  const borderSizePx = Number(draft.borderSizePx);

  if (!Number.isFinite(widthCm) || widthCm < MIN_SIZE_CM || widthCm > MAX_SIZE_CM) {
    errors.push(`${label}: la larghezza deve essere tra ${MIN_SIZE_CM} e ${MAX_SIZE_CM} cm.`);
  }
  if (!Number.isFinite(heightCm) || heightCm < MIN_SIZE_CM || heightCm > MAX_SIZE_CM) {
    errors.push(`${label}: l'altezza deve essere tra ${MIN_SIZE_CM} e ${MAX_SIZE_CM} cm.`);
  }
  if (!Number.isInteger(dpi) || dpi < MIN_DPI || dpi > MAX_DPI) {
    errors.push(`${label}: i DPI devono essere un intero tra ${MIN_DPI} e ${MAX_DPI}.`);
  }
  if (!Number.isFinite(ratioX) || ratioX < MIN_RATIO_PART || ratioX > MAX_RATIO_PART) {
    errors.push(`${label}: Rapporto X deve essere tra ${MIN_RATIO_PART} e ${MAX_RATIO_PART}.`);
  }
  if (!Number.isFinite(ratioY) || ratioY < MIN_RATIO_PART || ratioY > MAX_RATIO_PART) {
    errors.push(`${label}: Rapporto Y deve essere tra ${MIN_RATIO_PART} e ${MAX_RATIO_PART}.`);
  }
  if (
    Number.isFinite(ratioX) &&
    Number.isFinite(ratioY) &&
    ratioY !== 0 &&
    (ratioX / ratioY < MIN_PHOTO_ASPECT_RATIO || ratioX / ratioY > MAX_PHOTO_ASPECT_RATIO)
  ) {
    errors.push(`${label}: il rapporto foto finale deve essere compreso tra 1:10 e 10:1.`);
  }
  if (!Number.isInteger(borderSizePx) || borderSizePx < 0 || borderSizePx > MAX_BORDER_SIZE_PX) {
    errors.push(`${label}: il bordo deve essere un intero tra 0 e ${MAX_BORDER_SIZE_PX} px.`);
  }
  if (!/^#([0-9a-fA-F]{6})$/.test(draft.borderColor)) {
    errors.push(`${label}: il colore bordo deve essere nel formato #RRGGBB.`);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const widthPx = cmToPx(widthCm, dpi);
  const heightPx = cmToPx(heightCm, dpi);
  if (
    widthPx < MIN_CANVAS_SIDE_PX ||
    heightPx < MIN_CANVAS_SIDE_PX ||
    widthPx > MAX_CANVAS_SIDE_PX ||
    heightPx > MAX_CANVAS_SIDE_PX
  ) {
    errors.push(
      `${label}: ogni lato del canvas deve essere tra ${MIN_CANVAS_SIDE_PX} e ${MAX_CANVAS_SIDE_PX.toLocaleString("it-IT")} px (ora ${widthPx} x ${heightPx} px).`
    );
  }
  if (widthPx * heightPx > MAX_CANVAS_PIXELS) {
    errors.push(
      `${label}: il canvas supera ${MAX_CANVAS_PIXELS.toLocaleString("it-IT")} pixel totali (ora ${(widthPx * heightPx).toLocaleString("it-IT")}).`
    );
  }

  const ratio = ratioX / ratioY;
  if (
    draft.lockAspectRatio &&
    (ratio > widthPx / MIN_PHOTO_AREA_SIDE_PX || ratio < MIN_PHOTO_AREA_SIDE_PX / heightPx)
  ) {
    errors.push(`${label}: il rapporto foto non è compatibile con le dimensioni del canvas.`);
  }
  const area = draft.photoArea;
  if (![area.x, area.y, area.width, area.height].every(Number.isInteger)) {
    errors.push(`${label}: posizione e dimensioni dell'area foto devono essere pixel interi.`);
  }
  if (area.x < 0 || area.y < 0) {
    errors.push(`${label}: X e Y dell'area foto non possono essere negativi.`);
  }
  if (area.width < MIN_PHOTO_AREA_SIDE_PX || area.height < MIN_PHOTO_AREA_SIDE_PX) {
    errors.push(`${label}: l'area foto deve misurare almeno ${MIN_PHOTO_AREA_SIDE_PX} px per lato.`);
  }
  if (area.x + area.width > widthPx || area.y + area.height > heightPx) {
    errors.push(`${label}: l'area foto deve rimanere interamente dentro il canvas.`);
  }

  const photoArea = clampRect(area, { width: widthPx, height: heightPx }, draft.lockAspectRatio, ratio);
  const maximumBorder = Math.max(0, Math.floor(Math.min(photoArea.width, photoArea.height) / 2) - 1);
  if (borderSizePx > maximumBorder) {
    errors.push(`${label}: il bordo non puo superare ${maximumBorder} px con l'area foto corrente.`);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    variant: {
      widthCm,
      heightCm,
      dpi,
      widthPx,
      heightPx,
      photoAreaX: photoArea.x,
      photoAreaY: photoArea.y,
      photoAreaWidth: photoArea.width,
      photoAreaHeight: photoArea.height,
      lockAspectRatio: draft.lockAspectRatio,
      photoAspectRatio: ratio,
      backgroundPreviewUrl: draft.backgroundPreviewUrl || undefined,
      backgroundFileName: draft.backgroundFileName || undefined,
      borderSizePx,
      borderColor: draft.borderColor,
    },
  };
}

function buildTemplate(name: string, variants: Record<Orientation, VariantDraft>): TemplateBuildResult {
  const vertical = validateVariantDraft(variants.vertical, "vertical");
  const horizontal = validateVariantDraft(variants.horizontal, "horizontal");
  const errors = [
    ...(vertical.ok ? [] : vertical.errors),
    ...(horizontal.ok ? [] : horizontal.errors),
  ];

  if (!vertical.ok || !horizontal.ok) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    template: {
      id: "custom",
      name,
      variants: {
        vertical: vertical.variant,
        horizontal: horizontal.variant,
      },
    },
  };
}

export default function CustomTemplateBuilder() {
  const navigate = useNavigate();
  const { project, setCustomTemplate } = useProject();
  const existingTemplate = project.customTemplate;
  const [templateName, setTemplateName] = useState(existingTemplate?.name ?? "");
  const [templateNameError, setTemplateNameError] = useState("");
  const [activeOrientation, setActiveOrientation] = useState<Orientation>("vertical");
  const [variants, setVariants] = useState<Record<Orientation, VariantDraft>>({
    vertical: existingTemplate?.variants.vertical ? variantToDraft(existingTemplate.variants.vertical) : createDefaultVariant("vertical"),
    horizontal: existingTemplate?.variants.horizontal ? variantToDraft(existingTemplate.variants.horizontal) : createDefaultVariant("horizontal"),
  });
  const [backgroundFeedbacks, setBackgroundFeedbacks] = useState<Record<Orientation, BackgroundFeedback>>({
    vertical: {
      message: existingTemplate?.variants.vertical?.backgroundFileName
        ? `Sfondo pronto: ${existingTemplate.variants.vertical.backgroundFileName}`
        : "Nessun file selezionato",
      tone: "muted",
    },
    horizontal: {
      message: existingTemplate?.variants.horizontal?.backgroundFileName
        ? `Sfondo pronto: ${existingTemplate.variants.horizontal.backgroundFileName}`
        : "Nessun file selezionato",
      tone: "muted",
    },
  });
  const [draftBackgroundFiles] = useState(() => getCustomTemplateBackgroundFiles());

  const fileInputRefs = {
    vertical: useRef<HTMLInputElement | null>(null),
    horizontal: useRef<HTMLInputElement | null>(null),
  };
  const dragStateRef = useRef<DragState | null>(null);
  const savingLibraryRef = useRef(false);
  const [savingLibrary, setSavingLibrary] = useState(false);
  const [uploadBusy, setUploadBusy] = useState<Record<Orientation, boolean>>({
    vertical: false,
    horizontal: false,
  });
  const uploadBusyRef = useRef<Record<Orientation, boolean>>({ vertical: false, horizontal: false });
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const draftBackgroundFilesRef = useRef<Record<Orientation, File | null>>(draftBackgroundFiles);
  const previewUrlsRef = useRef<Record<Orientation, string>>({
    vertical: variants.vertical.backgroundPreviewUrl,
    horizontal: variants.horizontal.backgroundPreviewUrl,
  });
  const uploadSequenceRef = useRef<Record<Orientation, number>>({ vertical: 0, horizontal: 0 });
  const ownedPreviewUrlsRef = useRef(new Set<string>());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      uploadSequenceRef.current.vertical += 1;
      uploadSequenceRef.current.horizontal += 1;
      for (const previewUrl of ownedPreviewUrlsRef.current) {
        URL.revokeObjectURL(previewUrl);
      }
      ownedPreviewUrlsRef.current.clear();
    };
  }, []);

  const activeDraft = variants[activeOrientation];
  const previewGeometry = useMemo(() => getPreviewGeometry(activeDraft), [activeDraft]);
  const { widthPx, heightPx, ratio, photoArea: previewPhotoArea, borderSizePx: safeBorderSize } = previewGeometry;
  const activeValidation = useMemo(
    () => validateVariantDraft(activeDraft, activeOrientation),
    [activeDraft, activeOrientation]
  );
  const activeValidationErrors = activeValidation.ok ? [] : activeValidation.errors;
  const anyUploadBusy = uploadBusy.vertical || uploadBusy.horizontal;
  const saveBusy = savingLibrary || anyUploadBusy;
  const fieldPrefix = `custom-template-${activeOrientation}`;
  const previewBorderColor = /^#([0-9a-fA-F]{6})$/.test(activeDraft.borderColor)
    ? activeDraft.borderColor
    : "#ffffff";

  const updateActiveDraft = (updater: (draft: VariantDraft) => VariantDraft) => {
    setSaveErrors([]);
    setVariants((prev) => ({
      ...prev,
      [activeOrientation]: updater(prev[activeOrientation]),
    }));
  };

  const photoAreaStyle = useMemo(
    () => ({
      left: `${(previewPhotoArea.x / widthPx) * 100}%`,
      top: `${(previewPhotoArea.y / heightPx) * 100}%`,
      width: `${(previewPhotoArea.width / widthPx) * 100}%`,
      height: `${(previewPhotoArea.height / heightPx) * 100}%`,
    }),
    [previewPhotoArea, widthPx, heightPx]
  );

  const innerPhotoAreaStyle = useMemo(
    () => ({
      left: `${(safeBorderSize / previewPhotoArea.width) * 100}%`,
      top: `${(safeBorderSize / previewPhotoArea.height) * 100}%`,
      right: `${(safeBorderSize / previewPhotoArea.width) * 100}%`,
      bottom: `${(safeBorderSize / previewPhotoArea.height) * 100}%`,
      borderRadius: 12,
    }),
    [safeBorderSize, previewPhotoArea.height, previewPhotoArea.width]
  );

  const handleBackgroundSelected = async (orientation: Orientation, event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    if (savingLibraryRef.current) {
      input.value = "";
      return;
    }

    const requestId = uploadSequenceRef.current[orientation] + 1;
    uploadSequenceRef.current[orientation] = requestId;
    const targetGeometry = getPreviewGeometry(variants[orientation]);
    uploadBusyRef.current[orientation] = true;
    setUploadBusy((previous) => ({ ...previous, [orientation]: true }));
    setBackgroundFeedbacks((previous) => ({
      ...previous,
      [orientation]: {
        message: `Elaborazione di ${file.name} in corso...`,
        tone: "muted",
      },
    }));

    try {
      const result = await optimizeTemplateBackground(file, targetGeometry.widthPx, targetGeometry.heightPx);
      if (!mountedRef.current || uploadSequenceRef.current[orientation] !== requestId) {
        return;
      }

      const previewUrl = URL.createObjectURL(result.file);
      const previousPreviewUrl = previewUrlsRef.current[orientation];
      ownedPreviewUrlsRef.current.add(previewUrl);
      if (ownedPreviewUrlsRef.current.delete(previousPreviewUrl)) {
        URL.revokeObjectURL(previousPreviewUrl);
      }
      previewUrlsRef.current[orientation] = previewUrl;
      draftBackgroundFilesRef.current[orientation] = result.file;
      setSaveErrors([]);
      setVariants((prev) => ({
        ...prev,
        [orientation]: {
          ...prev[orientation],
          backgroundPreviewUrl: previewUrl,
          backgroundFileName: result.file.name,
        },
      }));
      setBackgroundFeedbacks((prev) => ({
        ...prev,
        [orientation]: result.feedback,
      }));

      if (file.size > SOFT_WARNING_BYTES && file.size <= AUTO_OPTIMIZE_BYTES) {
        toast.warning(`Sfondo ${orientationLabel(orientation).toLocaleLowerCase("it-IT")} pesante`, {
          description: "L'immagine è stata accettata, ma conviene mantenerla più leggera se possibile.",
        });
      } else if (result.file !== file) {
        toast.success(`Sfondo ${orientationLabel(orientation).toLocaleLowerCase("it-IT")} ottimizzato`, {
          description: result.feedback.message,
        });
      } else if (result.feedback.tone === "warning") {
        toast.warning(`Sfondo ${orientationLabel(orientation).toLocaleLowerCase("it-IT")} mantenuto originale`, {
          description: result.feedback.message,
        });
      }
    } catch (error) {
      if (!mountedRef.current || uploadSequenceRef.current[orientation] !== requestId) {
        return;
      }

      const message = error instanceof Error ? error.message : "Impossibile usare questa immagine come sfondo template.";
      setBackgroundFeedbacks((prev) => ({
        ...prev,
        [orientation]: {
          message,
          tone: "warning",
        },
      }));
      toast.error("Upload sfondo non riuscito", { description: message });
    } finally {
      input.value = "";
      if (mountedRef.current && uploadSequenceRef.current[orientation] === requestId) {
        uploadBusyRef.current[orientation] = false;
        setUploadBusy((previous) => ({ ...previous, [orientation]: false }));
      }
    }
  };

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>, mode: "move" | "resize") => {
    dragStateRef.current = {
      pointerId: event.pointerId,
      orientation: activeOrientation,
      startX: event.clientX,
      startY: event.clientY,
      origin: previewPhotoArea,
      mode,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.orientation !== activeOrientation) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const deltaX = ((event.clientX - drag.startX) / bounds.width) * widthPx;
    const deltaY = ((event.clientY - drag.startY) / bounds.height) * heightPx;

    updateActiveDraft((draft) => {
      const nextRect =
        drag.mode === "move"
          ? {
              ...drag.origin,
              x: Math.round(drag.origin.x + deltaX),
              y: Math.round(drag.origin.y + deltaY),
            }
          : {
              ...drag.origin,
              width: Math.round(drag.origin.width + deltaX),
              height: draft.lockAspectRatio
                ? Math.round((drag.origin.width + deltaX) / ratio)
                : Math.round(drag.origin.height + deltaY),
            };

      return {
        ...draft,
        photoArea: clampRect(nextRect, { width: widthPx, height: heightPx }, draft.lockAspectRatio, ratio),
      };
    });
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  };

  const commitTemplateToProject = (
    template: CustomTemplate,
    backgroundFiles: Record<Orientation, File | null> = draftBackgroundFilesRef.current
  ) => {
    const previousBackgroundFiles = getCustomTemplateBackgroundFiles();

    try {
      setCustomTemplateBackgroundFile("vertical", backgroundFiles.vertical);
      setCustomTemplateBackgroundFile("horizontal", backgroundFiles.horizontal);
      setCustomTemplate(template);
    } catch (error) {
      setCustomTemplateBackgroundFile("vertical", previousBackgroundFiles.vertical);
      setCustomTemplateBackgroundFile("horizontal", previousBackgroundFiles.horizontal);
      throw error;
    }

    for (const orientation of ["vertical", "horizontal"] as const) {
      const previewUrl = template.variants[orientation].backgroundPreviewUrl;
      if (previewUrl) {
        ownedPreviewUrlsRef.current.delete(previewUrl);
      }
    }
  };

  const reportBuildErrors = (errors: string[]) => {
    setSaveErrors(errors);
    if (errors.some((error) => error.startsWith("Verticale:"))) {
      setActiveOrientation("vertical");
    } else if (errors.some((error) => error.startsWith("Orizzontale:"))) {
      setActiveOrientation("horizontal");
    }
    toast.error("Controlla i dati del template", {
      description: errors[0] ?? "Correggi i campi non validi prima di salvare.",
    });
  };

  const handleSaveTemplate = () => {
    if (savingLibraryRef.current || uploadBusyRef.current.vertical || uploadBusyRef.current.horizontal) {
      return;
    }

    const cleanedName = templateName.trim();
    if (!cleanedName) {
      setTemplateNameError("Inserisci un nome template prima di salvarlo.");
      return;
    }

    const result = buildTemplate(cleanedName, variants);
    if (!result.ok) {
      reportBuildErrors(result.errors);
      return;
    }

    setSaveErrors([]);
    commitTemplateToProject(preserveCustomTemplateLibraryIdentity(result.template, project.customTemplate));
    navigate("/new-project");
  };

  const handleSaveTemplateToLibrary = async () => {
    if (savingLibraryRef.current || uploadBusyRef.current.vertical || uploadBusyRef.current.horizontal) {
      return;
    }

    const cleanedName = templateName.trim();
    if (!cleanedName) {
      setTemplateNameError("Il nome template e obbligatorio per salvarlo nella libreria.");
      return;
    }

    const result = buildTemplate(cleanedName, variants);
    if (!result.ok) {
      reportBuildErrors(result.errors);
      return;
    }

    const backgroundFiles = { ...draftBackgroundFilesRef.current };
    savingLibraryRef.current = true;
    setSavingLibrary(true);
    setSaveErrors([]);

    try {
      const savedRecord = await saveTemplateToLibrary(result.template, backgroundFiles);
      if (!mountedRef.current) {
        return;
      }

      const committedTemplate: CustomTemplate = {
        ...savedRecord.template,
        libraryTemplateId: savedRecord.id,
        variants: {
          vertical: {
            ...savedRecord.template.variants.vertical,
            backgroundPreviewUrl: result.template.variants.vertical.backgroundPreviewUrl,
          },
          horizontal: {
            ...savedRecord.template.variants.horizontal,
            backgroundPreviewUrl: result.template.variants.horizontal.backgroundPreviewUrl,
          },
        },
      };

      commitTemplateToProject(committedTemplate, backgroundFiles);
      toast.success("Template salvato in libreria", {
        description: `${cleanedName} e ora disponibile nei template salvati.`,
      });
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }
      console.error("Failed to save template to library", error);
      toast.error("Salvataggio non riuscito", {
        description: "Impossibile salvare il template nella libreria. Riprova.",
      });
    } finally {
      savingLibraryRef.current = false;
      if (mountedRef.current) {
        setSavingLibrary(false);
      }
    }
  };

  const handleCancel = () => {
    if (savingLibraryRef.current) {
      return;
    }
    navigate("/new-project");
  };

  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-[var(--app-text)] flex flex-col">
      <div className="h-16 bg-[var(--app-topbar)] border-b border-[var(--app-border)] backdrop-blur-xl flex items-center px-6 justify-between">
        <div className="flex items-center gap-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-[var(--app-text-muted)] hover:text-[var(--app-text)]"
            onClick={handleCancel}
            disabled={savingLibrary}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Torna al progetto
          </Button>
          <div>
            <div className="text-xl font-semibold tracking-tight">Template personalizzato</div>
            <div className="text-xs text-[var(--app-text-subtle)]">Una variante verticale e una orizzontale, selezionate automaticamente dal sistema</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="border-[var(--app-border-strong)] bg-[var(--app-surface)] text-[var(--app-text)] hover:bg-[var(--app-surface-strong)]"
            onClick={handleSaveTemplateToLibrary}
            disabled={saveBusy}
          >
            <Save className="w-4 h-4 mr-2" />
            {savingLibrary ? "Salvo..." : anyUploadBusy ? "Attendi lo sfondo..." : "Salva nella Libreria"}
          </Button>
          <Button
            type="button"
            onClick={handleSaveTemplate}
            disabled={saveBusy}
            className="bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)] hover:bg-[var(--brand-primary-strong)]"
          >
            <Save className="w-4 h-4 mr-2" />
            {anyUploadBusy ? "Attendi lo sfondo..." : "Usa nel Progetto"}
          </Button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-[390px,1fr] min-h-0">
        <aside className="bg-[var(--app-topbar)] border-r border-[var(--app-border)] p-6 overflow-y-auto space-y-6">
          <div className="space-y-2">
            <Label htmlFor="template-name">Nome Template</Label>
            <Input
              id="template-name"
              value={templateName}
              onChange={(event) => {
                setTemplateName(event.target.value);
                setSaveErrors([]);
                if (event.target.value.trim()) {
                  setTemplateNameError("");
                }
              }}
              className={`bg-[var(--app-field)] text-[var(--app-text)] ${
                templateNameError ? "border-[var(--danger)] focus-visible:ring-[var(--danger)]" : "border-[var(--app-border)]"
              }`}
            />
            {templateNameError ? <p className="text-xs text-[var(--danger)]">{templateNameError}</p> : null}
          </div>

          {saveErrors.length > 0 ? (
            <div
              role="alert"
              className="rounded-xl border border-[var(--danger)] bg-[var(--app-surface)] p-3 text-xs text-[var(--danger)]"
            >
              <div className="font-medium">Il template non puo essere salvato:</div>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                {saveErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-3 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 shadow-[0_18px_42px_rgba(0,0,0,0.16)]">
            <div className="text-sm font-medium">Varianti Layout</div>
            <div className="grid grid-cols-2 gap-2">
              {(["vertical", "horizontal"] as Orientation[]).map((orientation) => (
                <button
                  key={orientation}
                  type="button"
                  onClick={() => setActiveOrientation(orientation)}
                  className={`rounded-lg border px-3 py-2 text-sm transition ${
                    activeOrientation === orientation
                      ? "border-[var(--brand-accent)] bg-[var(--brand-primary-soft)] text-[var(--app-text)]"
                      : "border-[var(--app-border)] bg-[var(--app-field)] text-[var(--app-text-muted)] hover:border-[var(--brand-primary)] hover:text-[var(--app-text)]"
                  }`}
                >
                  Variante {orientation === "vertical" ? "Verticale" : "Orizzontale"}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor={`${fieldPrefix}-width-cm`}>Larghezza cm</Label>
              <Input
                id={`${fieldPrefix}-width-cm`}
                type="number"
                min={MIN_SIZE_CM}
                max={MAX_SIZE_CM}
                step="0.1"
                inputMode="decimal"
                value={activeDraft.widthCm}
                onChange={(event) => updateActiveDraft((draft) => ({ ...draft, widthCm: event.target.value }))}
                className="bg-[var(--app-field)] border-[var(--app-border)] text-[var(--app-text)]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${fieldPrefix}-height-cm`}>Altezza cm</Label>
              <Input
                id={`${fieldPrefix}-height-cm`}
                type="number"
                min={MIN_SIZE_CM}
                max={MAX_SIZE_CM}
                step="0.1"
                inputMode="decimal"
                value={activeDraft.heightCm}
                onChange={(event) => updateActiveDraft((draft) => ({ ...draft, heightCm: event.target.value }))}
                className="bg-[var(--app-field)] border-[var(--app-border)] text-[var(--app-text)]"
              />
            </div>
          </div>
          <p className="-mt-4 text-[11px] text-[var(--app-text-subtle)]">
            Formato consentito: {MIN_SIZE_CM}-{MAX_SIZE_CM} cm per lato.
          </p>

          <div className="space-y-2">
            <Label htmlFor={`${fieldPrefix}-dpi`}>DPI</Label>
            <Input
              id={`${fieldPrefix}-dpi`}
              type="number"
              min={MIN_DPI}
              max={MAX_DPI}
              step="1"
              inputMode="numeric"
              value={activeDraft.dpi}
              onChange={(event) => updateActiveDraft((draft) => ({ ...draft, dpi: event.target.value }))}
              className="bg-[var(--app-field)] border-[var(--app-border)] text-[var(--app-text)]"
            />
            <p className="text-xs text-[var(--app-text-subtle)]">Canvas: {widthPx} x {heightPx}px</p>
            <p className="text-[11px] text-[var(--app-text-subtle)]">
              {MIN_DPI}-{MAX_DPI} DPI; massimo {MAX_CANVAS_SIDE_PX.toLocaleString("it-IT")} px per lato e {MAX_CANVAS_PIXELS.toLocaleString("it-IT")} pixel totali.
            </p>
          </div>

          <div className="space-y-3 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 shadow-[0_18px_42px_rgba(0,0,0,0.16)]">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Sfondo {activeOrientation === "vertical" ? "Verticale" : "Orizzontale"}</div>
                <div className="text-xs text-[var(--app-text-subtle)]">Carica il template dedicato a questo orientamento</div>
              </div>
              <Button
                type="button"
                variant="outline"
                className="border-[var(--app-border)] bg-[var(--app-field)] text-[var(--app-text)] hover:bg-[var(--app-surface-strong)]"
                onClick={() => {
                  const input = fileInputRefs[activeOrientation].current;
                  if (input) {
                    input.value = "";
                    input.click();
                  }
                }}
                disabled={savingLibrary}
                aria-busy={uploadBusy[activeOrientation]}
              >
                <ImagePlus className="w-4 h-4 mr-2" />
                {uploadBusy[activeOrientation] ? "Elaborazione..." : "Carica"}
              </Button>
            </div>
            <input
              ref={fileInputRefs[activeOrientation]}
              type="file"
              accept="image/*"
              hidden
              aria-label={`Scegli lo sfondo ${orientationLabel(activeOrientation).toLocaleLowerCase("it-IT")}`}
              onChange={(event) => handleBackgroundSelected(activeOrientation, event)}
            />
            <div className="space-y-1">
              <div className="text-xs text-[var(--app-text-muted)]">{activeDraft.backgroundFileName || "Nessun file selezionato"}</div>
              <div
                aria-live="polite"
                className={`text-xs ${getFeedbackToneClass(backgroundFeedbacks[activeOrientation].tone)}`}
              >
                {backgroundFeedbacks[activeOrientation].message}
              </div>
              <div className="text-[11px] text-[var(--app-text-subtle)]">
                Avviso oltre 12 MB, ottimizzazione sicura oltre 18 MB, limite 35 MB.
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 shadow-[0_18px_42px_rgba(0,0,0,0.16)]">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Bordo Foto</div>
                <div className="text-xs text-[var(--app-text-subtle)]">Bordo applicato intorno alla foto dentro l'area foto</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor={`${fieldPrefix}-border-size`}>Spessore px</Label>
                <Input
                  id={`${fieldPrefix}-border-size`}
                  type="number"
                  min="0"
                  max={MAX_BORDER_SIZE_PX}
                  step="1"
                  inputMode="numeric"
                  value={activeDraft.borderSizePx}
                  onChange={(event) => updateActiveDraft((draft) => ({ ...draft, borderSizePx: event.target.value }))}
                  className="bg-[var(--app-field)] border-[var(--app-border)] text-[var(--app-text)]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${fieldPrefix}-border-color-text`}>Colore bordo</Label>
                <div className="flex items-center gap-2">
                  <input
                    id={`${fieldPrefix}-border-color-picker`}
                    type="color"
                    value={previewBorderColor}
                    onChange={(event) => updateActiveDraft((draft) => ({ ...draft, borderColor: event.target.value }))}
                    className="h-10 w-12 rounded-xl border border-[var(--app-border)] bg-transparent"
                    aria-label="Seleziona colore bordo"
                  />
                  <Input
                    id={`${fieldPrefix}-border-color-text`}
                    value={activeDraft.borderColor}
                    onChange={(event) => updateActiveDraft((draft) => ({ ...draft, borderColor: event.target.value }))}
                    className="bg-[var(--app-field)] border-[var(--app-border)] text-[var(--app-text)]"
                  />
                </div>
              </div>
            </div>
            <p className="text-[11px] text-[var(--app-text-subtle)]">
              Bordo: 0-{MAX_BORDER_SIZE_PX} px e comunque meno della metà del lato corto dell'area foto.
            </p>
          </div>

          <div className="space-y-3 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 shadow-[0_18px_42px_rgba(0,0,0,0.16)]">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Area Foto</div>
                <div className="text-xs text-[var(--app-text-subtle)]">Trascinamento diretto nel canvas o valori manuali</div>
              </div>
              <div className="flex items-center gap-2 text-xs text-[var(--app-text-muted)]">
                <Crop className="w-4 h-4" />
                <span>{activeDraft.photoArea.width} x {activeDraft.photoArea.height}px</span>
              </div>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <input
                id={`${fieldPrefix}-lock-ratio`}
                type="checkbox"
                checked={activeDraft.lockAspectRatio}
                onChange={(event) => updateActiveDraft((draft) => ({ ...draft, lockAspectRatio: event.target.checked }))}
                className="w-4 h-4"
              />
              <Label htmlFor={`${fieldPrefix}-lock-ratio`} className="cursor-pointer">Mantieni proporzioni</Label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor={`${fieldPrefix}-ratio-x`}>Rapporto X</Label>
                <Input
                  id={`${fieldPrefix}-ratio-x`}
                  type="number"
                  min={MIN_RATIO_PART}
                  max={MAX_RATIO_PART}
                  step="0.1"
                  inputMode="decimal"
                  value={activeDraft.photoRatioX}
                  onChange={(event) => updateActiveDraft((draft) => ({ ...draft, photoRatioX: event.target.value }))}
                  className="bg-[var(--app-field)] border-[var(--app-border)] text-[var(--app-text)]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${fieldPrefix}-ratio-y`}>Rapporto Y</Label>
                <Input
                  id={`${fieldPrefix}-ratio-y`}
                  type="number"
                  min={MIN_RATIO_PART}
                  max={MAX_RATIO_PART}
                  step="0.1"
                  inputMode="decimal"
                  value={activeDraft.photoRatioY}
                  onChange={(event) => updateActiveDraft((draft) => ({ ...draft, photoRatioY: event.target.value }))}
                  className="bg-[var(--app-field)] border-[var(--app-border)] text-[var(--app-text)]"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor={`${fieldPrefix}-photo-x`}>X</Label>
                <Input
                  id={`${fieldPrefix}-photo-x`}
                  type="number"
                  min="0"
                  max={Math.max(0, widthPx - MIN_PHOTO_AREA_SIDE_PX)}
                  step="1"
                  inputMode="numeric"
                  value={String(activeDraft.photoArea.x)}
                  onChange={(event) => updateActiveDraft((draft) => ({
                    ...draft,
                    photoArea: clampRect(
                      { ...draft.photoArea, x: Number(event.target.value) || 0 },
                      { width: widthPx, height: heightPx },
                      draft.lockAspectRatio,
                      ratio
                    ),
                  }))}
                  className="bg-[var(--app-field)] border-[var(--app-border)] text-[var(--app-text)]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${fieldPrefix}-photo-y`}>Y</Label>
                <Input
                  id={`${fieldPrefix}-photo-y`}
                  type="number"
                  min="0"
                  max={Math.max(0, heightPx - MIN_PHOTO_AREA_SIDE_PX)}
                  step="1"
                  inputMode="numeric"
                  value={String(activeDraft.photoArea.y)}
                  onChange={(event) => updateActiveDraft((draft) => ({
                    ...draft,
                    photoArea: clampRect(
                      { ...draft.photoArea, y: Number(event.target.value) || 0 },
                      { width: widthPx, height: heightPx },
                      draft.lockAspectRatio,
                      ratio
                    ),
                  }))}
                  className="bg-[var(--app-field)] border-[var(--app-border)] text-[var(--app-text)]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${fieldPrefix}-photo-width`}>Larghezza</Label>
                <Input
                  id={`${fieldPrefix}-photo-width`}
                  type="number"
                  min={MIN_PHOTO_AREA_SIDE_PX}
                  max={widthPx}
                  step="1"
                  inputMode="numeric"
                  value={String(activeDraft.photoArea.width)}
                  onChange={(event) => updateActiveDraft((draft) => {
                    const nextWidth = Number(event.target.value) || MIN_PHOTO_AREA_SIDE_PX;
                    return {
                      ...draft,
                      photoArea: clampRect(
                        {
                          ...draft.photoArea,
                          width: nextWidth,
                          height: draft.lockAspectRatio ? Math.round(nextWidth / ratio) : draft.photoArea.height,
                        },
                        { width: widthPx, height: heightPx },
                        draft.lockAspectRatio,
                        ratio
                      ),
                    };
                  })}
                  className="bg-[var(--app-field)] border-[var(--app-border)] text-[var(--app-text)]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${fieldPrefix}-photo-height`}>Altezza</Label>
                <Input
                  id={`${fieldPrefix}-photo-height`}
                  type="number"
                  min={MIN_PHOTO_AREA_SIDE_PX}
                  max={heightPx}
                  step="1"
                  inputMode="numeric"
                  value={String(activeDraft.photoArea.height)}
                  onChange={(event) => updateActiveDraft((draft) => {
                    const nextHeight = Number(event.target.value) || MIN_PHOTO_AREA_SIDE_PX;
                    return {
                      ...draft,
                      photoArea: clampRect(
                        {
                          ...draft.photoArea,
                          width: draft.lockAspectRatio ? Math.round(nextHeight * ratio) : draft.photoArea.width,
                          height: nextHeight,
                        },
                        { width: widthPx, height: heightPx },
                        draft.lockAspectRatio,
                        ratio
                      ),
                    };
                  })}
                  className="bg-[var(--app-field)] border-[var(--app-border)] text-[var(--app-text)]"
                />
              </div>
            </div>

            {activeValidationErrors.length > 0 ? (
              <div aria-live="polite" className="rounded-lg border border-[var(--danger)] p-3 text-xs text-[var(--danger)]">
                <div className="font-medium">Correggi la variante {orientationLabel(activeOrientation).toLocaleLowerCase("it-IT")}:</div>
                <ul className="mt-2 list-disc space-y-1 pl-4">
                  {activeValidationErrors.map((error) => (
                    <li key={error}>{error.replace(`${orientationLabel(activeOrientation)}: `, "")}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </aside>

        <main className="p-8 flex items-center justify-center overflow-auto bg-[radial-gradient(circle_at_top,rgba(103,117,107,0.16),transparent_36%),linear-gradient(180deg,#1f2421,#232925)]">
          <div className="w-full max-w-[860px]">
            <div className="mb-5 flex items-center justify-between text-sm text-[var(--app-text-muted)]">
              <span>Preview live variante {activeOrientation === "vertical" ? "Verticale" : "Orizzontale"}</span>
              <span className="flex items-center gap-2">
                <Move className="w-4 h-4" />
                Trascina il box per spostarlo, usa l'angolo per ridimensionarlo
              </span>
            </div>

            <div
              className="relative mx-auto w-full overflow-hidden rounded-[30px] border border-[var(--app-border)] bg-[var(--app-surface)] shadow-[0_32px_90px_rgba(0,0,0,0.28)]"
              style={{
                aspectRatio: `${widthPx} / ${heightPx}`,
                backgroundImage: activeDraft.backgroundPreviewUrl ? `url(${activeDraft.backgroundPreviewUrl})` : undefined,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
              onPointerMove={handlePointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              {!activeDraft.backgroundPreviewUrl ? (
                <div className="absolute inset-0 bg-[linear-gradient(135deg,#4b5750,#66756b_42%,#2b312d)] opacity-95" />
              ) : null}
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(237,230,221,0.12),transparent_35%)]" />

              <div
                className="absolute rounded-[18px] shadow-[0_0_0_9999px_rgba(0,0,0,0.18)]"
                style={{
                  ...photoAreaStyle,
                  backgroundColor: previewBorderColor,
                  border: "2px dashed rgba(212, 193, 170, 0.95)",
                }}
                onPointerDown={(event) => beginDrag(event, "move")}
              >
                <div
                  className="absolute bg-[rgba(31,36,33,0.18)]"
                  style={innerPhotoAreaStyle}
                />
                <div className="absolute inset-0 flex items-center justify-center text-[11px] font-medium tracking-[0.2em] text-[var(--brand-secondary)] uppercase">
                  Area Foto
                </div>
                <div
                  className="absolute bottom-2 right-2 h-5 w-5 rounded-md border border-[var(--brand-secondary)] bg-[var(--brand-accent)] shadow"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    beginDrag(event, "resize");
                  }}
                />
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
