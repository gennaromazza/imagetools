import { itemAspect, type Project } from "../model/project";
import { approximateMeasure } from "../render/text-layout";
import { buildSlide } from "./build";
import { envFor } from "./plan";
import { templateOf } from "./templates";
import { MAX_SLIDES, MIN_SLIDES, type Carousel } from "./types";

export interface SocialIssue {
  level: "error" | "warning" | "info";
  message: string;
  slideIndex?: number;
}

export interface SocialReport {
  issues: SocialIssue[];
  errors: number;
  warnings: number;
}

/** Controlli prima di esportare: numero di slide, spazi vuoti, foto sparite o troppo piccole, album da mostrare. */
export function carouselReport(carousel: Carousel, project: Project): SocialReport {
  const issues: SocialIssue[] = [];
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  if (carousel.slides.length < MIN_SLIDES) issues.push({ level: "error", message: `Un carosello ha almeno ${MIN_SLIDES} slide.` });
  if (carousel.slides.length > MAX_SLIDES) issues.push({ level: "error", message: `Instagram accetta al massimo ${MAX_SLIDES} slide: ne hai ${carousel.slides.length}.` });
  const env = envFor(project, approximateMeasure);
  const seen = new Map<string, number>();
  carousel.slides.forEach((slide, index) => {
    const template = templateOf(slide.templateId);
    if (!template) { issues.push({ level: "error", message: `La slide ${index + 1} usa un modello che non esiste più.`, slideIndex: index }); return; }
    const built = buildSlide(carousel, index, env);
    const slotIds = slide.free ? slide.free.map((frame) => frame.assetId) : template.slots.map((_, slot) => slide.photos[slot]);
    slotIds.forEach((id, slot) => {
      if (!id) issues.push({ level: "warning", message: `Slide ${index + 1}: manca una foto (spazio ${slot + 1}).`, slideIndex: index });
      else if (!assets.has(id)) issues.push({ level: "warning", message: `Slide ${index + 1}: una foto non è più nell'album.`, slideIndex: index });
      else if (!slide.span) seen.set(id, (seen.get(id) ?? 0) + 1);
    });
    if (template.needsSpread && (!slide.spreadId || !project.spreads.some((spread) => spread.id === slide.spreadId) || (slide.spreadId2 && !project.spreads.some((spread) => spread.id === slide.spreadId2)))) {
      issues.push({ level: "warning", message: `Slide ${index + 1}: scegli la doppia pagina dell'album da mostrare.`, slideIndex: index });
    }
    for (const layer of built.layers) {
      if (layer.kind !== "photo" || !layer.assetId) continue;
      const asset = assets.get(layer.assetId);
      if (!asset) continue;
      const aspect = itemAspect(asset);
      const frameAspect = layer.w / layer.h;
      const shownW = aspect > frameAspect ? layer.h * aspect : layer.w;
      const quarter = asset.rotationDegrees === 90 || asset.rotationDegrees === 270;
      const pixels = quarter ? asset.height : asset.width;
      if (pixels > 0 && pixels < shownW * 0.9 * layer.zoom && layer.w >= 300) {
        issues.push({ level: "warning", message: `Slide ${index + 1}: una foto ha pochi pixel per questa dimensione e può risultare sgranata.`, slideIndex: index });
        break;
      }
    }
  });
  for (const [id, uses] of seen) {
    if (uses > 1) issues.push({ level: "info", message: `La foto ${assets.get(id)?.fileName ?? id} compare in ${uses} slide.` });
  }
  if (!carousel.brand.handle.trim()) issues.push({ level: "info", message: "Aggiungi il tuo profilo (@nome): compare in alcune slide." });
  const errors = issues.filter((issue) => issue.level === "error").length;
  return { issues, errors, warnings: issues.filter((issue) => issue.level === "warning").length };
}

/** Verità che devono valere dopo qualsiasi modifica: la usano i test, anche nella prova con operazioni casuali. */
export function assertCarouselInvariants(carousel: Carousel, project?: Project): void {
  const fail = (message: string): never => { throw new Error(`Carosello non valido: ${message}`); };
  if (carousel.slides.length < MIN_SLIDES || carousel.slides.length > MAX_SLIDES) fail(`numero di slide ${carousel.slides.length}`);
  const ids = new Set<string>();
  carousel.slides.forEach((slide, index) => {
    if (ids.has(slide.id)) fail(`identificativo doppio ${slide.id}`);
    ids.add(slide.id);
    const template = templateOf(slide.templateId);
    if (!template) return fail(`modello sconosciuto ${slide.templateId}`);
    if (slide.photos.length !== template.slots.length) fail(`la slide ${index + 1} ha ${slide.photos.length} foto per ${template.slots.length} spazi`);
    if (slide.framing) {
      if (slide.framing.length !== slide.photos.length) fail(`la slide ${index + 1} ha ${slide.framing.length} inquadrature per ${slide.photos.length} foto`);
      for (const framing of slide.framing) {
        if (!framing) continue;
        if (!(framing.zoom >= 1 && framing.zoom <= 4) || !(framing.cx >= 0 && framing.cx <= 1) || !(framing.cy >= 0 && framing.cy <= 1)) fail(`inquadratura fuori limite alla slide ${index + 1}`);
        if (framing.shape !== undefined && (slide.span || !(framing.shape >= 0.2 && framing.shape <= 5))) fail(`forma non valida alla slide ${index + 1}`);
      }
    }
    if (slide.free) {
      if (slide.span) fail(`un panorama non ha il modo libero (slide ${index + 1})`);
      if (new Set(slide.free.map((frame) => frame.id)).size !== slide.free.length) fail(`cornici libere con id doppio alla slide ${index + 1}`);
      for (const frame of slide.free) if (!(frame.w > 0 && frame.h > 0 && frame.zoom >= 1 && frame.zoom <= 4)) fail(`cornice libera non valida alla slide ${index + 1}`);
    }
    for (const key of Object.keys(slide.textOffset ?? {})) if (!template.fields.some((field) => field.key === key)) fail(`testo spostato per un campo che non esiste (${key}) alla slide ${index + 1}`);
    if (slide.textStyle) {
      for (const [key, style] of Object.entries(slide.textStyle)) {
        if (!template.fields.some((field) => field.key === key)) fail(`stile per un campo che non esiste (${key}) alla slide ${index + 1}`);
        if (style.scale !== undefined && !(style.scale >= 0.6 && style.scale <= 1.5)) fail(`corpo fuori limite alla slide ${index + 1}`);
      }
    }
    if (slide.span) {
      if (slide.flip) fail(`un panorama non si specchia (slide ${index + 1})`);
      const { index: part, count } = slide.span;
      const group = carousel.slides.slice(index - part, index - part + count);
      if (group.some((other) => JSON.stringify(other.texts) !== JSON.stringify(slide.texts) || other.tone !== slide.tone || JSON.stringify(other.framing ?? null) !== JSON.stringify(slide.framing ?? null) || JSON.stringify(other.textStyle ?? null) !== JSON.stringify(slide.textStyle ?? null))) fail(`le parti del panorama alla slide ${index + 1} non hanno gli stessi testi o lo stesso fondo`);
      if (part < 0 || part >= count) fail(`parte di panorama fuori intervallo alla slide ${index + 1}`);
      const start = index - part;
      for (let k = 0; k < count; k += 1) {
        const other = carousel.slides[start + k];
        if (!other?.span || other.span.index !== k || other.span.count !== count || other.photos[0] !== slide.photos[0]) fail(`panorama spezzato alla slide ${index + 1}`);
      }
    }
    if (project) {
      for (const id of slide.photos) if (id && !project.assets.some((asset) => asset.id === id)) fail(`foto inesistente ${id}`);
      for (const frame of slide.free ?? []) if (frame.assetId && !project.assets.some((asset) => asset.id === frame.assetId)) fail(`foto inesistente ${frame.assetId}`);
      for (const spreadId of [slide.spreadId, slide.spreadId2]) if (spreadId && !project.spreads.some((spread) => spread.id === spreadId)) fail(`spread inesistente ${spreadId}`);
    }
  });
}
