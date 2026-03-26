import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useEffect } from "react";
import { COLOR_LABEL_NAMES, COLOR_LABELS, formatAssetStars, getAssetColorLabel, getAssetPickStatus, getAssetRating, PICK_STATUS_LABELS, } from "../services/photo-classification";
export function CompareModal({ photos, onClose, onUpdatePhoto }) {
    useEffect(() => {
        function onKey(e) {
            if (e.key === "Escape")
                onClose();
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);
    const cols = photos.length <= 2 ? "1fr 1fr" : photos.length === 3 ? "1fr 1fr 1fr" : "1fr 1fr 1fr 1fr";
    return (_jsx("div", { className: "compare-modal__overlay", onClick: (e) => e.target === e.currentTarget && onClose(), children: _jsxs("div", { className: "compare-modal", role: "dialog", "aria-label": "Confronta foto", children: [_jsxs("div", { className: "compare-modal__header", children: [_jsxs("span", { className: "compare-modal__title", children: ["Confronta (", photos.length, " foto)"] }), _jsx("button", { type: "button", className: "icon-button", onClick: onClose, title: "Chiudi (Esc)", children: "\u2715" })] }), _jsx("div", { className: "compare-modal__grid", style: { gridTemplateColumns: cols }, children: photos.map((photo) => {
                        const previewUrl = photo.previewUrl ?? photo.thumbnailUrl ?? photo.sourceUrl;
                        const rating = getAssetRating(photo);
                        const pickStatus = getAssetPickStatus(photo);
                        const colorLabel = getAssetColorLabel(photo);
                        return (_jsxs("div", { className: "compare-modal__cell", children: [_jsx("div", { className: "compare-modal__image-wrap", children: previewUrl ? (_jsx("img", { src: previewUrl, alt: photo.fileName, className: "compare-modal__image" })) : (_jsx("div", { className: "compare-modal__placeholder", children: _jsx("span", { children: "Anteprima non disponibile" }) })) }), _jsxs("div", { className: "compare-modal__meta", children: [_jsx("span", { className: "compare-modal__filename", title: photo.fileName, children: photo.fileName }), photo.width > 0 && (_jsxs("span", { className: "compare-modal__dims", children: [Math.round(photo.width), "\u00D7", Math.round(photo.height)] }))] }), _jsxs("div", { className: "compare-modal__controls", onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "compare-modal__stars", children: [[1, 2, 3, 4, 5].map((v) => (_jsx("button", { type: "button", className: `photo-card__star${v <= rating ? " photo-card__star--active" : ""}`, onClick: () => onUpdatePhoto(photo.id, { rating: v }), title: `${v} stelle`, children: "\u2605" }, v))), rating > 0 && (_jsx("span", { className: "compare-modal__rating-label", children: formatAssetStars(photo) }))] }), _jsx("div", { className: "compare-modal__pills", children: ["picked", "rejected", "unmarked"].map((value) => (_jsx("button", { type: "button", className: `photo-card__pill${pickStatus === value ? " photo-card__pill--active" : ""}`, onClick: () => onUpdatePhoto(photo.id, { pickStatus: value }), children: PICK_STATUS_LABELS[value] }, value))) }), _jsxs("div", { className: "compare-modal__dots", children: [_jsx("button", { type: "button", className: "ghost-button ghost-button--small", onClick: () => onUpdatePhoto(photo.id, { colorLabel: null }), title: "Nessun colore", children: "\u2715" }), COLOR_LABELS.map((value) => (_jsx("button", { type: "button", className: `asset-color-dot asset-color-dot--${value}${colorLabel === value ? " asset-color-dot--selected" : ""}`, onClick: () => onUpdatePhoto(photo.id, { colorLabel: colorLabel === value ? null : value }), title: COLOR_LABEL_NAMES[value] }, value)))] })] })] }, photo.id));
                    }) })] }) }));
}
//# sourceMappingURL=CompareModal.js.map