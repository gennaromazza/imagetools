import { renderPhotoCanvas, exportRasterPage } from "../render-export";
import { cmToPx, mmToPx } from "../print-engine";
import { contentSpec, cropFor, displayedSize, effectiveBorderMm, orientedSizeCm, toAsset, PRINT_DPI } from "./geometry";
import type { OrderGroup, OrderPhoto, LogoSettings } from "./model";
import type { LogoOverlaySpec } from "../print-engine";

export const JPG_QUALITY = 0.95;

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
    const canvas = await renderPrint({ ...args, dpi: PRINT_DPI });
    try {
        return await exportRasterPage(canvas, "jpg", JPG_QUALITY, PRINT_DPI);
    } finally {
        canvas.width = 1;
        canvas.height = 1;
    }
}
