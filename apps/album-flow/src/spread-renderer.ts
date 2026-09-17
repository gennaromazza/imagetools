import type { AlbumAsset, GeneratedPageLayout } from "@photo-tools/shared-types";

function xmlAttribute(value: string | number): string {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&apos;");
}

export function renderSpreadSvg(page: GeneratedPageLayout, assets: AlbumAsset[] = []): string {
  const width = page.sheetSpec.widthCm * 10;
  const height = page.sheetSpec.heightCm * 10;
  const bleed = (page.sheetSpec.bleedCm ?? 0) * 10;
  const margin = page.sheetSpec.marginCm * 10;
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error("Dimensioni pagina non valide per l’export SVG.");
  }
  const slots = page.slotDefinitions;
  const body = page.assignments.map((assignment) => {
    const slot = slots.find(item => item.id === assignment.slotId);
    if (!slot) throw new Error(`Slot mancante: ${assignment.slotId}`);
    const x = slot.x * width, y = slot.y * height, w = slot.width * width, h = slot.height * height;
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) throw new Error("Geometria slot non valida.");
    const asset = assets.find(item => item.id === assignment.imageId);
    const image = asset?.previewUrl ? `<image href="${xmlAttribute(asset.previewUrl)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>` : `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#e8e2d8"/>`;
    return `${image}<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#ffffff" stroke-width="1" data-image-id="${xmlAttribute(assignment.imageId)}"/>`;
  }).join("");
  const safeArea = `<rect x="${margin}" y="${margin}" width="${Math.max(0, width - margin * 2)}" height="${Math.max(0, height - margin * 2)}" fill="none" stroke="#c8a800" stroke-dasharray="3 2" stroke-width="0.5" data-safe-area="true"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-bleed} ${-bleed} ${width + bleed * 2} ${height + bleed * 2}" width="${width + bleed * 2}mm" height="${height + bleed * 2}mm" role="img" aria-label="Pagina ${xmlAttribute(page.pageNumber)}"><rect x="${-bleed}" y="${-bleed}" width="${width + bleed * 2}" height="${height + bleed * 2}" fill="${xmlAttribute(page.sheetSpec.backgroundColor ?? "#ffffff")}"/>${body}${safeArea}</svg>`;
}
