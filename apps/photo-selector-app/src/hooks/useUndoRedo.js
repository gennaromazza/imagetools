/**
 * Generic undo/redo hook with configurable history depth.
 * Ctrl+Z = undo, Ctrl+Shift+Z = redo (global keyboard).
 *
 * Usage:
 *   const { push, undo, redo, canUndo, canRedo } = useClassificationHistory(applySnapshot);
 *   function handleChange(next) { push(current); setCurrent(next); }
 *
 * Stores snapshots of T. Does NOT own the "current" state — the consumer
 * manages current state so that non-undoable updates (e.g. thumbnail URLs)
 * can bypass the history stack.
 */
import { useCallback, useEffect, useRef } from "react";
const MAX_HISTORY = 50;
/**
 * @param getCurrent  Returns the live state value (avoids stale closures).
 * @param apply       Called when undo/redo fires — apply the restored snapshot.
 */
export function useUndoRedo(getCurrent, apply) {
    const pastRef = useRef([]);
    const futureRef = useRef([]);
    const getRef = useRef(getCurrent);
    const applyRef = useRef(apply);
    getRef.current = getCurrent;
    applyRef.current = apply;
    const push = useCallback((snapshot) => {
        pastRef.current.push(snapshot);
        if (pastRef.current.length > MAX_HISTORY)
            pastRef.current.shift();
        futureRef.current = [];
    }, []);
    const undo = useCallback(() => {
        const prev = pastRef.current.pop();
        if (prev === undefined)
            return;
        futureRef.current.push(getRef.current());
        applyRef.current(prev);
    }, []);
    const redo = useCallback(() => {
        const next = futureRef.current.pop();
        if (next === undefined)
            return;
        pastRef.current.push(getRef.current());
        applyRef.current(next);
    }, []);
    const reset = useCallback(() => {
        pastRef.current = [];
        futureRef.current = [];
    }, []);
    // Global keyboard binding
    useEffect(() => {
        const handler = (e) => {
            const mod = e.ctrlKey || e.metaKey;
            if (!mod || e.key.toLowerCase() !== "z")
                return;
            const target = e.target;
            if (target.closest("input, textarea, select, [contenteditable]"))
                return;
            e.preventDefault();
            if (e.shiftKey) {
                redo();
            }
            else {
                undo();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [undo, redo]);
    return {
        push,
        undo,
        redo,
        get canUndo() { return pastRef.current.length > 0; },
        get canRedo() { return futureRef.current.length > 0; },
        reset,
    };
}
//# sourceMappingURL=useUndoRedo.js.map