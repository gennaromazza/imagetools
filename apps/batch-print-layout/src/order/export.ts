import type { FileXDesktopApi } from "@photo-tools/desktop-contracts";
import { runDesktopAtomicWriteTransaction } from "../render-export";
import type { Order, OrderGroup, OrderPhoto } from "./model";
import { countPrints } from "./model";
import { folderNames, orderFolderName, plannedFiles, uniqueName } from "./naming";

export interface ExportDeps {
    api: Pick<FileXDesktopApi, "beginAtomicWriteTransaction" | "stageAtomicWriteTransactionFile" | "commitAtomicWriteTransaction" | "finalizeAtomicWriteTransaction" | "rollbackAtomicWriteTransaction">;
    ensureSubfolder(parentPath: string, name: string): Promise<string>;
    fileExists(folderPath: string, fileName: string): Promise<boolean>;
    renderFile(group: OrderGroup, photo: OrderPhoto): Promise<Uint8Array>;
}

export interface ExportOptions {
    order: Order;
    outputPath: string;
    groupIds?: string[];
    signal?: AbortSignal;
    onProgress?(done: number, total: number, label: string): void;
}

export interface ExportReport {
    done: { groupId: string; folder: string; files: number }[];
    failed: { groupId: string; folder: string; message: string }[];
    cancelled: boolean;
}

export async function exportOrder(options: ExportOptions, deps: ExportDeps): Promise<ExportReport> {
    const report: ExportReport = { done: [], failed: [], cancelled: false };
    
    const allGroups = options.order.groups;
    const allFolderNames = folderNames(allGroups);
    
    const targetGroups = allGroups.filter(g => 
        g.photos.length > 0 && (!options.groupIds || options.groupIds.includes(g.id))
    );

    const orderFolder = orderFolderName(options.order.customer);
    const label = (group: string) => (orderFolder ? `${orderFolder}/${group}` : group);

    let donePrints = 0;
    const totalPrints = targetGroups.reduce((acc, g) => acc + countPrints(g), 0);

    for (const group of targetGroups) {
        if (options.signal?.aborted) {
            report.cancelled = true;
            break;
        }

        const folderName = allFolderNames.get(group.id)!;
        let currentFileNameForError = "";

        try {
            const parentPath = orderFolder
                ? await deps.ensureSubfolder(options.outputPath, orderFolder)
                : options.outputPath;
            const folderPath = await deps.ensureSubfolder(parentPath, folderName);
            
            const planned = plannedFiles(group.photos);
            // I nomi alternativi non devono toccare né il disco né le altre foto del gruppo.
            const taken = new Set(planned.map(plan => plan.fileName.toLowerCase()));
            const filesByPhoto = new Map<string, string[]>();

            for (const plan of planned) {
                let name = plan.fileName;
                while (await deps.fileExists(folderPath, name)) {
                    name = uniqueName(plan.fileName, taken);
                }
                
                const arr = filesByPhoto.get(plan.photoId) || [];
                arr.push(name);
                filesByPhoto.set(plan.photoId, arr);
            }

            await runDesktopAtomicWriteTransaction(deps.api, folderPath, async (stageFile) => {
                for (const photo of group.photos) {
                    if (options.signal?.aborted) throw new Error("ABORTED");
                    
                    const filesToProduce = filesByPhoto.get(photo.id) || [];
                    if (filesToProduce.length === 0) continue;

                    currentFileNameForError = filesToProduce[0];
                    const bytes = await deps.renderFile(group, photo);

                    for (const fileName of filesToProduce) {
                        currentFileNameForError = fileName;
                        if (options.signal?.aborted) throw new Error("ABORTED");
                        
                        await stageFile({ fileName, bytes });
                        donePrints++;
                        options.onProgress?.(donePrints, totalPrints, `Esportazione ${fileName}`);
                    }
                }
            }, () => {
                if (options.signal?.aborted) throw new Error("ABORTED");
            });

            const totalFilesProduced = Array.from(filesByPhoto.values()).reduce((sum, arr) => sum + arr.length, 0);
            report.done.push({ groupId: group.id, folder: label(folderName), files: totalFilesProduced });

        } catch (err) {
            const baseMessage = err instanceof Error ? err.message : String(err);
            if (baseMessage === "ABORTED" || options.signal?.aborted) {
                report.cancelled = true;
                break;
            }
            
            const finalMessage = currentFileNameForError ? `${currentFileNameForError}: ${baseMessage}` : baseMessage;
            
            report.failed.push({
                groupId: group.id,
                folder: label(folderName),
                message: finalMessage
            });
        }
    }

    return report;
}
