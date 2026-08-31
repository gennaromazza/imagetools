export type ProfileKind = "official" | "studio";

export interface DocumentProfile {
  id: string;
  label: string;
  country: string;
  document: string;
  kind: ProfileKind;
  version: string;
  widthMm: number;
  heightMm: number;
  faceHeightMinPct: number;
  faceHeightMaxPct: number;
  eyeLineFromBottomMinMm?: number;
  eyeLineFromBottomMaxMm?: number;
  digitalMinDpi?: number;
  digitalMaxBytes?: number;
  digitalFormats?: readonly string[];
  sourceLabel: string;
  sourceUrl: string;
  sourceCheckedAt: string;
  nextReviewAt: string;
  editingPolicy: "crop-only" | "technical-only" | "studio-controlled";
  backgroundPolicy: "preserve" | "uniform-required";
  note: string;
}

export const DOCUMENT_PROFILES: DocumentProfile[] = [
  {
    id: "it-cie-35x45-v1",
    label: "Carta d'identità italiana (CIE)",
    country: "Italia",
    document: "CIE",
    kind: "official",
    version: "1.0.0",
    widthMm: 35,
    heightMm: 45,
    faceHeightMinPct: 70,
    faceHeightMaxPct: 80,
    eyeLineFromBottomMinMm: 23,
    eyeLineFromBottomMaxMm: 31,
    digitalMinDpi: 400,
    digitalMaxBytes: 500_000,
    digitalFormats: ["jpg"],
    sourceLabel: "Ministero dell'Interno — modalità di acquisizione foto CIE",
    sourceUrl: "https://www.cartaidentita.interno.gov.it/richiedi/modalita-di-acquisizione-delle-foto/",
    sourceCheckedAt: "2026-08-31",
    nextReviewAt: "2027-02-28",
    editingPolicy: "technical-only",
    backgroundPolicy: "preserve",
    note: "Profilo basato sulle indicazioni pubblicate per la CIE. La verifica finale resta responsabilità dell'operatore.",
  },
  {
    id: "it-passport-icao-35x45-v2",
    label: "Passaporto italiano — linee guida ICAO",
    country: "Italia",
    document: "Passaporto",
    kind: "official",
    version: "2.0.0",
    widthMm: 35,
    heightMm: 45,
    faceHeightMinPct: 70,
    faceHeightMaxPct: 80,
    sourceLabel: "Ministero degli Affari Esteri — linee guida foto ICAO",
    sourceUrl: "https://www.esteri.it/it/servizi-opportunita/italiani-all-estero/documenti_di_viaggio/linee-guida-foto-icao/",
    sourceCheckedAt: "2026-08-31",
    nextReviewAt: "2027-02-28",
    editingPolicy: "technical-only",
    backgroundPolicy: "uniform-required",
    note: "Formato nazionale 35×45 mm verificato sulle linee guida MAECI. Alcune sedi estere richiedono 35×40 mm: controllare sempre l'ufficio destinatario.",
  },
  {
    id: "generic-35x45-v1",
    label: "Documento generico 35×45 mm",
    country: "Generico",
    document: "Documento",
    kind: "studio",
    version: "1.0.0",
    widthMm: 35,
    heightMm: 45,
    faceHeightMinPct: 65,
    faceHeightMaxPct: 80,
    sourceLabel: "Preset studio FileX",
    sourceUrl: "",
    sourceCheckedAt: "2026-08-31",
    nextReviewAt: "2027-02-28",
    editingPolicy: "studio-controlled",
    backgroundPolicy: "uniform-required",
    note: "Formato generico, senza dichiarazione di conformità a uno specifico ente.",
  },
];

export interface TechnicalCheck {
  id: "resolution" | "brightness" | "contrast" | "sharpness" | "background";
  label: string;
  status: "pass" | "warning" | "fail";
  value: string;
  message: string;
}

export interface ImageMetrics {
  width: number;
  height: number;
  meanLuma: number;
  contrast: number;
  sharpness: number;
  backgroundUniformity: number;
}

export interface NormalizedCrop {
  cropLeft: number;
  cropTop: number;
  cropWidth: number;
  cropHeight: number;
  rotation?: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function finiteDimension(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function effectiveCropPixelSize(
  width: number,
  height: number,
  crop?: NormalizedCrop | null,
): { width: number; height: number } {
  const normalizedWidth = finiteDimension(width);
  const normalizedHeight = finiteDimension(height);
  if (!crop) return { width: normalizedWidth, height: normalizedHeight };
  const cropWidth = Math.max(0, Math.min(1 - clamp01(crop.cropLeft), clamp01(crop.cropWidth)));
  const cropHeight = Math.max(0, Math.min(1 - clamp01(crop.cropTop), clamp01(crop.cropHeight)));
  const sourceWidth = normalizedWidth * cropWidth;
  const sourceHeight = normalizedHeight * cropHeight;
  const normalizedRotation = ((crop.rotation ?? 0) % 360 + 360) % 360;
  const quarterTurn = Math.abs(normalizedRotation - 90) < 0.001 || Math.abs(normalizedRotation - 270) < 0.001;
  return {
    width: Math.round(quarterTurn ? sourceHeight : sourceWidth),
    height: Math.round(quarterTurn ? sourceWidth : sourceHeight),
  };
}

export function evaluateTechnicalChecks(
  metrics: ImageMetrics,
  profile: DocumentProfile,
  crop?: NormalizedCrop | null,
): TechnicalCheck[] {
  const requiredWidth = Math.ceil((profile.widthMm / 25.4) * (profile.digitalMinDpi ?? 300));
  const requiredHeight = Math.ceil((profile.heightMm / 25.4) * (profile.digitalMinDpi ?? 300));
  const effectiveSize = effectiveCropPixelSize(metrics.width, metrics.height, crop);
  const resolutionPass = effectiveSize.width >= requiredWidth && effectiveSize.height >= requiredHeight;
  const brightnessStatus = metrics.meanLuma >= 72 && metrics.meanLuma <= 225 ? "pass" : metrics.meanLuma >= 55 && metrics.meanLuma <= 240 ? "warning" : "fail";
  const contrastStatus = metrics.contrast >= 28 ? "pass" : metrics.contrast >= 18 ? "warning" : "fail";
  const sharpnessStatus = metrics.sharpness >= 110 ? "pass" : metrics.sharpness >= 55 ? "warning" : "fail";
  const backgroundStatus = metrics.backgroundUniformity >= 82 ? "pass" : metrics.backgroundUniformity >= 65 ? "warning" : "fail";

  return [
    {
      id: "resolution",
      label: "Risoluzione utile",
      status: resolutionPass ? "pass" : "fail",
      value: `${effectiveSize.width}×${effectiveSize.height} px utili`,
      message: resolutionPass ? `Il ritaglio è sufficiente per ${profile.digitalMinDpi ?? 300} dpi.` : `Nel ritaglio servono almeno ${requiredWidth}×${requiredHeight} px per questo profilo.`,
    },
    {
      id: "brightness",
      label: "Luminosità",
      status: brightnessStatus,
      value: `${Math.round(metrics.meanLuma)}/255`,
      message: brightnessStatus === "pass" ? "Esposizione media nel range tecnico." : "Controllare viso e alte luci prima dell'export.",
    },
    {
      id: "contrast",
      label: "Contrasto",
      status: contrastStatus,
      value: metrics.contrast.toFixed(1),
      message: contrastStatus === "pass" ? "Separazione tonale adeguata." : "Immagine potenzialmente piatta o velata.",
    },
    {
      id: "sharpness",
      label: "Nitidezza",
      status: sharpnessStatus,
      value: metrics.sharpness.toFixed(0),
      message: sharpnessStatus === "pass" ? "Dettaglio locale adeguato." : "Verificare fuoco, mosso e compressione.",
    },
    {
      id: "background",
      label: "Uniformità sfondo",
      status: backgroundStatus,
      value: `${Math.round(metrics.backgroundUniformity)}%`,
      message: backgroundStatus === "pass" ? "Bordi dello sfondo abbastanza uniformi." : "Il controllo locale rileva variazioni: rifinire o verificare manualmente.",
    },
  ];
}

export function safeJobName(customer: string, job: string): string {
  const value = `${customer}-${job}`
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[. -]+$/g, "")
    .slice(0, 64);
  if (!value) return "filex-id-photo";
  const windowsReservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  return windowsReservedName.test(value) ? `filex-${value}`.slice(0, 64) : value;
}
