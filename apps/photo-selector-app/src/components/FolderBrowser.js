import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { fileListToEntries, getRecentFolders, hasNativeFolderAccess, openFolderNative, reopenRecentFolder, } from "../services/folder-access";
function formatRelativeTime(timestamp) {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1)
        return "adesso";
    if (minutes < 60)
        return `${minutes} min fa`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return `${hours} or${hours === 1 ? "a" : "e"} fa`;
    const days = Math.floor(hours / 24);
    if (days < 7)
        return `${days} giorn${days === 1 ? "o" : "i"} fa`;
    return new Date(timestamp).toLocaleDateString("it-IT");
}
export function FolderBrowser({ onFolderOpened }) {
    const fileInputRef = useRef(null);
    const [openingRecentFolder, setOpeningRecentFolder] = useState(null);
    const recentFolders = getRecentFolders();
    const supportsNative = hasNativeFolderAccess();
    useEffect(() => {
        if (!fileInputRef.current)
            return;
        fileInputRef.current.setAttribute("webkitdirectory", "");
        fileInputRef.current.setAttribute("directory", "");
    }, []);
    async function handleBrowse() {
        if (supportsNative) {
            const result = await openFolderNative();
            if (result) {
                await onFolderOpened(result);
            }
        }
        else {
            fileInputRef.current?.click();
        }
    }
    function handleFallbackInput(files) {
        if (!files || files.length === 0)
            return;
        const result = fileListToEntries(files);
        void onFolderOpened(result);
    }
    async function handleRecentFolderOpen(folder) {
        if (!supportsNative || openingRecentFolder) {
            return;
        }
        setOpeningRecentFolder(folder.name);
        try {
            const result = await reopenRecentFolder(folder);
            if (result) {
                await onFolderOpened(result);
                return;
            }
            await handleBrowse();
        }
        finally {
            setOpeningRecentFolder(null);
        }
    }
    return (_jsxs("div", { className: "folder-browser", children: [_jsxs("div", { className: "folder-browser__hero", children: [_jsx("div", { className: "folder-browser__icon", children: "\uD83D\uDCC1" }), _jsx("h2", { className: "folder-browser__title", children: "Apri una cartella" }), _jsx("p", { className: "folder-browser__subtitle", children: "Seleziona una cartella con le foto per iniziare la selezione." }), _jsx("div", { className: "folder-browser__actions", children: _jsx("button", { type: "button", className: "primary-button", onClick: handleBrowse, children: "Sfoglia cartella..." }) }), _jsxs("div", { className: "folder-browser__formats", children: [_jsx("span", { className: "folder-browser__formats-label", children: "Formati supportati" }), _jsx("div", { className: "folder-browser__format-tags", children: ["JPEG", "PNG", "WebP", "CR2", "CR3", "NEF", "ARW", "RAF", "DNG", "RW2", "ORF", "PEF", "3FR", "X3F"].map((fmt) => (_jsx("span", { className: "folder-browser__format-tag", children: fmt }, fmt))) })] })] }), recentFolders.length > 0 ? (_jsxs("div", { className: "folder-browser__recent", children: [_jsx("h3", { className: "folder-browser__recent-title", children: "Cartelle recenti" }), _jsx("ul", { className: "folder-browser__recent-list", children: recentFolders.map((folder) => (_jsx("li", { className: "folder-browser__recent-item", children: supportsNative ? (_jsxs("button", { type: "button", className: "folder-browser__recent-button", onClick: () => void handleRecentFolderOpen(folder), disabled: openingRecentFolder !== null, children: [_jsx("div", { className: "folder-browser__recent-icon", children: "\uD83D\uDCC2" }), _jsxs("div", { className: "folder-browser__recent-info", children: [_jsx("span", { className: "folder-browser__recent-name", children: folder.name }), _jsx("span", { className: "folder-browser__recent-meta", children: openingRecentFolder === folder.name
                                                    ? "Riapertura in corso..."
                                                    : `${folder.imageCount} foto · ${formatRelativeTime(folder.openedAt)}` })] })] })) : (_jsxs(_Fragment, { children: [_jsx("div", { className: "folder-browser__recent-icon", children: "\uD83D\uDCC2" }), _jsxs("div", { className: "folder-browser__recent-info", children: [_jsx("span", { className: "folder-browser__recent-name", children: folder.name }), _jsxs("span", { className: "folder-browser__recent-meta", children: [folder.imageCount, " foto \u00B7 ", formatRelativeTime(folder.openedAt)] })] })] })) }, folder.name))) })] })) : null, _jsx("input", { ref: fileInputRef, type: "file", accept: ".jpg,.jpeg,.png,.webp,.cr2,.cr3,.crw,.nef,.nrw,.arw,.srf,.sr2,.raf,.dng,.rw2,.orf,.pef,.srw,.3fr,.x3f,.gpr", multiple: true, className: "hidden-file-input", onChange: (ev) => handleFallbackInput(ev.target.files) })] }));
}
//# sourceMappingURL=FolderBrowser.js.map