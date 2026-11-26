import { renderPhotoCanvas, exportRasterPage } from "../render-export";
import { cmToPx, getPhotoContentRectCm, mmToPx } from "../print-engine";
import { downscaleImage } from "./resample";
import { contentSpec, cropFor, displayedSize, effectiveBorderMm, orientedSizeCm, toAsset, PRINT_DPI } from "./geometry";
import type { OrderGroup, OrderPhoto, LogoSettings } from "./model";
import type { LogoOverlaySpec } from "../print-engine";

// Con qualità 1 Chromium conserva il colore a piena risoluzione (4:4:4): sulle stampe piccole si vede.
export const JPG_QUALITY = 1;

export interface RenderArgs {
    group: OrderGroup;
    photo: OrderPhoto;
    url: string;
    width: number;
    height: number;
    logo: LogoSettings;
    logoImage: HTMLImageElement | null;
    dpi?: number;
}

/**
 * Quanto va ridotta la sorgente perché il ritaglio finisca sul foglio un pixel per pixel
 * (1 = nessuna riduzione: non si ingrandisce mai).
 */
export function sourceScale(args: Pick<RenderArgs, "group" | "photo" | "width" | "height">, dpi: number): number {
    const content = getPhotoContentRectCm({ ...contentSpec(args.group, args.photo), dpi });
    const crop = cropFor(args.group, args.photo);
    const quarterTurn = Math.abs(crop.rotation) % 180 === 90;
    const cropWidth = crop.cropWidth * args.width;
    const cropHeight = crop.cropHeight * args.height;
    const shownWidth = quarterTurn ? cropHeight : cropWidth;
    const shownHeight = quarterTurn ? cropWidth : cropHeight;
    const scales = [cmToPx(content.width, dpi) / shownWidth, cmToPx(content.height, dpi) / shownHeight];
    return Math.min(1, args.group.fitMode === "cover" ? Math.max(...scales) : Math.min(...scales));
}

/**
 * Decodifica con rilascio esplicito: un <img> tiene in memoria gli originali finché pare al browser,
 * e dopo alcune foto da 40 megapixel rifiuta di decodificarne altre.
 */
async function decodeSource(url: string): Promise<ImageBitmap> {
    const blob = await (await fetch(url)).blob();
    try {
        return await createImageBitmap(blob);
    } catch {
        // La memoria può essere ancora occupata dalla foto precedente: un secondo tentativo basta.
        await new Promise(resolve => setTimeout(resolve, 1500));
        try {
            return await createImageBitmap(blob);
        } catch {
            throw new Error("Il browser non riesce a leggere la foto: file danneggiato o memoria insufficiente.");
        }
    }
}

/** Sostituisce la sorgente con una copia ridotta senza perdite, quando serve rimpicciolire molto. */
async function prepareSource(args: RenderArgs, dpi: number): Promise<{ url: string; width: number; height: number; release(): void }> {
    const bitmap = await decodeSource(args.url);
    let canvas: HTMLCanvasElement;
    try {
        const scale = sourceScale({ ...args, width: bitmap.width, height: bitmap.height }, dpi);
        if (scale > 0.9) return { url: args.url, width: args.width, height: args.height, release: () => {} };
        canvas = downscaleImage(bitmap, Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    } finally {
        bitmap.close();
    }
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
    const size = { width: canvas.width, height: canvas.height };
    canvas.width = canvas.height = 1;
    if (!blob) throw new Error("Impossibile ridurre la foto per la stampa.");
    const url = URL.createObjectURL(blob);
    return { url, ...size, release: () => URL.revokeObjectURL(url) };
}

export async function renderPrint(args: RenderArgs): Promise<HTMLCanvasElement> {
    const dpi = args.dpi ?? PRINT_DPI;
    const spec = { ...contentSpec(args.group, args.photo), dpi };
    
    const asset = toAsset(args.photo, args.url);
    asset.width = args.width;
    asset.height = args.height;
    
    const crop = cropFor(args.group, args.photo);
    const border = effectiveBorderMm(args.group);

    const overlay: LogoOverlaySpec = {
        enabled: args.group.logoEnabled,
        imageUrl: args.logo.path,
        position: args.logo.position,
        scalePct: args.logo.scalePct,
        opacity: args.logo.opacity,
        marginPct: args.logo.marginPct
    };

    const innerCanvas = await renderPhotoCanvas(
        asset,
        crop,
        spec,
        args.group.logoEnabled ? args.logoImage : null,
        overlay,
        {
            blackAndWhiteEnabled: false,
            fitMode: args.group.fitMode,
            autoRotateBySourceOrientation: false,
            borderEnabled: false,
            borderWidthPx: 0,
            borderColor: "#FFFFFF"
        }
    );

    if (border === 0) {
        return innerCanvas;
    }

    const outerCanvas = document.createElement("canvas");
    const oriented = orientedSizeCm(args.group.format, displayedSize(args.photo));
    
    outerCanvas.width = cmToPx(oriented.widthCm, dpi);
    outerCanvas.height = cmToPx(oriented.heightCm, dpi);

    const ctx = outerCanvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D non disponibile.");

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, outerCanvas.width, outerCanvas.height);

    const offsetPx = mmToPx(border, dpi);
    ctx.drawImage(
        innerCanvas,
        offsetPx,
        offsetPx,
        outerCanvas.width - 2 * offsetPx,
        outerCanvas.height - 2 * offsetPx
    );

    innerCanvas.width = 1;
    innerCanvas.height = 1;

    return outerCanvas;
}

export async function renderPrintJpg(args: RenderArgs): Promise<Uint8Array> {
    const source = await prepareSource(args, PRINT_DPI);
    try {
        const canvas = await renderPrint({ ...args, url: source.url, width: source.width, height: source.height, dpi: PRINT_DPI });
        try {
            return await exportRasterPage(canvas, "jpg", JPG_QUALITY, PRINT_DPI);
        } finally {
            canvas.width = 1;
            canvas.height = 1;
        }
    } finally {
        source.release();
    }
}
