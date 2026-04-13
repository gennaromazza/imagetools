import { useEffect, useCallback } from "react";

interface KeyboardShortcutsProps {
  onUndo?: () => void;
  onRedo?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomFit?: () => void;
  onFullscreen?: () => void;
  onEscape?: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.isContentEditable ||
      target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']")
  );
}

export function KeyboardShortcuts({
  onUndo,
  onRedo,
  onDelete,
  onDuplicate,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  onFullscreen,
  onEscape
}: KeyboardShortcutsProps) {
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (isEditableTarget(event.target)) {
      return;
    }

    const { ctrlKey, metaKey, shiftKey, key } = event;
    const cmdOrCtrl = ctrlKey || metaKey;

    // Prevent default application behavior conflicts for our shortcuts
    if (cmdOrCtrl) {
      switch (key.toLowerCase()) {
        case "z":
          if (shiftKey) {
            event.preventDefault();
            onRedo?.();
          } else {
            event.preventDefault();
            onUndo?.();
          }
          break;
        case "y":
          event.preventDefault();
          onRedo?.();
          break;
        case "+":
        case "=":
          event.preventDefault();
          onZoomIn?.();
          break;
        case "-":
          event.preventDefault();
          onZoomOut?.();
          break;
        case "0":
          event.preventDefault();
          onZoomFit?.();
          break;
        case "d":
          if (!shiftKey) {
            event.preventDefault();
            onDuplicate?.();
          }
          break;
      }
    } else {
      switch (key) {
        case "Delete":
        case "Backspace":
          event.preventDefault();
          onDelete?.();
          break;
        case "F11":
          event.preventDefault();
          onFullscreen?.();
          break;
        case "Escape":
          event.preventDefault();
          onEscape?.();
          break;
      }
    }
  }, [onUndo, onRedo, onDelete, onDuplicate, onZoomIn, onZoomOut, onZoomFit, onFullscreen, onEscape]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // This component doesn't render anything
  return null;
}
