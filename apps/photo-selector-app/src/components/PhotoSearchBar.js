import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useRef, useState } from "react";
export function PhotoSearchBar({ value, onChange, resultCount, totalCount }) {
    const inputRef = useRef(null);
    const [focused, setFocused] = useState(false);
    return (_jsxs("div", { className: `photo-search ${focused ? "photo-search--focused" : ""}`, children: [_jsx("span", { className: "photo-search__icon", "aria-hidden": true, children: "\uD83D\uDD0D" }), _jsx("input", { ref: inputRef, type: "text", className: "photo-search__input", placeholder: "Cerca per nome file\u2026", value: value, onChange: (e) => onChange(e.target.value), onFocus: () => setFocused(true), onBlur: () => setFocused(false), "aria-label": "Cerca foto per nome file" }), value ? (_jsxs(_Fragment, { children: [_jsxs("span", { className: "photo-search__count", children: [resultCount, "/", totalCount] }), _jsx("button", { type: "button", className: "photo-search__clear", onClick: () => { onChange(""); inputRef.current?.focus(); }, "aria-label": "Cancella ricerca", title: "Cancella ricerca", children: "\u2715" })] })) : null] }));
}
//# sourceMappingURL=PhotoSearchBar.js.map