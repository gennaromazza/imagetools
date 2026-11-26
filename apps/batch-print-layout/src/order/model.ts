import { PHOTO_PRESETS, type PhotoFitMode, type PhotoFrameStyle, type BatchCropState } from "../print-engine";

export interface PrintFormat {
    id: string;
    label: string;
    widthCm: number;
    heightCm: number;
    frameStyle?: PhotoFrameStyle;
}

export const STANDARD_FORMATS: PrintFormat[] = [
    { id: "10x15", label: "10×15", widthCm: 10, heightCm: 15 },
    { id: "13x18", label: "13×18", widthCm: 13, heightCm: 18 },
    { id: "15x20", label: "15×20", widthCm: 15, heightCm: 20 },
    { id: "20x30", label: "20×30", widthCm: 20, heightCm: 30 },
    { id: "a4", label: "A4", widthCm: 21, heightCm: 29.7 }
];

export const ALL_FORMATS: PrintFormat[] = [
    ...STANDARD_FORMATS,
    ...PHOTO_PRESETS.map(p => ({
        id: p.presetId,
        label: p.label,
        widthCm: p.widthCm,
        heightCm: p.heightCm,
        frameStyle: p.frameStyle
    }))
];

export function customFormat(widthCm: number, heightCm: number): PrintFormat {
    const w = Number.isFinite(widthCm) ? Math.min(Math.max(widthCm, 2), 100) : 10;
    const h = Number.isFinite(heightCm) ? Math.min(Math.max(heightCm, 2), 100) : 15;
    const wRounded = Math.round(w * 10) / 10;
    const hRounded = Math.round(h * 10) / 10;
    return {
        id: `custom-${wRounded}x${hRounded}`,
        label: `${wRounded}×${hRounded} cm`,
        widthCm: wRounded,
        heightCm: hRounded
    };
}

export interface OrderPhoto {
    id: string;
    sourceKey: string;
    fileName: string;
    absolutePath?: string;
    size?: number;
    lastModified?: number;
    width: number;
    height: number;
    copies: number;
    crop?: BatchCropState;
}

export type PhotoSource = Omit<OrderPhoto, "id" | "copies" | "crop">;

export interface OrderGroup {
    id: string;
    format: PrintFormat;
    fitMode: PhotoFitMode;
    borderMm: number;
    logoEnabled: boolean;
    photos: OrderPhoto[];
}

export interface LogoSettings {
    path: string | null;
    position: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
    scalePct: number;
    opacity: number;
    marginPct: number;
}

/** Ordine di un cliente; la data resta quella di creazione, così la cartella non cambia tra un export e l'altro. */
export interface Customer {
    name: string;
    date: string;
}

export interface Order {
    version: 1;
    customer?: Customer;
    groups: OrderGroup[];
    logo: LogoSettings;
}

export function createId(): string {
    return crypto.randomUUID();
}

export function createGroup(format?: PrintFormat): OrderGroup {
    return {
        id: createId(),
        format: format ?? STANDARD_FORMATS[0],
        fitMode: "cover",
        borderMm: 0,
        logoEnabled: false,
        photos: []
    };
}

export function createOrder(): Order {
    return {
        version: 1,
        groups: [createGroup()],
        logo: {
            path: null,
            position: "bottom-right",
            scalePct: 18,
            opacity: 0.85,
            marginPct: 3
        }
    };
}

export const CUSTOMER_NAME_MAX = 80;

/** Un nome vuoto trasforma l'ordine in un lavoro senza cliente. */
export function setCustomer(order: Order, name: string, today: string): Order {
    const trimmed = name.trim().slice(0, CUSTOMER_NAME_MAX);
    if (!trimmed) {
        const { customer: _removed, ...rest } = order;
        return rest;
    }
    return { ...order, customer: { name: trimmed, date: order.customer?.date ?? today } };
}

export function addGroup(order: Order, group: OrderGroup): Order {
    return { ...order, groups: [...order.groups, group] };
}

export function removeGroup(order: Order, groupId: string): Order {
    if (order.groups.length <= 1) return order;
    const groups = order.groups.filter(g => g.id !== groupId);
    return groups.length ? { ...order, groups } : order;
}

export function updateGroup(order: Order, groupId: string, patch: Partial<Pick<OrderGroup, "format" | "fitMode" | "borderMm" | "logoEnabled">>): Order {
    const idx = order.groups.findIndex(g => g.id === groupId);
    if (idx < 0) return order;

    const group = order.groups[idx];
    const formatChanged = patch.format && (patch.format.id !== group.format.id || patch.format.widthCm !== group.format.widthCm || patch.format.heightCm !== group.format.heightCm || patch.format.frameStyle !== group.format.frameStyle);
    const fitModeChanged = patch.fitMode && patch.fitMode !== group.fitMode;
    const borderMmChanged = patch.borderMm !== undefined && patch.borderMm !== group.borderMm;
    const requiresCropReset = formatChanged || fitModeChanged || borderMmChanged;

    const newGroup: OrderGroup = { ...group, ...patch };
    if (requiresCropReset) {
        newGroup.photos = newGroup.photos.map(p => ({ ...p, crop: undefined }));
    }

    const groups = [...order.groups];
    groups[idx] = newGroup;
    return { ...order, groups };
}

export function addPhotos(order: Order, groupId: string, sources: PhotoSource[]): Order {
    const idx = order.groups.findIndex(g => g.id === groupId);
    if (idx < 0) return order;

    const group = order.groups[idx];
    const existingKeys = new Set(group.photos.map(p => p.sourceKey));
    const newPhotos: OrderPhoto[] = [];

    for (const src of sources) {
        if (!existingKeys.has(src.sourceKey)) {
            newPhotos.push({ ...src, id: createId(), copies: 1 });
            existingKeys.add(src.sourceKey);
        }
    }

    if (newPhotos.length === 0) return order;

    const groups = [...order.groups];
    groups[idx] = { ...group, photos: [...group.photos, ...newPhotos] };
    return { ...order, groups };
}

export function removePhotos(order: Order, groupId: string, photoIds: string[]): Order {
    const idx = order.groups.findIndex(g => g.id === groupId);
    if (idx < 0) return order;

    const group = order.groups[idx];
    const idsToRemove = new Set(photoIds);
    const newPhotos = group.photos.filter(p => !idsToRemove.has(p.id));

    const groups = [...order.groups];
    groups[idx] = { ...group, photos: newPhotos };
    return { ...order, groups };
}

export function setCopies(order: Order, groupId: string, photoId: string, copies: number): Order {
    const idx = order.groups.findIndex(g => g.id === groupId);
    if (idx < 0) return order;

    const group = order.groups[idx];
    const pIdx = group.photos.findIndex(p => p.id === photoId);
    if (pIdx < 0) return order;

    const c = Number.isFinite(copies) ? Math.min(Math.max(Math.floor(copies), 1), 999) : 1;
    const newPhotos = [...group.photos];
    newPhotos[pIdx] = { ...newPhotos[pIdx], copies: c };

    const groups = [...order.groups];
    groups[idx] = { ...group, photos: newPhotos };
    return { ...order, groups };
}

export function setCrop(order: Order, groupId: string, photoId: string, crop: BatchCropState | undefined): Order {
    const idx = order.groups.findIndex(g => g.id === groupId);
    if (idx < 0) return order;

    const group = order.groups[idx];
    const pIdx = group.photos.findIndex(p => p.id === photoId);
    if (pIdx < 0) return order;

    const newPhotos = [...group.photos];
    newPhotos[pIdx] = { ...newPhotos[pIdx], crop };

    const groups = [...order.groups];
    groups[idx] = { ...group, photos: newPhotos };
    return { ...order, groups };
}

export function transferPhotos(order: Order, fromId: string, toId: string, photoIds: string[], mode: "move" | "copy"): Order {
    if (fromId === toId) return order;
    const fromIdx = order.groups.findIndex(g => g.id === fromId);
    const toIdx = order.groups.findIndex(g => g.id === toId);
    if (fromIdx < 0 || toIdx < 0) return order;

    const fromGroup = order.groups[fromIdx];
    const toGroup = order.groups[toIdx];

    const toExistingKeys = new Set(toGroup.photos.map(p => p.sourceKey));
    const photosToProcess = fromGroup.photos.filter(p => photoIds.includes(p.id));
    if (photosToProcess.length === 0) return order;

    const newTargetPhotos = [...toGroup.photos];
    const processedPhotoIds = new Set<string>();

    for (const p of photosToProcess) {
        if (!toExistingKeys.has(p.sourceKey)) {
            newTargetPhotos.push({
                ...p,
                id: createId(),
                crop: undefined
            });
        }
        processedPhotoIds.add(p.id);
    }

    const groups = [...order.groups];
    groups[toIdx] = { ...toGroup, photos: newTargetPhotos };

    if (mode === "move") {
        const newSourcePhotos = fromGroup.photos.filter(p => !processedPhotoIds.has(p.id));
        groups[fromIdx] = { ...fromGroup, photos: newSourcePhotos };
    }

    return { ...order, groups };
}

export function countPrints(group: OrderGroup): number {
    return group.photos.reduce((sum, p) => sum + p.copies, 0);
}
