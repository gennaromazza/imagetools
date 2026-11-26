import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { 
    Order, OrderGroup, OrderPhoto, LogoSettings, PrintFormat,
    createOrder, createGroup, addGroup, removeGroup, updateGroup, addPhotos,
    removePhotos, setCopies, setCrop, transferPhotos, setCustomer
} from '../order/model';
import type { BatchCropState } from '../print-engine';
import { loadOrder, saveOrder, clearOrder } from '../order/storage';
import { bytesToObjectUrl } from '../lib/assets';
import { 
    thumbnailStore, processFileArray, processDesktopFolder, processDesktopEntries, type ImportResult, 
    checkMissingAndLoadThumbnails, setBrowserLogo, clearBrowserLogo, 
    getSharedLogoImage, renderPhotoForExport, loadLogoPreview 
} from './library';

/** Data locale di oggi in formato AAAA-MM-GG. */
function today(): string {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function usePrintOrder() {
    const [order, setOrder] = useState<Order>(() => loadOrder(window.localStorage) || createOrder());
    const [chosenGroupId, setSelectedGroupId] = useState<string | null>(null);
    // Sempre un gruppo esistente: dopo rimozioni o «Nuovo ordine» si torna al primo.
    const selectedGroupId = order.groups.some(g => g.id === chosenGroupId) ? chosenGroupId! : order.groups[0].id;
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [busy, setBusy] = useState<{ done: number, total: number } | null>(null);
    const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);

    const orderRef = useRef(order);
    const selectedGroupRef = useRef(selectedGroupId);

    const handleImportResult = (res: ImportResult | null, targetGroup: string, origin = "Aggiunte") => {
        setBusy(null);
        if (!res) return;
        setStatusMessage(res.unreadable > 0
            ? `${origin} ${res.photos.length} foto. ${res.unreadable} file non leggibili ignorati.`
            : `${origin} ${res.photos.length} foto.`);
        // Se il gruppo di partenza è stato rimosso, le foto non vanno perse.
        setOrder(prev => addPhotos(prev, prev.groups.some(g => g.id === targetGroup) ? targetGroup : prev.groups[0].id, res.photos));
    };
    const importRef = useRef(handleImportResult);
    const importingRef = useRef(false);
    const reportFailure = (error: unknown) => {
        setBusy(null);
        setStatusMessage(error instanceof Error ? error.message : "Operazione non riuscita.");
    };
    const runImport = async (load: (onProgress: (done: number, total: number) => void) => Promise<ImportResult | null>) => {
        if (importingRef.current) {
            setStatusMessage("Attendi la fine dell'importazione in corso.");
            return;
        }
        importingRef.current = true;
        const targetGroup = selectedGroupRef.current;
        try {
            handleImportResult(await load((done, total) => setBusy({ done, total })), targetGroup);
        } catch (error) {
            reportFailure(error);
        } finally {
            importingRef.current = false;
        }
    };
    
    orderRef.current = order;
    selectedGroupRef.current = selectedGroupId;
    importRef.current = handleImportResult;

    useEffect(() => {
        const timer = setTimeout(() => {
            if (!saveOrder(window.localStorage, order)) {
                setStatusMessage("Errore durante il salvataggio dell'ordine");
            }
        }, 400);
        return () => clearTimeout(timer);
    }, [order]);

    useEffect(() => {
        const onBeforeUnload = () => saveOrder(window.localStorage, orderRef.current);
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, []);

    useEffect(() => {
        const allPhotos = order.groups.flatMap(g => g.photos);
        checkMissingAndLoadThumbnails(allPhotos).catch(reportFailure);
    }, []); 

    useEffect(() => {
        const api = window.filexDesktop;
        if (!api?.onOpenProjectRequest || !api.consumePendingOpenProjectPath || !api.consumePhotoSelectionHandoff) return;

        let active = true;
        let draining = false;
        const drain = async () => {
            if (draining) return;
            draining = true;
            try {
                while (active) {
                    const path = await api.consumePendingOpenProjectPath();
                    if (!path) break;
                    try {
                        const handoff = await api.consumePhotoSelectionHandoff(path);
                        if (handoff && handoff.files.length > 0) {
                            while (importingRef.current) await new Promise(resolve => window.setTimeout(resolve, 200));
                            importingRef.current = true;
                            try {
                                const target = selectedGroupRef.current;
                                const result = await processDesktopEntries(
                                    handoff.files.slice(0, 500),
                                    (done, total) => setBusy({ done, total })
                                );
                                importRef.current(result, target, "Lascia collegata la scheda fino all'esportazione. Da Archivio Flow:");
                            } finally {
                                importingRef.current = false;
                            }
                        }
                    } catch (error) {
                        setBusy(null);
                        setStatusMessage(error instanceof Error ? error.message : "Selezione di Archivio Flow non valida.");
                    } finally {
                        await api.acknowledgeOpenProjectRequest(path).catch(() => undefined);
                    }
                }
            } finally {
                draining = false;
            }
        };

        const unsubscribe = api.onOpenProjectRequest(() => { void drain(); });
        // Rinvio di un giro: il doppio avvio di StrictMode non deve consumare la richiesta.
        const timer = window.setTimeout(() => {
            void api.markOpenProjectRequestReady().then(drain).catch(reportFailure);
        }, 0);

        return () => {
            active = false;
            window.clearTimeout(timer);
            unsubscribe();
        };
    }, []);

    useEffect(() => {
        let active = true;
        let currentUrl: string | null = null;

        if (order.logo?.path && window.filexDesktop) {
            loadLogoPreview(order.logo.path, 900).then(p => {
                if (active && p) {
                    currentUrl = bytesToObjectUrl(p.bytes, p.mimeType);
                    setLogoPreviewUrl(currentUrl);
                }
            }).catch(reportFailure);
        }
        return () => {
            active = false;
            if (currentUrl) {
                URL.revokeObjectURL(currentUrl);
                setLogoPreviewUrl(null);
            }
        };
    }, [order.logo?.path]);

    const api = {
        order,
        selectedGroupId,
        setSelectedGroupId,
        statusMessage,
        busy,
        
        thumbnails: useSyncExternalStore(thumbnailStore.subscribe, () => thumbnailStore.snapshot),
        logoPreviewUrl,

        addFolder: () => runImport(processDesktopFolder),

        addFilesFromInput: async (files: File[]) => {
            if (files.length === 0) return;
            await runImport(onProgress => processFileArray(files, onProgress));
        },

        setCustomerName: (name: string) => setOrder(prev => setCustomer(prev, name, today())),

        /** Riparte da zero: con un nome è l'ordine di un cliente, senza è un lavoro veloce. */
        newOrder: (customerName = "") => {
            clearOrder(window.localStorage);
            thumbnailStore.retain(new Set());
            const fresh = setCustomer(createOrder(), customerName, today());
            setOrder(fresh);
            setSelectedGroupId(null);
            clearBrowserLogo();
            setLogoPreviewUrl(null);
            setStatusMessage(fresh.customer ? `Ordine di ${fresh.customer.name} creato.` : "Lavoro veloce iniziato.");
        },

        doAddGroup: (format?: PrintFormat) => {
            const g = createGroup(format);
            setOrder(prev => addGroup(prev, g));
            setSelectedGroupId(g.id);
        },

        doRemoveGroup: (id: string) => {
            setOrder(prev => removeGroup(prev, id));
        },

        doUpdateGroup: (id: string, patch: Partial<Pick<OrderGroup, 'format' | 'fitMode' | 'borderMm' | 'logoEnabled'>>) => {
            setOrder(prev => updateGroup(prev, id, patch));
        },

        doRemovePhotos: (groupId: string, photoIds: string[]) => {
            setOrder(prev => removePhotos(prev, groupId, photoIds));
        },

        doTransferPhotos: (fromId: string, toId: string, photoIds: string[], mode: 'move' | 'copy') => {
            setOrder(prev => transferPhotos(prev, fromId, toId, photoIds, mode));
            setStatusMessage(`Foto ${mode === 'move' ? 'spostate' : 'copiate'} con successo.`);
        },

        doSetCopies: (groupId: string, photoId: string, n: number) => {
            setOrder(prev => setCopies(prev, groupId, photoId, n));
        },

        doSetCrop: (groupId: string, photoId: string, crop: BatchCropState | undefined) => {
            setOrder(prev => setCrop(prev, groupId, photoId, crop));
        },

        chooseLogo: async () => {
            const path = await window.filexDesktop?.chooseImageFile();
            if (path) setOrder(prev => ({ ...prev, logo: { ...prev.logo, path } }));
        },

        setLogoFile: (file: File) => {
            const url = URL.createObjectURL(file);
            setBrowserLogo(url);
            setLogoPreviewUrl(url);
            setOrder(prev => ({ ...prev, logo: { ...prev.logo, path: null } }));
        },

        removeLogo: () => {
            clearBrowserLogo();
            setLogoPreviewUrl(null);
            setOrder(prev => ({ ...prev, logo: { ...prev.logo, path: null } }));
        },

        updateLogoSettings: (patch: Partial<LogoSettings>) => {
            setOrder(prev => ({ ...prev, logo: { ...prev.logo, ...patch } }));
        },

        renderFile: async (group: OrderGroup, photo: OrderPhoto): Promise<Uint8Array> => {
            const { logo } = orderRef.current;
            let logoImage: HTMLImageElement | null = null;
            if (group.logoEnabled) {
                logoImage = (await getSharedLogoImage(logo)) ?? null;
                if (!logoImage) throw new Error("Logo non disponibile: sceglilo di nuovo o disattivalo per il gruppo.");
            }
            return renderPhotoForExport(group, photo, logo, logoImage);
        }
    };

    return api;
}
