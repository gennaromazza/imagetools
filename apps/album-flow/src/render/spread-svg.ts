import type { AlbumAssetV2, AlbumSpread } from "@photo-tools/shared-types";
import { areaOuterRects, spreadSizeMm } from "../engine/geometry";
import { itemBorderColor, placeItem } from "../model/placement";
import { areaGeometry, assetMap, type Project } from "../model/project";
import { renderBackgroundsSvg, renderOverlaysSvg, type DesignContext } from "./design-svg";

export interface RenderOptions {
  /** Output per stampa: solo immagini incorporate (data URL), niente guide. */
  forPrint?: boolean;
  /** Mostra piega e zona sicura (solo anteprima). */
  showGuides?: boolean;
  /** Sfondi a immagine, testi e grafiche: servono le immagini già caricate e come misurare il testo. Senza, restano fuori. */
  design?: DesignContext & {
    /** Regole @font-face (con i font incorporati come data URL) per un SVG autonomo. */
    fontCss?: string;
  };
}

const n = (value: number) => Number(value.toFixed(3));
const attr = (value: string | number) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&apos;");
const safeId = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, "_");

/** Dimensioni dello spread con l'abbondanza attorno, in millimetri. */
export function spreadSizeWithBleedMm(project: Project): { width: number; height: number; bleed: number } {
  const { width, height } = spreadSizeMm(project.settings.sheet);
  const bleed = Math.max(0, (project.settings.sheet.bleedCm ?? 0) * 10);
  return { width: width + bleed * 2, height: height + bleed * 2, bleed };
}

/**
 * SVG di uno spread: sfondi per area (fino al bordo dell'abbondanza), foto ritagliate e orientate, bordi e bianco e nero.
 * `assets` deve contenere per ogni foto usata un `previewUrl` (data URL per la stampa).
 */
export function renderSpreadSvg(project: Project, spread: AlbumSpread, assets: ReadonlyMap<string, AlbumAssetV2> = assetMap(project), options: RenderOptions = {}, spreadIndex = 0): string {
  const { width, height } = spreadSizeMm(project.settings.sheet);
  if (![width, height].every((value) => Number.isFinite(value) && value > 0)) throw new Error("Dimensioni dello spread non valide per l'export.");
  const bleed = Math.max(0, (project.settings.sheet.bleedCm ?? 0) * 10);
  const outers = areaOuterRects(project.settings.sheet, spread.split);

  const backgrounds = spread.areas.map((area, index) => {
    const outer = outers[index];
    const x0 = index === 0 ? -bleed : outer.x;
    const x1 = index === outers.length - 1 ? width + bleed : outer.x + outer.w;
    return `<rect x="${n(x0)}" y="${n(-bleed)}" width="${n(x1 - x0)}" height="${n(height + bleed * 2)}" fill="${attr(area.style.background)}"/>`;
  }).join("");

  const backgroundImages = options.design ? renderBackgroundsSvg(project, spread, options.design) : "";
  const overlays = options.design ? renderOverlaysSvg(project, spread, options.design) : "";
  let needsMono = false;
  const cells = spread.areas.map((area, areaIndex) => {
    const geometry = areaGeometry(project, spread, areaIndex);
    // Nelle disposizioni libere si disegna dal livello più basso al più alto; ogni foto ruota attorno al suo centro.
    const ordered = geometry.cells.some((cell) => cell.z !== undefined) ? [...geometry.cells].sort((a, b) => (a.z ?? 0) - (b.z ?? 0)) : geometry.cells;
    return ordered.map((cell) => {
      const item = area.items.find((candidate) => candidate.id === cell.itemId);
      if (!item) throw new Error("Elemento mancante nel layout.");
      const asset = assets.get(item.assetId);
      const placement = placeItem(cell.rect, item, asset, area.style, null, cell.anchor);
      const { frame, content, borderMm } = placement;
      const border = borderMm > 0 ? `<rect x="${n(content.x - borderMm)}" y="${n(content.y - borderMm)}" width="${n(content.w + borderMm * 2)}" height="${n(content.h + borderMm * 2)}" fill="${attr(itemBorderColor(item, area.style))}"/>` : "";
      const url = asset?.previewUrl;
      const usable = url && (!options.forPrint || url.startsWith("data:image/"));
      const turn = (inner: string) => (cell.rotation ? `<g transform="rotate(${n(cell.rotation)} ${n(cell.rect.x + cell.rect.w / 2)} ${n(cell.rect.y + cell.rect.h / 2)})">${inner}</g>` : inner);
      if (!usable || !asset) return turn(`${border}<rect x="${n(content.x)}" y="${n(content.y)}" width="${n(content.w)}" height="${n(content.h)}" fill="#d8d2c6"/>`);
      const clipId = `c${spreadIndex}-${safeId(item.id)}`;
      const quarter = asset.rotationDegrees === 90 || asset.rotationDegrees === 270;
      const cx = placement.image.x + placement.image.w / 2;
      const cy = placement.image.y + placement.image.h / 2;
      const elementW = quarter ? placement.image.h : placement.image.w;
      const elementH = quarter ? placement.image.w : placement.image.h;
      const rotate = asset.rotationDegrees ? ` transform="rotate(${asset.rotationDegrees} ${n(cx)} ${n(cy)})"` : "";
      if (area.style.mono) needsMono = true;
      const filter = area.style.mono ? ' filter="url(#mono)"' : "";
      const clip = `<clipPath id="${clipId}"><rect x="${n(content.x)}" y="${n(content.y)}" width="${n(content.w)}" height="${n(content.h)}"/></clipPath>`;
      if (placement.angle) {
        // Foto raddrizzata: il ritaglio resta dritto, l'immagine ruota attorno al centro della parte visibile.
        return turn(`${border}${clip}<g clip-path="url(#${clipId})"><g transform="rotate(${n(placement.angle)} ${n(content.x + content.w / 2)} ${n(content.y + content.h / 2)})">`
          + `<image href="${attr(url)}" x="${n(cx - elementW / 2)}" y="${n(cy - elementH / 2)}" width="${n(elementW)}" height="${n(elementH)}" preserveAspectRatio="none"${rotate}${filter}/></g></g>`);
      }
      return turn(`${border}${clip}`
        + `<image href="${attr(url)}" x="${n(cx - elementW / 2)}" y="${n(cy - elementH / 2)}" width="${n(elementW)}" height="${n(elementH)}" preserveAspectRatio="none"${rotate}${filter} clip-path="url(#${clipId})"/>`);
    }).join("");
  }).join("");

  let guides = "";
  if (!options.forPrint && options.showGuides !== false) {
    const margin = Math.max(0, project.settings.sheet.marginCm * 10);
    const page = width / 2;
    guides = [0, 1].map((side) => `<rect x="${n(side * page + margin)}" y="${n(margin)}" width="${n(Math.max(0, page - margin * 2))}" height="${n(Math.max(0, height - margin * 2))}" fill="none" stroke="#c8a800" stroke-dasharray="3 2" stroke-width="0.5" data-safe-area="true"/>`).join("")
      + `<line x1="${n(page)}" y1="0" x2="${n(page)}" y2="${n(height)}" stroke="#000000" stroke-opacity="0.25" stroke-width="0.4" data-fold="true"/>`;
  }
  const monoFilter = needsMono ? '<filter id="mono" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/></filter>' : "";
  const fontStyle = options.design?.fontCss && overlays ? `<style>${options.design.fontCss}</style>` : "";
  const defs = monoFilter || fontStyle ? `<defs>${fontStyle}${monoFilter}</defs>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(-bleed)} ${n(-bleed)} ${n(width + bleed * 2)} ${n(height + bleed * 2)}" width="${n(width + bleed * 2)}mm" height="${n(height + bleed * 2)}mm" role="img" aria-label="Spread ${spreadIndex + 1}">${defs}${backgrounds}${backgroundImages}${cells}${overlays}${guides}</svg>`;
}
