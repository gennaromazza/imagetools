import React, { useState, useEffect, useRef } from 'react';
import { Order, countPrints } from '../order/model';
import { exportOrder, type ExportReport } from '../order/export';
import { Folder, FolderOpen } from 'lucide-react';
import { folderNames, orderFolderName } from '../order/naming';
import { effectiveDpi, LOW_DPI } from '../order/geometry';
import type { OrderGroup, OrderPhoto } from '../order/model';

interface ExportDialogProps {
    order: Order;
    thumbnails: { missing: Set<string> };
    onClose: () => void;
    renderFile: (group: OrderGroup, photo: OrderPhoto) => Promise<Uint8Array>;
}

export const ExportDialog: React.FC<ExportDialogProps> = ({ order, thumbnails, onClose, renderFile }) => {
    const api = window.filexDesktop;
    const [outPath, setOutPath] = useState<string | null>(null);
    const [exporting, setExporting] = useState(false);
    const [progress, setProgress] = useState<{ done: number, total: number, label: string } | null>(null);
    const [report, setReport] = useState<ExportReport | null>(null);
    const [error, setError] = useState<string | null>(null);
    const abortCtrl = useRef<AbortController | null>(null);

    const fNames = folderNames(order.groups);
    const missingKeys = thumbnails.missing;
    
    const groupsWithMissing = order.groups.filter(g => g.photos.some(p => missingKeys.has(p.sourceKey)));
    const blockedIds = new Set(groupsWithMissing.map(g => g.id));
    const validGroups = order.groups.filter(g => !blockedIds.has(g.id) && g.photos.length > 0);
    const totalPrints = validGroups.reduce((acc, g) => acc + countPrints(g), 0);
    const lowResCount = validGroups.reduce((acc, g) => acc + g.photos.filter(p => effectiveDpi(g, p) < LOW_DPI).length, 0);

    const chooseFolder = async () => {
        if (!api) return;
        const p = await api.chooseOutputFolder();
        if (p) setOutPath(p);
    };

    const handleExport = async (groupIds?: string[]) => {
        if (!api || !outPath) return;
        setExporting(true);
        setReport(null);
        setProgress({ done: 0, total: totalPrints, label: 'Inizio esportazione...' });
        
        abortCtrl.current = new AbortController();
        
        const deps = {
            api,
            ensureSubfolder: (parent: string, name: string) => api.ensureOutputSubfolder(parent, name),
            fileExists: async (folder: string, name: string) => (await api.statFiles([folder + (folder.includes('\\') ? '\\' : '/') + name])).length > 0,
            renderFile
        };

        const targetIds = groupIds || validGroups.map(g => g.id);
        
        setError(null);
        try {
            setReport(await exportOrder({
                order, outputPath: outPath, groupIds: targetIds, signal: abortCtrl.current.signal,
                onProgress: (done, total, label) => setProgress({ done, total, label })
            }, deps));
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : "Esportazione non riuscita.");
        } finally {
            setExporting(false);
        }
    };

    const handleCancel = () => {
        if (exporting && abortCtrl.current) {
            abortCtrl.current.abort();
        } else {
            onClose();
        }
    };

    const orderFolder = orderFolderName(order.customer);
    const filled = order.groups.filter(g => g.photos.length > 0);

    return (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="export-title">
            <div className="modal">
                <p className="eyebrow">{order.customer ? `Ordine di ${order.customer.name}` : "Lavoro veloce"}</p>
                <h2 id="export-title">{report ? (report.cancelled ? "Esportazione annullata" : report.failed.length ? "Esportazione incompleta" : "Stampe pronte") : "Esporta le stampe"}</h2>

                {!report ? (
                    <>
                        <button type="button" className="destination" onClick={chooseFolder} disabled={exporting || !api}>
                            <FolderOpen size={20} />
                            <span>
                                <strong>{outPath ? "Salva in" : "Scegli dove salvare"}</strong>
                                <small>{outPath ?? "La cartella di destinazione"}</small>
                            </span>
                        </button>

                        <div className="tree">
                            {orderFolder ? <p className="tree__root"><Folder size={15} /> {orderFolder}</p> : null}
                            <ul className={orderFolder ? "tree__nested" : undefined}>
                                {filled.map(g => (
                                    <li key={g.id} className={blockedIds.has(g.id) ? "tree--blocked" : undefined}>
                                        <Folder size={15} />
                                        <span>{fNames.get(g.id)}</span>
                                        <small>{blockedIds.has(g.id) ? "bloccata: file mancanti" : `${countPrints(g)} stampe`}</small>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        {lowResCount > 0 ? <p className="notice">{lowResCount} foto sono sotto i {LOW_DPI} DPI nel formato scelto.</p> : null}
                        {!api ? <p className="notice">L'esportazione è disponibile solo nell'app desktop.</p> : null}
                    </>
                ) : (
                    <>
                        <ul className="tree">
                            {report.done.map(item => <li key={item.groupId}><Folder size={15} /><span>{item.folder}</span><small>{item.files} file</small></li>)}
                        </ul>
                        {report.failed.length > 0 ? (
                            <ul className="notice notice--danger">
                                {report.failed.map(item => <li key={item.groupId}>{item.folder}: {item.message}</li>)}
                            </ul>
                        ) : null}
                        {outPath && report.done.length > 0 ? <p className="hint">Salvate in {outPath}</p> : null}
                    </>
                )}

                {error ? <p className="notice notice--danger">{error}</p> : null}

                {exporting && progress ? (
                    <div className="modal__progress">
                        <progress value={progress.done} max={progress.total} />
                        <span>{progress.done} di {progress.total}</span>
                        <small>{progress.label}</small>
                    </div>
                ) : null}

                <div className="modal__actions">
                    <button type="button" className="btn btn--ghost" onClick={handleCancel}>{exporting ? 'Annulla' : 'Chiudi'}</button>
                    {!report ? (
                        <button type="button" className="btn btn--primary" onClick={() => handleExport()} disabled={exporting || !outPath || validGroups.length === 0}>
                            {exporting ? "Esporto…" : `Esporta ${totalPrints} stampe`}
                        </button>
                    ) : null}
                    {report && report.failed.length > 0 ? (
                        <button type="button" className="btn btn--primary" onClick={() => handleExport(report.failed.map(f => f.groupId))}>Riprova i formati non riusciti</button>
                    ) : null}
                </div>
            </div>
        </div>
    );
};
