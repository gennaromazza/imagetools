import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { getRecentFolders, hydrateRecentFolders, openFolderNative, removeRecentFolder, reopenRecentFolder, } from "../services/folder-access";
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
export function FolderBrowser({ onFolderOpened, isBusy = false }) {
    const [openingRecentFolder, setOpeningRecentFolder] = useState(null);
    const [recentFolders, setRecentFolders] = useState(() => getRecentFolders());
    useEffect(() => {
        let active = true;
        void hydrateRecentFolders().then((folders) => {
            if (active) {
                setRecentFolders(folders);
            }
        });
        return () => {
            active = false;
        };
    }, []);
    async function handleBrowse() {
        if (isBusy) {
            return;
        }
        const result = await openFolderNative();
        if (result) {
            await onFolderOpened(result);
        }
    }
    async function handleRecentFolderOpen(folder) {
        if (openingRecentFolder || isBusy) {
            return;
        }
        setOpeningRecentFolder(folder.name);
        try {
            const result = await reopenRecentFolder(folder);
            if (result) {
                await onFolderOpened(result);
                return;
            }
            const nextRecentFolders = await removeRecentFolder(folder.path ?? folder.name);
            setRecentFolders(nextRecentFolders);
            await handleBrowse();
        }
        finally {
            setOpeningRecentFolder(null);
        }
    }
    return (_jsxs("div", { className: "folder-browser", children: [_jsxs("div", { className: "folder-browser__hero", children: [_jsx("div", { className: "folder-browser__icon", children: "??" }), _jsx("h2", { className: "folder-browser__title", children: "Apri una cartella" }), _jsx("p", { className: "folder-browser__subtitle", children: "Seleziona una cartella con le foto per iniziare la selezione." }), _jsx("div", { className: "folder-browser__actions", children: _jsx("button", { type: "button", className: "primary-button", onClick: handleBrowse, disabled: isBusy, children: isBusy ? "Apertura in corso..." : "Sfoglia cartella..." }) }), _jsxs("div", { className: "folder-browser__formats", children: [_jsx("span", { className: "folder-browser__formats-label", children: "Formati supportati" }), _jsx("div", { className: "folder-browser__format-tags", children: ["JPEG", "PNG", "WebP", "CR2", "CR3", "NEF", "ARW", "RAF", "DNG", "RW2", "ORF", "PEF", "3FR", "X3F"].map((fmt) => (_jsx("span", { className: "folder-browser__format-tag", children: fmt }, fmt))) })] })] }), recentFolders.length > 0 ? (_jsxs("div", { className: "folder-browser__recent", children: [_jsx("h3", { className: "folder-browser__recent-title", children: "Cartelle recenti" }), _jsx("ul", { className: "folder-browser__recent-list", children: recentFolders.map((folder) => (_jsx("li", { className: "folder-browser__recent-item", children: _jsxs("button", { type: "button", className: "folder-browser__recent-button", onClick: () => void handleRecentFolderOpen(folder), disabled: openingRecentFolder !== null || isBusy, children: [_jsx("div", { className: "folder-browser__recent-icon", children: "??" }), _jsxs("div", { className: "folder-browser__recent-info", children: [_jsx("span", { className: "folder-browser__recent-name", children: folder.name }), _jsx("span", { className: "folder-browser__recent-meta", children: openingRecentFolder === folder.name
                                                    ? "Riapertura in corso..."
                                                    : `${folder.imageCount} foto � ${formatRelativeTime(folder.openedAt)}` })] })] }) }, folder.name))) })] })) : null] }));
}
//# sourceMappingURL=FolderBrowser.js.map