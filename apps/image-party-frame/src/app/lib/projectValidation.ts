import type { CustomTemplateVariant, ProjectState } from "../contexts/ProjectContext";

export type ValidationSeverity = "ok" | "warning" | "error";

export type ProjectValidationCheck = {
  code: string;
  severity: ValidationSeverity;
  label: string;
  detail?: string;
};

export type ProjectValidationResult = {
  checks: ProjectValidationCheck[];
  canContinue: boolean;
  errorCount: number;
  warningCount: number;
};

const MAX_TEMPLATE_SIDE_PX = 12_000;
const MAX_TEMPLATE_PIXELS = 80_000_000;

function validateVariant(
  orientation: "vertical" | "horizontal",
  variant: CustomTemplateVariant | undefined
): ProjectValidationCheck[] {
  const label = orientation === "vertical" ? "verticale" : "orizzontale";

  if (!variant) {
    return [{
      code: `custom-${orientation}-missing`,
      severity: "error",
      label: `Variante ${label} mancante`,
    }];
  }

  const dimensionsValid =
    Number.isFinite(variant.widthPx) &&
    Number.isFinite(variant.heightPx) &&
    variant.widthPx > 0 &&
    variant.heightPx > 0 &&
    variant.widthPx <= MAX_TEMPLATE_SIDE_PX &&
    variant.heightPx <= MAX_TEMPLATE_SIDE_PX &&
    variant.widthPx * variant.heightPx <= MAX_TEMPLATE_PIXELS;
  const areaValid =
    Number.isFinite(variant.photoAreaX) &&
    Number.isFinite(variant.photoAreaY) &&
    Number.isFinite(variant.photoAreaWidth) &&
    Number.isFinite(variant.photoAreaHeight) &&
    variant.photoAreaX >= 0 &&
    variant.photoAreaY >= 0 &&
    variant.photoAreaWidth > 0 &&
    variant.photoAreaHeight > 0 &&
    variant.photoAreaX + variant.photoAreaWidth <= variant.widthPx &&
    variant.photoAreaY + variant.photoAreaHeight <= variant.heightPx;
  const borderValid =
    Number.isFinite(variant.borderSizePx) &&
    variant.borderSizePx >= 0 &&
    variant.borderSizePx * 2 < Math.min(variant.photoAreaWidth, variant.photoAreaHeight);

  return [
    {
      code: `custom-${orientation}-canvas`,
      severity: dimensionsValid ? "ok" : "error",
      label: `Canvas ${label}`,
      detail: dimensionsValid
        ? `${variant.widthPx} x ${variant.heightPx}px a ${variant.dpi} DPI`
        : `Il canvas deve restare entro ${MAX_TEMPLATE_SIDE_PX}px per lato e 80 MP.`,
    },
    {
      code: `custom-${orientation}-photo-area`,
      severity: areaValid ? "ok" : "error",
      label: `Area foto ${label}`,
      detail: areaValid
        ? `${variant.photoAreaWidth} x ${variant.photoAreaHeight}px`
        : "L'area foto esce dal canvas o ha dimensioni non valide.",
    },
    {
      code: `custom-${orientation}-border`,
      severity: borderValid ? "ok" : "error",
      label: `Bordo foto ${label}`,
      detail: borderValid ? `${variant.borderSizePx}px` : "Il bordo occupa completamente l'area foto.",
    },
  ];
}

export function validateProjectForWorkspace(
  project: ProjectState,
  hasSessionFile: (imageId: string) => boolean = () => false
): ProjectValidationResult {
  const images = Array.isArray(project.images) ? project.images : [];
  const checks: ProjectValidationCheck[] = [];

  checks.push({
    code: "project-name",
    severity: project.name.trim() ? "ok" : "error",
    label: project.name.trim() ? "Progetto identificato" : "Nome progetto mancante",
    detail: project.name.trim() || "Assegna un nome prima di continuare.",
  });

  checks.push({
    code: "images",
    severity: images.length > 0 ? "ok" : "error",
    label: images.length > 0 ? `${images.length} immagini indicizzate` : "Nessuna immagine indicizzata",
  });

  const unavailableImages = images.filter((image) => !hasSessionFile(image.id));
  checks.push({
    code: "source-files",
    severity: unavailableImages.length === 0 ? "ok" : "error",
    label: unavailableImages.length === 0 ? "File sorgente disponibili" : `${unavailableImages.length} file da ricollegare`,
    detail: unavailableImages.length > 0
      ? "Torna al progetto e ricollega la cartella sorgente. Un percorso salvato non viene considerato valido finché il file non è verificato nella sessione corrente."
      : undefined,
  });

  const ids = new Set(images.map((image) => image.id));
  checks.push({
    code: "unique-identities",
    severity: ids.size === images.length ? "ok" : "error",
    label: ids.size === images.length ? "Identita immagini univoche" : "Sono presenti ID immagine duplicati",
  });

  const countedVertical = images.filter((image) => image.orientation === "vertical").length;
  const countsMatch =
    project.imageCount.total === images.length &&
    project.imageCount.vertical === countedVertical &&
    project.imageCount.horizontal === images.length - countedVertical;
  checks.push({
    code: "orientation-counts",
    severity: countsMatch ? "ok" : "warning",
    label: countsMatch ? "Orientamenti coerenti" : "Conteggi orientamento da riallineare",
    detail: `${countedVertical} verticali, ${images.length - countedVertical} orizzontali`,
  });

  if (project.template === "custom") {
    if (!project.customTemplate) {
      checks.push({
        code: "custom-template",
        severity: "error",
        label: "Template custom non configurato",
      });
    } else {
      checks.push(...validateVariant("vertical", project.customTemplate.variants.vertical));
      checks.push(...validateVariant("horizontal", project.customTemplate.variants.horizontal));
    }
  } else {
    checks.push({
      code: "preset-template",
      severity: project.template.trim() ? "ok" : "error",
      label: project.template.trim() ? `Preset ${project.template}` : "Preset non selezionato",
      detail: "La variante viene scelta automaticamente dall'orientamento della foto.",
    });
  }

  const errorCount = checks.filter((check) => check.severity === "error").length;
  const warningCount = checks.filter((check) => check.severity === "warning").length;

  return {
    checks,
    canContinue: errorCount === 0,
    errorCount,
    warningCount,
  };
}
