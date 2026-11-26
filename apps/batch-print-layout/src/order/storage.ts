import { createId, type Order, type OrderGroup, type OrderPhoto, type LogoSettings } from "./model";
import type { BatchCropState } from "../print-engine";

export const STORAGE_KEY = "print-flow:order:v1";

type KeyValue = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const FRAME_STYLES = new Set(["none", "polaroid-go", "polaroid-classic", "instax-mini", "instax-square", "instax-wide"]);
const isPositive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const inRange = (value: unknown, min: number, max: number, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function parseOrder(text: string): Order | null {
    try {
        const obj = JSON.parse(text);
        if (!obj || typeof obj !== "object" || obj.version !== 1 || !Array.isArray(obj.groups)) {
            return null;
        }

        const validGroups: OrderGroup[] = [];

        for (const g of obj.groups) {
            if (!g || typeof g !== "object") continue;
            if (typeof g.id !== "string" || typeof g.fitMode !== "string") continue;
            if (typeof g.borderMm !== "number" || !Number.isFinite(g.borderMm) || g.borderMm < 0) continue;
            if (typeof g.logoEnabled !== "boolean" || !Array.isArray(g.photos)) continue;
            if (!g.format || typeof g.format !== "object") continue;
            if (typeof g.format.id !== "string" || !isPositive(g.format.widthCm) || !isPositive(g.format.heightCm)) continue;
            if (g.format.frameStyle !== undefined && !FRAME_STYLES.has(g.format.frameStyle)) continue;
            
            const validPhotos: OrderPhoto[] = [];
            for (const p of g.photos) {
                if (!p || typeof p !== "object") continue;
                if (typeof p.id !== "string" || typeof p.sourceKey !== "string" || typeof p.fileName !== "string") continue;
                if (typeof p.width !== "number" || !Number.isFinite(p.width) || p.width <= 0) continue;
                if (typeof p.height !== "number" || !Number.isFinite(p.height) || p.height <= 0) continue;
                if (typeof p.copies !== "number" || !Number.isFinite(p.copies) || p.copies <= 0) continue;

                let validCrop: BatchCropState | undefined = undefined;
                if (p.crop && typeof p.crop === "object") {
                    const c = p.crop;
                    if (
                        typeof c.assetId === "string" &&
                        typeof c.cropLeft === "number" && Number.isFinite(c.cropLeft) &&
                        typeof c.cropTop === "number" && Number.isFinite(c.cropTop) &&
                        typeof c.cropWidth === "number" && Number.isFinite(c.cropWidth) &&
                        typeof c.cropHeight === "number" && Number.isFinite(c.cropHeight) &&
                        typeof c.rotation === "number" && Number.isFinite(c.rotation) &&
                        typeof c.reviewed === "boolean"
                    ) {
                        validCrop = {
                            assetId: c.assetId,
                            cropLeft: c.cropLeft,
                            cropTop: c.cropTop,
                            cropWidth: c.cropWidth,
                            cropHeight: c.cropHeight,
                            rotation: c.rotation,
                            reviewed: c.reviewed
                        };
                    }
                }

                validPhotos.push({
                    id: p.id,
                    sourceKey: p.sourceKey,
                    fileName: p.fileName,
                    absolutePath: typeof p.absolutePath === "string" ? p.absolutePath : undefined,
                    size: typeof p.size === "number" && Number.isFinite(p.size) ? p.size : undefined,
                    lastModified: typeof p.lastModified === "number" && Number.isFinite(p.lastModified) ? p.lastModified : undefined,
                    width: p.width,
                    height: p.height,
                    copies: Math.min(999, Math.max(1, Math.floor(p.copies))),
                    crop: validCrop
                });
            }

            validGroups.push({
                id: g.id,
                format: {
                    id: g.format.id,
                    label: typeof g.format.label === "string" ? g.format.label : "",
                    widthCm: g.format.widthCm,
                    heightCm: g.format.heightCm,
                    frameStyle: g.format.frameStyle
                },
                fitMode: g.fitMode === "contain" ? "contain" : "cover",
                borderMm: g.borderMm,
                logoEnabled: g.logoEnabled,
                photos: validPhotos
            });
        }

        if (validGroups.length === 0) return null;

        const logoObj = obj.logo || {};
        const pos = logoObj.position;
        const validPos = ["top-left", "top-right", "bottom-left", "bottom-right", "center"].includes(pos) ? pos : "bottom-right";

        const validLogo: LogoSettings = {
            path: typeof logoObj.path === "string" ? logoObj.path : null,
            position: validPos,
            scalePct: inRange(logoObj.scalePct, 1, 100, 18),
            opacity: inRange(logoObj.opacity, 0, 1, 0.85),
            marginPct: inRange(logoObj.marginPct, 0, 30, 3)
        };

        const customer = obj.customer;
        const validCustomer = customer && typeof customer.name === "string" && customer.name.trim()
            && typeof customer.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(customer.date)
            ? { name: customer.name.trim().slice(0, 80), date: customer.date }
            : undefined;

        return {
            version: 1,
            id: typeof obj.id === "string" ? obj.id : createId(),
            ...(validCustomer ? { customer: validCustomer } : {}),
            groups: validGroups,
            logo: validLogo
        };
    } catch {
        return null;
    }
}

export function loadOrder(storage: KeyValue): Order | null {
    try {
        const text = storage.getItem(STORAGE_KEY);
        if (!text) return null;
        return parseOrder(text);
    } catch {
        return null;
    }
}

export function saveOrder(storage: KeyValue, order: Order): boolean {
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(order));
        return true;
    } catch {
        return false;
    }
}

export function clearOrder(storage: KeyValue): void {
    try {
        storage.removeItem(STORAGE_KEY);
    } catch {
        // Ignore
    }
}
