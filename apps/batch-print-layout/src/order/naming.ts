import type { Customer, OrderGroup, OrderPhoto } from "./model";
import { effectiveBorderMm } from "./geometry";

export function sanitizeName(value: string, fallback = "foto"): string {
    const trimEdges = (text: string) => text.replace(/^[\s.]+|[\s.]+$/g, "");
    const legal = value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "");
    const cleaned = trimEdges(trimEdges(legal).slice(0, 100));
    // Windows riserva questi nomi anche quando hanno un'estensione (CON.jpg).
    const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
    return !cleaned || reserved.test(cleaned) ? fallback : cleaned;
}

/** Cartella dell'ordine di un cliente, per esempio «Mario Rossi - 2026-11-26»; null senza cliente. */
export function orderFolderName(customer: Customer | undefined): string | null {
    if (!customer) return null;
    return `${sanitizeName(customer.name, "Cliente")} - ${customer.date}`;
}

export function folderName(group: OrderGroup): string {
    let name = group.format.id;
    if (name.startsWith("custom-")) {
        name = `${group.format.widthCm}x${group.format.heightCm}cm`;
    }
    if (group.fitMode === "contain") {
        name += "_intera";
    }
    const border = effectiveBorderMm(group);
    if (border > 0) {
        name += `_bordo${border}mm`;
    }
    if (group.logoEnabled) {
        name += "_logo";
    }
    return sanitizeName(name);
}

export function folderNames(groups: OrderGroup[]): Map<string, string> {
    const map = new Map<string, string>();
    const taken = new Set<string>();
    
    for (const g of groups) {
        const base = folderName(g);
        let name = base;
        let counter = 2;
        
        while (taken.has(name.toLowerCase())) {
            name = `${base}_${counter}`;
            counter++;
        }
        
        taken.add(name.toLowerCase());
        map.set(g.id, name);
    }
    
    return map;
}

export function uniqueName(fileName: string, taken: Set<string>): string {
    const lastDot = fileName.lastIndexOf(".");
    const stem = lastDot < 0 ? fileName : fileName.substring(0, lastDot);
    const ext = lastDot < 0 ? "" : fileName.substring(lastDot);
    
    let current = fileName;
    let counter = 2;
    
    while (taken.has(current.toLowerCase())) {
        current = `${stem}-${counter}${ext}`;
        counter++;
    }
    
    taken.add(current.toLowerCase());
    return current;
}

export interface PlannedFile {
    photoId: string;
    fileName: string;
}

export function plannedFiles(photos: OrderPhoto[], taken = new Set<string>()): PlannedFile[] {
    const result: PlannedFile[] = [];
    
    for (const p of photos) {
        // Prima si toglie l'estensione, poi si accorcia.
        const stem = sanitizeName(p.fileName.replace(/\.[^.]*$/, ""));
        const forcedExt = ".jpg";
        
        for (let i = 1; i <= p.copies; i++) {
            let candidate = i === 1 ? `${stem}${forcedExt}` : `${stem}_copia${i}${forcedExt}`;
            candidate = uniqueName(candidate, taken);
            result.push({ photoId: p.id, fileName: candidate });
        }
    }
    
    return result;
}
