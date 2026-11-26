import React, { useEffect, useRef, useState } from 'react';
import { assessQuality, describePhoto, STRONG_CUT_PERCENT } from '../order/quality';
import { loadFullImage } from './library';
import { OrderGroup, OrderPhoto, LogoSettings } from '../order/model';
import { Check, ChevronLeft, ChevronRight, Maximize2, RotateCw, Undo2, Wand2 } from 'lucide-react';
import { CropView } from './CropView';
import { cropFor, rotateCrop, moveCrop, zoomCrop, toAsset, contentSpec } from '../order/geometry';
import { createDefaultCrop, type BatchCropState } from '../print-engine';

interface CropDialogProps {
    group: OrderGroup;
    photo: OrderPhoto;
    url: string | null;
    logo: LogoSettings;
    logoUrl: string | null;
    index: number;
    total: number;
    onClose: () => void;
    onPrev: () => void;
    onNext: () => void;
    onSetCrop: (crop: BatchCropState | undefined) => void;
    formatBar: React.ReactNode;
    onEdit?: () => void;
    onUseSavedFile?: () => void;
    onChangeEditor?: () => void;
}

export const CropDialog: React.FC<CropDialogProps> = ({
    group, photo, url, logo, logoUrl, index, total, onClose, onPrev, onNext, onSetCrop, formatBar, onEdit, onUseSavedFile, onChangeEditor
}) => {
    const crop = cropFor(group, photo);
    const quality = assessQuality(group, photo);
    const details = describePhoto(photo);
    const [showWhole, setShowWhole] = useState(false);
    // Finché l'originale non è pronto si mostra la miniatura.
    const [full, setFull] = useState<{ key: string; url: string } | null>(null);
    useEffect(() => {
        let active = true;
        let loaded: string | null = null;
        loadFullImage(photo)
            .then(next => {
                if (!next) return;
                if (!active) return URL.revokeObjectURL(next);
                loaded = next;
                setFull({ key: photo.sourceKey, url: next });
            })
            .catch(() => undefined);
        return () => {
            active = false;
            if (loaded) URL.revokeObjectURL(loaded);
        };
    }, [photo.sourceKey]);
    const sharp = full?.key === photo.sourceKey;
    const shownUrl = sharp ? full!.url : url;
    const baseCrop = createDefaultCrop(toAsset(photo), contentSpec(group, photo), group.fitMode, false, crop.rotation);
    const zoom = baseCrop.cropWidth / crop.cropWidth;

    const boxRef = useRef<HTMLDivElement>(null);
    const windowRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const lastPos = useRef({ x: 0, y: 0 });

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setIsDragging(true);
        lastPos.current = { x: e.clientX, y: e.clientY };
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isDragging || !boxRef.current) return;
        const dx = e.clientX - lastPos.current.x;
        const dy = e.clientY - lastPos.current.y;
        lastPos.current = { x: e.clientX, y: e.clientY };

        const BW = boxRef.current.offsetWidth;
        const BH = boxRef.current.offsetHeight;
        if (BW === 0 || BH === 0) return;

        const rad = -crop.rotation * Math.PI / 180;
        const dx_rot = dx * Math.cos(rad) - dy * Math.sin(rad);
        const dy_rot = dx * Math.sin(rad) + dy * Math.cos(rad);

        const du = (-dx_rot / BW) * crop.cropWidth;
        const dv = (-dy_rot / BH) * crop.cropHeight;

        onSetCrop(moveCrop(crop, du, dv));
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        setIsDragging(false);
    };

    useEffect(() => {
        const el = windowRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            if (group.fitMode !== 'cover') return;
            e.preventDefault();
            const factor = e.deltaY > 0 ? 0.9 : 1.1;
            const newZoom = Math.max(1, Math.min(4, zoom * factor));
            if (newZoom !== zoom) {
                onSetCrop(zoomCrop(baseCrop, crop, newZoom));
            }
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [baseCrop, crop, zoom, onSetCrop, group.fitMode]);

    const stateRef = useRef({ onPrev, onNext, onClose, rotate: () => onSetCrop(rotateCrop(group, photo)), zoomIn: () => onSetCrop(zoomCrop(baseCrop, crop, Math.min(4, zoom * 1.1))), zoomOut: () => onSetCrop(zoomCrop(baseCrop, crop, Math.max(1, zoom * 0.9))) });
    stateRef.current = { onPrev, onNext, onClose, rotate: () => onSetCrop(rotateCrop(group, photo)), zoomIn: () => onSetCrop(zoomCrop(baseCrop, crop, Math.min(4, zoom * 1.1))), zoomOut: () => onSetCrop(zoomCrop(baseCrop, crop, Math.max(1, zoom * 0.9))) };

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            // Il cursore dello zoom tiene le frecce per sé; le altre scorciatoie restano attive.
            if (e.target instanceof HTMLInputElement && e.key.startsWith('Arrow')) return;
            if (e.key === 'Escape') stateRef.current.onClose();
            if (e.key === 'ArrowRight') stateRef.current.onNext();
            if (e.key === 'ArrowLeft') stateRef.current.onPrev();
            if (e.key === 'r' || e.key === 'R') stateRef.current.rotate();
            if (e.key === '+') stateRef.current.zoomIn();
            if (e.key === '-') stateRef.current.zoomOut();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    return (
        <div className="overlay overlay--full" role="dialog" aria-modal="true" aria-label={`Ritaglio di ${photo.fileName}`}>
            <div className="cropper">
                <header className="cropper__head">
                    <div>
                        <p className="eyebrow">Ritaglio · {group.format.label}</p>
                        <h2>{photo.fileName}</h2>
                    </div>
                    <span className="cropper__count">{index} di {total}</span>
                    <button type="button" className="btn" onClick={onClose}><Check size={16} /> Fatto (Esc)</button>
                </header>

                {formatBar}

                <div className="cropper__stage">
                    <button type="button" className="cropper__nav" onClick={onPrev} disabled={index <= 1} aria-label="Foto precedente"><ChevronLeft size={22} /></button>
                    <div className="cropper__view">
                        {showWhole ? (
                            <div className="whole">
                                <div className="whole__frame" style={{ aspectRatio: `${photo.width} / ${photo.height}`, width: `min(100cqw, calc(100cqh * ${photo.width / photo.height}))` }}>
                                    {shownUrl ? <img src={shownUrl} alt={photo.fileName} /> : null}
                                    {group.fitMode === 'cover' ? (
                                        <i style={{ left: `${crop.cropLeft * 100}%`, top: `${crop.cropTop * 100}%`, width: `${crop.cropWidth * 100}%`, height: `${crop.cropHeight * 100}%` }} />
                                    ) : null}
                                </div>
                            </div>
                        ) : (
                            <CropView
                                group={group} photo={photo} url={shownUrl} logo={logo} logoUrl={logoUrl}
                                boxRef={boxRef} windowRef={windowRef}
                                onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}
                            />
                        )}
                    </div>
                    <button type="button" className="cropper__nav" onClick={onNext} disabled={index >= total} aria-label="Foto successiva"><ChevronRight size={22} /></button>
                </div>

                <div className="cropper__info">
                    <span className={`score score--${quality.level}`}>
                        <strong>{quality.score}</strong>/100 · {quality.verdict}
                    </span>
                    <span>{quality.dpi} DPI in {group.format.label}</span>
                    <span className={quality.cutPercent > STRONG_CUT_PERCENT ? "cut cut--strong" : "cut"}>
                        {quality.cutPercent > 0 ? `Taglio: ${quality.cutPercent}% della foto resta fuori` : "Nessun taglio"}
                    </span>
                    <span className="cropper__original">
                        Originale: {details.pixels} · {details.megapixels}{details.fileSize ? ` · ${details.fileSize}` : ""} · fino a {details.largestPrint}
                    </span>
                    {!sharp && window.filexDesktop ? <span className="hint">Carico l'originale…</span> : null}
                </div>

                <footer className="cropper__foot">
                    <button type="button" className="btn" aria-pressed={showWhole} onClick={() => setShowWhole(value => !value)}>
                        <Maximize2 size={16} /> {showWhole ? "Torna al ritaglio" : "Vedi la foto intera"}
                    </button>
                    {onEdit ? <button type="button" className="btn" onClick={onEdit}><Wand2 size={16} /> Modifica in Photoshop</button> : null}
                    {onUseSavedFile ? <button type="button" className="btn btn--ghost" onClick={onUseSavedFile}>Usa un file salvato…</button> : null}
                    {onChangeEditor ? <button type="button" className="btn btn--ghost" onClick={onChangeEditor} title="Scegli quale Photoshop usare">Cambia Photoshop…</button> : null}
                    <button type="button" className="btn" onClick={() => stateRef.current.rotate()}><RotateCw size={16} /> Ruota 90° (R)</button>
                    {group.fitMode === 'cover' ? (
                        <label className="cropper__zoom">
                            <span>Zoom {zoom.toFixed(1)}×</span>
                            <input type="range" min="1" max="4" step="0.1" value={zoom} onChange={e => onSetCrop(zoomCrop(baseCrop, crop, parseFloat(e.target.value)))} />
                        </label>
                    ) : null}
                    <button type="button" className="btn btn--ghost" onClick={() => onSetCrop(undefined)}><Undo2 size={16} /> Ripristina il taglio automatico</button>
                    <span className="hint">{group.fitMode === 'cover' ? "Trascina la foto per spostare il taglio · rotella per lo zoom" : "La foto resta intera"}</span>
                </footer>
            </div>
        </div>
    );
};
