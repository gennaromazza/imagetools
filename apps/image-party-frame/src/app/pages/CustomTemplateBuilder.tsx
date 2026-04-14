import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
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
import { hydrateSavedTemplate, saveTemplateToLibrary } from "../lib/savedTemplates";

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
  startX: number;
  startY: number;
  origin: Rect;
  mode: "move" | "resize";
};

const DEFAULT_DPI = 300;
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
    throw new Error(`"${file.name}" pesa ${formatFileSize(file.size)}. Il limite per gli sfondi template e 35 MB.`);
  }

  const image = await loadImageElement(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
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

function createDefaultVariant(orientation: Orientation): VariantDraft {
  const widthCm = orientation === "vertical" ? "10" : "15";
  const heightCm = orientation === "vertical" ? "15" : "10";
  const widthPx = cmToPx(Number(widthCm), DEFAULT_DPI);
  const heightPx = cmToPx(Number(heightCm), DEFAULT_DPI);

  return {
    widthCm,
    heightCm,
    dpi: String(DEFAULT_DPI),
    photoRatioX: orientation === "vertical" ? "3" : "4",
    photoRatioY: orientation === "vertical" ? "4" : "3",
    lockAspectRatio: true,
    photoArea: {
      x: Math.round(widthPx * 0.1),
      y: Math.round(heightPx * 0.1),
      width: Math.round(widthPx * 0.8),
      height: Math.round(heightPx * 0.8),
    },
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
    photoRatioX: String(Math.round(variant.photoAspectRatio * 100)),
    photoRatioY: "100",
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
  let next = { ...rect };

  next.width = Math.max(40, Math.min(bounds.width, next.width));
  next.height = Math.max(40, Math.min(bounds.height, next.height));

  if (lockAspectRatio) {
    next.height = Math.max(40, Math.min(bounds.height, Math.round(next.width / ratio)));
    if (next.y + next.height > bounds.height) {
      next.height = bounds.height - next.y;
      next.width = Math.max(40, Math.min(bounds.width, Math.round(next.height * ratio)));
    }
  }

  next.x = Math.max(0, Math.min(bounds.width - next.width, next.x));
  next.y = Math.max(0, Math.min(bounds.height - next.height, next.y));
  next.width = Math.min(next.width, bounds.width - next.x);
  next.height = Math.min(next.height, bounds.height - next.y);

  return next;
}

function draftToVariant(draft: VariantDraft): CustomTemplateVariant {
  const widthCm = Number(draft.widthCm) || 10;
  const heightCm = Number(draft.heightCm) || 15;
  const dpi = Number(draft.dpi) || DEFAULT_DPI;
  const widthPx = cmToPx(widthCm, dpi);
  const heightPx = cmToPx(heightCm, dpi);
  const ratio = Math.max(0.1, (Number(draft.photoRatioX) || 4) / Math.max(0.1, Number(draft.photoRatioY) || 3));
  const photoArea = clampRect(draft.photoArea, { width: widthPx, height: heightPx }, draft.lockAspectRatio, ratio);
  const maxBorder = Math.max(0, Math.floor(Math.min(photoArea.width, photoArea.height) / 2) - 1);
  const borderSizePx = Math.max(0, Math.min(maxBorder, Number(draft.borderSizePx) || 0));

  return {
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
    borderColor: /^#([0-9a-fA-F]{6})$/.test(draft.borderColor) ? draft.borderColor : "#ffffff",
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

  const fileInputRefs = {
    vertical: useRef<HTMLInputElement | null>(null),
    horizontal: useRef<HTMLInputElement | null>(null),
  };
  const dragStateRef = useRef<DragState | null>(null);
  const [savingLibrary, setSavingLibrary] = useState(false);
  const variantsRef = useRef(variants);

  useEffect(() => {
    variantsRef.current = variants;
  }, [variants]);

  useEffect(() => {
    return () => {
      for (const orientation of ["vertical", "horizontal"] as const) {
        const previewUrl = variantsRef.current[orientation].backgroundPreviewUrl;
        if (previewUrl.startsWith("blob:")) {
          URL.revokeObjectURL(previewUrl);
        }
      }
    };
  }, []);

  const activeDraft = variants[activeOrientation];
  const widthPx = cmToPx(Number(activeDraft.widthCm) || 10, Number(activeDraft.dpi) || DEFAULT_DPI);
  const heightPx = cmToPx(Number(activeDraft.heightCm) || 15, Number(activeDraft.dpi) || DEFAULT_DPI);
  const ratio = Math.max(0.1, (Number(activeDraft.photoRatioX) || 4) / Math.max(0.1, Number(activeDraft.photoRatioY) || 3));
  const safeBorderSize = Math.max(
    0,
    Math.min(Math.floor(Math.min(activeDraft.photoArea.width, activeDraft.photoArea.height) / 2) - 1, Number(activeDraft.borderSizePx) || 0)
  );

  const updateActiveDraft = (updater: (draft: VariantDraft) => VariantDraft) => {
    setVariants((prev) => ({
      ...prev,
      [activeOrientation]: updater(prev[activeOrientation]),
    }));
  };

  const photoAreaStyle = useMemo(
    () => ({
      left: `${(activeDraft.photoArea.x / widthPx) * 100}%`,
      top: `${(activeDraft.photoArea.y / heightPx) * 100}%`,
      width: `${(activeDraft.photoArea.width / widthPx) * 100}%`,
      height: `${(activeDraft.photoArea.height / heightPx) * 100}%`,
    }),
    [activeDraft.photoArea, widthPx, heightPx]
  );

  const innerPhotoAreaStyle = useMemo(
    () => ({
      left: safeBorderSize,
      top: safeBorderSize,
      right: safeBorderSize,
      bottom: safeBorderSize,
      borderRadius: 12,
    }),
    [safeBorderSize]
  );

  const handleBackgroundSelected = async (orientation: Orientation, event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = event.currentTarget.files?.[0];
    if (!file) {
      return;
    }

    const targetWidth = cmToPx(Number(variants[orientation].widthCm) || 10, Number(variants[orientation].dpi) || DEFAULT_DPI);
    const targetHeight = cmToPx(Number(variants[orientation].heightCm) || 15, Number(variants[orientation].dpi) || DEFAULT_DPI);

    try {
      const result = await optimizeTemplateBackground(file, targetWidth, targetHeight);
      const previewUrl = URL.createObjectURL(result.file);
      const previousPreviewUrl = variants[orientation].backgroundPreviewUrl;
      if (previousPreviewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(previousPreviewUrl);
      }
      setCustomTemplateBackgroundFile(orientation, result.file);
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
        toast.warning(`${orientation === "vertical" ? "Sfondo verticale" : "Sfondo orizzontale"} pesante`, {
          description: "L'immagine e stata accettata, ma conviene tenerla piu leggera se possibile.",
        });
      } else if (result.file !== file) {
        toast.success(`${orientation === "vertical" ? "Sfondo verticale" : "Sfondo orizzontale"} ottimizzato`, {
          description: result.feedback.message,
        });
      }
    } catch (error) {
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
    }
  };

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>, mode: "move" | "resize") => {
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: activeDraft.photoArea,
      mode,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
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

  const handleSaveTemplate = () => {
    const cleanedName = templateName.trim();
    if (!cleanedName) {
      setTemplateNameError("Inserisci un nome template prima di salvarlo.");
      return;
    }

    const nextTemplate: CustomTemplate = {
      id: "custom",
      name: cleanedName,
      variants: {
        vertical: draftToVariant(variants.vertical),
        horizontal: draftToVariant(variants.horizontal),
      },
    };

    setCustomTemplate(nextTemplate);
    navigate("/new-project");
  };

  const handleSaveTemplateToLibrary = async () => {
    const cleanedName = templateName.trim();
    if (!cleanedName) {
      setTemplateNameError("Il nome template e obbligatorio per salvarlo nella libreria.");
      return;
    }

    setSavingLibrary(true);

    try {
      const backgroundFiles = getCustomTemplateBackgroundFiles();
      const nextTemplate: CustomTemplate = {
        id: "custom",
        name: cleanedName,
        variants: {
          vertical: draftToVariant(variants.vertical),
          horizontal: draftToVariant(variants.horizontal),
        },
      };

      const savedRecord = await saveTemplateToLibrary(nextTemplate, backgroundFiles);
      setCustomTemplate(await hydrateSavedTemplate(savedRecord));
      toast.success("Template salvato in libreria", {
        description: `${cleanedName} e ora disponibile nei template salvati.`,
      });
    } catch (error) {
      console.error("Failed to save template to library", error);
      toast.error("Salvataggio non riuscito", {
        description: "Impossibile salvare il template nella libreria. Riprova.",
      });
    } finally {
      setSavingLibrary(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-[var(--app-text)] flex flex-col">
      <div className="h-16 bg-[var(--app-topbar)] border-b border-[var(--app-border)] backdrop-blur-xl flex items-center px-6 justify-between">
        <div className="flex items-center gap-4">
          <Link to="/new-project">
            <Button variant="ghost" size="sm" className="text-[var(--app-text-muted)] hover:text-[var(--app-text)]">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Torna al progetto
            </Button>
          </Link>
          <div>
            <div className="text-xl font-semibold tracking-tight">Template Custom</div>
            <div className="text-xs text-[var(--app-text-subtle)]">Una variante verticale e una orizzontale, scelte automaticamente dal sistema</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="border-[var(--app-border-strong)] bg-[var(--app-surface)] text-[var(--app-text)] hover:bg-[var(--app-surface-strong)]"
            onClick={handleSaveTemplateToLibrary}
            disabled={savingLibrary}
          >
            <Save className="w-4 h-4 mr-2" />
            {savingLibrary ? "Salvo..." : "Salva nella Libreria"}
          </Button>
          <Button onClick={handleSaveTemplate} className="bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)] hover:bg-[var(--brand-primary-strong)]">
            <Save className="w-4 h-4 mr-2" />
            Usa nel Progetto
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
              <Label>Larghezza cm</Label>
              <Input value={activeDraft.widthCm} onChange={(event) => updateActiveDraft((draft) => ({ ...draft, widthCm: event.target.value }))} className="bg-[var(--app-field)] border-[var(--app-border)] text-[var(--app-text)]" />
            </div>
            <div className="space-y-2">
              <Label>Altezza cm</Label>
              <Input value={activeDraft.heightCm} onChange={(event) => updateActiveDraft((draft) => ({ ...draft, heightCm: event.target.value }))} className="bg-[var(--app-field)] border-[var(--app-border)] text-[var(--app-text)]" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>DPI</Label>
            <Input value={activeDraft.dpi} onChange={(event) => updateActiveDraft((draft) => ({ ...draft, dpi: event.target.value }))} className="bg-[var(--app-field)] border-[var(--app-border)] text-[var(--app-text)]" />
            <p className="text-xs text-[var(--app-text-subtle)]">Canvas: {widthPx} x {heightPx}px</p>
          </div>

          <div className="space-y-3 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 shadow-[0_18px_42px_rgba(0,0,0,0.16)]">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Sfondo {activeOrientation === "vertical" ? "Verticale" : "Orizzontale"}</div>
                <div className="text-xs text-[var(--app-text-subtle)]">Carica il template dedicato a questo orientamento</div>
              </div>
              <Button type="button" variant="outline" className="border-[var(--app-border)] bg-[var(--app-field)] text-[var(--app-text)] hover:bg-[var(--app-surface-strong)]" onClick={() => fileInputRefs[activeOrientation].current?.click()}>
                <ImagePlus className="w-4 h-4 mr-2" />
                Carica
              </Button>
            </div>
            <input
              ref={fileInputRefs[activeOrientation]}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => handleBackgroundSelected(activeOrientation, event)}
            />
            <div className="space-y-1">
              <div className="text-xs text-[var(--app-text-muted)]">{activeDraft.backgroundFileName || "Nessun file selezionato"}</div>
              <div className={`text-xs ${getFeedbackToneClass(backgroundFeedbacks[activeOrientation].tone)}`}>
                {backgroundFeedbacks[activeOrientation].message}
              </div>
              <div className="text-[11px] text-[var(--app-text-subtle)]">
                Warning oltre 12 MB, ottimizzazione oltre 18 MB, limite 35 MB.
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
                <Label>Spessore px</Label>
                <Input value={activeDraft.borderSizePx} onChange={(event) => updateActiveDraft((draft) => ({ ...draft, borderSizePx: event.target.value }))} className="bg-[var(--app-field)] border-[var(--app-border)] text-[var(--app-text)]" />
              </div>
              <div className="space-y-2">
                <Label>Colore bordo</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={activeDraft.borderColor}
                    onChange={(event) => updateActiveDraft((draft) => ({ ...draft, borderColor: event.target.value }))}
                    className="h-10 w-12 rounded-xl border border-[var(--app-border)] bg-transparent"
                  />
                  <Input value={activeDraft.borderColor} onChange={(event) => updateActiveDraft((draft) => ({ ...draft, borderColor: event.target.value }))} className="bg-[var(--app-field)] border-[var(--app-border)] text-[var(--app-text)]" />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 shadow-[0_18px_42px_rgba(0,0,0,0.16)]">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Area Foto</div>
                <div className="text-xs text-[var(--app-text-subtle)]">Drag diretto nel canvas o valori manuali</div>
              </div>
              <div className="flex items-center gap-2 text-xs text-[var(--app-text-muted)]">
                <Crop className="w-4 h-4" />
                <span>{activeDraft.photoArea.width} x {activeDraft.photoArea.height}px</span>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={activeDraft.lockAspectRatio} onChange={(event) => updateActiveDraft((draft) => ({ ...draft, lockAspectRatio: event.target.checked }))} className="w-4 h-4" />
              Mantieni proporzioni
            </label>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Rapporto X</Label>
                <Input value={activeDraft.photoRatioX} onChange={(event) => updateActiveDraft((draft) => ({ ...draft, photoRatioX: event.target.value }))} className="bg-[var(--app-field)] border-[var(--app-border)] text-[var(--app-text)]" />
              </div>
              <div className="space-y-2">
                <Label>Rapporto Y</Label>
                <Input value={activeDraft.photoRatioY} onChange={(event) => updateActiveDraft((draft) => ({ ...draft, photoRatioY: event.target.value }))} className="bg-[var(--app-field)] border-[var(--app-border)] text-[var(--app-text)]" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>X</Label>
                <Input value={String(activeDraft.photoArea.x)} onChange={(event) => updateActiveDraft((draft) => ({ ...draft, photoArea: clampRect({ ...draft.photoArea, x: Number(event.target.value) || 0 }, { width: widthPx, height: heightPx }, draft.lockAspectRatio, ratio) }))} className="bg-[var(--app-field)] border-[var(--app-border)] text-[var(--app-text)]" />
              </div>
              <div className="space-y-2">
                <Label>Y</Label>
                <Input value={String(activeDraft.photoArea.y)} onChange={(event) => updateActiveDraft((draft) => ({ ...draft, photoArea: clampRect({ ...draft.photoArea, y: Number(event.target.value) || 0 }, { width: widthPx, height: heightPx }, draft.lockAspectRatio, ratio) }))} className="bg-[var(--app-field)] border-[var(--app-border)] text-[var(--app-text)]" />
              </div>
              <div className="space-y-2">
                <Label>Larghezza</Label>
                <Input value={String(activeDraft.photoArea.width)} onChange={(event) => updateActiveDraft((draft) => ({ ...draft, photoArea: clampRect({ ...draft.photoArea, width: Number(event.target.value) || 40, height: draft.lockAspectRatio ? Math.round((Number(event.target.value) || 40) / ratio) : draft.photoArea.height }, { width: widthPx, height: heightPx }, draft.lockAspectRatio, ratio) }))} className="bg-[var(--app-field)] border-[var(--app-border)] text-[var(--app-text)]" />
              </div>
              <div className="space-y-2">
                <Label>Altezza</Label>
                <Input value={String(activeDraft.photoArea.height)} onChange={(event) => updateActiveDraft((draft) => ({ ...draft, photoArea: clampRect({ ...draft.photoArea, height: Number(event.target.value) || 40 }, { width: widthPx, height: heightPx }, draft.lockAspectRatio, ratio) }))} className="bg-[var(--app-field)] border-[var(--app-border)] text-[var(--app-text)]" />
              </div>
            </div>
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
                  backgroundColor: activeDraft.borderColor,
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
