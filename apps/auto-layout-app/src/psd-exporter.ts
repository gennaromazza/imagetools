/**
 * PSD Export con Smart Objects embedded.
 *
 * Per ogni pagina del layout genera un file .psd con:
 *  - Un layer "Sfondo" (colore piatto della pagina)
 *  - Un layer Smart Object per ogni foto assegnata, con i byte originali
 *    del file (JPEG/PNG) embedded come linkedFile.
 *
 * In Photoshop, doppio click su un layer foto → apre Camera Raw
 * con il file originale per il ritocco non distruttivo.
 *
 * Nota: ag-psd opera in RGB 8-bit. I linkedFiles però vengono embeddati
 * come blob opachi, quindi Photoshop accede ai dati originali senza
 * downgrade di qualità.
 */

import { writePsd } from "ag-psd";
import type { AutoLayoutResult, GeneratedPageLayout, ImageAsset, LayoutAssignment } from "@photo-tools/shared-types";
import { getAssignmentCanvasDrawMetrics, getNormalizedAssignmentCrop } from "./utils/assignment-rendering";
import { loadDecodedImage } from "./image-cache";
import { cmToPx, getRenderedSlotRect } from "./sheet-renderer";

export interface PsdExportProgressUpdate {
  completed: number;
  total: number;
  fileName: string;
  pageNumber: number;
  stage: "rendering" | "saving" | "completed";
}

export interface PsdExportOptions {
  outputDirectoryPath?: string | null;
  onProgress?: (update: PsdExportProgressUpdate) => void;
}

export interface PsdExportResult {
  exportedFiles: string[];
  savedToDirectory: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildPsdFileName(result: AutoLayoutResult, page: GeneratedPageLayout): string {
  return `${result.request.output.fileNamePattern.replace("{index}", String(page.pageNumber))}.psd`;
}

function joinOutputPath(directoryPath: string, fileName: string): string {
  const separator = directoryPath.includes("\\") ? "\\" : "/";
  return directoryPath.endsWith(separator)
    ? `${directoryPath}${fileName}`
    : `${directoryPath}${separator}${fileName}`;
}

async function fetchAsBytes(url: string): Promise<Uint8Array> {
  // Percorso assoluto Windows (es. C:\Foto\DSC_001.NEF) → usa il bridge Electron
  const isAbsolutePath = /^[a-zA-Z]:[\\\/]/.test(url) || url.startsWith("\\\\");
  if (isAbsolutePath && typeof window.filexDesktop?.readFile === "function") {
    const result = await window.filexDesktop.readFile(url);
    if (!result) {
      throw new Error(`Impossibile leggere il file RAW: ${url}`);
    }
    return result.bytes;
  }

  // blob: o http: URL → fetch standard
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Impossibile leggere il file asset: ${url}`);
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Renderizza la porzione visibile di una foto nel suo slot (con crop/zoom/
 * rotazione applicati) su un canvas della dimensione dello slot.
 * Questo canvas diventa il thumbnail del layer Smart Object in Photoshop.
 */
async function renderSlotThumbnail(
  asset: ImageAsset,
  assignment: LayoutAssignment,
  slotWidth: number,
  slotHeight: number
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(slotWidth));
  canvas.height = Math.max(1, Math.round(slotHeight));

  const assetUrl = asset.sourceUrl ?? asset.previewUrl;
  if (!assetUrl) {
    return canvas;
  }

  const image = await loadDecodedImage(assetUrl);
  const { cropLeft, cropTop, cropWidth, cropHeight } = getNormalizedAssignmentCrop(assignment);

  const crop = {
    sx: cropLeft * image.naturalWidth,
    sy: cropTop * image.naturalHeight,
    sw: cropWidth * image.naturalWidth,
    sh: cropHeight * image.naturalHeight
  };

  const croppedAspect = crop.sw / Math.max(crop.sh, 0.001);
  const renderAssignment = { ...assignment, cropLeft: 0, cropTop: 0, cropWidth: 1, cropHeight: 1 };
  const metrics = getAssignmentCanvasDrawMetrics(renderAssignment, croppedAspect, slotWidth, slotHeight);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return canvas;
  }

  ctx.save();
  ctx.translate(slotWidth / 2, slotHeight / 2);
  ctx.rotate(metrics.rotationRad);
  ctx.drawImage(
    image,
    crop.sx,
    crop.sy,
    crop.sw,
    crop.sh,
    -metrics.drawWidth / 2 + metrics.translateX,
    -metrics.drawHeight / 2 + metrics.translateY,
    metrics.drawWidth,
    metrics.drawHeight
  );
  ctx.restore();

  return canvas;
}

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

/**
 * Esporta tutte le pagine di un layout come file .psd con Smart Objects.
 * Un file .psd separato viene generato per ogni pagina.
 */
export async function exportSheetsAsPsd(
  result: AutoLayoutResult,
  options: PsdExportOptions = {}
): Promise<PsdExportResult> {
  const assetsById = new Map(result.request.assets.map((asset) => [asset.id, asset]));
  const exportedFiles: string[] = [];

  for (const page of result.pages) {
    const fileName = buildPsdFileName(result, page);
    const dpi = page.sheetSpec.dpi;
    const pageWidth = cmToPx(page.sheetSpec.widthCm, dpi);
    const pageHeight = cmToPx(page.sheetSpec.heightCm, dpi);

    options.onProgress?.({
      completed: exportedFiles.length,
      total: result.pages.length,
      fileName,
      pageNumber: page.pageNumber,
      stage: "rendering"
    });

    // --- Layer sfondo -------------------------------------------------------
    const bgCanvas = document.createElement("canvas");
    bgCanvas.width = pageWidth;
    bgCanvas.height = pageHeight;
    const bgCtx = bgCanvas.getContext("2d");
    if (bgCtx) {
      bgCtx.fillStyle = page.sheetSpec.backgroundColor || "#ffffff";
      bgCtx.fillRect(0, 0, pageWidth, pageHeight);
    }

    const linkedFiles: { id: string; name: string; data: Uint8Array }[] = [];
    const children: object[] = [
      {
        name: "Sfondo",
        top: 0,
        left: 0,
        bottom: pageHeight,
        right: pageWidth,
        canvas: bgCanvas
      }
    ];

    // --- Layer Smart Object per ogni slot assegnato -------------------------
    // trimX/trimY = 0 perché il PSD non ha bleed
    const trimX = 0;
    const trimY = 0;

    for (const slot of page.slotDefinitions) {
      const assignment = page.assignments.find((a) => a.slotId === slot.id);
      if (!assignment) {
        continue;
      }

      const asset = assetsById.get(assignment.imageId);
      if (!asset) {
        continue;
      }

      const { x: slotX, y: slotY, width: slotW, height: slotH } = getRenderedSlotRect(
        page,
        slot,
        trimX,
        trimY,
        pageWidth,
        pageHeight,
        dpi
      );

      const roundedX = Math.round(slotX);
      const roundedY = Math.round(slotY);
      const roundedW = Math.max(1, Math.round(slotW));
      const roundedH = Math.max(1, Math.round(slotH));

      // Carica i byte originali del file (JPEG/PNG) per il linked file
      const assetUrl = asset.sourceUrl ?? asset.previewUrl;
      const fileId = `linked-${asset.id}`;

      if (assetUrl && !linkedFiles.find((lf) => lf.id === fileId)) {
        const fileBytes = await fetchAsBytes(assetUrl);
        linkedFiles.push({ id: fileId, name: asset.fileName, data: fileBytes });
      }

      // Thumbnail renderizzato per la preview del layer in Photoshop
      const thumbCanvas = await renderSlotThumbnail(asset, assignment, roundedW, roundedH);

      children.push({
        name: asset.fileName,
        top: roundedY,
        left: roundedX,
        bottom: roundedY + roundedH,
        right: roundedX + roundedW,
        canvas: thumbCanvas,
        placedLayer: {
          // Riferimento al linkedFile
          id: fileId,
          // Tipo raster (foto JPG/PNG)
          type: "raster",
          // 4 angoli del bounding box: TL, TR, BR, BL
          transform: [
            roundedX, roundedY,
            roundedX + roundedW, roundedY,
            roundedX + roundedW, roundedY + roundedH,
            roundedX, roundedY + roundedH
          ],
          // Dimensioni originali della foto sorgente
          width: asset.width,
          height: asset.height,
          resolution: { value: dpi, units: "Density" }
        }
      });
    }

    // --- Costruzione PSD ----------------------------------------------------
    const psd = {
      width: pageWidth,
      height: pageHeight,
      linkedFiles,
      children
    };

    const buffer = writePsd(psd, { generateThumbnail: true });
    const bytes = new Uint8Array(buffer);

    options.onProgress?.({
      completed: exportedFiles.length,
      total: result.pages.length,
      fileName,
      pageNumber: page.pageNumber,
      stage: "saving"
    });

    // --- Scrittura file -----------------------------------------------------
    if (options.outputDirectoryPath && typeof window.filexDesktop?.writeFile === "function") {
      const absolutePath = joinOutputPath(options.outputDirectoryPath, fileName);
      const ok = await window.filexDesktop.writeFile(absolutePath, bytes);
      if (!ok) {
        throw new Error(`Impossibile salvare il file PSD: ${absolutePath}`);
      }
    } else {
      const blob = new Blob([bytes], { type: "application/octet-stream" });
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    }

    exportedFiles.push(fileName);

    options.onProgress?.({
      completed: exportedFiles.length,
      total: result.pages.length,
      fileName,
      pageNumber: page.pageNumber,
      stage: "completed"
    });
  }

  return {
    exportedFiles,
    savedToDirectory: Boolean(options.outputDirectoryPath)
  };
}
