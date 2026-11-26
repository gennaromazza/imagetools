import {
    createDefaultCrop,
    getPhotoContentRectCm,
    normalizeCrop,
    type BatchCropState,
    type PhotoAsset,
    type PhotoPrintSpec
} from "../print-engine";
import type { OrderGroup, OrderPhoto, PrintFormat } from "./model";

export const PRINT_DPI = 300;
export const LOW_DPI = 200;

export function hasFrame(format: PrintFormat): boolean {
    return format.frameStyle !== undefined && format.frameStyle !== "none";
}

export function orientedSizeCm(format: PrintFormat, photo: { width: number; height: number }): { widthCm: number; heightCm: number } {
    if (hasFrame(format)) {
        return { widthCm: format.widthCm, heightCm: format.heightCm };
    }
    const isLandscape = photo.width > photo.height;
    const isPortrait = photo.height > photo.width;
    const longSide = Math.max(format.widthCm, format.heightCm);
    const shortSide = Math.min(format.widthCm, format.heightCm);

    if (isLandscape) return { widthCm: longSide, heightCm: shortSide };
    if (isPortrait) return { widthCm: shortSide, heightCm: longSide };
    return { widthCm: format.widthCm, heightCm: format.heightCm };
}

/** Dimensioni della foto come la si vede dopo l'eventuale rotazione scelta dall'utente. */
export function displayedSize(photo: { width: number; height: number; crop?: { rotation: number } }): { width: number; height: number } {
    const quarterTurn = Math.abs(photo.crop?.rotation ?? 0) % 180 === 90;
    return quarterTurn ? { width: photo.height, height: photo.width } : { width: photo.width, height: photo.height };
}

export function effectiveBorderMm(group: OrderGroup): number {
    if (hasFrame(group.format)) return 0;
    const b = group.borderMm;
    if (!Number.isFinite(b)) return 0;
    const shortestSideMm = Math.min(group.format.widthCm, group.format.heightCm) * 10;
    return Math.max(0, Math.min(b, shortestSideMm / 4));
}

export function contentSpec(group: OrderGroup, photo: OrderPhoto): PhotoPrintSpec {
    if (hasFrame(group.format)) {
        return {
            widthCm: group.format.widthCm,
            heightCm: group.format.heightCm,
            dpi: PRINT_DPI,
            frameStyle: group.format.frameStyle
        };
    }
    const size = orientedSizeCm(group.format, displayedSize(photo));
    const borderCm = effectiveBorderMm(group) / 10;
    return {
        widthCm: size.widthCm - (2 * borderCm),
        heightCm: size.heightCm - (2 * borderCm),
        dpi: PRINT_DPI
    };
}

export function toAsset(photo: OrderPhoto, url?: string): PhotoAsset {
    return {
        id: photo.id,
        fileName: photo.fileName,
        relativePath: undefined,
        absolutePath: photo.absolutePath,
        size: photo.size,
        lastModified: photo.lastModified,
        sourceUrl: url ?? "",
        previewUrl: url ?? "",
        width: photo.width,
        height: photo.height
    };
}

export function cropFor(group: OrderGroup, photo: OrderPhoto): BatchCropState {
    if (photo.crop) {
        return normalizeCrop(photo.crop);
    }
    return createDefaultCrop(toAsset(photo), contentSpec(group, photo), group.fitMode, false);
}

export function rotateCrop(group: OrderGroup, photo: OrderPhoto): BatchCropState {
    const currentRot = photo.crop?.rotation ?? 0;
    const newRot = (currentRot + 90) % 360;
    // Il formato segue la foto ruotata: la specifica va calcolata con la nuova rotazione.
    const rotated = { ...photo, crop: { ...cropFor(group, photo), rotation: newRot } };
    const crop = createDefaultCrop(toAsset(photo), contentSpec(group, rotated), group.fitMode, false, newRot);
    return { ...crop, reviewed: true };
}

export function moveCrop(crop: BatchCropState, dx: number, dy: number): BatchCropState {
    const cx = Math.max(0, Math.min(crop.cropLeft + dx, 1 - crop.cropWidth));
    const cy = Math.max(0, Math.min(crop.cropTop + dy, 1 - crop.cropHeight));
    return { ...crop, cropLeft: cx, cropTop: cy, reviewed: true };
}

export function zoomCrop(base: BatchCropState, crop: BatchCropState, zoom: number): BatchCropState {
    const z = Math.max(1, Math.min(zoom, 4));
    const nw = base.cropWidth / z;
    const nh = base.cropHeight / z;
    
    const centerX = crop.cropLeft + (crop.cropWidth / 2);
    const centerY = crop.cropTop + (crop.cropHeight / 2);
    
    let cl = centerX - (nw / 2);
    let ct = centerY - (nh / 2);
    
    cl = Math.max(0, Math.min(cl, 1 - nw));
    ct = Math.max(0, Math.min(ct, 1 - nh));
    
    return {
        ...crop,
        cropLeft: cl,
        cropTop: ct,
        cropWidth: nw,
        cropHeight: nh,
        reviewed: true
    };
}

export function effectiveDpi(group: OrderGroup, photo: OrderPhoto): number {
    const spec = contentSpec(group, photo);
    const crop = cropFor(group, photo);
    
    let cw = crop.cropWidth * photo.width;
    let ch = crop.cropHeight * photo.height;
    
    if (crop.rotation === 90 || crop.rotation === 270) {
        const temp = cw;
        cw = ch;
        ch = temp;
    }
    
    const contentRect = getPhotoContentRectCm(spec);
    const wIn = contentRect.width / 2.54;
    const hIn = contentRect.height / 2.54;
    
    if (group.fitMode === "cover") {
        return Math.round(Math.min(cw / wIn, ch / hIn));
    } else {
        return Math.round(Math.max(cw / wIn, ch / hIn));
    }
}
