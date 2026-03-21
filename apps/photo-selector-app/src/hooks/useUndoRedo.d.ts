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
export interface UndoRedoHandle<T> {
    /** Push the current state before making a change. */
    push: (snapshot: T) => void;
    undo: () => void;
    redo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    /** Reset history (e.g. folder change). */
    reset: () => void;
}
/**
 * @param getCurrent  Returns the live state value (avoids stale closures).
 * @param apply       Called when undo/redo fires — apply the restored snapshot.
 */
export declare function useUndoRedo<T>(getCurrent: () => T, apply: (snapshot: T) => void): UndoRedoHandle<T>;
